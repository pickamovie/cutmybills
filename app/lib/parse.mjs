// Turns one raw message into a detection: a structured fact about a bill.
// Rule-based recognisers cover known Indian providers and bank formats.
// Anything that looks like a bill but matches no rule comes back as
// { unrecognised: true } for review or optional LLM extraction.

import { amount } from './money.mjs';

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function parseDate(s) {
  if (!s) return null;
  s = s.trim().replace(/[.,]$/, '');
  let m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, MON[m[2].toLowerCase()], Number(m[1]));
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return iso(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}
const iso = (y, mo, d) => new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10);

const grab = (text, re) => { const m = text.match(re); return m ? m[1].trim() : null; };
const num = (text, re) => amount(grab(text, re));

const MERCHANTS = [
  [/^JIO$/i, { key: 'mobile:jio', type: 'recharge', op: 'jio' }],
  [/^AIRTEL$/i, { key: 'mobile:airtel', type: 'recharge', op: 'airtel' }],
  [/^Vi$/i, { key: 'mobile:vi', type: 'recharge', op: 'vi' }],
  [/NETFLIX/i, { key: 'sub:NETFLIX', name: 'Netflix', group: 'streaming' }],
  [/HOTSTAR/i, { key: 'sub:HOTSTAR', name: 'JioHotstar', group: 'streaming' }],
  [/SONYLIV/i, { key: 'sub:SONYLIV', name: 'SonyLIV', group: 'streaming' }],
  [/PRIMEVIDEO/i, { key: 'sub:PRIMEVIDEO', name: 'Prime Video', group: 'streaming' }],
  [/ZEE5/i, { key: 'sub:ZEE5', name: 'ZEE5', group: 'streaming' }],
  [/YOUTUBE/i, { key: 'sub:YOUTUBE', name: 'YouTube Premium', group: 'streaming' }],
  [/SPOTIFY/i, { key: 'sub:SPOTIFY', name: 'Spotify', group: 'music' }],
  [/CULTFIT/i, { key: 'sub:CULTFIT', name: 'cult.fit', group: 'fitness' }],
  [/SWIGGY/i, { key: 'sub:SWIGGY', name: 'Swiggy One', group: 'food' }],
  [/ZOMATO/i, { key: 'sub:ZOMATO', name: 'Zomato Gold', group: 'food' }],
];
const merchant = (text) => {
  for (const [re, m] of MERCHANTS) if (re.test(text.trim())) return m;
  return null;
};

const DISCOMS = { 'mahadiscom.in': 'msedcl', 'bescom.co.in': 'bescom', 'tatapower-ddl.com': 'tpddl', 'tangedco.org': 'tangedco' };

