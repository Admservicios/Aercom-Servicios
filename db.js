import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const databasePath = () => resolve(process.env.AERCOM_DB || 'data/aercom.sqlite');

export function openDatabase(path = databasePath()) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON');
  return db;
}

const usersSchema = `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL
)`;

export function initializePeople(db) {
  db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
  try {
    db.exec(usersSchema);
    if (db.prepare("PRAGMA table_info('users')").all().some(column => column.name === 'password')) {
      db.exec(`
        DROP TABLE IF EXISTS sessions;
        ${usersSchema.replace('EXISTS users', 'EXISTS people_migration')};
        INSERT INTO people_migration (id, name) SELECT id, name FROM users;
        DROP TABLE users;
        ALTER TABLE people_migration RENAME TO users;
      `);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        expires INTEGER NOT NULL
      );
    `);
    if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('La base tiene referencias inválidas.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
