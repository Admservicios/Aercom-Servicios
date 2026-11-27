export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function initializeCases(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      kind TEXT NOT NULL CHECK(kind IN ('Abonado', 'Tercero'))
    );
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
      subject TEXT NOT NULL, equipment TEXT NOT NULL DEFAULT '',
      owner_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL, closed_at TEXT, version INTEGER NOT NULL DEFAULT 1, assigned_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id),
      kind TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('Pendiente', 'En curso', 'Completada')),
      due_date TEXT NOT NULL, note TEXT NOT NULL, pending_since TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS actions_case ON actions(case_id);
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id),
      author_id INTEGER NOT NULL REFERENCES users(id), timestamp TEXT NOT NULL,
      description TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_case ON history(case_id);
  `);
}

export function field(value, label, limit, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > limit || (required && !value.trim())) {
    throw new HttpError(400, 'Revisá el campo ' + label + '.');
  }
  return value.trim();
}

export function linkedId(db, table, value, label, optional = false) {
  if (optional && (value == null || value === '')) return null;
  if (!Number.isSafeInteger(Number(value)) || !db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(Number(value))) {
    throw new HttpError(400, 'Seleccioná ' + label + ' válido.');
  }
  return Number(value);
}

export function createClient(db, data) {
  const name = field(data.name, 'cliente', 160, true);
  if (!['Abonado', 'Tercero'].includes(data.kind)) throw new HttpError(400, 'Seleccioná el tipo de cliente.');
  const row = db.prepare('INSERT INTO clients (name, kind) VALUES (?, ?) ON CONFLICT(name) DO NOTHING RETURNING *').get(name, data.kind);
  if (!row) throw new HttpError(409, 'Ya existe un cliente con ese nombre. Seleccionalo de la lista.');
  return row;
}

export function options(db) {
  return {
    clients: db.prepare('SELECT * FROM clients ORDER BY name COLLATE NOCASE').all(),
    users: db.prepare('SELECT id, username, name FROM users ORDER BY name, id').all(),
  };
}

const caseQuery = `
  SELECT cases.*, clients.name AS client, clients.kind,
         users.name AS owner
  FROM cases JOIN clients ON clients.id = cases.client_id
  LEFT JOIN users ON users.id = cases.owner_id
