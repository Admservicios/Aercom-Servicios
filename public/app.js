const page = document.querySelector('#page');
const nav = document.querySelector('#nav');
const account = document.querySelector('#account');
let activePerson;
const path = location.pathname;
const id = /^\/casos\/(\d+)$/.exec(path)?.[1];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function api(path, method = 'GET', data) {
  const response = await fetch('/api/' + path, {
    method,
    ...(data ? { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', 'X-Aercom-Person': String(activePerson?.id ?? '') } } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function formData(form) {
  return Object.fromEntries(new FormData(form));
}

function bindForm(form, save) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const error = form.querySelector('.error');
    error.textContent = '';
    const buttons = [...form.querySelectorAll('button[type=submit]')];
    buttons.forEach(button => { button.disabled = true; });
    try { await save(formData(form)); }
    catch (failure) { error.textContent = failure.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  });
}

const submit = text => `<p class="error" role="alert"></p><div class="buttons"><button class="primary" type="submit">${text}</button></div>`;

async function choosePerson({ changing = false } = {}) {
  const people = await api('people');
  const picker = document.createElement('section');
  picker.className = 'panel picker';
  picker.innerHTML = `<h1>${changing ? 'Cambiar nombre' : 'Elegí tu nombre'}</h1>
    <p class="muted">${people.length ? 'El historial registra los cambios con el nombre que elijas.' :
      'La lista está vacía. Pedile a Sistemas que cargue los nombres del equipo.'}</p>
    <div class="person-list">${people.map(person => `<button type="button" data-person="${person.id}"
      ${person.id === activePerson?.id ? 'disabled' : ''}>${escapeHtml(person.name)}
      ${person.id === activePerson?.id ? '<small>Activo</small>' : '<span aria-hidden="true">→</span>'}</button>`).join('')}</div>
    <p class="error" role="alert"></p>
    ${changing ? '<div class="buttons picker-controls"><button type="button" data-cancel>Cancelar</button><button type="button" data-clear>Quitar selección</button></div>' : ''}`;
  function bind(button, route, data) {
    button.onclick = async () => {
      const enabled = [...picker.querySelectorAll('button:not(:disabled)')];
      enabled.forEach(control => { control.disabled = true; });
      try {
        await api(route, 'POST', data);
        location.reload();
      } catch (error) {
        picker.querySelector('.error').textContent = error.message;
        enabled.forEach(control => { control.disabled = false; });
      }
    };
  }
  for (const button of picker.querySelectorAll('[data-person]')) {
    bind(button, 'selection', { person_id: Number(button.dataset.person) });
  }
  if (changing) {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Cambiar nombre');
    dialog.append(picker);
    picker.querySelector('[data-cancel]').onclick = () => dialog.close();
    bind(picker.querySelector('[data-clear]'), 'clear-selection', {});
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  } else {
    page.replaceChildren(picker);
  }
}

function heading(title, subtitle, button = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`;
}

const h = escapeHtml;
const formatter = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const displayDate = date => date ? formatter.format(new Date(date)) : '—';
const selectOptions = (rows, value, label) => rows.map(row =>
  `<option value="${row.id}" ${row.id === Number(value) ? 'selected' : ''}>${h(label(row))}</option>`).join('');
const userOptions = (users, value) => selectOptions(users, value, row => row.name);
const clientOptions = (clients, value) => selectOptions(clients, value, row => `${row.name} · ${row.kind}`);

function poll(refresh, status) {
  let running = false;
  setInterval(async () => {
    if (running || document.hidden) return;
    running = true;
    try {
      await refresh();
      status.hidden = true;
    } catch (error) {
      status.textContent = error.status === 401
        ? 'La selección venció. Elegí tu nombre en otra pestaña para conservar tu edición.'
        : 'No se pudo actualizar. Reintentando…';
      status.hidden = false;
    } finally { running = false; }
  }, 2500);
}

const syncNotice = '<p id="sync-notice" class="notice" role="status" hidden></p>';

async function casesPage() {
  page.innerHTML = heading('Casos', 'Seguimiento de pedidos de Servicios', '<a class="button primary" href="/nuevo">+ Nuevo caso</a>') +
    syncNotice + '<section class="panel"><div class="toolbar"><label>Buscar casos<input type="search" id="search" placeholder="Asunto, cliente o número de caso"></label></div><div id="case-list" class="table-area"></div></section>';
  const search = page.querySelector('#search');
  const list = page.querySelector('#case-list');
  let cases = [];
  let snapshot;
  function render() {
    const query = search.value.trim().toLocaleLowerCase('es-AR');
    const rows = cases.filter(row => `#${row.id} ${row.subject} ${row.client} ${row.equipment}`.toLocaleLowerCase('es-AR').includes(query));
    list.innerHTML = rows.length ? `<table><thead><tr><th>Caso</th><th>Cliente</th><th>Tipo</th><th>Estado</th><th>Próxima acción</th><th>Desde</th></tr></thead>
      <tbody>${rows.map(row => `<tr><td><a href="/casos/${row.id}">${h(row.subject)}</a><br><small class="muted">#${row.id}</small></td>
      <td>${h(row.client)}</td><td><span class="badge">${h(row.kind)}</span></td>
      <td>${caseStatus(row)}</td><td>${row.next ? `<strong>${h(row.next.kind || 'Por definir')}</strong><br><small>${h(row.next.owner || 'Sin asignar')}</small>` : '—'}</td><td>${displayDate(row.next?.pending_since)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted">${query ? 'No se encontraron casos.' : 'Todavía no hay casos.'}</p>`;
  }
  async function refresh() {
    const latest = await api('cases');
    const state = JSON.stringify(latest);
    if (state === snapshot) return;
    cases = latest;
    snapshot = state;
    render();
  }
  search.addEventListener('input', render);
  await refresh();
  poll(refresh, page.querySelector('#sync-notice'));
}

function caseInputs({ clients, users }, row = {}) {
  return `<label class="wide">Cliente<select name="client_id" required><option value="">Seleccionar cliente</option>${clientOptions(clients, row.client_id)}</select></label>
    <label class="wide">Asunto<input name="subject" required maxlength="180" value="${h(row.subject)}"></label>
    <label>Equipo (opcional)<input name="equipment" maxlength="160" value="${h(row.equipment)}"></label>
    <label>Responsable (opcional)<select name="owner_id"><option value="">Sin asignar</option>${userOptions(users, row.owner_id)}</select></label>`;
}

async function newPage() {
  page.innerHTML = heading('Nuevo caso', 'Registrá un pedido de Servicios') +
    '<section class="panel narrow" id="new-case"></section>';
  const choices = await api('options');
  const panel = page.querySelector('#new-case');
  panel.innerHTML = `<h2>Datos del caso</h2><form id="create-case" class="fields two">${caseInputs(choices)}
    <div class="wide">${submit('Crear caso')}</div></form>
    <details class="client-create"><summary>+ Dar de alta un cliente</summary>
    <form id="create-client" class="fields two"><label>Nombre del cliente<input name="name" required maxlength="160"></label>
    <label>Tipo de cliente<select name="kind"><option>Abonado</option><option>Tercero</option></select></label>
    <div class="wide">${submit('Guardar cliente')}</div></form></details>`;
  const form = panel.querySelector('#create-case');
  bindForm(form, async data => {
    const row = await api('cases', 'POST', data);
    location.assign('/casos/' + row.id);
  });
  const clientForm = panel.querySelector('#create-client');
  bindForm(clientForm, async data => {
    const client = await api('clients', 'POST', data);
    const select = form.elements.client_id;
    select.add(new Option(client.name + ' · ' + client.kind, client.id));
    select.value = client.id;
    clientForm.reset();
    clientForm.closest('details').open = false;
  });
}

function summary(row) {
  const items = [['Cliente', row.client], ['Tipo', row.kind], ['Responsable', row.owner || 'Sin asignar'],
    ['Equipo', row.equipment || 'Sin registrar'], ['Alta', displayDate(row.created_at)]];
  return `<dl class="summary">${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${h(value)}</dd></div>`).join('')}</dl>`;
}

const caseStatus = row => `<span class="badge ${row.closed_at ? '' : 'open'}">${row.closed_at ? 'Cerrado' : 'Abierto'}</span>`;
const plannedDate = date => date ? date.split('-').reverse().join('/') : '';

function actionInputs(choices, action) {
  return `${action ? '' : `<label>Tipo<select name="kind">${choices.actionKinds.map(kind => `<option>${kind}</option>`).join('')}</select></label>`}
    <label>Responsable<select name="owner_id" required><option value="">Seleccionar responsable</option>${userOptions(choices.users, action?.owner_id)}</select></label>
    <label>Estado<select name="status">${choices.actionStatuses.map(status => `<option ${status === action?.status ? 'selected' : ''}>${status}</option>`).join('')}</select></label>
    <label>Fecha prevista (opcional)<input type="date" name="due_date" value="${h(action?.due_date)}"></label>
    <label class="wide">Detalle o referencia de factura<textarea name="note" rows="3" maxlength="3000">${h(action?.note)}</textarea></label>`;
}

function actionCard(action, choices, closed) {
  return `<article class="action" data-card="${action.id}"><div class="action-view"><div class="section-head">
    <h3>${h(action.kind)}</h3><span class="badge ${action.status === 'En curso' ? 'open' : ''}">${h(action.status)}</span></div>
    <div class="action-meta">${h(action.owner)}${action.due_date ? ' · Prevista ' + plannedDate(action.due_date) : ''}
    ${action.status === 'Completada' ? '' : ' · Desde ' + displayDate(action.pending_since)}</div>
    ${action.note ? `<p>${h(action.note)}</p>` : ''}</div>
    ${closed ? '' : `<details><summary>Editar acción</summary><form class="fields two" data-action="${action.id}" data-version="${action.version}">${actionInputs(choices, action)}
      <div class="wide">${submit('Guardar acción')}</div></form></details>`}</article>`;
}

function historyEntries(history) {
  return `<ol class="timeline">${history.map(entry => `<li>
    <strong>${h(entry.author)}</strong> <small>${displayDate(entry.timestamp)}</small>
    <div>${h(entry.description)}</div></li>`).join('')}</ol>`;
}

async function detailPage() {
  page.innerHTML = '<p><a href="/">← Casos</a></p>' + syncNotice + '<div id="detail"></div>';
  const region = page.querySelector('#detail');
  let choices = await api('options');
  const route = 'cases/' + id;
  let snapshot;
  let requested = 0;
  let applied = 0;

  function markup(row) {
    const next = row.closed_at ? `<p>Cerrado el ${displayDate(row.closed_at)}</p>` :
      `<h3>${h(row.next.kind || 'Por definir')}</h3><p>${h(row.next.owner || 'Sin asignar')}<br>
      <span class="muted">Desde ${displayDate(row.next.pending_since)}</span></p>`;
    return `<div id="detail-heading">${heading(h(row.subject), 'Caso #' + row.id, caseStatus(row))}</div>
      <section class="panel"><div id="case-summary">${summary(row)}</div><div id="case-editor">
      ${row.closed_at ? '' : `<details class="client-create"><summary>Editar datos del caso</summary>
        <form id="edit-case" data-version="${row.version}" class="fields two">${caseInputs(choices, row)}<div class="wide">${submit('Guardar datos')}</div></form></details>`}</div></section>
      <div class="details"><section class="panel"><h2>Acciones</h2><div id="action-editor">
      ${row.closed_at ? '' : `<details class="new-action"><summary>+ Registrar acción</summary>
        <form id="new-action" class="fields two">${actionInputs(choices)}<div class="wide">${submit('Registrar acción')}</div></form></details>`}</div>
      <div id="actions">${row.actions.length ? row.actions.map(action => actionCard(action, choices, row.closed_at)).join('') : '<p class="muted">Todavía no hay acciones.</p>'}</div>
      </section><aside><section class="panel"><h2>Próxima acción</h2><div id="next">${next}</div></section>
      <section class="panel"><h2>Historial</h2><div id="history">${historyEntries(row.history)}</div></section></aside></div>`;
  }

  function bindEditors(container) {
    for (const form of container.querySelectorAll('form')) {
      const target = form.id === 'edit-case' ? route : route + '/actions' + (form.dataset.action ? '/' + form.dataset.action : '');
      const method = form.id === 'new-action' ? 'POST' : 'PUT';
      const editor = form.closest('details');
      bindForm(form, async data => {
        await api(target, method, { ...data, version: Number(form.dataset.version) });
        editor.open = false;
        await refresh(true);
      });
      editor.addEventListener('toggle', () => {
        if (!editor.open && editor.isConnected) refresh(true).catch(() => {});
      });
    }
  }

  function render(row) {
    const next = document.createElement('div');
    next.innerHTML = markup(row);
    bindEditors(next);
    if (!region.querySelector('details[open]')) {
      region.replaceChildren(...next.childNodes);
      return;
    }
    for (const selector of ['#detail-heading', '#case-summary', '#next', '#history', '#case-editor', '#action-editor']) {
      const current = region.querySelector(selector);
      if (!current.querySelector('details[open]')) current.replaceWith(next.querySelector(selector));
    }
    const actions = region.querySelector('#actions');
    const cards = next.querySelectorAll('[data-card]');
    if (cards.length) actions.querySelector(':scope > p')?.remove();
    for (const card of cards) {
      const current = actions.querySelector(`[data-card="${card.dataset.card}"]`);
      if (!current) actions.append(card);
      else if (!current.querySelector('details[open]')) current.replaceWith(card);
      else current.querySelector('.action-view').replaceWith(card.querySelector('.action-view'));
    }
  }

  async function refresh(force = false) {
    const sequence = ++requested;
    const [row, options] = await Promise.all([api(route), api('options')]);
    if (sequence < applied) return;
    applied = sequence;
    const state = JSON.stringify([row, options]);
    if (!force && state === snapshot) return;
    snapshot = state;
    choices = options;
    render(row);
  }
  await refresh();
  poll(refresh, page.querySelector('#sync-notice'));
}

async function start() {
  try { activePerson = await api('me'); }
  catch (error) {
    if (error.status === 401) return choosePerson();
    throw error;
  }
  nav.hidden = account.hidden = false;
  document.querySelector('#identity').textContent = activePerson.name;
  nav.querySelector(path === '/nuevo' ? 'a:last-child' : 'a:first-child').setAttribute('aria-current', 'page');
  const change = document.querySelector('#change-person');
  change.onclick = async () => {
    change.disabled = true;
    try { await choosePerson({ changing: true }); }
    catch (error) { document.querySelector('#identity-error').textContent = error.message; }
    finally { change.disabled = false; }
  };
  if (path === '/nuevo') await newPage();
  else if (id) await detailPage();
  else await casesPage();
}

start().catch(error => {
  const status = document.createElement('p');
  status.className = 'error';
  status.textContent = error.message;
  page.prepend(status);
});
