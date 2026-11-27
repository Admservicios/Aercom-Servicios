import { backup, DatabaseSync } from 'node:sqlite';
import { linkSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { databasePath } from './db.js';

async function writeBackup(destination) {
  const dir = mkdtempSync(join(dirname(destination), '.aercom-backup-'));
  const temporary = join(dir, 'backup.sqlite');
  try {
    const source = new DatabaseSync(databasePath(), { readOnly: true, timeout: 5000 });
    try { await backup(source, temporary); }
    finally { source.close(); }
    const copy = new DatabaseSync(temporary, { readOnly: true });
    try {
      if (copy.prepare('PRAGMA quick_check').get().quick_check !== 'ok') {
        throw new Error('Falló la verificación SQLite del respaldo.');
      }
    } finally { copy.close(); }
    linkSync(temporary, destination);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  if (!process.argv[2]) throw new Error('Uso: npm run backup -- ruta-del-respaldo.sqlite');
  process.umask(0o077);
  const destination = resolve(process.argv[2]);
  await writeBackup(destination);
  console.log('Respaldo verificado: ' + destination);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
