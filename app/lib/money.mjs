// Shared money helpers.

// Reducing-balance EMI for a principal, an annual rate in percent and a term in months.
export function emi(principal, annualRate, months) {
  const r = annualRate / 12 / 100;
  if (r === 0) return principal / months;
  return (principal * r * (1 + r) ** months) / ((1 + r) ** months - 1);
}

// Parse Indian-formatted amounts: "1,00,548.00", "Rs. 1,199", "₹649".
export function amount(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
