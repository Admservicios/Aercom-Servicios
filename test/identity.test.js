import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { initializePeople, openDatabase } from '../db.js';
import { initializeCases } from '../cases.js';
import { addPerson, people, sessionUser, selectPerson, clearSelection } from '../identity.js';

test('lista vacía, selección independiente y cambio de nombre', t => {
  const dir = mkdtempSync('/tmp/aercom-identity-');
  const db = openDatabase(dir + '/test.sqlite');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  initializePeople(db);
  assert.deepEqual(people(db), []);
  const ana = addPerson(db, 'Ana');
  const luis = addPerson(db, 'Luis');
  assert.throws(() => addPerson(db, 'ana'));
  assert.deepEqual(people(db), [ana, luis]);
  assert.equal(selectPerson(db, 30), null);
  const first = selectPerson(db, ana.id).token;
  const second = selectPerson(db, luis.id).token;
  assert.equal(sessionUser(db, first).name, 'Ana');
  assert.equal(sessionUser(db, second).name, 'Luis');
  assert.notEqual(db.prepare('SELECT token FROM sessions WHERE user_id = ?').get(ana.id).token, first);
  const switched = selectPerson(db, luis.id, first).token;
  assert.equal(sessionUser(db, first), undefined);
  assert.equal(sessionUser(db, switched).name, 'Luis');
  clearSelection(db, switched);
  assert.equal(sessionUser(db, switched), undefined);
  assert.equal(sessionUser(db, second).name, 'Luis');
});

test('conserva los nombres, referencias e historial de una base anterior', t => {
  const dir = mkdtempSync('/tmp/aercom-legacy-');
  const db = openDatabase(dir + '/test.sqlite');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL
    );
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires INTEGER);
    CREATE TABLE history (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL, author_id INTEGER NOT NULL REFERENCES users(id),
      timestamp TEXT NOT NULL, description TEXT NOT NULL
    );
    INSERT INTO users VALUES (7, 'ana', 'Ana', 'hash anterior');
    INSERT INTO sessions VALUES ('anterior', 7, 1);
    INSERT INTO history VALUES (1, 1, 7, '2026-11-27T12:00:00Z', 'Caso abierto');
  `);
  initializePeople(db);
  initializeCases(db);
  assert.deepEqual(people(db).map(row => ({ ...row })), [{ id: 7, name: 'Ana' }]);
  assert.equal(db.prepare('SELECT count(*) AS total FROM sessions').get().total, 0);
  assert.equal(db.prepare('SELECT author_name FROM history').get().author_name, 'Ana');
  db.prepare('UPDATE users SET name = ? WHERE id = 7').run('Ana Torres');
  initializePeople(db);
  initializeCases(db);
  assert.equal(db.prepare('SELECT author_name FROM history').get().author_name, 'Ana');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