`;

export function listCases(db) {
  return readSnapshot(db, () => {
    const actions = db.prepare("SELECT actions.*, users.name AS owner FROM actions JOIN users ON users.id = actions.owner_id WHERE status != 'Completada' ORDER BY actions.id").all();
    const byCase = Map.groupBy(actions, action => action.case_id);
    return db.prepare(caseQuery + ' ORDER BY cases.id DESC').all().map(row => ({
      ...row, next: nextAction(row, byCase.get(row.id) ?? []),
    }));
  });
}

export function getCase(db, id) {
  const row = db.prepare(caseQuery + ' WHERE cases.id = ?').get(id);
  if (!row) throw new HttpError(404, 'Caso no encontrado.');
  return row;
}

export function caseFields(db, data) {
  return [
    linkedId(db, 'clients', data.client_id, 'un cliente'),
    field(data.subject, 'asunto', 180, true),
    field(data.equipment, 'equipo', 160),
    linkedId(db, 'users', data.owner_id, 'un responsable', true),
  ];
}

function record(db, id, author, timestamp, description) {
  db.prepare('INSERT INTO history (case_id, author_id, timestamp, description) VALUES (?, ?, ?, ?)')
    .run(id, author, timestamp, description);
}

function changedFields(before, after, fields) {
  return Object.entries(fields).filter(([key]) => before[key] !== after[key]).map(([key, label]) => {
    const oldValue = before[key] || '—';
    const newValue = after[key] || '—';
    return `${label} «${oldValue}» → «${newValue}»`;
  }).join(' · ');
}

function checkVersion(row, data) {
  if (data.version !== row.version) {
    throw new HttpError(409, 'Otra sesión cambió estos datos. Tu edición sigue abierta. Cerrá el editor para revisar los datos actuales y volvé a abrirlo para aplicar el cambio.');
  }
}

export function createCase(db, data, author) {
  return transaction(db, () => {
    const now = new Date().toISOString();
    const row = db.prepare(`
      INSERT INTO cases (client_id, subject, equipment, owner_id, created_at, assigned_at)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING id
    `).get(...caseFields(db, data), now, now);
    const saved = getCase(db, row.id);
    const assignment = saved.owner ? ' · Responsable ' + saved.owner : '';
    record(db, row.id, author, now, 'Caso abierto · ' + saved.client + ' · ' + saved.subject + assignment);
    return row;
  });
}

export const actionKinds = ['Análisis', 'Cotización', 'Aprobación', 'Pedido', 'Visita', 'Resultado', 'Factura', 'Cierre'];
export const actionStatuses = ['Pendiente', 'En curso', 'Completada'];

function readSnapshot(db, operation) {
  return transaction(db, operation, 'BEGIN');
}

function transaction(db, operation, begin = 'BEGIN IMMEDIATE') {
  db.exec(begin);
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function actionsFor(db, id) {
  return db.prepare(`
    SELECT actions.*, users.name AS owner FROM actions JOIN users ON users.id = actions.owner_id
    WHERE case_id = ? ORDER BY actions.id
  `).all(id);
}

export function detail(db, id) {
  return readSnapshot(db, () => {
    const row = getCase(db, id);
    const actions = actionsFor(db, id);
    const history = db.prepare(`
      SELECT history.id, timestamp, description, users.name AS author, users.username
      FROM history JOIN users ON users.id = author_id WHERE case_id = ? ORDER BY history.id DESC
    `).all(id);
    return { ...row, actions, history, next: nextAction(row, actions) };
  });
}

function ensureOpen(row) {
  if (row.closed_at) throw new HttpError(409, 'El caso está cerrado.');
}

export function updateCase(db, id, data, author) {
  return transaction(db, () => {
    const previous = getCase(db, id);
    ensureOpen(previous);
    checkVersion(previous, data);
    const values = caseFields(db, data);
    if (values.every((value, index) => value === previous[['client_id', 'subject', 'equipment', 'owner_id'][index]])) return previous;
    const now = new Date().toISOString();
    const assigned = previous.owner_id === values[3] ? previous.assigned_at : now;
    db.prepare('UPDATE cases SET client_id = ?, subject = ?, equipment = ?, owner_id = ?, assigned_at = ?, version = version + 1 WHERE id = ?')
      .run(...values, assigned, id);
    const row = getCase(db, id);
    const changes = changedFields(previous, row, {
      client: 'Cliente', kind: 'Tipo', subject: 'Asunto', equipment: 'Equipo', owner: 'Responsable',
    });
    record(db, id, author, now, 'Datos del caso actualizados · ' + changes);
    return row;
  });
}

function actionFields(db, data, kind) {
  if (!actionKinds.includes(kind) || !actionStatuses.includes(data.status)) {
    throw new HttpError(400, 'Seleccioná un tipo y un estado válidos.');
  }
  const due = field(data.due_date, 'fecha prevista', 10);
  if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) ||
      !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due)) {
    throw new HttpError(400, 'Ingresá una fecha válida.');
  }
  return [linkedId(db, 'users', data.owner_id, 'un responsable'), data.status, due,
    field(data.note, kind === 'Factura' ? 'referencia de factura' : 'detalle', 3000,
      kind === 'Factura' && data.status === 'Completada')];
}

function finishCase(db, caseId, kind, status, timestamp) {
  if (kind !== 'Cierre' || status !== 'Completada') return;
  const pending = db.prepare("SELECT id FROM actions WHERE case_id = ? AND status != 'Completada' LIMIT 1").get(caseId);
  if (pending) throw new HttpError(409, 'Completá las demás acciones pendientes antes de cerrar el caso.');
  db.prepare('UPDATE cases SET closed_at = ?, version = version + 1 WHERE id = ?').run(timestamp, caseId);
}

export function saveAction(db, caseId, data, author, actionId) {
  return transaction(db, () => {
    ensureOpen(getCase(db, caseId));
    const previous = actionId && actionsFor(db, caseId).find(action => action.id === actionId);
    if (actionId && !previous) throw new HttpError(404, 'Acción no encontrada.');
    if (previous) checkVersion(previous, data);
    const kind = previous ? previous.kind : data.kind;
    const values = actionFields(db, data, kind);
    if (previous && values.every((value, index) => value === previous[['owner_id', 'status', 'due_date', 'note'][index]])) return previous;
    const timestamp = new Date().toISOString();
    const since = previous && previous.owner_id === values[0] && previous.status !== 'Completada'
      ? previous.pending_since : timestamp;
    const row = previous
      ? db.prepare('UPDATE actions SET owner_id = ?, status = ?, due_date = ?, note = ?, pending_since = ?, version = version + 1 WHERE id = ? RETURNING *')
        .get(...values, since, actionId)
      : db.prepare('INSERT INTO actions (case_id, kind, owner_id, status, due_date, note, pending_since) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *')
        .get(caseId, kind, ...values, since);
    finishCase(db, caseId, kind, row.status, timestamp);
    const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(row.owner_id).name;
    const description = previous
      ? 'Acción actualizada · ' + kind + ' · ' + changedFields(previous, { ...row, owner }, {
        status: 'Estado', owner: 'Responsable', due_date: 'Fecha prevista', note: 'Detalle',
      })
      : ['Acción registrada', kind, row.status, owner, row.due_date, row.note].filter(Boolean).join(' · ');
    record(db, caseId, author, timestamp,
      kind === 'Cierre' && row.status === 'Completada' ? 'Caso cerrado · ' + description : description);
    return row;
  });
}

export function nextAction(row, actions) {
  return actions.find(action => action.status === 'En curso') ??
    actions.find(action => action.status === 'Pendiente') ??
    (row.closed_at ? null : { kind: '', owner: row.owner, pending_since: row.assigned_at });
}
