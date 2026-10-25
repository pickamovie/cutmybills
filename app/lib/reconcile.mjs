// Merges detections that describe the same bill (an Airtel invoice email,
// the bank's AutoPay debit SMS, the operator's usage SMS) into one bill.

import { lending } from './catalog.mjs';

const CADENCE_DAYS = { monthly: 30, bimonthly: 60, quarterly: 91, yearly: 365 };
const MARKS = { 'ACT Fibernet': 'AC', 'Airtel Xstream Fiber': 'AX', 'BSNL Bharat Fibre': 'BS', Jio: 'JI', Airtel: 'AI', Vi: 'VI', 'Airtel Postpaid': 'AP', MSEDCL: 'MS', BESCOM: 'BE', 'Tata Power-DDL': 'TP', TANGEDCO: 'TN', MNGL: 'MN', 'iCloud+': 'iC', 'Google One': 'G1', 'cult.fit': 'CF', 'Income Tax': 'IT', EPFO: 'EP' };
const mark = (name) => MARKS[name] || name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '··';

const addDays = (isoDate, n) => { const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

function snippet(item) {
  const text = item.source === 'Gmail' ? `${item.subject}: ${item.body.replace(/\n+/g, ' ')}` : item.body;
  return text.length > 220 ? text.slice(0, 217) + '…' : text;
}

export function reconcile(parsed, today) {
  // parsed: [{ item, det }]
  const groups = new Map();
  let cibil = null;
  const review = [];
  for (const { item, det } of parsed) {
    if (!det) continue;
    if (det.unrecognised) { review.push({ item, reason: det.reason }); continue; }
    if (det.signal === 'cibil') { cibil = { ...det.report, item }; continue; }
    if (!groups.has(det.key)) groups.set(det.key, []);
    groups.get(det.key).push({ item, det });
  }

  // CIBIL accounts join card and loan bills by account last-4.
  if (cibil) {
    for (const a of cibil.accounts) {
      const key = a.type === 'Credit Card' ? `card:${a.last4}` : `loan:${a.last4}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ item: cibil.item, det: { key, category: 'credit', signal: 'account', account: a, provider: titleCase(a.lender), plan: a.type } });
    }
  }

  const bills = [];
  for (const [key, list] of groups) {
    list.sort((x, y) => y.item.at.localeCompare(x.item.at)); // newest first
    const pick = (f) => list.map((l) => l.det[f]).find((v) => v != null);
    const all = (f) => list.map((l) => l.det[f]).filter((v) => v != null);
    const priced = list.filter((l) => l.det.amount != null);
    const latest = priced[0]?.det;
    const acct = pick('account');
    const bill = {
      key, category: pick('category'), provider: pick('provider') || key, plan: pick('plan'), group: pick('group'),
      amount: latest?.amount ?? null, cadence: pick('cadence') || 'monthly', rail: pick('rail') || (acct ? 'Credit report' : 'Bill'),
      due: pick('due'), lastPaid: pick('paidOn'), meta: {},
      evidence: dedupeEvidence(list.map((l) => ({ source: l.item.source, at: l.item.at, from: l.item.sender, text: snippet(l.item) }))),
    };
    const m = bill.meta;

    // Per-type signals.
    if (key.startsWith('broadband:')) Object.assign(m, { isp: pick('isp'), planMbps: pick('planMbps'), peakMbps: Math.max(...all('peakMbps')) });
    if (key.startsWith('mobile:') && key !== 'mobile:airtel-postpaid') {
      Object.assign(m, { op: pick('op'), number: pick('number'), avgDaily: pick('avgDaily'), planDaily: pick('planDaily'), days: pick('days') || 28 });
      bill.plan = m.planDaily ? `${m.planDaily} GB a day, ${m.days} days` : 'Prepaid';
      bill.cadence = `${m.days}d`;
    }
    if (key === 'mobile:airtel-postpaid') Object.assign(m, { gbPlan: pick('gbPlan'), gbUsed: Math.max(...all('gbUsed')), planPrice: pick('planPrice'), number: pick('number') });
    if (key.startsWith('power:')) { Object.assign(m, { discom: pick('discom'), units: pick('units'), unitsHistory: all('units') }); bill.plan = `${m.units} units last bill`; }
    if (key.startsWith('insurance:')) Object.assign(m, { sumInsured: pick('sumInsured'), eldestAge: pick('eldestAge'), lastPremium: pick('lastPremium'), members: pick('members') });
    if (key === 'sub:CULTFIT') { m.lastCheckin = all('checkin').sort().at(-1) || null; bill.plan = pick('plan') || 'Membership'; }
    if (key.startsWith('saas:')) m.lastActive = pick('lastActive');
    if (key.startsWith('cloud:')) m.storageUsed = pick('storageUsed');
    if (key === 'tax:itr') Object.assign(m, { regime: pick('regime'), gross: pick('gross'), d80c: pick('d80c'), d80d: pick('d80d'), taxable: pick('taxable') });
    if (key === 'claim:epf') Object.assign(m, { employer: pick('employer'), balance: pick('balance') });
    if (key.startsWith('sub:') && !bill.plan) bill.plan = bill.group === 'streaming' ? 'Streaming' : bill.group === 'food' ? 'Delivery membership' : bill.group === 'music' ? 'Music' : 'Subscription';

    // Infer cadence for card/UPI subscriptions from the gap between debits.
    if (key.startsWith('sub:') && !pick('cadence')) {
      const dates = all('paidOn').sort();
      if (dates.length >= 2) bill.cadence = daysBetween(dates.at(-2), dates.at(-1)) > 80 ? 'yearly' : 'monthly';
      else bill.cadence = (bill.amount ?? 0) >= 999 ? 'yearly' : 'monthly';
    }

    if (key.startsWith('card:')) {
      const stmts = list.filter((l) => l.det.signal === 'statement').map((l) => l.det);
      const pays = list.filter((l) => l.det.signal === 'payment').map((l) => l.det);
      m.last4 = key.slice(5);
      m.minDues = stmts.map((s) => s.minDue);
      m.payments = pays.map((p) => p.paid);
      // Revolving when recent payments were at or near the minimum due.
      m.revolving = pays.length > 0 && pays.every((p) => stmts.some((s) => Math.abs(s.minDue - p.paid) / s.minDue < 0.15));
      if (acct) Object.assign(m, { limit: acct.limit, balance: acct.balance, lender: acct.lender, opened: acct.opened });
      m.balance = m.balance ?? bill.amount;
      bill.statementDue = bill.amount;
      bill.amount = m.revolving ? Math.round((m.balance * lending.cardInterestAnnual) / 1200) : 0;
      bill.unit = m.revolving ? 'interest a month' : 'paid in full each month';
      bill.provider = acct ? titleCase(acct.lender) : bill.provider;
      bill.plan = `Credit card XX${m.last4}`;
    }
    if (key.startsWith('loan:')) {
      if (acct) Object.assign(m, { lender: acct.lender, type: acct.type, outstanding: acct.balance, rate: acct.rate, monthsLeft: acct.monthsLeft, emi: acct.emi, opened: acct.opened });
      bill.amount = bill.amount ?? m.emi;
      bill.provider = titleCase(m.lender || bill.provider);
      bill.plan = m.type ? `${m.type}, ${m.monthsLeft} EMIs left` : bill.plan;
      bill.rail = 'EMI';
    }

    // Monthly equivalent and next debit.
    const periodDays = bill.cadence.endsWith('d') ? Number(bill.cadence.slice(0, -1)) : CADENCE_DAYS[bill.cadence] || 30;
    bill.periodDays = periodDays;
    bill.monthly = bill.amount != null ? Math.round((bill.amount * 30) / periodDays) : 0;
    if (key === 'tax:itr' || key === 'claim:epf') bill.monthly = 0;
    let next = bill.due || (bill.lastPaid ? addDays(bill.lastPaid, periodDays) : null);
    while (next && next < today) next = addDays(next, periodDays);
    bill.nextDebit = key.startsWith('tax:') || key.startsWith('claim:') ? null : next;
    bill.nextAmount = key.startsWith('card:') ? bill.statementDue : bill.amount;
    bill.unit = bill.unit || unitFor(bill);
    bill.mark = mark(bill.provider);
    bills.push(bill);
  }

  let profile = null;
  if (cibil) {
    const cards = cibil.accounts.filter((a) => a.type === 'Credit Card');
    const limit = cards.reduce((s, a) => s + (a.limit || 0), 0);
    const bal = cards.reduce((s, a) => s + (a.balance || 0), 0);
    const oldest = cibil.accounts.map((a) => a.opened).filter(Boolean).sort()[0];
    const months = oldest ? Math.floor(daysBetween(oldest, today) / 30.44) : 0;
    profile = {
      score: cibil.score, enquiries: cibil.enquiries, accounts: cibil.accounts.length, reportDate: cibil.reportDate,
      utilisation: limit ? Math.round((bal / limit) * 100) : 0,
      onTime: cibil.accounts.some((a) => a.late) ? 'Some late' : '100%',
      age: `${Math.floor(months / 12)} yrs ${months % 12} mos`,
    };
  }
  return { bills, review, profile };
}

function unitFor(b) {
  if (b.key.startsWith('tax:') || b.key.startsWith('claim:')) return 'one-time';
  if (b.cadence === 'yearly') return 'a year';
  if (b.cadence === 'bimonthly') return 'every 2 months';
  if (b.cadence === 'quarterly') return 'every 3 months';
  if (b.cadence.endsWith('d')) return `every ${b.cadence.slice(0, -1)} days`;
  if (b.rail === 'EMI') return 'EMI';
  return 'a month';
}

function dedupeEvidence(ev) {
  const seen = new Set();
  return ev.filter((e) => { const k = e.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
}

export function titleCase(s) {
  if (!s) return s;
  const keep = { SBI: 'SBI', HDFC: 'HDFC', ICICI: 'ICICI', LTD: '', CARD: 'Card', BANK: 'Bank' };
  return s.split(/\s+/).map((w) => (w in keep ? keep[w] : w[0] + w.slice(1).toLowerCase())).filter(Boolean).join(' ')
    .replace('State Bank Of India', 'SBI').replace('Navi Finserv', 'Navi');
}
