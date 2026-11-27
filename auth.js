import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const hashToken = token => createHash('sha256').update(token).digest('hex');
const duration = 12 * 60 * 60;

export function createAccount(db, username, name, password) {
  username = username.trim();
  name = name.trim();
  if (!/^[a-zA-Z0-9._-]{2,64}$/.test(username) || !name || name.length > 120 ||
      password.length < 12 || password.length > 256) {
    throw new Error('Ingresá un usuario válido, un nombre y una clave de 12 a 256 caracteres.');
  }
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, salt, 64).toString('hex');
  db.prepare('INSERT INTO users (username, name, password) VALUES (?, ?, ?)').run(username, name, salt + ':' + digest);
}

export function signIn(db, username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' ||
      username.length > 64 || password.length > 256) return null;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  const [salt, digest] = user?.password.split(':') ?? ['0'.repeat(32), '0'.repeat(128)];
  const matches = timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex'));
  if (!user || !matches) return null;
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hashToken(token), user.id, Date.now() + duration * 1000);
  return token;
}

export function sessionUser(db, token) {
  return db.prepare(`
    SELECT users.id, users.username, users.name FROM sessions
    JOIN users ON users.id = sessions.user_id WHERE token = ? AND expires > ?
  `).get(hashToken(token), Date.now());
}

export function signOut(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(token));
}

export function sessionCookie(token) {
  const secure = process.env.AERCOM_SECURE_COOKIE === '1' ? '; Secure' : '';
  return `aercom_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? duration : 0}${secure}`;
}
