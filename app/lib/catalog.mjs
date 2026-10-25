// Price catalog used by the recommendation engine.
// ILLUSTRATIVE ONLY: these are plausible test values, not live prices.
// In production this is a maintained database refreshed from provider sites.

export const CATALOG_NOTE = 'Test catalog. Prices and rates are illustrative, not live.';

// Prepaid mobile plans. daily = GB per day, days = validity.
export const mobilePlans = {
  jio: [
    { name: '₹799, 1.5 GB/day', price: 799, daily: 1.5, days: 84 },
    { name: '₹1,029, 2 GB/day', price: 1029, daily: 2, days: 84 },
    { name: '₹1,199, 3 GB/day', price: 1199, daily: 3, days: 84 },
    { name: '₹349, 2 GB/day', price: 349, daily: 2, days: 28 },
  ],
  airtel: [
    { name: '₹859, 1.5 GB/day', price: 859, daily: 1.5, days: 84 },
    { name: '₹979, 2 GB/day', price: 979, daily: 2, days: 84 },
    { name: '₹379, 2 GB/day', price: 379, daily: 2, days: 30 },
  ],
  vi: [
    { name: '₹349, 1.5 GB/day', price: 349, daily: 1.5, days: 28 },
    { name: '₹859, 1.5 GB/day', price: 859, daily: 1.5, days: 84 },
  ],
};

// Postpaid plans: data in GB per month.
export const postpaidPlans = {
  airtel: [
    { name: 'Airtel ₹449, 40 GB', price: 449, gb: 40 },
    { name: 'Airtel ₹599, 75 GB', price: 599, gb: 75 },
    { name: 'Airtel ₹999, 190 GB', price: 999, gb: 190 },
  ],
};

export const familyAddOn = { provider: 'Jio', name: 'Jio family add-on', price: 249 };

// Home broadband: monthly price on a 6-month prepay.
export const broadbandPlans = {
  act: [
    { mbps: 150, price: 849 },
    { mbps: 300, price: 1199 },
    { mbps: 500, price: 1549 },
    { mbps: 1000, price: 2299 },
  ],
  airtel: [
    { mbps: 100, price: 699 },
    { mbps: 300, price: 999 },
    { mbps: 500, price: 1499 },
    { mbps: 1000, price: 3999 },
  ],
  bsnl: [
    { mbps: 60, price: 499 },
    { mbps: 150, price: 799 },
    { mbps: 300, price: 1199 },
  ],
};

// Electricity slabs (₹ per unit) and the threshold worth staying under.
// period: units are per billing period (monthly or bimonthly).
export const tariffs = {
  msedcl: { name: 'MSEDCL', period: 'monthly', slabs: [[100, 4.71], [300, 10.29], [500, 14.55], [Infinity, 16.64]], target: 300 },
  bescom: { name: 'BESCOM', period: 'monthly', slabs: [[100, 4.75], [Infinity, 7.0]], target: 100 },
  tpddl: { name: 'Tata Power-DDL', period: 'monthly', slabs: [[200, 3.0], [400, 4.5], [800, 6.5], [Infinity, 7.0]], target: 200, freeUpTo: 200, note: 'Delhi waives the whole bill when use stays at or under 200 units.' },
  tangedco: { name: 'TANGEDCO', period: 'bimonthly', slabs: [[100, 0], [400, 4.7], [500, 6.3], [Infinity, 8.4]], target: 400 },
};

// Health insurance: best comparable annual premium by sum insured and eldest age band.
export const healthQuotes = [
  { sumInsured: 500000, ageBand: 'under45', premium: 11800, insurer: 'Niva Bupa ReAssure' },
  { sumInsured: 1000000, ageBand: 'under45', premium: 23900, insurer: 'Care Supreme' },
  { sumInsured: 1000000, ageBand: '45to60', premium: 31500, insurer: 'Care Supreme' },
  { sumInsured: 500000, ageBand: 'over60', premium: 38900, insurer: 'Star Senior Red Carpet' },
  { sumInsured: 1000000, ageBand: 'over60', premium: 52400, insurer: 'Niva Bupa Senior First' },
];

// Lending rates offered through partners, by CIBIL score band.
export const lending = {
  balanceTransfer: [ { minScore: 700, rate: 13.5 }, { minScore: 650, rate: 18 } ],
  personalLoan: [ { minScore: 750, rate: 10.75 }, { minScore: 700, rate: 11.25 }, { minScore: 650, rate: 15.5 } ],
  homeLoanCurrent: { 'STATE BANK OF INDIA': 8.15, 'HDFC BANK': 8.35, 'ICICI BANK': 8.4, default: 8.4 },
  homeLoanConversionFee: 10000,
  cardInterestAnnual: 42,
  personalLoanForeclosurePct: 4,
};

// Subscriptions: known merchants, categories and annual alternatives.
export const subscriptions = {
  NETFLIX: { name: 'Netflix', category: 'streaming' },
  HOTSTAR: { name: 'JioHotstar', category: 'streaming' },
  PRIMEVIDEO: { name: 'Prime Video', category: 'streaming' },
  SONYLIV: { name: 'SonyLIV', category: 'streaming' },
  ZEE5: { name: 'ZEE5', category: 'streaming' },
  YOUTUBE: { name: 'YouTube Premium', category: 'streaming' },
  SPOTIFY: { name: 'Spotify', category: 'music' },
  CULTFIT: { name: 'cult.fit', category: 'fitness' },
  SWIGGY: { name: 'Swiggy One', category: 'food' },
  ZOMATO: { name: 'Zomato Gold', category: 'food' },
};

export const saasAnnual = {
  Notion: { monthly: 1000, annualPerMonth: 800 },
  'Canva Pro': { monthly: 500, annualPerMonth: 333 },
  'Adobe Express': { monthly: 399, annualPerMonth: 333 },
};

// Old-regime tax slabs for the 80D claim estimate.
export function oldRegimeMarginalRate(taxable) {
  if (taxable > 1000000) return 0.3;
  if (taxable > 500000) return 0.2;
  if (taxable > 250000) return 0.05;
  return 0;
}
