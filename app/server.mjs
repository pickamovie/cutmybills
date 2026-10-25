// CutMyBills web app server. Node 22+, no dependencies.
//   node server.mjs            -> http://localhost:3000
// Env: PORT, DB_PATH, SCAN_PACE_MS, FIX_CONFIRM_MS, ANTHROPIC_API_KEY (optional), CMB_MODEL

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDb, seedIfEmpty, createUser, regenerateItems, loadState, saveScan, itemsWithStatus, checkPassword, TEST_PASSWORD } from './lib/db.mjs';
import { households, randomHousehold } from './lib/seed.mjs';
import { runScan } from './lib/scan.mjs';
import { llmEnabled } from './lib/llm.mjs';
import { CATALOG_NOTE } from './lib/catalog.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const SCAN_PACE = Number(process.env.SCAN_PACE_MS ?? 90);
const FIX_CONFIRM = Number(process.env.FIX_CONFIRM_MS ?? 25000);
const db = openDb(process.env.DB_PATH || join(ROOT, 'data', 'cutmybills.db'));
if (seedIfEmpty(db)) console.log(`Seeded ${households.length} test households (password ${TEST_PASSWORD}).`);

// ---------- live events (Server-Sent Events, one stream set per user) ----------
const streams = new Map(); // userId -> Set(res)
function emit(userId, type, data) {
  for (const res of streams.get(userId) || []) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---------- fix lifecycle ----------
// A fix moves open -> requested -> confirmed. Confirmation stands in for the
// provider, lender or insurer acknowledging the change.
const CONFIRMED = { switch: 'Confirmed by provider', stop: 'Stopped', refinance: 'Offer approved', port: 'Port accepted', habit: 'Tracking', claim: 'Ready to file' };
function confirmDue() {
  const due = db.prepare("SELECT user_id, key, data, history FROM recs WHERE status = 'requested' AND status_at <= ?").all(new Date(Date.now() - FIX_CONFIRM).toISOString());
  for (const r of due) {
    const rec = JSON.parse(r.data);
    const at = new Date().toISOString();
    const history = [...JSON.parse(r.history || '[]'), { at, status: 'confirmed', label: CONFIRMED[rec.kind] || 'Confirmed' }];
    db.prepare("UPDATE recs SET status = 'confirmed', status_at = ?, history = ? WHERE user_id = ? AND key = ?").run(at, JSON.stringify(history), r.user_id, r.key);
    emit(r.user_id, 'rec', { key: r.key, status: 'confirmed', label: CONFIRMED[rec.kind] || 'Confirmed', history });
  }
}
setInterval(confirmDue, 2000).unref();

// ---------- helpers ----------
const scanning = new Set();
const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
function userFrom(req) {
  const t = cookies(req).cmb_session;
  if (!t) return null;
  return db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(t)?.user_id ?? null;
}
function startSession(res, userId) {
  const token = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, userId);
  return `cmb_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`;
}
async function body(req) {
  let size = 0, data = '';
  for await (const chunk of req) { size += chunk.length; if (size > 100_000) throw new Error('Body too large'); data += chunk; }
  return data ? JSON.parse(data) : {};
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  const file = normalize(join(ROOT, 'public', path));
  if (!file.startsWith(join(ROOT, 'public'))) return send(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    const data = await readFile(join(ROOT, 'public', 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(data);
  }
}

// ---------- routes ----------
const routes = {
  'GET /api/test-accounts': () => ({
    password: TEST_PASSWORD,
    accounts: db.prepare('SELECT email, name, city, blurb, seeded FROM users ORDER BY seeded DESC, id DESC LIMIT 12').all(),
  }),

  'POST /api/login': async (req, res) => {
    const { email, password } = await body(req);
    const u = db.prepare('SELECT id, pass_salt, pass_hash FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!u || !checkPassword(String(password || ''), u.pass_salt, u.pass_hash)) return [401, { error: 'That email and password do not match a test account.' }];
    return [200, { ok: true }, { 'set-cookie': startSession(res, u.id) }];
  },

  'POST /api/logout': (req) => {
    const t = cookies(req).cmb_session;
    if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
    return [200, { ok: true }, { 'set-cookie': 'cmb_session=; Path=/; Max-Age=0' }];
  },

  'POST /api/test-users': async (req, res) => {
    const spec = randomHousehold(`${Date.now()}-${randomBytes(4).toString('hex')}`);
    const id = createUser(db, spec);
    return [200, { ok: true, email: spec.email }, { 'set-cookie': startSession(res, id) }];
  },

  'GET /api/me': (req, res, uid) => {
    const u = db.prepare('SELECT id, email, name, city, blurb FROM users WHERE id = ?').get(uid);
    return { user: u, llm: llmEnabled(), catalogNote: CATALOG_NOTE };
  },

  'GET /api/state': (req, res, uid) => ({ ...loadState(db, uid), llm: llmEnabled(), catalogNote: CATALOG_NOTE, scanning: scanning.has(uid) }),

  'GET /api/items': (req, res, uid) => ({ items: itemsWithStatus(db, uid) }),

  'POST /api/scan': async (req, res, uid) => {
    if (scanning.has(uid)) return [409, { error: 'A scan is already running.' }];
    const { sources } = await body(req);
    const chosen = ['Gmail', 'SMS', 'CIBIL'].filter((s) => (sources || []).includes(s));
    if (!chosen.length) return [400, { error: 'Pick at least one source.' }];
    const items = db.prepare('SELECT * FROM items WHERE user_id = ? ORDER BY at DESC').all(uid);
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(uid);
    const started = new Date().toISOString();
    scanning.add(uid);
    runScan(items, {
      today: started.slice(0, 10), sources: chosen, pace: SCAN_PACE, names: (u?.name || '').split(' '),
      onEvent: (type, data) => emit(uid, `scan:${type}`, data),
    }).then((result) => {
      saveScan(db, uid, chosen, started, result);
      emit(uid, 'scan:done', result.stats);
    }).catch((e) => {
      console.error(e);
      emit(uid, 'scan:error', { message: e.message });
    }).finally(() => scanning.delete(uid));
    return [202, { ok: true }];
  },

  'POST /api/reset': (req, res, uid) => {
    const u = db.prepare('SELECT spec FROM users WHERE id = ?').get(uid);
    regenerateItems(db, uid, JSON.parse(u.spec));
    return { ok: true };
  },

  'GET /api/events': (req, res, uid) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    if (!streams.has(uid)) streams.set(uid, new Set());
    streams.get(uid).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); streams.get(uid)?.delete(res); });
    return null; // stream stays open
  },
};

