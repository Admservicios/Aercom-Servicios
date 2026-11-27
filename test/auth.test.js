import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { initializeAccounts, openDatabase } from '../db.js';
import { createAccount, sessionUser, signIn, signOut } from '../auth.js';

test('cuentas individuales, sesiones independientes y cierre de sesión', t => {
  const dir = mkdtempSync('/tmp/aercom-auth-');
  const db = openDatabase(dir + '/test.sqlite');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  initializeAccounts(db);
  assert.equal(db.prepare('SELECT count(*) AS count FROM users').get().count, 0);
  createAccount(db, 'ana', 'Ana', 'clave temporal 1');
  createAccount(db, 'luis', 'Luis', 'clave temporal 2');
  assert.equal(signIn(db, 'ana', 'incorrecta'), null);
  const ana = signIn(db, 'ana', 'clave temporal 1');
  const luis = signIn(db, 'luis', 'clave temporal 2');
  assert.equal(sessionUser(db, ana).name, 'Ana');
  assert.equal(sessionUser(db, luis).name, 'Luis');
  assert.notEqual(db.prepare('SELECT token FROM sessions WHERE user_id=1').get().token, ana);
  signOut(db, ana);
  assert.equal(sessionUser(db, ana), undefined);
  assert.equal(sessionUser(db, luis).name, 'Luis');
});
