import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createApp } from '../server.js';
import { openDatabase } from '../db.js';
import { createAccount } from '../auth.js';

test('API compartida, conflictos, reinicio y restauración de un respaldo', async t => {
  const dir = mkdtempSync('/tmp/aercom-http-');
  const path = dir + '/test.sqlite';
  let server;
  let base;
  async function start(database = path) {
    server = createApp(database);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
  }
  async function stop() {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
  t.after(async () => { await stop(); rmSync(dir, { recursive: true, force: true }); });
  await start();
  const db = openDatabase(path);
  createAccount(db, 'ana', 'Ana', 'clave temporal 1');
  createAccount(db, 'luis', 'Luis', 'clave temporal 2');
  db.close();

  async function request(route, { cookie, method = 'GET', data } = {}) {
    const response = await fetch(base + '/api/' + route, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }

  assert.equal((await request('cases')).status, 401);
  const ana = (await request('login', { method: 'POST', data: { username: 'ana', password: 'clave temporal 1' } })).cookie;
  const luis = (await request('login', { method: 'POST', data: { username: 'luis', password: 'clave temporal 2' } })).cookie;
  const client = (await request('clients', { cookie: ana, method: 'POST', data: { name: 'Planta Norte', kind: 'Abonado' } })).body;
  const data = { client_id: client.id, subject: 'Bomba', owner_id: 2, author_id: 2 };
  const created = await request('cases', { cookie: ana, method: 'POST', data });
  assert.equal(created.status, 201);
  const route = 'cases/' + created.body.id;
  const saved = await request(route, { cookie: luis, method: 'PUT', data: { ...data, equipment: 'B-12', version: 1 } });
  assert.equal(saved.status, 200);
  assert.equal((await request(route, { cookie: ana, method: 'PUT', data: { ...data, equipment: 'Obsoleto', version: 1 } })).status, 409);
  const actionData = { kind: 'Resultado', owner_id: 2, status: 'Pendiente' };
  const action = await request(route + '/actions', { cookie: ana, method: 'POST', data: actionData });
  assert.equal(action.status, 201);
  const actionRoute = route + '/actions/' + action.body.id;
  const complete = { ...actionData, version: 1, status: 'Completada', note: 'Verificado' };
  assert.equal((await request(actionRoute, { cookie: luis, method: 'PUT', data: complete })).status, 200);
  assert.equal((await request(actionRoute, { cookie: ana, method: 'PUT', data: { ...complete, note: 'Obsoleto' } })).status, 409);

  await stop();
  await start();
  const detail = (await request(route, { cookie: ana })).body;
  assert.equal(detail.equipment, 'B-12');
  assert.equal(detail.actions[0].note, 'Verificado');
  assert.deepEqual(detail.history.map(row => row.author), ['Luis', 'Ana', 'Luis', 'Ana']);
  assert.ok(detail.history.every(row => Number.isFinite(Date.parse(row.timestamp))));

  const backupPath = dir + '/backup.sqlite';
  const backup = () => spawnSync(process.execPath, ['backup.js', backupPath], {
    env: { ...process.env, AERCOM_DB: path }, encoding: 'utf8',
  });
  const copy = backup();
  assert.equal(copy.status, 0, copy.stderr);
  assert.notEqual(backup().status, 0);
  const restored = dir + '/restored.sqlite';
  copyFileSync(backupPath, restored);
  await stop();
  await start(restored);
  const restoredLogin = await request('login', { method: 'POST', data: { username: 'ana', password: 'clave temporal 1' } });
  assert.equal(restoredLogin.status, 200);
  assert.deepEqual((await request(route, { cookie: restoredLogin.cookie })).body, detail);
});
