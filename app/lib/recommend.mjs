// Recommendation rules: each looks at reconciled bills and the price catalog
// and proposes one fix with a monthly saving (or a one-time amount owed).

import { mobilePlans, postpaidPlans, familyAddOn, broadbandPlans, tariffs, healthQuotes, lending, saasAnnual, oldRegimeMarginalRate } from './catalog.mjs';
import { billFor } from './seed.mjs';
import { emi, inr } from './money.mjs';

const rec = (o) => ({ confidence: 'High', partner: 'No partner.', oneOff: 0, ...o });
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

export function recommend(bills, profile, today) {
  const out = [];
  const by = (pred) => bills.filter(pred);
  const score = profile?.score ?? 0;

  // Broadband faster than the household ever uses.
  for (const b of by((b) => b.key.startsWith('broadband:'))) {
    const { isp, planMbps, peakMbps } = b.meta;
    if (!planMbps || !peakMbps || peakMbps * 1.5 >= planMbps) continue;
    const need = Math.max(isp === 'bsnl' ? 60 : 100, peakMbps * 2);
    const target = (broadbandPlans[isp] || []).filter((p) => p.mbps >= need && p.mbps < planMbps).sort((x, y) => x.price - y.price)[0];
    if (!target || target.price >= b.amount) continue;
    out.push(rec({
      key: `${b.key}:downgrade`, billKeys: [b.key], kind: 'switch', verb: 'Switch plan', save: b.amount - target.price,
      headline: `You never use more than ${Math.ceil(peakMbps / 10) * 10} Mbps`,
      now: `${planMbps} Mbps for ${inr(b.amount)} a month`, better: `${target.mbps} Mbps for ${inr(target.price)} a month on a 6-month prepay`,
      why: [`Peak use was ${peakMbps} Mbps across your last 3 invoices.`, `${target.mbps} Mbps still leaves more than twice that headroom.`],
      steps: [`We raise the plan change with ${b.provider}`, 'New price from your next bill'], done: 'Switch requested',
    }));
  }

  // Prepaid plans with more data than is used.
  const mobiles = by((b) => b.key.startsWith('mobile:') && b.key !== 'mobile:airtel-postpaid');
  for (const b of mobiles) {
    const { op, avgDaily, planDaily, days: validity } = b.meta;
    if (validity && validity <= 30 && mobiles.length >= 2) {
      const save = b.monthly - familyAddOn.price;
      if (save > 0) out.push(rec({
        key: `${b.key}:family`, billKeys: [b.key], kind: 'switch', verb: 'Combine', save, confidence: 'Medium',
        headline: 'Add this number to a family plan', now: `${inr(b.amount)} every ${validity} days on ${b.provider}`, better: `${familyAddOn.name} for ${inr(familyAddOn.price)} a month, number kept`,
        why: [`${validity}-day packs mean ${Math.round(365 / validity)} recharges a year, not 12.`, 'Your number moves with MNP in about 3 working days.'],
        steps: ['Send PORT and your number to 1900', 'New SIM delivered to your door'], done: 'Port started',
      }));
      continue;
    }
    if (!avgDaily || !planDaily || avgDaily * 1.2 > planDaily) continue;
    const options = (mobilePlans[op] || []).filter((p) => p.daily >= avgDaily * 1.25 && p.days === validity && p.price < b.amount).sort((x, y) => x.price - y.price);
    const t = options[0];
    if (!t) continue;
    const save = Math.round(((b.amount - t.price) * 30) / validity);
    if (save < 30) continue;
    out.push(rec({
      key: `${b.key}:downgrade`, billKeys: [b.key], kind: 'switch', verb: 'Switch plan', save,
      headline: `Drop to ${t.daily} GB a day`, now: `${inr(b.amount)} for ${planDaily} GB a day`, better: `${t.name}, same ${validity} days`,
      why: [`You used ${avgDaily} GB a day on average over 28 days.`, 'Home Wi-Fi covers most of your data.'],
      steps: [`Set the ${inr(t.price)} plan as your next recharge`], done: 'Next recharge set',
    }));
  }

  // Postpaid with unused data.
  for (const b of by((b) => b.key === 'mobile:airtel-postpaid')) {
    const { gbPlan, gbUsed, planPrice } = b.meta;
    const t = postpaidPlans.airtel.filter((p) => p.gb >= gbUsed * 1.5 && p.price < planPrice).sort((x, y) => x.price - y.price)[0];
    if (!t) continue;
    out.push(rec({
      key: `${b.key}:downgrade`, billKeys: [b.key], kind: 'switch', verb: 'Switch plan', save: Math.round((planPrice - t.price) * 1.18),
      headline: `You use ${gbUsed} GB of ${gbPlan} GB`, now: `${inr(planPrice)} plan with ${gbPlan} GB`, better: `${t.name} plus GST`,
      why: [`Your highest month was ${gbUsed} GB.`, 'Unused data does not roll over beyond 200 GB.'],
      steps: ['Change plan in Airtel Thanks', 'Applies from the next billing cycle'], done: 'Switch requested',
    }));
  }

  // Electricity above the cheap slab.
  for (const b of by((b) => b.key.startsWith('power:'))) {
    const t = tariffs[b.meta.discom];
    if (!t || b.meta.units <= t.target) continue;
    const perPeriod = b.amount - billFor(t, t.target);
    const save = Math.round(t.period === 'bimonthly' ? perPeriod / 2 : perPeriod);
    if (save < 50) continue;
    const over = b.meta.units - t.target;
    out.push(rec({
      key: `${b.key}:slab`, billKeys: [b.key], kind: 'habit', verb: 'See how', save, confidence: 'Medium',
      headline: t.freeUpTo ? `Stay at ${t.freeUpTo} units and pay nothing` : `Stay under ${t.target} units`,
      now: `${b.meta.units} units, ${over} above the ${t.target}-unit slab`, better: t.freeUpTo ? 'A zero bill under the Delhi subsidy' : `About ${over} fewer units ${t.period === 'bimonthly' ? 'every 2 months' : 'a month'}`,
      why: [t.note || `Units above ${t.target} are charged at a higher slab.`, 'Geyser on a 20-minute timer saves about 45 units a month.', 'AC at 24°C instead of 20°C saves about 50 units a month.'],
      steps: ['Pick the changes you will make', 'We compare your next bill'], done: 'Plan saved', partner: 'No partner. Estimates from your bill history.',
    }));
  }

  // Streaming: rotate two at a time.
  const streaming = by((b) => b.group === 'streaming');
  if (streaming.length >= 3) {
    const total = streaming.reduce((s, b) => s + b.monthly, 0);
    const avg = total / streaming.length;
    const save = Math.round(total - 2 * avg);
    out.push(rec({
      key: 'group:streaming:rotate', billKeys: streaming.map((b) => b.key), kind: 'switch', verb: 'Rotate', save,
      display: { provider: streaming.map((b) => b.provider).join(', '), title: `${streaming.length} streaming apps`, mark: 'TV', monthly: total },
      headline: 'Keep two streaming apps at a time', now: `${streaming.length} apps running all year, ${inr(total)} a month`, better: 'A monthly rotation planned around what you watch',
      why: ['Most households watch one or two services in any given month.', 'pickamovie.tv plans which two to keep each month.'],
      steps: ['Open your plan on pickamovie.tv', 'Cancel the apps it pauses this month'], done: 'Rotation on', partner: 'Powered by pickamovie.tv.',
    }));
  }

  // Duplicate cloud storage.
  const clouds = by((b) => b.group === 'cloud');
  if (clouds.length >= 2) {
    const [keep, drop] = [...clouds].sort((x, y) => y.monthly - x.monthly);
    out.push(rec({
      key: `${drop.key}:duplicate`, billKeys: [drop.key, keep.key], kind: 'stop', verb: 'Stop one', save: drop.monthly,
      headline: 'You pay for cloud storage twice', now: `${drop.provider} and ${keep.provider}`, better: `Keep ${keep.provider}, stop ${drop.provider}`,
      why: [`${keep.provider} already has room: ${keep.meta.storageUsed || 'plenty'} used.`, 'Both renew every month.'],
      steps: [`Back up anything only in ${drop.provider}`, `Stop ${drop.provider} in its subscription settings`], done: 'Stop requested',
    }));
  }

  // Duplicate food memberships.
  const food = by((b) => b.group === 'food');
  if (food.length >= 2) {
    const drop = [...food].sort((x, y) => x.monthly - y.monthly)[0];
    const keep = food.find((f) => f !== drop);
    out.push(rec({
      key: `${drop.key}:duplicate`, billKeys: [drop.key, keep.key], kind: 'stop', verb: 'Stop one', save: drop.monthly, confidence: 'Medium',
      headline: 'Two food delivery memberships', now: `${keep.provider} and ${drop.provider}`, better: `Keep ${keep.provider}, let ${drop.provider} lapse`,
      why: ['Free delivery on one app covers most orders.', 'Both renew automatically through UPI AutoPay.'],
      steps: [`Cancel the ${drop.provider} AutoPay in Google Pay`], done: 'Stop requested',
    }));
  }

  // Duplicate design tools.
  const design = by((b) => b.group === 'design');
  if (design.length >= 2) {
    const drop = [...design].sort((x, y) => (x.meta.lastActive ? 0 : 1) - (y.meta.lastActive ? 0 : 1) || x.monthly - y.monthly)[0];
    const keep = design.find((d) => d !== drop);
    const idle = drop.meta.lastActive ? days(drop.meta.lastActive, today) : null;
    out.push(rec({
      key: `${drop.key}:duplicate`, billKeys: [drop.key, keep.key], kind: 'stop', verb: 'Stop', save: drop.monthly,
      headline: idle ? `Not opened in ${idle} days` : 'Two design tools', now: `${keep.provider} and ${drop.provider}`, better: `Keep ${keep.provider}`,
      why: [idle ? `${drop.provider} was last used ${idle} days ago.` : 'Both cover the same templates and exports.', `${keep.provider} covers the same work.`],
      steps: [`Cancel ${drop.provider} in account settings`], done: 'Stop requested',
    }));
  }

  // Monthly SaaS that has a cheaper annual plan.
  for (const b of by((b) => b.key.startsWith('saas:') && b.cadence === 'monthly')) {
    const a = saasAnnual[b.provider];
    if (!a || out.some((r) => r.billKeys[0] === b.key)) continue;
    out.push(rec({
      key: `${b.key}:annual`, billKeys: [b.key], kind: 'switch', verb: 'Go annual', save: a.monthly - a.annualPerMonth, confidence: 'Medium',
      headline: 'Pay yearly, pay less', now: `${inr(a.monthly)} a month, billed monthly`, better: `${inr(a.annualPerMonth * 12)} a year (${inr(a.annualPerMonth)} a month)`,
      why: ['You have paid every month for the last quarter.', 'Only worth it if you will use it all year.'],
      steps: [`Switch billing to yearly in ${b.provider}`], done: 'Switch requested',
    }));
  }

  // Gym with no recent check-ins.
  for (const b of by((b) => b.key === 'sub:CULTFIT' && b.meta.lastCheckin)) {
    const idle = days(b.meta.lastCheckin, today);
    if (idle < 30) continue;
    out.push(rec({
      key: `${b.key}:pause`, billKeys: [b.key], kind: 'stop', verb: 'Pause', save: b.monthly,
      headline: 'Pause until you go back', now: `${inr(b.amount)} a month, no check-ins for ${idle} days`, better: 'Pause the AutoPay. Restart in one tap when you return.',
      why: [`Your last check-in email was ${idle} days ago.`, b.nextDebit ? `The next debit is on ${b.nextDebit}.` : 'It renews every month.'],
      steps: ['Open PhonePe, AutoPay', 'Pause the cult.fit mandate'], done: 'Pause requested', partner: 'No partner. The mandate lives in your UPI app.',
    }));
  }

  // Health insurance renewal priced above a comparable quote.
  for (const b of by((b) => b.key.startsWith('insurance:'))) {
    const { sumInsured, eldestAge, lastPremium } = b.meta;
    const band = eldestAge >= 60 ? 'over60' : eldestAge >= 45 ? '45to60' : 'under45';
    const q = healthQuotes.find((h) => h.sumInsured === sumInsured && h.ageBand === band);
    if (!q || q.premium > b.amount * 0.95) continue;
    const hike = lastPremium ? Math.round(((b.amount - lastPremium) / lastPremium) * 100) : null;
    const dueIn = b.due ? days(today, b.due) : null;
    out.push(rec({
      key: `${b.key}:port`, billKeys: [b.key], kind: 'port', verb: 'Port', save: Math.round((b.amount - q.premium) / 12), confidence: 'Medium',
      headline: `Same cover for ${inr(b.amount - q.premium)} less a year`, now: `${inr(b.amount)} a year${hike ? `, up ${hike}% on renewal` : ''}`,
      better: `${q.insurer}, ${inr(q.premium)} for the same ${inr(sumInsured).replace('₹', '₹')} cover, waiting periods carried over`,
      why: ['Porting keeps the waiting periods you have already served.', dueIn != null ? `Renewal is in ${dueIn} days; porting must start at least 15 days before.` : 'Start porting at least 15 days before renewal.'],
      steps: ['Compare matched quotes', 'Pick one', 'The new insurer handles the port'], done: 'Port started',
      partner: 'Quotes via an IRDAI-registered broker. We earn a referral fee; it never changes the ranking.',
    }));
  }

  // Credit card balance rolling over.
  for (const b of by((b) => b.key.startsWith('card:') && b.meta.revolving)) {
    const bt = lending.balanceTransfer.find((r) => score >= r.minScore);
    if (!bt) continue;
    const save = Math.round((b.meta.balance * (lending.cardInterestAnnual - bt.rate)) / 1200);
    out.push(rec({
      key: `${b.key}:transfer`, billKeys: [b.key], kind: 'refinance', verb: 'Transfer', save,
      headline: `Move this balance to ${bt.rate}% a year`, now: `${inr(b.meta.balance)} rolling over at about ${lending.cardInterestAnnual}% a year`,
      better: `Balance transfer loan at ${bt.rate}%, 12 months`,
      why: [`Your last ${b.meta.payments.length} payments were the minimum due.`, `At ${lending.cardInterestAnnual}% that costs about ${inr(b.amount)} a month in interest.`, `Your score of ${score} qualifies for partner offers.`],
      steps: ['Check eligibility (no score impact)', 'Pick an offer', 'The lender pays your card directly'], done: 'Transfer requested',
      partner: 'Offer from a lending partner. We earn a referral fee; it never changes the ranking.',
    }));
  }

  // Loans priced above today's rates.
  for (const b of by((b) => b.key.startsWith('loan:') && b.meta.rate)) {
    const { type, rate, outstanding, monthsLeft, lender } = b.meta;
    if (type === 'Personal Loan') {
      const best = lending.personalLoan.find((r) => score >= r.minScore);
      if (!best || rate - best.rate < 1.5) continue;
      const now = emi(outstanding, rate, monthsLeft), next = emi(outstanding, best.rate, monthsLeft);
      const save = Math.round(now - next);
      const fee = Math.round((outstanding * lending.personalLoanForeclosurePct) / 100);
      const breakeven = Math.ceil(fee / save);
      if (breakeven > monthsLeft * 0.6) continue;
      out.push(rec({
        key: `${b.key}:refinance`, billKeys: [b.key], kind: 'refinance', verb: 'Refinance', save, confidence: 'Medium',
        headline: `Refinance from ${rate}% to ${best.rate}%`, now: `${inr(now)} EMI at ${rate}%`, better: `${inr(next)} EMI at ${best.rate}%, same ${monthsLeft} months`,
        why: [`Your score of ${score} qualifies for ${best.rate}% with partner lenders.`, `Closing early costs a one-time ${lending.personalLoanForeclosurePct}% fee, about ${inr(fee)}. The lower EMI earns it back in about ${breakeven} months.`],
        steps: ['Check eligibility (no score impact)', 'Upload 3 months of bank statements', 'The new lender closes the old loan'], done: 'Refinance requested',
        partner: 'Offer from a lending partner. We earn a referral fee; it never changes the ranking.',
      }));
    }
    if (type === 'Housing Loan') {
      const current = lending.homeLoanCurrent[lender] ?? lending.homeLoanCurrent.default;
      if (rate - current < 0.25) continue;
      const now = emi(outstanding, rate, monthsLeft), next = emi(outstanding, current, monthsLeft);
      const save = Math.round(now - next);
      out.push(rec({
        key: `${b.key}:reset`, billKeys: [b.key], kind: 'refinance', verb: 'Reset rate', save,
        headline: `Ask ${b.provider} to move you to ${current}%`, now: `${inr(now)} EMI at ${rate}%`, better: `${inr(next)} EMI at ${current}%, same tenure`,
        why: [`New ${b.provider} home loans for your profile are priced near ${current}%.`, `Existing borrowers can switch for a one-time fee of about ${inr(lending.homeLoanConversionFee)}.`, `The lower EMI earns the fee back in about ${Math.ceil(lending.homeLoanConversionFee / save)} months.`],
        steps: ['We draft the conversion request', 'You submit it in the bank app or at the branch', 'New EMI from the next cycle'], done: 'Letter ready',
        partner: 'No partner. You request this from your bank.',
      }));
    }
  }

  // 80D health premium not claimed under the old regime.
  const itr = bills.find((b) => b.key === 'tax:itr');
  const health = by((b) => b.key.startsWith('insurance:'));
  if (itr && itr.meta.regime === 'Old' && !itr.meta.d80d && health.length) {
    const senior = health.some((h) => (h.meta.eldestAge || 0) >= 60);
    const limit = senior ? 50000 : 25000;
    const premium = health.reduce((s, h) => s + (h.meta.lastPremium || h.amount), 0);
    const claim = Math.min(premium, limit);
    const rate = oldRegimeMarginalRate(itr.meta.taxable);
    const back = Math.round(claim * rate * 1.04);
    if (back > 0) out.push(rec({
      key: 'tax:itr:80d', billKeys: ['tax:itr', health[0].key], kind: 'claim', verb: 'Claim', save: 0, oneOff: back,
      headline: `Get about ${inr(back)} back`, now: `You paid ${inr(premium)} in health premiums but claimed no 80D deduction`,
      better: `Revise your return to claim up to ${inr(limit)}`,
      why: [`At your ${Math.round(rate * 100)}% slab, ${inr(claim)} of deduction is about ${inr(back)} with cess.`, 'Your return is under the old regime, so 80D applies.'],
      steps: ['Download the premium certificate from your insurer', 'File a revised return on the income tax portal'], done: 'Checklist ready',
    }));
  }

  // EPF left with a previous employer.
  const epf = bills.find((b) => b.key === 'claim:epf');
  if (epf?.meta.balance) out.push(rec({
    key: 'claim:epf:transfer', billKeys: ['claim:epf'], kind: 'claim', verb: 'Transfer', save: 0, oneOff: epf.meta.balance,
    headline: `${inr(epf.meta.balance)} is sitting with an old employer`, now: `EPF with ${epf.meta.employer}, not transferred`,
    better: 'Move it to your current UAN, or withdraw if you are between jobs for over 2 months',
    why: ['Unclaimed EPF keeps earning, but you cannot use it until it is moved.', 'Form 13 transfers it online in about 20 days.'],
    steps: ['Log in to the EPFO member portal with your UAN', 'Submit Form 13 (transfer) or Form 19 (withdraw)'], done: 'Steps ready',
  }));

  return out;
}
