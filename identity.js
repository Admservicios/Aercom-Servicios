import { createHash, randomBytes } from 'node:crypto';

const hashToken = token => createHash('sha256').update(token).digest('hex');
const duration = 12 * 60 * 60;

export function people(db) {
  return db.prepare('SELECT id, name FROM users ORDER BY name COLLATE NOCASE, id').all();
}

export function addPerson(db, name) {
  name = name.trim().normalize('NFC');
  if (!name || name.length > 120 || /[\p{Cc}]/u.test(name)) throw new Error('Ingresá un nombre de hasta 120 caracteres.');
  const row = db.prepare(`
    INSERT INTO users (name) SELECT ? WHERE NOT EXISTS (
      SELECT 1 FROM users WHERE name = ? COLLATE NOCASE
    ) RETURNING id, name
  `).get(name, name);
  if (!row) throw new Error('Ese nombre ya figura en la lista. Usá un nombre distintivo.');
  return row;
}

export function selectPerson(db, id, previousToken) {
  if (!Number.isSafeInteger(id)) return null;
  const person = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!person) return null;
  const token = randomBytes(32).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hashToken(token), person.id, Date.now() + duration * 1000);
    if (previousToken) clearSelection(db, previousToken);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { token, person };
}

export function sessionUser(db, token) {
  return db.prepare(`
    SELECT users.id, users.name FROM sessions
    JOIN users ON users.id = sessions.user_id WHERE token = ? AND expires > ?
  `).get(hashToken(token), Date.now());
}

export function clearSelection(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(token));
}

export function sessionCookie(token) {
  const secure = process.env.AERCOM_SECURE_COOKIE === '1' ? '; Secure' : '';
  return `aercom_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? duration : 0}${secure}`;
}
