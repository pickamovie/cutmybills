// Removes identifiers before any text leaves the machine (for example to an LLM).
// Amounts, dates and provider names are kept because extraction needs them.

const RULES = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[PAN]'],
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, '[aadhaar-or-card]'],
  [/\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g, '[phone]'],
  [/\b\d{2}X{4,}\d{2}\b/g, '[phone]'],
  [/\b(?:XX|X{4})\d{4}\b/g, '[acct]'],
  [/\b\d{8,}\b/g, '[number]'],
];

export function redact(text) {
  let out = String(text ?? '');
  for (const [re, sub] of RULES) out = out.replace(re, sub);
  return out;
}

// Removes the greeting line, which usually carries the person's first name.
export function redactWithName(text, names = []) {
  let out = redact(text);
  for (const n of names.filter(Boolean)) out = out.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[name]');
  return out;
}