// ---------- email ----------
const emailRules = [
  {
    when: (i) => /actcorp\.in/.test(i.sender),
    parse: (i, b) => ({
      key: 'broadband:act', category: 'phone', provider: 'ACT Fibernet', signal: 'bill',
      plan: grab(b, /Plan:\s*(.+)/), planMbps: num(b, /Plan:.*?(\d+)\s*Mbps/), peakMbps: num(b, /Peak speed used:\s*(\d+)/),
      amount: num(b, /Amount Due:\s*Rs\.?\s*([\d,.]+)/), due: parseDate(grab(b, /Due Date:\s*(\S+)/)), cadence: 'monthly', rail: 'Bill', isp: 'act',
    }),
  },
  {
    when: (i) => /airtel\.com/.test(i.sender) && /Xstream/.test(i.subject),
    parse: (i, b) => ({
      key: 'broadband:airtel', category: 'phone', provider: 'Airtel Xstream Fiber', signal: 'bill',
      plan: grab(b, /Current plan:\s*(.+)/), planMbps: num(b, /Current plan:.*?(\d+)\s*Mbps/), peakMbps: num(b, /highest speed reached (\d+)/),
      amount: num(b, /payable:\s*₹([\d,.]+)/), due: parseDate(grab(b, /Pay by:\s*(\S+)/)), cadence: 'monthly', rail: 'Bill', isp: 'airtel',
    }),
  },
  {
    when: (i) => /bsnl\.co\.in/.test(i.sender),
    parse: (i, b) => ({
      key: 'broadband:bsnl', category: 'phone', provider: 'BSNL Bharat Fibre', signal: 'bill',
      plan: grab(b, /\((.+?Mbps)\)/), planMbps: num(b, /\(.*?(\d+)\s*Mbps\)/), peakMbps: num(b, /Max speed utilised:\s*(\d+)/),
      amount: num(b, /Bill Amount Rs\s*([\d,.]+)/), due: parseDate(grab(b, /Last date of payment\s*(\S+)/)), cadence: 'monthly', rail: 'Bill', isp: 'bsnl',
    }),
  },
  {
    when: (i) => /airtel\.com/.test(i.sender) && /Postpaid/.test(i.subject),
    parse: (i, b) => ({
      key: 'mobile:airtel-postpaid', category: 'phone', provider: 'Airtel Postpaid', signal: 'bill',
      plan: grab(b, /Plan:\s*(.+)/), planPrice: num(b, /Plan:.*?₹(\d+)/), gbPlan: num(b, /Data used:\s*\d+ GB of (\d+)/), gbUsed: num(b, /Data used:\s*(\d+) GB/),
      amount: num(b, /Amount due:\s*₹([\d,.]+)/), due: parseDate(grab(b, /Due date:\s*(\S+)/)), cadence: 'monthly', rail: 'Bill', number: grab(i.subject, /for (\S+)$/),
    }),
  },
  {
    when: (i) => Object.keys(DISCOMS).some((d) => i.sender.includes(d)),
    parse: (i, b) => {
      const discom = DISCOMS[Object.keys(DISCOMS).find((d) => i.sender.includes(d))];
      return {
        key: `power:${discom}`, category: 'power', provider: grab(b, /^(.+?) Electricity Bill/m), signal: 'bill', discom,
        units: num(b, /Units consumed:\s*(\d+)/), amount: num(b, /Bill amount:\s*Rs\s*([\d,.]+)/), due: parseDate(grab(b, /Due date:\s*(\S+)/)),
        cadence: /Bi-monthly/.test(b) ? 'bimonthly' : 'monthly', rail: 'Bill', consumer: grab(b, /Consumer No:\s*(\S+)/),
      };
    },
  },
  {
    when: (i) => /mngl\.in/.test(i.sender),
    parse: (i, b) => ({ key: 'gas:mngl', category: 'power', provider: 'MNGL', plan: 'Piped gas', signal: 'bill', amount: num(b, /Bill amount:\s*Rs\s*([\d,.]+)/), due: parseDate(grab(b, /Due date:\s*(\S+)/)), cadence: 'monthly', rail: 'Bill' }),
  },
  {
    when: (i) => /^Renewal notice/i.test(i.subject),
    parse: (i, b) => ({
      key: `insurance:${grab(b, /Policy No:\s*(.+)/)}`, category: 'health', provider: grab(b, /Your (.+?) policy is due/), signal: 'renewal',
      plan: grab(b, /Product:\s*(.+)/), sumInsured: num(b, /Sum Insured:\s*Rs\s*([\d,]+)/), members: num(b, /Members covered:\s*(\d+)/),
      eldestAge: num(b, /Eldest insured age:\s*(\d+)/), lastPremium: num(b, /Last year premium:\s*Rs\s*([\d,]+)/),
      amount: num(b, /Renewal premium:\s*Rs\s*([\d,]+)/), due: parseDate(grab(b, /Renewal due date:\s*(\S+)/)), cadence: 'yearly', rail: 'Renewal',
    }),
  },
  {
    when: (i) => /email\.apple\.com/.test(i.sender),
    parse: (i, b) => {
      const m = b.match(/\n(.+)\nRenews (\S+)\n(Monthly|Yearly)\n₹([\d,.]+)/);
      if (!m) return null;
      const icloud = /iCloud/.test(m[1]);
      return { key: icloud ? 'cloud:icloud' : `sub:apple:${m[1]}`, category: 'apps', provider: icloud ? 'iCloud+' : m[1], plan: m[1], signal: 'bill', group: icloud ? 'cloud' : null, amount: amount(m[4]), due: parseDate(m[2]), cadence: m[3].toLowerCase(), rail: 'App store' };
    },
  },
  {
    when: (i) => /google\.com/.test(i.sender) && /Google One/.test(i.subject),
    parse: (i, b) => ({ key: 'cloud:googleone', category: 'apps', provider: 'Google One', plan: grab(b, /Plan:\s*(.+)/), group: 'cloud', signal: 'bill', amount: num(b, /Price:\s*₹([\d,.]+)/), due: parseDate(grab(b, /Next charge:\s*(\S+)/)), cadence: 'monthly', rail: 'Card e-mandate', storageUsed: grab(b, /Storage used:\s*(.+)/) }),
  },
  {
    when: (i) => /cult\.fit/.test(i.sender) && /checked in/i.test(i.subject),
    parse: (i) => ({ key: 'sub:CULTFIT', category: 'apps', provider: 'cult.fit', signal: 'checkin', checkin: i.at.slice(0, 10), centre: grab(i.subject, /cult (.+)$/) }),
  },
  {
    when: (i) => /cult\.fit/.test(i.sender),
    parse: (i, b) => ({ key: 'sub:CULTFIT', category: 'apps', provider: 'cult.fit', signal: 'info', plan: grab(b, /Plan:\s*(.+)/), group: 'fitness' }),
  },
  {
    when: (i) => /canva\.com|adobe\.com|notion\.so|openai\.com/.test(i.sender) && /Product:/.test(i.body),
    parse: (i, b) => {
      const vendor = grab(b, /Product:\s*(.+)/);
      return { key: `saas:${vendor}`, category: 'apps', provider: vendor, plan: `${vendor}, ${grab(b, /Billing:\s*(\w+)/)}`, signal: 'bill', group: /Canva|Adobe/.test(vendor) ? 'design' : 'saas', amount: num(b, /Amount paid:\s*₹([\d,.]+)/), paidOn: parseDate(grab(b, /Date:\s*(\S+)/)), cadence: (grab(b, /Billing:\s*(\w+)/) || 'monthly').toLowerCase(), rail: 'Card e-mandate', lastActive: parseDate(grab(b, /Last active:\s*(\S+)/)) };
    },
  },
  {
    when: (i) => /incometax\.gov\.in/.test(i.sender),
    parse: (i, b) => ({ key: 'tax:itr', category: 'tax', provider: 'Income Tax', plan: `ITR, AY ${grab(b, /Assessment Year:\s*(\S+)/)}`, signal: 'itr', regime: grab(b, /Tax regime:\s*(\w+)/), gross: num(b, /Gross total income:\s*([\d,]+)/), d80c: num(b, /80C:\s*([\d,]+)/), d80d: num(b, /80D:\s*([\d,]+)/), taxable: num(b, /Total taxable income:\s*([\d,]+)/) }),
  },
  {
    when: (i) => /epfindia\.gov\.in/.test(i.sender),
    parse: (i, b) => ({ key: 'claim:epf', category: 'tax', provider: 'EPFO', plan: `EPF with ${grab(b, /previous employer (.+?) that/)}`, signal: 'epf', employer: grab(b, /previous employer (.+?) that/), balance: num(b, /Balance in that account:\s*Rs\s*([\d,]+)/) }),
  },
];

