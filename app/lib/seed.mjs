// Synthetic test data. Each test household is described as a list of
// accounts; renderers turn those into the raw messages a real scan would see
// (Gmail emails, bank and operator SMS, a CIBIL report). The pipeline only
// ever reads the raw text, never these specs.

import { tariffs } from './catalog.mjs';
import { emi } from './money.mjs';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function rng(seed) {
  let a = 0;
  for (const c of String(seed)) a = (Math.imul(a, 31) + c.charCodeAt(0)) | 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const money = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n) => Math.round(n).toLocaleString('en-IN');
const dMonY = (d) => `${pad(d.getUTCDate())}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
const dMonYY = (d) => `${pad(d.getUTCDate())}-${MON[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
const dSlash = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const dDash = (d) => `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
const monthName = (d) => `${MONTH_FULL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

function makeCtx(now, seed) {
  const r = rng(seed);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9, 0, 0));
  const day = (offset, hour = 9) => new Date(today.getTime() + offset * 864e5 + (hour - 9) * 36e5);
  const items = [];
  const push = (source, at, from, subject, body) => items.push({ source, at: at.toISOString(), sender: from, subject, body });
  const ref = () => String(Math.floor(r() * 9e11) + 1e11);
  return { r, day, items, push, ref, today };
}

// ---------- renderers: one per account type ----------

const R = {
  broadband(c, a) {
    const isp = {
      act: { from: 'ebill@actcorp.in', brand: 'ACT Fibernet', plan: `ACT Blaze ${a.mbps} Mbps` },
      airtel: { from: 'ebill@airtel.com', brand: 'Airtel Xstream Fiber', plan: `Xstream Fiber ${a.mbps} Mbps` },
      bsnl: { from: 'bsnlebill@bsnl.co.in', brand: 'BSNL Bharat Fibre', plan: `Fibre Basic ${a.mbps} Mbps` },
    }[a.isp];
    for (let m = 2; m >= 0; m--) {
      const due = c.day(-m * 30 + a.dueIn);
      const issued = c.day(Math.min(-1, -m * 30 + a.dueIn - 15));
      const peak = Math.max(10, Math.round(a.peak * (0.85 + c.r() * 0.2)));
      const gb = Math.round(a.mbps * 0.6 + c.r() * 200);
      if (a.isp === 'act') {
        c.push('Gmail', issued, isp.from, `Your ACT Fibernet bill for ${monthName(issued)}`,
          `Dear Customer,\nYour ACT Fibernet bill is ready.\nAccount No: ${a.account}\nPlan: ${isp.plan}\nBill period: ${monthName(issued)}\nData used: ${gb} GB\nPeak speed used: ${peak} Mbps\nAmount Due: Rs. ${money(a.price)}\nDue Date: ${dMonY(due)}\nPay on time to avoid late fees.\nTeam ACT`);
      } else if (a.isp === 'airtel') {
        c.push('Gmail', issued, isp.from, `Airtel Xstream Fiber bill for ${monthName(issued)}`,
          `Hi,\nYour Airtel Xstream Fiber bill for account ${a.account} has been generated.\nCurrent plan: ${isp.plan}\nUsage this cycle: ${gb} GB, highest speed reached ${peak} Mbps\nTotal amount payable: ₹${money(a.price)}\nPay by: ${dSlash(due)}\nThank you for choosing Airtel.`);
      } else {
        c.push('Gmail', issued, isp.from, `BSNL Bill for Telephone No ${a.account}`,
          `Dear Subscriber,\nBill for ${isp.brand} (${isp.plan})\nBill Amount Rs ${money(a.price)}\nLast date of payment ${dSlash(due)}\nMax speed utilised: ${peak} Mbps\nBSNL`);
      }
    }
  },

  electricity(c, a) {
    const t = tariffs[a.discom];
    const step = t.period === 'bimonthly' ? 60 : 30;
    const from = { msedcl: 'ebill@mahadiscom.in', bescom: 'noreply@bescom.co.in', tpddl: 'ebill@tatapower-ddl.com', tangedco: 'billing@tangedco.org' }[a.discom];
    for (let m = 2; m >= 0; m--) {
      const units = Math.round(a.units * (m === 0 ? 1 : 0.88 + c.r() * 0.18));
      const amt = billFor(t, units);
      const issued = c.day(-m * step - a.dueIn);
      const due = c.day(-m * step + a.dueIn);
      c.push('Gmail', issued, from, `${t.name} electricity bill for Consumer No ${a.consumer}`,
        `Dear Consumer,\n${t.name} Electricity Bill\nConsumer No: ${a.consumer}\nBilling period: ${t.period === 'bimonthly' ? 'Bi-monthly' : 'Monthly'}\nUnits consumed: ${units} kWh\nBill amount: Rs ${money(amt)}\nDue date: ${dDash(due)}\nPay online to avoid disconnection.`);
    }
  },

  prepaid(c, a) {
    // a.op jio | airtel | vi ; a.days validity ; recharges spaced by validity
    const opName = { jio: 'JIO', airtel: 'AIRTEL', vi: 'Vi' }[a.op];
    let last = -a.lastRechargeDaysAgo;
    for (let k = 0; k < (a.days >= 84 ? 2 : 3); k++) {
      const at = c.day(last - k * a.days, 10);
      c.push('SMS', at, 'AX-HDFCBK', '',
        `Rs.${money(a.price)} debited from A/c XX${a.bankLast4} on ${dMonYY(at)} for UPI AutoPay to ${opName} via PhonePe. UPI Ref ${c.ref()}. Not you? Call 18002586161 -HDFC Bank`);
      if (a.op === 'vi') c.push('SMS', at, 'VM-VIINDA', '', `Recharge of Rs ${a.price} successful for ${a.number}. Validity ${a.days} days. ${a.daily} GB/day data. Thank you for choosing Vi.`);
      if (a.op === 'airtel') c.push('SMS', at, 'AD-AIRTEL', '', `Your recharge of Rs ${a.price} on ${a.number} is successful. Pack: ${a.daily}GB/day, validity ${a.days} days.`);
      if (a.op === 'jio') c.push('SMS', at, 'JX-JIOINF', '', `Recharge of Rs ${a.price} successful on Jio number ${a.number}. Plan: ${a.daily}GB/day for ${a.days} days.`);
    }
    const usageAt = c.day(-3, 20);
    const sender = { jio: 'JM-JIOINF', airtel: 'AD-AIRTEL', vi: 'VM-VIINDA' }[a.op];
    c.push('SMS', usageAt, sender, '', `Usage summary for ${a.number}: average daily data use in the last 28 days is ${a.avgUse} GB against your ${a.daily} GB/day plan.`);
  },

  postpaid(c, a) {
    for (let m = 2; m >= 0; m--) {
      const at = c.day(-m * 30 - 12);
      const used = Math.round(a.used * (0.8 + c.r() * 0.35));
      c.push('Gmail', at, 'ebill@airtel.com', `Your Airtel Postpaid bill for ${a.number}`,
        `Dear Customer,\nAirtel Postpaid bill for ${a.number}\nPlan: Airtel Postpaid ₹${a.price}, ${a.gb} GB\nData used: ${used} GB of ${a.gb} GB\nAmount due: ₹${money(Math.round(a.price * 1.18))} (incl. GST)\nDue date: ${dSlash(c.day(-m * 30 + 6))}`);
    }
  },

  subscription(c, a) {
    const count = a.cadence === 'yearly' ? 1 : 3;
    const step = a.cadence === 'yearly' ? 365 : 30;
    for (let k = 0; k < count; k++) {
      const at = c.day(-a.lastDaysAgo - k * step, 7);
      if (a.rail === 'card') {
        c.push('SMS', at, 'AX-HDFCBK', '', `Rs ${money(a.price)} spent on HDFC Bank Card XX${a.cardLast4} at ${a.merchantText} on ${dMonYY(at)} (e-mandate). Avl Lmt Rs ${money(40000 + c.r() * 20000)}. Not you? Call 18002586161`);
      } else {
        c.push('SMS', at, 'VK-ICICIT', '', `ICICI Bank Acct XX${a.bankLast4} debited for Rs ${money(a.price)} on ${dMonYY(at)}; UPI AutoPay to ${a.merchantText} via Google Pay. RRN ${c.ref()}.`);
      }
    }
  },

  cult(c, a) {
    for (let k = 0; k < 3; k++) {
      const at = c.day(-a.lastDaysAgo - k * 30, 6);
      c.push('SMS', at, 'VM-PHONPE', '', `Rs ${money(a.price)} debited from A/c XX${a.bankLast4} for UPI AutoPay to CULTFIT via PhonePe on ${dMonYY(at)}. Ref ${c.ref()}`);
    }
    c.push('Gmail', c.day(-a.lastDaysAgo - 60, 8), 'no-reply@cult.fit', 'Your cultpass ELITE is active',
      `Hi,\nYour cultpass ELITE membership is active.\nPlan: cultpass ELITE, monthly\nAmount: Rs ${money(a.price)} per month, paid via UPI AutoPay.\nSee you at the centre!`);
    for (let k = 0; k < 4; k++) {
      const at = c.day(-a.lastCheckinDaysAgo - k * 3, 7);
      c.push('Gmail', at, 'no-reply@cult.fit', `You checked in at cult ${a.centre}`, `Great job showing up today at cult ${a.centre}. Keep the streak going!`);
    }
  },

  apple(c, a) {
    for (let k = 0; k < 3; k++) {
      const at = c.day(-a.lastDaysAgo - k * 30, 3);
      c.push('Gmail', at, 'no_reply@email.apple.com', 'Your receipt from Apple.',
        `Apple ID: ${a.appleId}\nORDER ID: M${c.ref().slice(0, 9)}\nDOCUMENT NO.: ${c.ref().slice(0, 12)}\n${a.item}\nRenews ${dMonY(c.day(-a.lastDaysAgo - k * 30 + 30))}\nMonthly\n₹${money(a.price)}\nTOTAL ₹${money(a.price)}`);
    }
  },

  googleOne(c, a) {
    for (let k = 0; k < 3; k++) {
      const at = c.day(-a.lastDaysAgo - k * 30, 4);
      c.push('Gmail', at, 'payments-noreply@google.com', 'Your Google One receipt',
        `Thanks for your Google One subscription.\nPlan: Google One ${a.plan}\nPrice: ₹${money(a.price)}/month\nStorage used: ${a.used} of ${a.plan}\nNext charge: ${dMonY(c.day(-a.lastDaysAgo - k * 30 + 30))}`);
    }
  },

  saas(c, a) {
    const meta = {
      'Canva Pro': { from: 'invoices@canva.com', subj: 'Your Canva Pro invoice' },
      'Adobe Express': { from: 'mail@mail.adobe.com', subj: 'Your Adobe Express Premium plan receipt' },
      Notion: { from: 'billing@notion.so', subj: 'Your Notion receipt' },
      'ChatGPT Plus': { from: 'noreply@tm.openai.com', subj: 'Your ChatGPT Plus receipt' },
    }[a.vendor];
    for (let k = 0; k < 3; k++) {
      const at = c.day(-a.lastDaysAgo - k * 30, 5);
      c.push('Gmail', at, meta.from, meta.subj,
        `Receipt\nProduct: ${a.vendor}\nBilling: Monthly\nAmount paid: ₹${money(a.price)}\nPaid with card ending ${a.cardLast4}\nDate: ${dMonY(at)}${a.lastUsedDaysAgo ? `\nLast active: ${dMonY(c.day(-a.lastUsedDaysAgo))}` : ''}`);
    }
  },

  food(c, a) {
    const at = c.day(-a.lastDaysAgo, 21);
    c.push('SMS', at, 'VK-ICICIT', '', `ICICI Bank Acct XX${a.bankLast4} debited for Rs ${money(a.price)} on ${dMonYY(at)}; UPI AutoPay to ${a.merchantText} via Google Pay. RRN ${c.ref()}. Validity 3 months.`);
  },

  health(c, a) {
    const at = c.day(Math.min(-2, a.dueIn - 30), 11);
    const from = { 'Star Health': 'renewals@starhealth.in', 'HDFC ERGO': 'renewal@hdfcergo.com', 'Niva Bupa': 'care@nivabupa.com' }[a.insurer];
    c.push('Gmail', at, from, `Renewal notice: ${a.product} policy ${a.policy}`,
      `Dear Policyholder,\nYour ${a.insurer} policy is due for renewal.\nProduct: ${a.product}\nPolicy No: ${a.policy}\nSum Insured: Rs ${whole(a.sumInsured)}\nMembers covered: ${a.members}\nEldest insured age: ${a.eldestAge}\nLast year premium: Rs ${whole(a.lastPremium)}\nRenewal premium: Rs ${whole(a.premium)} (incl. GST)\nRenewal due date: ${dMonY(c.day(a.dueIn))}\nRenew on time to keep your continuity benefits.`);
  },

  creditCard(c, a) {
    for (let m = 2; m >= 0; m--) {
      const stmt = c.day(Math.min(-1, -m * 30 + a.dueIn - 20), 18);
      const due = c.day(-m * 30 + a.dueIn);
      const total = Math.round(a.balance * (1 - m * 0.02));
      const min = Math.round(total * 0.05);
      c.push('SMS', stmt, 'AX-HDFCBK', '', `${a.bank === 'HDFC BANK' ? 'HDFC Bank' : a.bankShort} Credit Card XX${a.last4} statement generated. Total due Rs ${money(total)}, Min due Rs ${money(min)}, due by ${dMonYY(due)}.`);
      if (m > 0) {
        const paid = a.revolving ? min : total;
        c.push('SMS', c.day(-m * 30 + a.dueIn - 1, 19), 'AX-HDFCBK', '', `Payment of Rs ${money(paid)} received towards your ${a.bankShort} Credit Card XX${a.last4}. Thank you.`);
      }
    }
  },

  loan(c, a) {
    const amount = Math.round(emi(a.outstanding, a.rate, a.monthsLeft));
    const sender = { 'BAJAJ FINANCE LTD': 'VM-BAJAJF', 'STATE BANK OF INDIA': 'AD-SBIINB', 'NAVI FINSERV': 'VK-NAVIFS', 'HDFC BANK': 'AX-HDFCBK' }[a.lender] || 'VM-LOANSS';
    for (let m = 2; m >= 0; m--) {
      const at = c.day(-m * 30 - (30 - a.dueIn), 8);
      c.push('SMS', at, sender, '', `EMI of Rs ${money(amount)} for ${a.type} A/c XX${a.acct} has been debited on ${dMonYY(at)}. -${a.lenderShort}`);
    }
  },

  gas(c, a) {
    for (let m = 1; m >= 0; m--) {
      const at = c.day(-m * 30 - 17);
      c.push('Gmail', at, 'billing@mngl.in', 'MNGL PNG bill', `Dear Customer,\nMNGL Domestic PNG bill\nBP No: ${a.bp}\nGas consumed: ${a.scm} SCM\nBill amount: Rs ${money(a.amount)}\nDue date: ${dMonY(c.day(-m * 30 + 4))}`);
    }
  },

  itr(c, a) {
    c.push('Gmail', c.day(-80, 12), 'intimations@cpc.incometax.gov.in', 'ITR-V acknowledgement for AY 2026-27',
      `INDIAN INCOME TAX RETURN ACKNOWLEDGEMENT\nAssessment Year: 2026-27\nPAN: ${a.pan}\nTax regime: ${a.regime}\nGross total income: ${whole(a.gross)}\nDeduction u/s 80C: ${whole(a.d80c)}\nDeduction u/s 80D: ${whole(a.d80d)}\nTotal taxable income: ${whole(a.taxable)}\nThis return has been successfully verified.`);
  },

  epf(c, a) {
    c.push('Gmail', c.day(-22, 10), 'no-reply@epfindia.gov.in', 'EPF passbook update',
      `Dear Member,\nUAN: ${a.uan}\nYou have an EPF account with previous employer ${a.employer} that has not been transferred.\nBalance in that account: Rs ${whole(a.balance)}\nSubmit Form 13 online to transfer it to your current account or Form 19 to withdraw.`);
  },

  dth(c, a) {
    // A format the rules don't know, to exercise the review/LLM path.
    for (let m = 1; m >= 0; m--) {
      const at = c.day(-m * 30 - 9);
      c.push('Gmail', at, 'care@tataplay.com', 'Your Tata Play account summary',
        `Hello ${a.name},\nThanks for being with Tata Play. Here is your monthly pack summary for Subscriber ID ${a.subId}.\nYour channels: ${a.pack}\nMonthly recharge: ${a.price} rupees\nRecharge before ${dMonY(c.day(-m * 30 + 12))} to keep watching.`);
    }
  },

  noise(c) {
    c.push('SMS', c.day(-1, 13), 'AX-HDFCBK', '', `${Math.floor(100000 + c.r() * 899999)} is the OTP for your transaction of Rs 2,340.00 at AMAZON. Valid for 5 mins. Do not share with anyone.`);
    c.push('Gmail', c.day(-2, 8), 'newsletter@zerodha.com', 'Z-Connect weekly', 'This week on Z-Connect: what changed in F&O rules, and more.');
    c.push('Gmail', c.day(-6, 15), 'order-update@amazon.in', 'Your Amazon.in order has been delivered', 'Your package with Prestige Induction Cooktop was delivered.');
    c.push('SMS', c.day(-4, 9), 'JD-SWIGGY', '', 'Your Swiggy order from Meghana Foods is out for delivery.');
    c.push('Gmail', c.day(-12, 9), 'alerts@myntra.com', 'Big Fashion Festival is live', 'Up to 80% off on top brands. Shop now.');
  },
};

function billFor(t, units) {
  if (t.freeUpTo && units <= t.freeUpTo) return 0;
  let left = units, prev = 0, total = 0;
  for (const [upto, rate] of t.slabs) {
    const band = Math.min(left, upto - prev);
    if (band <= 0) break;
    total += band * rate; left -= band; prev = upto;
  }
  return Math.round(total + 120); // + fixed charge
}
export { billFor };

function cibilReport(c, person, accounts) {
  const lines = [
    'CIBIL TRANSUNION CONSUMER CREDIT REPORT',
    `Name: ${person.name.toUpperCase()}`,
    `Report date: ${dDash(c.today)}`,
    `CIBIL Score: ${person.score}`,
    `Enquiries (last 6 months): ${person.enquiries ?? 1}`,
    '',
  ];
  accounts.forEach((a, i) => {
    lines.push(`ACCOUNT ${i + 1}`);
    lines.push(`Member Name: ${a.bank || a.lender}`);
    if (a.kind === 'creditCard') {
      lines.push('Account Type: Credit Card', `Account Number: XXXX${a.last4}`, `Date Opened: ${dDash(c.day(-a.ageDays))}`,
        `Credit Limit: ${whole(a.limit)}`, `Current Balance: ${whole(a.balance)}`, `Amount Overdue: 0`);
    } else {
      lines.push(`Account Type: ${a.type}`, `Account Number: XXXX${a.acct}`, `Date Opened: ${dDash(c.day(-a.ageDays))}`,
        `Sanctioned Amount: ${whole(a.sanctioned)}`, `Current Balance: ${whole(a.outstanding)}`,
        `EMI Amount: ${whole(emi(a.outstanding, a.rate, a.monthsLeft))}`, `Rate of Interest: ${a.rate.toFixed(2)}%`,
        `Repayment Tenure Remaining: ${a.monthsLeft} months`);
    }
    lines.push(`Payment History (36 months): ${Array.from({ length: 12 }, () => (a.late ? 'STD' : '000')).join(' ')}`, '');
  });
  c.push('CIBIL', c.day(0, 9), 'CIBIL TransUnion', 'Credit report', lines.join('\n'));
}

export function renderHousehold(spec, now = new Date()) {
  const c = makeCtx(now, spec.email);
  for (const a of spec.accounts) R[a.kind](c, a);
  R.noise(c);
  const credit = spec.accounts.filter((a) => a.kind === 'creditCard' || a.kind === 'loan');
  if (spec.cibil) cibilReport(c, spec.cibil, credit);
  return c.items.sort((x, y) => y.at.localeCompare(x.at));
}

// ---------- the seeded test households ----------

export const households = [
  {
    email: 'kavya@test.cutmybills.in', name: 'Kavya Deshmukh', city: 'Pune',
    blurb: 'Family of 3 in Pune. Home loan, a revolving card, four streaming apps.',
    cibil: { name: 'Kavya Deshmukh', score: 731 },
    accounts: [
      { kind: 'broadband', isp: 'act', mbps: 300, price: 1199, peak: 62, dueIn: 9, account: '1047728391' },
      { kind: 'electricity', discom: 'msedcl', units: 412, dueIn: 20, consumer: '170012345678' },
      { kind: 'gas', bp: '5100223344', scm: 16, amount: 640 },
      { kind: 'prepaid', op: 'jio', price: 1029, daily: 2, days: 84, avgUse: 1.1, number: '98XXXXXX41', bankLast4: '4521', lastRechargeDaysAgo: 57 },
      { kind: 'prepaid', op: 'vi', price: 349, daily: 1.5, days: 28, avgUse: 0.9, number: '97XXXXXX18', bankLast4: '4521', lastRechargeDaysAgo: 13 },
      { kind: 'subscription', merchantText: 'NETFLIX.COM', price: 649, rail: 'card', cardLast4: '8812', lastDaysAgo: 16 },
      { kind: 'subscription', merchantText: 'JioHotstar', price: 299, rail: 'upi', bankLast4: '4521', lastDaysAgo: 20 },
      { kind: 'subscription', merchantText: 'SONYLIV', price: 399, rail: 'upi', bankLast4: '4521', lastDaysAgo: 11 },
      { kind: 'subscription', merchantText: 'PRIMEVIDEO', price: 1499, rail: 'card', cardLast4: '8812', lastDaysAgo: 140, cadence: 'yearly' },
      { kind: 'subscription', merchantText: 'SPOTIFY', price: 179, rail: 'card', cardLast4: '8812', lastDaysAgo: 19 },
      { kind: 'cult', price: 1499, lastDaysAgo: 23, lastCheckinDaysAgo: 52, centre: 'Kothrud', bankLast4: '4521' },
      { kind: 'apple', item: 'iCloud+ with 200 GB storage', price: 219, appleId: 'kavya.d@icloud.com', lastDaysAgo: 13 },
      { kind: 'googleOne', plan: '2 TB', price: 650, used: '0.6 TB', lastDaysAgo: 15 },
      { kind: 'health', insurer: 'Star Health', product: 'Family Health Optima', policy: 'P/181100/01/2026/004512', sumInsured: 1000000, members: 3, eldestAge: 41, lastPremium: 24900, premium: 28400, dueIn: 24 },
      { kind: 'creditCard', bank: 'HDFC BANK', bankShort: 'HDFC Bank', last4: '8812', limit: 135000, balance: 86400, revolving: true, dueIn: 10, ageDays: 2250 },
      { kind: 'loan', lender: 'BAJAJ FINANCE LTD', lenderShort: 'Bajaj Finance', type: 'Personal Loan', acct: '3390', outstanding: 420000, sanctioned: 600000, rate: 16, monthsLeft: 34, dueIn: 11, ageDays: 720 },
      { kind: 'loan', lender: 'STATE BANK OF INDIA', lenderShort: 'SBI', type: 'Housing Loan', acct: '4410', outstanding: 3800000, sanctioned: 4500000, rate: 8.9, monthsLeft: 216, dueIn: 13, ageDays: 3150 },
      { kind: 'itr', pan: 'ABCPD1234K', regime: 'Old', gross: 1180000, d80c: 150000, d80d: 0, taxable: 980000 },
    ],
  },
  {
    email: 'arjun@test.cutmybills.in', name: 'Arjun Rao', city: 'Bengaluru',
    blurb: 'Single, Bengaluru. Gigabit fibre he barely uses, two food memberships, pays cards in full.',
    cibil: { name: 'Arjun Rao', score: 802 },
    accounts: [
      { kind: 'broadband', isp: 'airtel', mbps: 1000, price: 3999, peak: 140, dueIn: 6, account: '20019938' },
      { kind: 'electricity', discom: 'bescom', units: 96, dueIn: 12, consumer: '7731220045' },
      { kind: 'postpaid', number: '99XXXXXX07', price: 599, gb: 75, used: 14 },
      { kind: 'subscription', merchantText: 'NETFLIX.COM', price: 499, rail: 'card', cardLast4: '2207', lastDaysAgo: 4 },
      { kind: 'subscription', merchantText: 'PRIMEVIDEO', price: 1499, rail: 'card', cardLast4: '2207', lastDaysAgo: 200, cadence: 'yearly' },
      { kind: 'subscription', merchantText: 'YOUTUBE PREMIUM', price: 149, rail: 'upi', bankLast4: '0931', lastDaysAgo: 8 },
      { kind: 'subscription', merchantText: 'JioHotstar', price: 299, rail: 'upi', bankLast4: '0931', lastDaysAgo: 2 },
      { kind: 'subscription', merchantText: 'SPOTIFY', price: 119, rail: 'card', cardLast4: '2207', lastDaysAgo: 26 },
      { kind: 'food', merchantText: 'SWIGGY ONE', price: 299, bankLast4: '0931', lastDaysAgo: 34 },
      { kind: 'food', merchantText: 'ZOMATO GOLD', price: 249, bankLast4: '0931', lastDaysAgo: 47 },
      { kind: 'creditCard', bank: 'ICICI BANK', bankShort: 'ICICI Bank', last4: '2207', limit: 300000, balance: 41200, revolving: false, dueIn: 15, ageDays: 1600 },
      { kind: 'loan', lender: 'HDFC BANK', lenderShort: 'HDFC Bank', type: 'Auto Loan', acct: '7781', outstanding: 520000, sanctioned: 800000, rate: 9.1, monthsLeft: 38, dueIn: 4, ageDays: 650 },
      { kind: 'health', insurer: 'HDFC ERGO', product: 'Optima Secure', policy: '2856 2041 5512 0000', sumInsured: 500000, members: 1, eldestAge: 29, lastPremium: 11200, premium: 11600, dueIn: 70 },
      { kind: 'itr', pan: 'BHXPR5521L', regime: 'New', gross: 2650000, d80c: 0, d80d: 0, taxable: 2575000 },
    ],
  },
  {
    email: 'ravi@test.cutmybills.in', name: 'Ravi Kumar', city: 'Delhi',
    blurb: 'Freelance designer in Delhi after a layoff. Two design tools, a 22% loan, EPF left behind.',
    cibil: { name: 'Ravi Kumar', score: 688, enquiries: 4 },
    accounts: [
      { kind: 'electricity', discom: 'tpddl', units: 236, dueIn: 14, consumer: '60009871234' },
      { kind: 'broadband', isp: 'airtel', mbps: 300, price: 999, peak: 210, dueIn: 3, account: '20087710' },
      { kind: 'prepaid', op: 'airtel', price: 979, daily: 2, days: 84, avgUse: 2.4, number: '88XXXXXX90', bankLast4: '6612', lastRechargeDaysAgo: 30 },
      { kind: 'saas', vendor: 'Canva Pro', price: 500, cardLast4: '5501', lastDaysAgo: 6 },
      { kind: 'saas', vendor: 'Adobe Express', price: 399, cardLast4: '5501', lastDaysAgo: 18, lastUsedDaysAgo: 75 },
      { kind: 'saas', vendor: 'Notion', price: 1000, cardLast4: '5501', lastDaysAgo: 9 },
      { kind: 'subscription', merchantText: 'NETFLIX.COM', price: 199, rail: 'card', cardLast4: '5501', lastDaysAgo: 12 },
      { kind: 'creditCard', bank: 'SBI CARD', bankShort: 'SBI Card', last4: '5501', limit: 60000, balance: 38500, revolving: true, dueIn: 8, ageDays: 1200 },
      { kind: 'loan', lender: 'NAVI FINSERV', lenderShort: 'Navi', type: 'Personal Loan', acct: '1205', outstanding: 180000, sanctioned: 250000, rate: 22, monthsLeft: 24, dueIn: 6, ageDays: 300 },
      { kind: 'epf', uan: '100912345678', employer: 'Pixelcraft Studios Pvt Ltd', balance: 214600 },
      { kind: 'itr', pan: 'CKRPK7734M', regime: 'New', gross: 840000, d80c: 0, d80d: 0, taxable: 765000 },
    ],
  },
  {
    email: 'meera@test.cutmybills.in', name: 'Meera Iyer', city: 'Chennai',
    blurb: 'Retired couple in Chennai. Senior health cover, BSNL fibre, a DTH bill the rules cannot read.',
    cibil: { name: 'Meera Iyer', score: 776 },
    accounts: [
      { kind: 'electricity', discom: 'tangedco', units: 468, dueIn: 10, consumer: '09-123-456-789' },
      { kind: 'broadband', isp: 'bsnl', mbps: 300, price: 1199, peak: 38, dueIn: 7, account: '044-24912345' },
      { kind: 'prepaid', op: 'jio', price: 1199, daily: 3, days: 84, avgUse: 0.7, number: '94XXXXXX55', bankLast4: '2093', lastRechargeDaysAgo: 40 },
      { kind: 'subscription', merchantText: 'JioHotstar', price: 299, rail: 'upi', bankLast4: '2093', lastDaysAgo: 5 },
      { kind: 'health', insurer: 'Star Health', product: 'Senior Citizens Red Carpet', policy: 'P/181200/01/2026/009921', sumInsured: 500000, members: 2, eldestAge: 68, lastPremium: 47800, premium: 54200, dueIn: 31 },
      { kind: 'dth', name: 'Meera', subId: '1012345678', pack: 'Tamil Value Sports HD', price: 520 },
      { kind: 'itr', pan: 'AAQPI2201H', regime: 'Old', gross: 760000, d80c: 150000, d80d: 0, taxable: 560000 },
    ],
  },
];

// ---------- random test households ----------

const FIRST = ['Aditi', 'Rahul', 'Sneha', 'Vikram', 'Priya', 'Karthik', 'Ananya', 'Rohan', 'Neha', 'Siddharth', 'Pooja', 'Aman'];
const LAST = ['Sharma', 'Nair', 'Reddy', 'Gupta', 'Patel', 'Menon', 'Joshi', 'Das', 'Kulkarni', 'Singh'];
const CITIES = [
  { city: 'Pune', discom: 'msedcl', isp: 'act' },
  { city: 'Bengaluru', discom: 'bescom', isp: 'act' },
  { city: 'Delhi', discom: 'tpddl', isp: 'airtel' },
  { city: 'Chennai', discom: 'tangedco', isp: 'bsnl' },
];

export function randomHousehold(seed) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const chance = (p) => r() < p;
  const first = pick(FIRST), last = pick(LAST), place = pick(CITIES);
  const handle = `${first.toLowerCase()}.${String(Math.floor(r() * 900) + 100)}`;
  const bank4 = String(Math.floor(r() * 9000) + 1000), card4 = String(Math.floor(r() * 9000) + 1000);
  const score = 640 + Math.floor(r() * 170);
  const accounts = [];
  const mbps = pick([100, 150, 300, 500, 1000]);
  const plans = { act: [849, 1199, 1549, 2299], airtel: [699, 999, 1499, 3999], bsnl: [499, 799, 1199, 1199] }[place.isp];
  const idx = [100, 150, 300, 500, 1000].indexOf(mbps);
  accounts.push({ kind: 'broadband', isp: place.isp, mbps, price: plans[Math.min(idx, 3)] ?? 999, peak: Math.round(mbps * (0.15 + r() * 0.7)), dueIn: 3 + Math.floor(r() * 20), account: String(Math.floor(r() * 1e9)) });
  accounts.push({ kind: 'electricity', discom: place.discom, units: 120 + Math.floor(r() * 400), dueIn: 5 + Math.floor(r() * 20), consumer: String(Math.floor(r() * 1e11)) });
  const op = pick(['jio', 'airtel']);
  const p = pick([[1029, 2, 84], [799, 1.5, 84], [349, 2, 28]]);
  accounts.push({ kind: 'prepaid', op, price: op === 'airtel' && p[0] === 1029 ? 979 : p[0], daily: p[1], days: p[2], avgUse: Math.round((0.4 + r() * 2.2) * 10) / 10, number: `9${Math.floor(r() * 9)}XXXXXX${Math.floor(r() * 90 + 10)}`, bankLast4: bank4, lastRechargeDaysAgo: 3 + Math.floor(r() * 60) });
  for (const [m, price] of [['NETFLIX.COM', pick([199, 499, 649])], ['JioHotstar', 299], ['SONYLIV', 399], ['YOUTUBE PREMIUM', 149], ['SPOTIFY', 119]]) {
    if (chance(0.55)) accounts.push({ kind: 'subscription', merchantText: m, price, rail: chance(0.5) ? 'card' : 'upi', cardLast4: card4, bankLast4: bank4, lastDaysAgo: 1 + Math.floor(r() * 28) });
  }
  if (chance(0.5)) accounts.push({ kind: 'cult', price: 1499, lastDaysAgo: 1 + Math.floor(r() * 28), lastCheckinDaysAgo: chance(0.5) ? 2 : 35 + Math.floor(r() * 40), centre: 'HSR Layout', bankLast4: bank4 });
  if (chance(0.5)) accounts.push({ kind: 'apple', item: 'iCloud+ with 200 GB storage', price: 219, appleId: `${handle}@icloud.com`, lastDaysAgo: 2 + Math.floor(r() * 25) });
  if (chance(0.5)) { const [plan, price] = pick([['100 GB', 130], ['2 TB', 650]]); accounts.push({ kind: 'googleOne', plan, price, used: '40 GB', lastDaysAgo: 2 + Math.floor(r() * 25) }); }
  if (chance(0.4)) { accounts.push({ kind: 'food', merchantText: 'SWIGGY ONE', price: 299, bankLast4: bank4, lastDaysAgo: 10 + Math.floor(r() * 60) }); }
  if (chance(0.4)) { accounts.push({ kind: 'food', merchantText: 'ZOMATO GOLD', price: 249, bankLast4: bank4, lastDaysAgo: 10 + Math.floor(r() * 60) }); }
  const lastPrem = 12000 + Math.floor(r() * 18000);
  accounts.push({ kind: 'health', insurer: pick(['Star Health', 'HDFC ERGO', 'Niva Bupa']), product: 'Family Floater', policy: String(Math.floor(r() * 1e12)), sumInsured: pick([500000, 1000000]), members: pick([1, 2, 3, 4]), eldestAge: 26 + Math.floor(r() * 30), lastPremium: lastPrem, premium: Math.round(lastPrem * (1.02 + r() * 0.18)), dueIn: 10 + Math.floor(r() * 50) });
  accounts.push({ kind: 'creditCard', bank: 'HDFC BANK', bankShort: 'HDFC Bank', last4: card4, limit: pick([80000, 150000, 250000]), balance: 10000 + Math.floor(r() * 70000), revolving: chance(0.45), dueIn: 3 + Math.floor(r() * 20), ageDays: 400 + Math.floor(r() * 2500) });
  if (chance(0.6)) accounts.push({ kind: 'loan', lender: 'BAJAJ FINANCE LTD', lenderShort: 'Bajaj Finance', type: 'Personal Loan', acct: String(Math.floor(r() * 9000) + 1000), outstanding: 100000 + Math.floor(r() * 500000), sanctioned: 700000, rate: pick([12, 14, 16, 18]), monthsLeft: 12 + Math.floor(r() * 40), dueIn: 2 + Math.floor(r() * 25), ageDays: 300 + Math.floor(r() * 800) });
  if (chance(0.4)) accounts.push({ kind: 'loan', lender: 'STATE BANK OF INDIA', lenderShort: 'SBI', type: 'Housing Loan', acct: String(Math.floor(r() * 9000) + 1000), outstanding: 2000000 + Math.floor(r() * 4000000), sanctioned: 7000000, rate: pick([8.15, 8.5, 8.9, 9.25]), monthsLeft: 120 + Math.floor(r() * 120), dueIn: 2 + Math.floor(r() * 25), ageDays: 1000 + Math.floor(r() * 3000) });
  const gross = 600000 + Math.floor(r() * 2000000);
  const regime = chance(0.5) ? 'Old' : 'New';
  accounts.push({ kind: 'itr', pan: 'ABCDE1234F', regime, gross, d80c: regime === 'Old' ? 150000 : 0, d80d: 0, taxable: regime === 'Old' ? gross - 200000 : gross - 75000 });
  return {
    email: `${handle}@test.cutmybills.in`, name: `${first} ${last}`, city: place.city,
    blurb: `Random test household in ${place.city}.`,
    cibil: { name: `${first} ${last}`, score }, accounts,
  };
}
