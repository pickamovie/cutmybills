// Runs the full pipeline over a user's raw items:
// parse each message -> (optional) LLM for unknown formats -> reconcile -> recommend.

import { parseItem } from './parse.mjs';
import { reconcile } from './reconcile.mjs';
import { recommend } from './recommend.mjs';
import { extractWithLLM, llmEnabled } from './llm.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runScan(items, { today, sources, names = [], onEvent = () => {}, pace = 0 }) {
  const chosen = items.filter((i) => sources.includes(i.source));
  const counts = Object.fromEntries(sources.map((s) => [s, { read: 0, found: 0 }]));
  const parsed = [];
  onEvent('start', { total: chosen.length, sources });

  for (const item of chosen) {
    let det = parseItem(item);
    if (det?.unrecognised && llmEnabled()) {
      try {
        const d = await extractWithLLM(item, names);
        if (d) det = { ...d, at: item.at };
      } catch (e) {
        det = { ...det, reason: `${det.reason}. Claude extraction failed: ${e.message}` };
      }
    }
    parsed.push({ item, det });
    counts[item.source].read++;
    const useful = det && !det.unrecognised && det.signal !== 'info';
    if (useful) counts[item.source].found++;
    onEvent('item', {
      source: item.source, counts,
      found: useful ? `${det.provider || det.key}${det.amount ? `, ₹${Math.round(det.amount).toLocaleString('en-IN')}` : ''}` : null,
      review: det?.unrecognised ? (item.subject || item.sender) : null,
    });
    if (pace) await sleep(pace);
  }

  const { bills, review, profile } = reconcile(parsed, today);
  const recs = recommend(bills, profile, today);
  const stats = { items: chosen.length, matches: Object.values(counts).reduce((s, c) => s + c.found, 0), bills: bills.length, review: review.length, counts };
  return {
    bills, recs, profile, stats,
    review: groupReview(review),
    parsed: parsed.map(({ item, det }) => ({ id: item.id, status: !det ? 'ignored' : det.unrecognised ? 'review' : 'read', key: det?.key || null, by: det?.extractedBy || (det && !det.unrecognised ? 'rules' : null) })),
  };
}

// One review entry per sender and subject, newest message first.
function groupReview(review) {
  const groups = new Map();
  for (const { item, reason } of review.sort((a, b) => b.item.at.localeCompare(a.item.at))) {
    const k = `${item.sender}|${item.subject}`;
    if (groups.has(k)) { groups.get(k).count++; continue; }
    groups.set(k, { source: item.source, at: item.at, from: item.sender, subject: item.subject, text: item.body.slice(0, 400), reason, count: 1 });
  }
  return [...groups.values()];
}