// ---------- SMS ----------
const smsRules = [
  { when: (i, b) => /\bOTP\b/.test(b), parse: () => null },
  {
    // HDFC / PhonePe-style UPI AutoPay debit
    when: (i, b) => /for UPI AutoPay to/.test(b),
    parse: (i, b) => {
      const m = b.match(/Rs\.?\s?([\d,]+\.\d{2}) debited from A\/c XX(\d{4}).*?(?:on (\S+) )?for UPI AutoPay to (.+?) via (\w+)/);
      if (!m) return null;
      return debit(i, m[4], amount(m[1]), 'UPI AutoPay', { via: m[5], bankLast4: m[2] });
    },
  },
  {
    // ICICI-style UPI AutoPay debit
    when: (i, b) => /; UPI AutoPay to/.test(b),
    parse: (i, b) => {
      const m = b.match(/XX(\d{4}) debited for Rs ([\d,.]+) on (\S+); UPI AutoPay to (.+?) via (.+?)\./);
      if (!m) return null;
      return debit(i, m[4], amount(m[2]), 'UPI AutoPay', { via: m[5], bankLast4: m[1], quarterly: /Validity 3 months/.test(b) });
    },
  },
  {
    when: (i, b) => /\(e-mandate\)/.test(b),
    parse: (i, b) => {
      const m = b.match(/Rs ([\d,.]+) spent on (.+?) Card XX(\d{4}) at (.+?) on (\S+) \(e-mandate\)/);
      if (!m) return null;
      return debit(i, m[4], amount(m[1]), 'Card e-mandate', { cardLast4: m[3] });
    },
  },
  {
    when: (i, b) => /Recharge of Rs \d+ successful|recharge of Rs \d+ on .* is successful/i.test(b),
    parse: (i, b) => {
      const op = /VIINDA/.test(i.sender) ? 'vi' : /AIRTEL/.test(i.sender) ? 'airtel' : 'jio';
      return { key: `mobile:${op}`, category: 'phone', signal: 'recharge-info', op, number: grab(b, /(\d{2}X+\d{2})/), planDaily: num(b, /([\d.]+)\s?GB\/day/), days: num(b, /(\d+) days/), planPrice: num(b, /Rs (\d+)/) };
    },
  },
  {
    when: (i, b) => /Usage summary for/.test(b),
    parse: (i, b) => {
      const op = /VIINDA/.test(i.sender) ? 'vi' : /AIRTEL/.test(i.sender) ? 'airtel' : 'jio';
      return { key: `mobile:${op}`, category: 'phone', signal: 'usage', op, number: grab(b, /for (\S+?):/), avgDaily: num(b, /is ([\d.]+) GB/), planDaily: num(b, /your ([\d.]+) GB\/day/) };
    },
  },
  {
    when: (i, b) => /Credit Card XX\d{4} statement generated/.test(b),
    parse: (i, b) => {
      const m = b.match(/^(.+?) Credit Card XX(\d{4}) statement generated\. Total due Rs ([\d,.]+), Min due Rs ([\d,.]+), due by (\S+?)\.$/);
      if (!m) return null;
      return { key: `card:${m[2]}`, category: 'credit', provider: m[1], plan: `Credit card XX${m[2]}`, signal: 'statement', last4: m[2], amount: amount(m[3]), minDue: amount(m[4]), due: parseDate(m[5]), cadence: 'monthly', rail: 'Card statement' };
    },
  },
  {
    when: (i, b) => /^Payment of Rs [\d,.]+ received towards/.test(b),
    parse: (i, b) => {
      const m = b.match(/Payment of Rs ([\d,.]+) received towards your (.+?) Credit Card XX(\d{4})/);
      return m && { key: `card:${m[3]}`, category: 'credit', signal: 'payment', paid: amount(m[1]), paidOn: i.at.slice(0, 10) };
    },
  },
  {
    when: (i, b) => /^EMI of Rs/.test(b),
    parse: (i, b) => {
      const m = b.match(/EMI of Rs ([\d,.]+) for (.+?) A\/c XX(\d{4}) has been debited on (\S+)\. -(.+)$/);
      if (!m) return null;
      return { key: `loan:${m[3]}`, category: 'credit', provider: m[5].trim(), plan: m[2], signal: 'emi', amount: amount(m[1]), paidOn: parseDate(m[4]), cadence: 'monthly', rail: 'EMI' };
    },
  },
];

