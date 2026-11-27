import { initializeAccounts, openDatabase } from './db.js';
import { createAccount } from './auth.js';

const [username, name] = process.argv.slice(2);
if (!username || !name || process.stdin.isTTY) {
  console.error('Uso: npm run account -- usuario "Nombre completo" (clave por entrada estándar, sin eco)');
  process.exitCode = 1;
} else {
  let password = '';
  for await (const chunk of process.stdin.setEncoding('utf8')) {
    password += chunk;
    if (password.length > 258) break;
  }
  const db = openDatabase();
  try {
    initializeAccounts(db);
    createAccount(db, username, name, password.replace(/\r?\n$/, ''));
    console.log('Cuenta creada.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
