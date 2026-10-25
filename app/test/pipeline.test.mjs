// Runs the full pipeline on the seeded test households and checks the
// findings a person would expect from reading their messages by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { households, renderHousehold, randomHousehold } from '../lib/seed.mjs';
import { runScan } from '../lib/scan.mjs';
import { redact } from '../lib/redact.mjs';

const now = new Date();
const today = now.toISOString().slice(0, 10);
const scan = (h, sources = ['Gmail', 'SMS', 'CIBIL']) =>
  runScan(renderHousehold(h, now).map((x, i) => ({ ...x, id: i })), { today, sources });
const byEmail = (e) => households.find((h) => h.email.startsWith(e));
const rec = (r, key) => r.recs.find((x) => x.key === key);

test('Kavya: merges email, SMS and CIBIL into one bill per account', async () => {
  const r = await scan(byEmail('kavya'));
  assert.equal(r.bills.filter((b) => b.key === 'card:8812').length, 1);
  const card = r.bills.find((b) => b.key === 'card:8812');
  assert.ok(card.evidence.some((e) => e.source === 'SMS') && card.evidence.some((e) => e.source === 'CIBIL'));
  assert.equal(card.meta.revolving, true);
  assert.equal(r.profile.score, 731);
});

test('Kavya: finds the expected fixes', async () => {
  const r = await scan(byEmail('kavya'));
  assert.equal(rec(r, 'broadband:act:downgrade').save, 350);
  assert.ok(rec(r, 'card:8812:transfer').save > 2000);
  assert.ok(rec(r, 'sub:CULTFIT:pause'));
  assert.ok(rec(r, 'cloud:icloud:duplicate'));
  assert.ok(rec(r, 'group:streaming:rotate'));
  assert.ok(rec(r, 'tax:itr:80d').oneOff > 5000);
});

test('Arjun: gigabit plan used at 140 Mbps, card paid in full gets no fix', async () => {
  const r = await scan(byEmail('arjun'));
  assert.equal(rec(r, 'broadband:airtel:downgrade').save, 3000);
  assert.ok(!r.recs.some((x) => x.key.startsWith('card:')));
  assert.ok(!rec(r, 'tax:itr:80d'), 'new regime cannot claim 80D');
});

test('Ravi: Delhi 200-unit waiver and EPF claim', async () => {
  const r = await scan(byEmail('ravi'));
  const power = rec(r, 'power:tpddl:slab');
  assert.equal(power.save, r.bills.find((b) => b.key === 'power:tpddl').amount);
  assert.equal(rec(r, 'claim:epf:transfer').oneOff, 214600);
});

test('Meera: unknown DTH format goes to review once, senior 80D limit applies', async () => {
  const r = await scan(byEmail('meera'));
  assert.equal(r.review.length, 1);
  assert.equal(r.review[0].count, 2);
  assert.ok(rec(r, 'tax:itr:80d').oneOff > 9000);
});

test('Scanning without CIBIL produces no credit profile', async () => {
  const r = await scan(byEmail('kavya'), ['Gmail', 'SMS']);
  assert.equal(r.profile, null);
  assert.ok(!r.recs.some((x) => x.key === 'loan:4410:reset'));
});

test('Random households always scan without errors', async () => {
  for (let i = 0; i < 25; i++) {
    const r = await scan(randomHousehold(`t-${i}`));
    assert.ok(r.bills.length > 5);
    for (const x of r.recs) assert.ok(x.save > 0 || x.oneOff > 0, x.key);
  }
});

test('Redaction removes identifiers but keeps amounts', () => {
  const out = redact('PAN ABCPD1234K, card XX8812, phone 9876543210, mail a.b@x.com, Rs 1,199.00, Subscriber 1012345678');
  for (const bad of ['ABCPD1234K', '8812', '9876543210', 'a.b@x.com', '1012345678']) assert.ok(!out.includes(bad), bad);
  assert.ok(out.includes('1,199.00'));
});