function debit(i, merchantText, amt, rail, extra) {
  const m = merchant(merchantText);
  if (!m) return { unrecognised: true, reason: `Unknown merchant ${merchantText}` };
  const paidOn = i.at.slice(0, 10);
  if (m.type === 'recharge') return { key: m.key, category: 'phone', provider: { jio: 'Jio', airtel: 'Airtel', vi: 'Vi' }[m.op], signal: 'debit', op: m.op, amount: amt, paidOn, rail, ...extra };
  return { key: m.key, category: 'apps', provider: m.name, group: m.group, signal: 'debit', amount: amt, paidOn, rail, cadence: extra.quarterly ? 'quarterly' : undefined, ...extra };
}

// ---------- CIBIL ----------
export function parseCibil(b) {
  const score = num(b, /CIBIL Score:\s*(\d+)/);
  const enquiries = num(b, /Enquiries \(last 6 months\):\s*(\d+)/);
  const reportDate = parseDate(grab(b, /Report date:\s*(\S+)/));
  const accounts = b.split(/\nACCOUNT \d+\n/).slice(1).map((blk) => {
    const type = grab(blk, /Account Type:\s*(.+)/);
    const last4 = grab(blk, /Account Number:\s*X+(\d{4})/);
    const a = {
      lender: grab(blk, /Member Name:\s*(.+)/), type, last4, opened: parseDate(grab(blk, /Date Opened:\s*(\S+)/)),
      balance: num(blk, /Current Balance:\s*([\d,]+)/), late: /STD|SUB|DBT|LSS|\b0[3-9]\d\b/.test(grab(blk, /Payment History.*?:\s*(.+)/) || ''),
    };
    if (type === 'Credit Card') Object.assign(a, { limit: num(blk, /Credit Limit:\s*([\d,]+)/) });
    else Object.assign(a, { sanctioned: num(blk, /Sanctioned Amount:\s*([\d,]+)/), emi: num(blk, /EMI Amount:\s*([\d,]+)/), rate: num(blk, /Rate of Interest:\s*([\d.]+)/), monthsLeft: num(blk, /Tenure Remaining:\s*(\d+)/) });
    return a;
  });
  return { score, enquiries, reportDate, accounts };
}

// ---------- entry point ----------
const BILLISH = /(recharge|bill|due|premium|invoice|payable|subscription|renew)/i;
const MONEYISH = /(rs\.?\s?\d|₹\s?\d|\d[\d,]*\s?rupees)/i;

export function parseItem(item) {
  const b = item.body || '';
  if (item.source === 'CIBIL') {
    const report = parseCibil(b);
    return report.score ? { key: 'cibil', category: 'credit', signal: 'cibil', report } : { unrecognised: true, reason: 'Could not read credit report' };
  }
  const rules = item.source === 'SMS' ? smsRules : emailRules;
  for (const r of rules) {
    if (r.when(item, b)) {
      const d = r.parse(item, b);
      return d ? { ...d, at: item.at } : d;
    }
  }
  if (BILLISH.test(b + ' ' + item.subject) && MONEYISH.test(b)) return { unrecognised: true, reason: 'Looks like a bill, format not known' };
  return null; // noise
}
