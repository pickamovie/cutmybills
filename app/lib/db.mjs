// SQLite storage using Node's built-in driver. One file, no install.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { households, renderHousehold } from './seed.mjs';

export const TEST_PASSWORD = 'test1234';

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, city TEXT, blurb TEXT,
      pass_salt TEXT, pass_hash TEXT, spec TEXT, seeded INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY, user_id INTEGER, source TEXT, at TEXT, sender TEXT, subject TEXT, body TEXT);
    CREATE INDEX IF NOT EXISTS items_user ON items(user_id);
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY, user_id INTEGER, started_at TEXT, finished_at TEXT, sources TEXT, stats TEXT, profile TEXT, review TEXT, parsed TEXT);
    CREATE TABLE IF NOT EXISTS bills (user_id INTEGER, key TEXT, data TEXT, PRIMARY KEY (user_id, key));
    CREATE TABLE IF NOT EXISTS recs (
      user_id INTEGER, key TEXT, data TEXT, status TEXT DEFAULT 'open', status_at TEXT, history TEXT DEFAULT '[]', PRIMARY KEY (user_id, key));
  `);
  return db;
}

export function hashPassword(pw, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(pw, salt, 32).toString('hex') };
}
export function checkPassword(pw, salt, hash) {
  const h = scryptSync(pw, salt, 32);
  return timingSafeEqual(h, Buffer.from(hash, 'hex'));
}

export function createUser(db, spec, { seeded = 0 } = {}) {
  const { salt, hash } = hashPassword(TEST_PASSWORD);
  const info = db.prepare('INSERT INTO users (email, name, city, blurb, pass_salt, pass_hash, spec, seeded) VALUES (?,?,?,?,?,?,?,?)')
    .run(spec.email, spec.name, spec.city, spec.blurb, salt, hash, JSON.stringify(spec), seeded);
  const id = Number(info.lastInsertRowid);
  regenerateItems(db, id, spec);
  return id;
}

// Writes a fresh set of raw messages dated relative to today, and clears results.
export function regenerateItems(db, userId, spec) {
  db.prepare('DELETE FROM items WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM bills WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM recs WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM scans WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO items (user_id, source, at, sender, subject, body) VALUES (?,?,?,?,?,?)');
  for (const it of renderHousehold(spec, new Date())) ins.run(userId, it.source, it.at, it.sender, it.subject, it.body);
}

export function seedIfEmpty(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return false;
  for (const h of households) createUser(db, h, { seeded: 1 });
  return true;
}

const json = (s, d = null) => (s ? JSON.parse(s) : d);

export function loadState(db, userId) {
  const user = db.prepare('SELECT id, email, name, city, blurb FROM users WHERE id = ?').get(userId);
  const scan = db.prepare('SELECT * FROM scans WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(userId);
  const bills = db.prepare('SELECT data FROM bills WHERE user_id = ?').all(userId).map((r) => json(r.data));
  const recs = db.prepare('SELECT key, data, status, status_at, history FROM recs WHERE user_id = ?').all(userId)
    .map((r) => ({ ...json(r.data), status: r.status, statusAt: r.status_at, history: json(r.history, []) }));
  return {
    user: { ...user },
    scan: scan ? { at: scan.finished_at, sources: json(scan.sources), stats: json(scan.stats) } : null,
    profile: scan ? json(scan.profile) : null,
    review: scan ? json(scan.review, []) : [],
    bills, recs,
  };
}

export function saveScan(db, userId, sources, startedAt, result) {
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO scans (user_id, started_at, finished_at, sources, stats, profile, review, parsed) VALUES (?,?,?,?,?,?,?,?)')
      .run(userId, startedAt, new Date().toISOString(), JSON.stringify(sources), JSON.stringify(result.stats), JSON.stringify(result.profile), JSON.stringify(result.review), JSON.stringify(result.parsed));
    db.prepare('DELETE FROM bills WHERE user_id = ?').run(userId);
    const ib = db.prepare('INSERT INTO bills (user_id, key, data) VALUES (?,?,?)');
    for (const b of result.bills) ib.run(userId, b.key, JSON.stringify(b));
    // Keep the status of fixes the person already acted on; drop open ones that no longer apply.
    const keep = new Set(result.recs.map((r) => r.key));
    for (const r of db.prepare("SELECT key, status FROM recs WHERE user_id = ?").all(userId)) {
      if (!keep.has(r.key) && r.status === 'open') db.prepare('DELETE FROM recs WHERE user_id = ? AND key = ?').run(userId, r.key);
    }
    const up = db.prepare(`INSERT INTO recs (user_id, key, data) VALUES (?,?,?)
      ON CONFLICT(user_id, key) DO UPDATE SET data = excluded.data`);
    for (const r of result.recs) up.run(userId, r.key, JSON.stringify(r));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function itemsWithStatus(db, userId) {
  const scan = db.prepare('SELECT parsed FROM scans WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(userId);
  const parsed = new Map((scan ? json(scan.parsed, []) : []).map((p) => [p.id, p]));
  return db.prepare('SELECT id, source, at, sender, subject, body FROM items WHERE user_id = ? ORDER BY at DESC').all(userId)
    .map((i) => ({ ...i, status: parsed.get(i.id)?.status || (scan ? 'not scanned' : 'not scanned'), key: parsed.get(i.id)?.key || null, by: parsed.get(i.id)?.by || null }));
}