function recAction(action) {
  return async (req, res, uid, key) => {
    const r = db.prepare('SELECT data, status, history FROM recs WHERE user_id = ? AND key = ?').get(uid, key);
    if (!r) return [404, { error: 'That fix no longer exists. Run a new scan.' }];
    const at = new Date().toISOString();
    const next = { fix: 'requested', dismiss: 'dismissed', reopen: 'open' }[action];
    if (action === 'fix' && r.status !== 'open') return [409, { error: 'This fix is already underway.' }];
    const label = { fix: JSON.parse(r.data).done, dismiss: 'Dismissed', reopen: 'Reopened' }[action];
    const history = [...JSON.parse(r.history || '[]'), { at, status: next, label }];
    db.prepare('UPDATE recs SET status = ?, status_at = ?, history = ? WHERE user_id = ? AND key = ?').run(next, at, JSON.stringify(history), uid, key);
    emit(uid, 'rec', { key, status: next, label, history });
    return { ok: true, status: next, history };
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
    let handler = routes[`${req.method} ${url.pathname}`];
    let key = null;
    const m = url.pathname.match(/^\/api\/recs\/(.+)\/(fix|dismiss|reopen)$/);
    if (!handler && m && req.method === 'POST') { handler = recAction(m[2]); key = decodeURIComponent(m[1]); }
    if (!handler) return send(res, 404, { error: 'Not found' });
    const open = ['/api/test-accounts', '/api/login', '/api/logout', '/api/test-users'].includes(url.pathname);
    const uid = userFrom(req);
    if (!open && !uid) return send(res, 401, { error: 'Sign in first.' });
    const out = await handler(req, res, uid, key);
    if (out === null) return;
    if (Array.isArray(out)) return send(res, out[0], out[1], out[2]);
    return send(res, 200, out);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Something went wrong on the server. Check the server log.' });
  }
});

server.listen(PORT, () => {
  console.log(`CutMyBills running at http://localhost:${PORT}`);
  console.log(llmEnabled() ? 'Claude extraction: on' : 'Claude extraction: off (set ANTHROPIC_API_KEY to read unknown bill formats)');
});
