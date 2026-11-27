import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { initializeAccounts, openDatabase } from './db.js';
import { sessionCookie, sessionUser, signIn, signOut } from './auth.js';

import { HttpError, initializeCases, options, createClient, listCases, detail, createCase, updateCase, saveAction, actionKinds, actionStatuses } from './cases.js';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/nuevo', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
].map(([path, [file, type]]) => [path, [readFileSync(new URL('./public/' + file, import.meta.url)), type]]));

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new HttpError(415, 'Formato de solicitud incorrecto.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) throw new HttpError(413, 'La solicitud es demasiado grande.');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks)); }
  catch { throw new HttpError(400, 'Solicitud inválida.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Solicitud inválida.');
  return data;
}

export function createApp(path) {
  const db = openDatabase(path);
  initializeAccounts(db);
  initializeCases(db);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      const asset = assets.get(pathname) ?? (/^\/casos\/\d+$/.test(pathname) ? assets.get('/') : null);
      if (req.method === 'GET' && asset) {
        res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' });
        return res.end(asset[0]);
      }
      if (!pathname.startsWith('/api/')) throw new HttpError(404, 'Página no encontrada.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Solicitud externa.');
      const token = req.headers.cookie?.match(/(?:^|;\s*)aercom_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const user = token && sessionUser(db, token);
      if (req.method === 'POST' && pathname === '/api/login') {
        const data = await readJson(req);
        const signed = signIn(db, data.username, data.password);
        if (!signed) throw new HttpError(401, 'Usuario o contraseña incorrectos.');
        res.setHeader('Set-Cookie', sessionCookie(signed));
        return json(200, sessionUser(db, signed));
      }
      if (!user) throw new HttpError(401, 'Ingresá con tu cuenta.');
      if (req.method === 'GET' && pathname === '/api/me') return json(200, user);
      if (req.method === 'POST' && pathname === '/api/logout') {
        await readJson(req);
        signOut(db, token);
        res.setHeader('Set-Cookie', sessionCookie(''));
        return json(200, {});
      }
      if (req.method === 'GET' && pathname === '/api/options') return json(200, { ...options(db), actionKinds, actionStatuses });
      if (req.method === 'POST' && pathname === '/api/clients') return json(201, createClient(db, await readJson(req)));
      if (pathname === '/api/cases') {
        if (req.method === 'GET') return json(200, listCases(db));
        if (req.method === 'POST') return json(201, createCase(db, await readJson(req), user.id));
      }
      const caseId = /^\/api\/cases\/(\d+)$/.exec(pathname)?.[1];
      if (caseId && req.method === 'GET') return json(200, detail(db, Number(caseId)));
      if (caseId && req.method === 'PUT') return json(200, updateCase(db, Number(caseId), await readJson(req), user.id));
      const action = /^\/api\/cases\/(\d+)\/actions(?:\/(\d+))?$/.exec(pathname);
      if (action && !action[2] && req.method === 'POST') return json(201, saveAction(db, Number(action[1]), await readJson(req), user.id));
      if (action?.[2] && req.method === 'PUT') return json(200, saveAction(db, Number(action[1]), await readJson(req), user.id, Number(action[2])));
      throw new HttpError(404, 'Recurso no encontrado.');
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Ocurrió un error interno.' });
    }
  });
  server.once('close', () => db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.AERCOM_HOST || '127.0.0.1';
  const port = Number(process.env.AERCOM_PORT || 3100);
  const server = createApp();
  server.listen(port, host, () => console.log(`Aercom Servicios en http://${host}:${server.address().port}`));
  function shutdown() {
    server.close();
    // A browser can keep a preconnected socket open without sending a request.
    setTimeout(() => server.closeAllConnections(), 2000).unref();
  }
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, shutdown);
}
