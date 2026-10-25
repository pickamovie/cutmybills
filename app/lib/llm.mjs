// Optional: reads bills the rules could not, using the Claude API.
// Enabled only when ANTHROPIC_API_KEY is set. Text is redacted first.

import { redactWithName } from './redact.mjs';

const MODEL = process.env.CMB_MODEL || 'claude-haiku-5-5';
export const llmEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

const PROMPT = `You extract one recurring household bill from an Indian email or SMS.
Reply with JSON only, no prose:
{"isBill": boolean, "provider": string, "plan": string|null, "amount": number|null, "cadence": "monthly"|"bimonthly"|"quarterly"|"yearly"|null, "dueDate": "YYYY-MM-DD"|null, "category": "phone"|"power"|"apps"|"health"|"credit"|"other"}
Amounts are in rupees as plain numbers. If it is not a recurring bill, return {"isBill": false}.`;

export async function extractWithLLM(item, names) {
  const text = `From: ${item.sender}\nSubject: ${item.subject}\n\n${redactWithName(item.body, names)}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 300, system: PROMPT, messages: [{ role: 'user', content: text }] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const raw = data.content?.map((c) => c.text || '').join('') || '';
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  if (!json.isBill || !json.provider) return null;
  return {
    key: `other:${json.provider.toLowerCase().replace(/\s+/g, '-')}`, category: json.category === 'other' ? 'apps' : json.category || 'apps',
    provider: json.provider, plan: json.plan, signal: 'bill', amount: json.amount, cadence: json.cadence || 'monthly', due: json.dueDate, rail: 'Bill',
    extractedBy: 'Claude', sentText: text,
  };
}
