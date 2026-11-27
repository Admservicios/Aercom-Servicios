import { initializePeople, openDatabase } from './db.js';
import { addPerson } from './identity.js';

const [name] = process.argv.slice(2);
if (!name || process.argv.length !== 3) {
  console.error('Uso: npm run person -- "Nombre completo"');
  process.exitCode = 1;
} else {
  const db = openDatabase();
  try {
    initializePeople(db);
    const person = addPerson(db, name);
    console.log('Nombre agregado: ' + person.name);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
