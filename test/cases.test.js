import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { openDatabase, initializePeople } from '../db.js';
import { addPerson } from '../identity.js';
import { actionsFor, saveAction, updateCase, createCase, createClient, getCase, initializeCases, listCases } from '../cases.js';

test('base de casos vacía y alta mínima con clasificación del cliente', t => {
  const dir = mkdtempSync('/tmp/aercom-cases-');
  const db = openDatabase(dir + '/test.sqlite');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  initializePeople(db);
  initializeCases(db);
  assert.deepEqual(listCases(db), []);
  addPerson(db, 'Ana');
  assert.throws(() => createCase(db, { subject: 'Visita' }), { status: 400 });
  for (const kind of ['Abonado', 'Tercero']) {
    const client = createClient(db, { name: kind + ' de prueba', kind });
    const { id } = createCase(db, { client_id: client.id, subject: 'Visita' }, 1);
    const row = getCase(db, id);
    assert.equal(row.kind, kind);
    assert.equal(row.owner_id, null);
    assert.equal(row.equipment, '');
  }
  assert.throws(() => createClient(db, { name: 'abonado de prueba', kind: 'Tercero' }), { status: 409 });
});


test('acciones independientes, asignación posterior, factura y cierre', t => {
  const dir = mkdtempSync('/tmp/aercom-actions-');
  const db = openDatabase(dir + '/test.sqlite');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  initializePeople(db);
  initializeCases(db);
  addPerson(db, 'Ana');
  const client = createClient(db, { name: 'Cliente', kind: 'Tercero' });
  const data = { client_id: client.id, subject: 'Servicio' };
  const { id } = createCase(db, data, 1);
  updateCase(db, id, { ...data, owner_id: 1, equipment: 'Bomba', version: 1 }, 1);
  assert.equal(getCase(db, id).equipment, 'Bomba');
  const base = { owner_id: 1, status: 'Pendiente', due_date: '2026-12-01' };
  const visit = saveAction(db, id, { ...base, kind: 'Visita' }, 1);
  const analysis = saveAction(db, id, { ...base, kind: 'Análisis' }, 1);
  const completed = { ...base, status: 'Completada', version: 1 };
  saveAction(db, id, completed, 1, analysis.id);
  assert.equal(actionsFor(db, id).find(action => action.id === visit.id).status, 'Pendiente');
  assert.equal(listCases(db)[0].next.kind, 'Visita');
  assert.throws(() => saveAction(db, id, { ...completed, kind: 'Cierre' }, 1), { status: 409 });
  assert.equal(actionsFor(db, id).length, 2);
  saveAction(db, id, completed, 1, visit.id);
  assert.throws(() => saveAction(db, id, { ...completed, kind: 'Factura' }, 1), { status: 400 });
  saveAction(db, id, { ...completed, kind: 'Factura', note: 'FC A-100' }, 1);
  saveAction(db, id, { ...completed, kind: 'Cierre' }, 1);
  assert.ok(getCase(db, id).closed_at);
  assert.throws(() => saveAction(db, id, { ...base, kind: 'Pedido' }, 1), { status: 409 });
});
