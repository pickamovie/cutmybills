// CutMyBills web client. Talks to the API in server.mjs and listens for live
// events (scan progress, fix confirmations) over Server-Sent Events.

// ---------- helpers ----------
const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const num = (n) => Math.round(n || 0).toLocaleString('en-IN');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parse = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isoDay = (dt) => dt.toISOString().slice(0, 10);
const TODAY = () => isoDay(new Date());
const fmtDay = (s) => { const d = parse(s); return `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const fmtShort = (s) => { const d = parse(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const fmtTime = (s) => { const d = new Date(s); return `${fmtShort(s)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const daysFrom = (s) => Math.round((parse(s) - parse(TODAY())) / 864e5);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Rolling digits: each digit is a column of 0-9 that slides to its value.
const odoPrev = {};
function odo(id, value) {
  const target = num(value);
  const prev = odoPrev[id] ?? target.replace(/\d/g, '0');
  const pd = prev.replace(/\D/g, '');
  const digits = target.replace(/\D/g, '');
  let di = 0;
  const html = [...target].map((ch) => {
    if (!/\d/.test(ch)) return `<span class="odo-sep">${ch}</span>`;
    const back = digits.length - 1 - di++;
    const from = Number(pd[pd.length - 1 - back] ?? 0);
    return `<span class="odo-col" data-d="${ch}" style="transform:translateY(-${from}em)">${'0123456789'.split('').map((d) => `<span>${d}</span>`).join('')}</span>`;
  }).join('');
  return `<span class="odo" id="odo-${id}" data-id="${id}" data-v="${target}" aria-label="${target}">${html}</span>`;
}
function rollOdos() {
  const els = root.querySelectorAll('.odo');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    els.forEach((el) => {
      el.querySelectorAll('.odo-col').forEach((c) => {
        if (reduceMotion) c.style.transition = 'none';
        c.style.transform = `translateY(-${c.dataset.d}em)`;
      });
      odoPrev[el.dataset.id] = el.dataset.v;
    });
  }));
}

const icon = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/></svg>',
  bills: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  credit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
};

const CATS = [
  ['phone', 'Phone and internet'], ['power', 'Power and gas'], ['apps', 'Streaming and apps'],
  ['health', 'Insurance and health'], ['credit', 'Cards and loans'], ['tax', 'Money you are owed'],
];

async function api(path, opts = {}) {
  const res = await fetch(path, { method: opts.body ? 'POST' : opts.method || 'GET', headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : opts.method === 'POST' ? '{}' : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

// ---------- state ----------
const state = {
  stage: 'loading', // loading | signin | connect | scan | app
  tab: 'home', // home | bills | credit | cal | saved | data
  filter: 'all',
  sources: { Gmail: true, SMS: true, CIBIL: true },
  data: null, // /api/state
  accounts: null,
  items: null,
  itemFilter: 'all',
  openItem: null,
  sheet: null, // { type: 'rec'|'bill'|'account', key }
  calSel: null,
  scan: null, // live scan progress
  error: null,
};

const bills = () => state.data?.bills || [];
const recs = () => state.data?.recs || [];
const billByKey = (k) => bills().find((b) => b.key === k);
const recForBill = (k) => recs().find((r) => r.billKeys[0] === k && r.status !== 'dismissed') || recs().find((r) => r.billKeys.includes(k) && r.status !== 'dismissed');
const openRecs = () => recs().filter((r) => r.status === 'open');
const activeRecs = () => recs().filter((r) => r.status === 'requested' || r.status === 'confirmed');
const saveable = () => openRecs().reduce((s, r) => s + r.save, 0);
const owed = () => openRecs().reduce((s, r) => s + (r.oneOff || 0), 0);
const savedMonthly = (only) => activeRecs().filter((r) => !only || r.status === only).reduce((s, r) => s + r.save, 0);
const displayOf = (r) => {
  const b = billByKey(r.billKeys[0]) || {};
  return { provider: r.display?.provider || b.provider, title: r.display?.title || b.plan, mark: r.display?.mark || b.mark || '··', monthly: r.display?.monthly ?? b.monthly };
};
const evidenceOf = (keys) => keys.flatMap((k) => (billByKey(k)?.evidence || [])).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
const outgoing = () => bills().reduce((s, b) => s + (b.monthly || 0), 0);

// ---------- shared pieces ----------
function topbar() {
  const u = state.data?.user;
  const initials = (u?.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2);
  return `<div class="topbar">
    <span class="brand">cut<b>my</b>bills</span>
    <span class="topbar-right">
      <button class="saved-chip" data-act="tab" data-tab="saved">Saving <strong class="num">${inr(savedMonthly())}</strong>/mo</button>
      <button class="avatar" data-act="account" aria-label="Account and test data">${esc(initials)}</button>
    </span>
  </div>`;
}

function statusPill(r) {
  if (r.status === 'requested') return `<span class="verb wait">${esc(r.done)}</span>`;
  if (r.status === 'confirmed') return `<span class="verb done">✓ ${esc(r.history?.at(-1)?.label || 'Confirmed')}</span>`;
  if (r.status === 'dismissed') return `<span class="verb dim">Dismissed</span>`;
  return `<span class="verb">${esc(r.verb)}</span>`;
}

function recRow(r, opts = {}) {
  const d = displayOf(r);
  const amount = r.oneOff ? `<div class="row-save num">+${inr(r.oneOff)}</div>` : `<div class="row-save num">−${inr(r.save)}<span class="small muted">/mo</span></div>`;
  const sub = opts.headline && r.status === 'open' ? esc(r.headline) : esc(d.title);
  return `<button class="row" data-act="open-rec" data-key="${esc(r.key)}">
    <span class="mark" data-cat="${esc(r.display ? 'apps' : billByKey(r.billKeys[0])?.category || '')}">${esc(d.mark)}</span>
    <span class="row-main"><div class="row-title">${esc(d.provider)}</div><div class="row-sub">${sub}</div></span>
    <span class="row-end">${amount}${statusPill(r)}</span>
  </button>`;
}

function billRow(b, opts = {}) {
  const r = recForBill(b.key);
  if (r && r.billKeys[0] === b.key && !opts.plain) return recRow(r);
  const amt = opts.due ? b.nextAmount : b.monthly;
  const sub = b.amount != null ? `${inr(b.amount)} ${esc(b.unit)}` : esc(b.plan || b.unit);
  const pill = b.key.startsWith('card:') && !b.meta.revolving ? 'Paid in full' : r ? 'See fix' : b.key.startsWith('tax:') || b.key.startsWith('claim:') ? 'Checked' : 'Best price';
  return `<button class="row" data-act="open-bill" data-key="${esc(b.key)}">
    <span class="mark" data-cat="${esc(b.category)}">${esc(b.mark)}</span>
    <span class="row-main"><div class="row-title">${esc(b.provider)}</div><div class="row-sub">${sub}</div></span>
    <span class="row-end">${amt ? `<div class="row-amt num">${inr(amt)}</div>` : ''}<span class="verb quiet">${pill}</span></span>
  </button>`;
}

// ---------- screens ----------
function viewSignin() {
  const list = state.accounts?.accounts || [];
  return `<div class="test-banner">Test environment. Every account and bill here is generated test data.</div>
  <div class="onb">
    <div class="topbar"><span class="brand">cut<b>my</b>bills</span></div>
    <div style="padding:18px 0 4px">
      <h1>Same life.<br>Lower bills.</h1>
      <p class="muted" style="margin-top:10px">Pick a test household to sign in. Each one has its own inbox, bank SMS and credit report.</p>
    </div>
    <div class="acct-list">
      ${list.map((a) => `<button class="acct" data-act="quick-login" data-email="${esc(a.email)}">
        <span class="mark">${esc(a.name.split(' ').map((w) => w[0]).join(''))}</span>
        <span><h3>${esc(a.name)}</h3><p>${esc(a.blurb)}</p></span><span class="go">Sign in</span></button>`).join('')}
    </div>
    <button class="btn ghost" style="margin-top:12px" data-act="new-user">Create a new test household</button>
    <div class="or">or sign in with email</div>
    <form id="login-form">
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" value="kavya@test.cutmybills.in"></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" value="${esc(state.accounts?.password || '')}"></div>
      ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
      <button class="btn" style="margin-top:16px" type="submit">Sign in</button>
    </form>
    <p class="small muted" style="text-align:center;margin-top:12px">All test accounts use the password ${esc(state.accounts?.password || '')}.</p>
  </div>`;
}

function viewConnect() {
  const src = [
    ['Gmail', 'GM', 'Bills and receipts in the inbox. Read-only, bills only.'],
    ['SMS', 'SM', 'Debit and AutoPay alerts from banks and operators.'],
    ['CIBIL', 'CB', 'Loans and cards from the credit report. Checking does not affect the score.'],
  ];
  const any = Object.values(state.sources).some(Boolean);
  const u = state.data?.user;
  return `<div class="onb">
    <div class="topbar"><span class="brand">cut<b>my</b>bills</span><button class="avatar" data-act="account" aria-label="Account">${esc((u?.name || '?')[0])}</button></div>
    <div style="padding:14px 0 22px">
      <h1>Where should we look?</h1>
      <p class="muted" style="margin-top:8px">Scanning ${esc(u?.name)}'s test data. Each source finds bills the others miss.</p>
    </div>
    ${src.map(([k, m, d]) => `<button class="source" data-act="toggle-src" data-src="${k}" role="switch" aria-checked="${state.sources[k]}">
        <span class="mark">${m}</span><span><h3>${k}</h3><p>${d}</p></span><span class="toggle ${state.sources[k] ? 'on' : ''}"></span></button>`).join('')}
    <div class="promise"><span>Only what each bill is gets stored, never the message itself.</span><span>${state.data?.llm ? 'Unknown bill formats are sent to the Claude API after removing names, numbers and IDs.' : 'Unknown bill formats are flagged for review. Nothing leaves this server.'}</span></div>
    <div style="flex:1"></div>
    ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
    <button class="btn" data-act="start-scan" ${any ? '' : 'disabled style="opacity:.4"'}>Start scan</button>
  </div>`;
}

function viewScan() {
  const s = state.scan;
  const rails = s.sources;
  const done = s.done;
  return `<div class="onb">
    <div class="topbar"><span class="brand">cut<b>my</b>bills</span></div>
    <div style="padding-top:14px"><h1>${done ? `Found ${done.bills} bills` : 'Reading your bills'}</h1>
      ${done ? '' : `<div class="scan-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${s.total || 0}" aria-valuenow="${Object.values(s.counts).reduce((a, c) => a + c.read, 0)}"><i style="width:${s.total ? Math.round((Object.values(s.counts).reduce((a, c) => a + c.read, 0) / s.total) * 100) : 0}%"></i></div>`}</div>
    <div class="scan-counts" style="grid-template-columns:repeat(${rails.length},1fr)">
      ${rails.map((r) => `<div class="scan-count"><div class="v num">${num(s.counts[r]?.read)}</div><div class="k">${r === 'CIBIL' ? 'reports' : r === 'SMS' ? 'messages' : 'emails'}</div><div class="f num">${num(s.counts[r]?.found)} found</div></div>`).join('')}
    </div>
    ${done ? `<div class="scan-result">
        ${done.matches > done.bills ? `<p class="small muted" style="margin-bottom:12px">${done.matches} matches across your sources, merged into ${done.bills} bills so nothing is counted twice.</p>` : ''}
        ${done.review ? `<p class="small" style="color:var(--coral);margin-bottom:12px">${done.review} message${done.review > 1 ? 's look' : ' looks'} like a bill in a format we could not read. You can see ${done.review > 1 ? 'them' : 'it'} under Bills.</p>` : ''}
        <div class="hero-label">You can save every month</div>
        <div class="hero-amount num"><span class="rupee">₹</span>${odo('scan', saveable())}</div>
        <button class="btn" style="margin-top:18px" data-act="go-app">Show me how</button>
      </div>`
      : `<div class="feed">${s.feed.map((f) => `<div class="feed-item ${f.review ? 'rev' : ''} ${f.id > (s.animated || 0) ? 'new' : ''}"><b>${f.review ? 'Review' : f.source}</b><span>${esc(f.text)}</span></div>`).join('')}</div>`}
  </div>`;
}

function viewHome() {
  const amt = saveable();
  const fixes = openRecs().sort((x, y) => (y.save || y.oneOff / 12) - (x.save || x.oneOff / 12));
  const inProgress = activeRecs();
  const upcoming = bills().filter((b) => b.nextDebit && daysFrom(b.nextDebit) >= 0 && daysFrom(b.nextDebit) <= 7).sort((x, y) => x.nextDebit.localeCompare(y.nextDebit));
  const o = owed();
  const sub = amt
    ? `That is <strong class="num">${inr(amt * 12)}</strong> a year${o ? `, plus <strong class="num">${inr(o)}</strong> owed to you.` : '.'}`
    : inProgress.length ? `${inProgress.length} fixes are underway. You will see each one confirm here.` : 'We will tell you the moment a cheaper option appears.';
  return `${topbar()}
  <section class="hero">
    <div class="hero-label">${amt ? 'You can save every month' : o ? 'Money owed to you' : 'Nothing left to fix'}</div>
    <div class="hero-amount num ${amt || o ? '' : 'zero'}"><span class="rupee">₹</span>${odo('hero', amt || o)}</div>
    <div class="hero-sub">${sub}</div>
    ${amt && outgoing() ? `<div class="avoid" aria-label="${inr(amt)} of ${inr(outgoing())} a month can go">
      <div class="avoid-bar"><i style="width:${Math.max(2, Math.round((amt / outgoing()) * 100))}%"></i></div>
      <div class="avoid-legend"><span><strong class="num">${Math.round((amt / outgoing()) * 100)}%</strong> of what goes out each month can go</span><span class="num">${inr(outgoing())}/mo</span></div>
    </div>` : ''}
    ${fixes.length ? `<div class="slider" id="slider" role="slider" aria-label="Slide to start all ${fixes.length} fixes" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
        <div class="slider-fill" id="slider-fill"></div><div class="slider-label" id="slider-label">Slide to fix all ${fixes.length}</div>
        <div class="slider-knob" id="slider-knob">${icon.arrow}</div></div>
      <div class="slider-note">Starts every fix at once. Anything that needs your OK waits for you.</div>` : ''}
  </section>
  ${fixes.length ? `<div class="section-head"><h2>Biggest fixes</h2><button class="link" data-act="tab" data-tab="bills">All ${bills().length} bills</button></div>
    <div class="rows">${fixes.slice(0, 5).map((r) => recRow(r, { headline: true })).join('')}</div>` : ''}
  ${inProgress.length ? `<div class="section-head"><h2>Underway</h2><button class="link" data-act="tab" data-tab="saved">All ${inProgress.length}</button></div>
    <div class="rows">${inProgress.slice(0, fixes.length ? 3 : 6).map((r) => recRow(r)).join('')}</div>` : ''}
  ${upcoming.length ? `<div class="section-head"><h2>Going out this week</h2><button class="link" data-act="tab" data-tab="cal">Calendar</button></div>
    <div class="rows">${upcoming.map((b) => `<button class="row" data-act="open-bill" data-key="${esc(b.key)}"><span class="mark" data-cat="${esc(b.category)}">${esc(b.mark)}</span><span class="row-main"><div class="row-title">${esc(b.provider)}</div><div class="row-sub">${fmtDay(b.nextDebit)}, ${esc(b.rail)}</div></span><span class="row-end"><div class="row-amt num">${inr(b.nextAmount)}</div></span></button>`).join('')}</div>` : ''}
  <p class="sample-note">${esc(state.data.catalogNote)} Scanned ${fmtTime(state.data.scan.at)}.</p>`;
}

function viewBills() {
  const list = bills();
  const cats = CATS.filter(([id]) => list.some((b) => b.category === id));
  const shown = state.filter === 'all' ? cats : state.filter === 'review' ? [] : cats.filter(([id]) => id === state.filter);
  const review = state.data.review || [];
  const groupRecs = recs().filter((r) => r.display && r.status !== 'dismissed');
  return `${topbar()}
  <h1 style="margin-top:10px">Your bills</h1>
  <div class="summary">
    <div class="stat"><div class="v num">${inr(outgoing())}</div><div class="k">going out a month</div></div>
    <div class="stat save"><div class="v num">${inr(saveable())}</div><div class="k">you can cut a month</div></div>
  </div>
  <div class="chips" style="margin-top:18px">
    <button class="chip ${state.filter === 'all' ? 'on' : ''}" data-act="filter" data-f="all">All</button>
    ${cats.map(([id, name]) => `<button class="chip ${state.filter === id ? 'on' : ''}" data-act="filter" data-f="${id}">${name}</button>`).join('')}
    ${review.length ? `<button class="chip ${state.filter === 'review' ? 'on' : ''}" data-act="filter" data-f="review">Needs review (${review.length})</button>` : ''}
  </div>
  ${(state.filter === 'all' || state.filter === 'apps') && groupRecs.length ? `<div class="cat-head"><h3>Across apps</h3></div><div class="rows">${groupRecs.map((r) => recRow(r)).join('')}</div>` : ''}
  ${shown.map(([id, name]) => {
    const items = list.filter((b) => b.category === id).sort((a, b) => (b.monthly || 0) - (a.monthly || 0));
    const cut = recs().filter((r) => r.status === 'open' && items.some((b) => b.key === r.billKeys[0])).reduce((s, r) => s + r.save, 0);
    return `<div class="cat-head"><h3>${name}</h3><span class="muted num">${cut ? `${inr(cut)}/mo to cut` : ''}</span></div>
      <div class="rows">${items.map((b) => billRow(b)).join('')}</div>`;
  }).join('')}
  ${(state.filter === 'all' || state.filter === 'review') && review.length ? `<div class="cat-head"><h3>Needs review</h3><span class="muted small">${review.length}</span></div>
    ${review.map((v) => `<div class="review"><div class="src">${esc(v.source)}, ${esc(v.from)}, ${fmtShort(v.at)}${v.count > 1 ? `, ${v.count} messages` : ''}</div><h3>${esc(v.subject || 'Message')}</h3><pre>${esc(v.text)}</pre><div class="small" style="color:var(--coral)">${esc(v.reason)}</div></div>`).join('')}
    <div class="note">${state.data.llm ? 'Claude extraction is on, but these still could not be read as bills.' : 'These are in a format the rules do not know. Start the server with ANTHROPIC_API_KEY set and rescan to read them with Claude, after names and numbers are removed.'}</div>` : ''}`;
}

function gauge(score) {
  const t = Math.max(0, Math.min(1, (score - 300) / 600));
  const a = Math.PI * (1 - t);
  const x = 120 + 100 * Math.cos(a), y = 125 - 100 * Math.sin(a);
  return `<svg viewBox="0 0 240 140" aria-hidden="true"><path d="M20 125 A100 100 0 0 1 220 125" fill="none" stroke="var(--raised)" stroke-width="14" stroke-linecap="round"/><path d="M20 125 A100 100 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="var(--gold)" stroke-width="14" stroke-linecap="round"/></svg>`;
}

function viewCredit() {
  const p = state.data.profile;
  if (!p) return `${topbar()}<h1 style="margin-top:10px">Credit</h1><div class="empty"><p>Include CIBIL in your scan to see your loans, cards and the cheapest way to carry them.</p><button class="btn" style="margin-top:18px" data-act="rescan">Scan again with CIBIL</button></div>`;
  const items = bills().filter((b) => b.category === 'credit');
  const cut = recs().filter((r) => r.status === 'open' && items.some((b) => b.key === r.billKeys[0])).reduce((s, r) => s + r.save, 0);
  const hot = p.utilisation > 30;
  const cardFix = recs().find((r) => r.key.startsWith('card:') && r.kind === 'refinance' && r.status !== 'open' && r.status !== 'dismissed');
  return `${topbar()}
  <h1 style="margin-top:10px">Credit</h1>
  <div class="gauge">${gauge(p.score)}<div class="gauge-v"><div class="v num">${p.score}</div><div class="k">CIBIL score, report of ${fmtShort(p.reportDate)}</div></div></div>
  <div class="factors">
    <div class="stat"><div class="k">Card limit used</div><div class="v num" style="color:${hot ? 'var(--coral)' : 'var(--text)'}">${p.utilisation}%</div><div class="bar ${hot ? 'hot' : ''}"><i style="width:${Math.min(100, p.utilisation)}%"></i></div></div>
    <div class="stat"><div class="k">Paid on time</div><div class="v">${esc(p.onTime)}</div></div>
    <div class="stat"><div class="k">Open accounts</div><div class="v num">${p.accounts}</div></div>
    <div class="stat"><div class="k">Credit age</div><div class="v">${esc(p.age)}</div></div>
  </div>
  ${hot ? (cardFix
    ? `<div class="tip" style="background:var(--gold-soft)"><strong style="color:var(--gold)">Card balance moving.</strong> Once the transfer clears, card use drops, the biggest lever on your score.</div>`
    : `<div class="tip"><strong>${p.utilisation}% of your card limit is in use.</strong> Lenders read anything over 30% as stretched.${recs().some((r) => r.key.startsWith('card:')) ? ' The balance transfer below fixes this and the interest together.' : ''}</div>`) : ''}
  ${p.enquiries >= 3 ? `<div class="tip" style="margin-top:8px"><strong>${p.enquiries} loan enquiries in 6 months.</strong> Each hard enquiry can lower the score. Use eligibility checks that do not count as one.</div>` : ''}
  <div class="section-head"><h2>Loans and cards</h2><span class="muted num small">${cut ? inr(cut) + '/mo to cut' : ''}</span></div>
  <div class="rows">${items.map((b) => billRow(b)).join('')}</div>`;
}

function viewCal() {
  const list = bills().filter((b) => b.nextDebit);
  const start = parse(TODAY());
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const days = Array.from({ length: 35 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return isoDay(d); });
  const byDay = {};
  list.forEach((b) => (byDay[b.nextDebit] = [...(byDay[b.nextDebit] || []), b]));
  const sel = state.calSel && byDay[state.calSel] ? state.calSel : Object.keys(byDay).filter((d) => d >= TODAY()).sort()[0];
  const in30 = list.filter((b) => daysFrom(b.nextDebit) >= 0 && daysFrom(b.nextDebit) <= 30).reduce((s, b) => s + (b.nextAmount || 0), 0);
  const selItems = byDay[sel] || [];
  return `${topbar()}
  <h1 style="margin-top:10px">Calendar</h1>
  <div class="summary"><div class="stat"><div class="v num">${inr(in30)}</div><div class="k">going out in 30 days</div></div><div class="stat"><div class="v num">${Object.keys(byDay).filter((d) => daysFrom(d) <= 30).length}</div><div class="k">debit days</div></div></div>
  <div class="cal">
    ${DOW.map((d) => `<div class="dow">${d[0]}</div>`).join('')}
    ${days.map((d) => {
      const has = byDay[d]; const dd = parse(d).getUTCDate();
      return `<button class="d ${has ? 'has' : ''} ${d === sel ? 'sel' : ''} ${d === TODAY() ? 'today' : ''}" ${has ? `data-act="cal" data-d="${d}"` : 'tabindex="-1"'} style="${daysFrom(d) < 0 ? 'opacity:.35' : ''}" aria-label="${fmtDay(d)}${has ? `, ${has.length} debits` : ''}">${dd === 1 ? MONTHS[parse(d).getUTCMonth()] : dd}${has ? '<i class="dot"></i>' : ''}</button>`;
    }).join('')}
  </div>
  ${sel ? `<div class="day-head"><h3>${fmtDay(sel)}</h3><span class="muted num">${inr(selItems.reduce((s, b) => s + (b.nextAmount || 0), 0))}</span></div>
  <div class="rows">${selItems.map((b) => billRow(b, { due: true, plain: true })).join('')}</div>` : ''}`;
}

function viewSaved() {
  const conf = savedMonthly('confirmed'), pend = savedMonthly('requested');
  const act = activeRecs().sort((a, b) => (b.statusAt || '').localeCompare(a.statusAt || ''));
  const oneOff = act.reduce((s, r) => s + (r.oneOff || 0), 0);
  const dismissed = recs().filter((r) => r.status === 'dismissed');
  return `<div class="topbar"><button data-act="tab" data-tab="home" aria-label="Back">${icon.back}</button><span class="brand">cut<b>my</b>bills</span></div>
  <section class="hero">
    <div class="hero-label">Confirmed savings a year</div>
    <div class="hero-amount num ${conf ? '' : 'zero'}"><span class="rupee">₹</span>${odo('saved', conf * 12)}</div>
    <div class="hero-sub">${act.length ? `<strong class="num">${inr(conf)}</strong> a month confirmed, <strong class="num">${inr(pend)}</strong> a month still in progress${oneOff ? `, plus <strong class="num">${inr(oneOff)}</strong> to claim once` : ''}.` : 'Nothing started yet. Your first fix is one swipe away on Home.'}</div>
  </section>
  ${act.length ? `<div class="section-head"><h2>Your fixes</h2></div><div class="rows">${act.map((r) => recRow(r)).join('')}</div>`
    : `<div class="empty"><button class="btn" data-act="tab" data-tab="home">Find my first fix</button></div>`}
  ${dismissed.length ? `<div class="section-head"><h2>Dismissed</h2></div><div class="rows">${dismissed.map((r) => recRow(r)).join('')}</div>` : ''}`;
}

function viewData() {
  const items = state.items;
  if (!items) return `<div class="topbar"><button data-act="tab" data-tab="home" aria-label="Back">${icon.back}</button><span class="brand">Test data</span></div><p class="muted">Loading…</p>`;
  const counts = items.reduce((c, i) => ((c[i.status] = (c[i.status] || 0) + 1), c), {});
  const f = state.itemFilter;
  const shown = items.filter((i) => f === 'all' || i.status === f || i.source === f);
  const filters = [['all', `All ${items.length}`], ['read', `Read ${counts.read || 0}`], ['review', `Review ${counts.review || 0}`], ['ignored', `Ignored ${counts.ignored || 0}`], ['Gmail', 'Gmail'], ['SMS', 'SMS'], ['CIBIL', 'CIBIL']];
  return `<div class="topbar"><button data-act="tab" data-tab="home" aria-label="Back">${icon.back}</button><span class="brand">Test data</span></div>
  <h1 style="margin-top:6px">Raw messages</h1>
  <p class="muted" style="margin-top:6px">Everything the scan read for ${esc(state.data.user.name)}, and what it made of each one.</p>
  <div class="chips" style="margin-top:14px">${filters.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-act="item-filter" data-f="${k}">${l}</button>`).join('')}</div>
  <div style="margin-top:14px">${shown.map((i) => {
    const open = state.openItem === i.id;
    const st = { read: `Read${i.by === 'Claude' ? ' by Claude' : ''}`, review: 'Needs review', ignored: 'Ignored', 'not scanned': 'Not scanned' }[i.status];
    return `<button class="item" data-act="item" data-id="${i.id}" aria-expanded="${open}">
      <div class="item-top"><b>${i.source}</b><span>${esc(i.sender)}</span><span class="st ${i.status.split(' ')[0]}">${st}</span></div>
      <div class="item-sub">${esc(i.subject || i.body.split('\n')[0])}</div>
      <div class="small muted">${fmtTime(i.at)}${i.key ? `, matched to ${esc(i.key)}` : ''}</div>
      ${open ? `<pre>${esc(i.body)}</pre>` : ''}
    </button>`;
  }).join('')}</div>`;
}

// ---------- sheets ----------
function sheetRec(r) {
  const d = displayOf(r);
  const ev = evidenceOf(r.billKeys);
  const evidence = ev.length ? `<h3 style="margin-bottom:8px">Found in</h3><div class="evidence">${ev.map((e) => `<div class="ev"><b>${e.source}</b><span><time>${fmtShort(e.at)}, ${esc(e.from)}</time>${esc(e.text)}</span></div>`).join('')}</div>` : '';
  const timeline = r.history?.length ? `<h3 style="margin:18px 0 6px">Progress</h3><ul class="timeline">${r.history.map((h) => `<li class="${h.status === 'requested' ? 'req' : ''}"><span>${esc(h.label)}</span><time>${fmtTime(h.at)}</time></li>`).join('')}</ul>` : '';
  const amount = r.oneOff ? `${inr(r.oneOff)}<span>one time</span>` : `${inr(r.save)}<span>a month</span>`;
  let foot;
  if (r.status === 'open') foot = `<button class="btn" data-act="fix" data-key="${esc(r.key)}">${esc(r.verb)}${r.save ? ` and save ${inr(r.save)}/mo` : ''}</button><button class="btn ghost" data-act="dismiss" data-key="${esc(r.key)}">Not for me</button>`;
  else if (r.status === 'dismissed') foot = `<button class="btn" data-act="reopen" data-key="${esc(r.key)}">Bring this fix back</button>`;
  else foot = `<button class="btn ghost" data-act="close">Close</button>`;
  const head = r.status === 'requested' || r.status === 'confirmed'
    ? `<div class="done-state" style="padding-top:8px"><div class="tick" style="${r.status === 'requested' ? 'background:var(--raised);color:var(--gold)' : ''}">${icon.check}</div><h2>${esc(r.status === 'confirmed' ? r.history.at(-1).label : r.done)}</h2>
       <p class="muted" style="margin-top:6px">${r.oneOff ? `About ${inr(r.oneOff)} for you to claim.` : `${inr(r.save)} a month ${r.status === 'confirmed' ? 'confirmed' : 'once this is confirmed'}.`}</p></div>`
    : `<div class="sheet-top"><span class="mark">${esc(d.mark)}</span><div><h2>${esc(d.provider)}</h2><div class="muted small">${esc(d.title)}</div></div></div>
      <div class="muted small">${r.oneOff ? 'You get back' : 'You save'}</div><div class="sheet-save num">${amount}</div>`;
  return `${head}
    <h3 style="margin-top:16px">${esc(r.headline)}</h3>
    <div class="compare"><div><span class="k">Now</span><span class="now">${esc(r.now)}</span></div><div><span class="k">Better</span><span class="better">${esc(r.better)}</span></div></div>
    <h3>Why</h3><ul class="why">${r.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
    ${timeline}
    ${evidence}
    <h3 style="margin:18px 0 4px">What happens</h3><ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="fine">${esc(r.partner)} Confidence: ${esc(r.confidence.toLowerCase())}.</p>
    <div data-foot>${foot}</div>`;
}

function sheetBill(b) {
  const ev = b.evidence || [];
  const m = b.meta || {};
  const facts = [
    b.nextDebit && ['Next debit', `${fmtDay(b.nextDebit)}, ${inr(b.nextAmount)}`],
    ['Paid by', b.rail],
    m.peakMbps && ['Peak speed used', `${m.peakMbps} Mbps of ${m.planMbps}`],
    m.avgDaily && ['Data used', `${m.avgDaily} GB a day of ${m.planDaily}`],
    m.units && ['Last bill', `${m.units} units`],
    m.balance && b.key.startsWith('card:') && ['Balance', `${inr(m.balance)} of ${inr(m.limit)} limit`],
    m.rate && ['Interest', `${m.rate}%, ${m.monthsLeft} months left`],
    m.regime && ['Tax regime', `${m.regime}, 80D claimed ${inr(m.d80d)}`],
  ].filter(Boolean);
  const note = b.key.startsWith('card:') && !m.revolving ? 'You pay this card in full every month, so it costs no interest.' : b.key.startsWith('tax:') ? 'Nothing to claim here beyond what is listed under fixes.' : 'This is already the best price we know for how you use it. We check again every month.';
  return `<div class="sheet-top"><span class="mark">${esc(b.mark)}</span><div><h2>${esc(b.provider)}</h2><div class="muted small">${esc(b.plan || '')}</div></div></div>
    ${b.amount != null && b.amount !== 0 ? `<div class="sheet-save num">${inr(b.amount)}<span>${esc(b.unit)}</span></div>` : ''}
    <p style="margin:16px 0">${note}</p>
    <div class="compare">${facts.map(([k, v]) => `<div><span class="k">${esc(k)}</span><span class="now">${esc(v)}</span></div>`).join('')}</div>
    <h3 style="margin-bottom:8px">Found in</h3><div class="evidence">${ev.map((e) => `<div class="ev"><b>${e.source}</b><span><time>${fmtShort(e.at)}, ${esc(e.from)}</time>${esc(e.text)}</span></div>`).join('')}</div>
    <div data-foot><button class="btn ghost" data-act="close">Close</button></div>`;
}

function sheetAccount() {
  const u = state.data?.user || {};
  return `<div class="sheet-top"><span class="avatar" style="width:44px;height:44px">${esc((u.name || '?').split(' ').map((w) => w[0]).join(''))}</span><div><h2>${esc(u.name)}</h2><div class="muted small">${esc(u.email)}</div></div></div>
    <p class="muted">${esc(u.blurb || '')}</p>
    <div class="menu-list">
      <button data-act="tab" data-tab="data">See raw test data<span>Every email, SMS and report the scan read, and how it was parsed</span></button>
      <button data-act="rescan">Scan again<span>Pick sources and rerun. Fixes you started keep their status.</span></button>
      <button data-act="regenerate">Start this household over<span>New test messages dated from today. Clears bills and fixes.</span></button>
      <button data-act="switch">Switch test household</button>
    </div>
    <div data-foot><button class="btn ghost" data-act="close">Close</button></div>`;
}

function sheetHtml() {
  const s = state.sheet;
  let inner = '', label = '';
  if (s.type === 'rec') { const r = recs().find((x) => x.key === s.key); if (!r) return ''; inner = sheetRec(r); label = displayOf(r).provider; }
  if (s.type === 'bill') { const b = billByKey(s.key); if (!b) return ''; inner = sheetBill(b); label = b.provider; }
  if (s.type === 'account') { inner = sheetAccount(); label = 'Account'; }
  const [body, foot] = inner.split('<div data-foot>');
  return `<div class="scrim" id="scrim" data-act="close"></div>
  <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
    <div class="sheet-grab"></div><div class="sheet-body">${body}</div><div class="sheet-foot">${foot.replace(/<\/div>\s*$/, '')}</div>
  </div>`;
}

function tabbar() {
  const t = [['home', 'Home', icon.home], ['bills', 'Bills', icon.bills], ['credit', 'Credit', icon.credit], ['cal', 'Calendar', icon.cal]];
  return `<nav class="tabbar"><span class="nav-brand">cut<b>my</b>bills</span>${t.map(([k, l, i]) => `<button class="tab ${state.tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}" aria-current="${state.tab === k}">${i}${l}</button>`).join('')}</nav>`;
}

// ---------- render ----------
const root = document.getElementById('device');
let lastTab = null;

function screenHtml() {
  return { home: viewHome, bills: viewBills, credit: viewCredit, cal: viewCal, saved: viewSaved, data: viewData }[state.tab]();
}

function render() {
  const scroller = root.querySelector('.screen');
  const keep = scroller && lastTab === state.tab ? scroller.scrollTop : 0;
  const sheetOpen = !!root.querySelector('#sheet.open');
  let html;
  if (state.stage === 'loading') html = '<div class="onb"><div class="topbar"><span class="brand">cut<b>my</b>bills</span></div></div>';
  else if (state.stage === 'signin') html = viewSignin();
  else if (state.stage === 'connect') html = viewConnect() + (state.sheet ? sheetHtml() : '');
  else if (state.stage === 'scan') html = viewScan();
  else html = `<main class="screen">${screenHtml()}</main>${tabbar()}${state.sheet ? sheetHtml() : ''}<div class="toast" id="toast"></div>`;
  root.innerHTML = html;
  const s2 = root.querySelector('.screen');
  if (s2) s2.scrollTop = keep;
  lastTab = state.tab;
  if (state.sheet && sheetOpen) { root.querySelector('#scrim')?.classList.add('open'); root.querySelector('#sheet')?.classList.add('open'); }
  if (state.stage === 'app' && state.tab === 'home') bindSlider();
  rollOdos();
  const form = root.querySelector('#login-form');
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); login(form.email.value, form.password.value); });
}

function openSheet(sheet) {
  state.sheet = sheet;
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelector('#scrim')?.classList.add('open');
    root.querySelector('#sheet')?.classList.add('open');
    root.querySelector('#sheet .btn')?.focus({ preventScroll: true });
  }));
}
function closeSheet(then) {
  root.querySelector('#scrim')?.classList.remove('open');
  root.querySelector('#sheet')?.classList.remove('open');
  setTimeout(() => { state.sheet = null; render(); then?.(); }, reduceMotion ? 0 : 260);
}

function toast(text, sub) {
  const t = root.querySelector('#toast');
  if (!t) return;
  t.innerHTML = `${esc(text)}${sub ? `<span>${esc(sub)}</span>` : ''}`;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}

function tween(el, from, to, ms) {
  if (!el) return;
  if (reduceMotion) { el.textContent = num(to); return; }
  const t0 = performance.now();
  const step = (now) => { const p = Math.min(1, (now - t0) / ms); el.textContent = num(from + (to - from) * (1 - (1 - p) ** 3)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function bindSlider() {
  const el = root.querySelector('#slider');
  if (!el) return;
  const knob = el.querySelector('#slider-knob'), fill = el.querySelector('#slider-fill'), label = el.querySelector('#slider-label');
  let startX = 0, x = 0, dragging = false;
  const max = () => el.clientWidth - 64;
  const set = (v) => { x = Math.max(0, Math.min(max(), v)); knob.style.transform = `translateX(${x}px)`; fill.style.width = `${x + 64}px`; label.style.opacity = String(1 - x / max()); el.setAttribute('aria-valuenow', String(Math.round((x / max()) * 100))); };
  const finish = () => { el.classList.add('done'); knob.style.transition = fill.style.transition = 'all .2s'; set(max()); knob.innerHTML = icon.check; label.style.opacity = '1'; label.textContent = 'Starting every fix'; fixAll(); };
  knob.addEventListener('pointerdown', (e) => { dragging = true; startX = e.clientX - x; knob.setPointerCapture(e.pointerId); knob.style.transition = fill.style.transition = 'none'; });
  knob.addEventListener('pointermove', (e) => { if (dragging) set(e.clientX - startX); });
  const up = () => { if (!dragging) return; dragging = false; if (x > max() * 0.86) finish(); else { knob.style.transition = fill.style.transition = 'all .25s'; set(0); } };
  knob.addEventListener('pointerup', up);
  knob.addEventListener('pointercancel', up);
  el.addEventListener('keydown', (e) => { if (['Enter', ' ', 'ArrowRight'].includes(e.key)) { e.preventDefault(); finish(); } });
}

// ---------- actions ----------
async function boot() {
  try {
    await refresh();
    state.stage = state.data.scan ? 'app' : 'connect';
    connectEvents();
  } catch (e) {
    if (e.status !== 401) console.error(e);
    state.accounts = await api('/api/test-accounts');
    state.stage = 'signin';
  }
  render();
}

async function refresh() {
  state.data = await api('/api/state');
  if (state.data.scanning && state.stage !== 'scan') state.stage = 'scan';
}

async function login(email, password) {
  state.error = null;
  try {
    await api('/api/login', { body: { email, password } });
    await boot();
  } catch (e) { state.error = e.message; render(); }
}

let events = null;
function connectEvents() {
  events?.close();
  events = new EventSource('/api/events');
  events.addEventListener('scan:start', (e) => { const d = JSON.parse(e.data); state.scan = { sources: d.sources, total: d.total, counts: {}, feed: [], done: null }; state.stage = 'scan'; render(); });
  events.addEventListener('scan:item', (e) => {
    const d = JSON.parse(e.data);
    if (!state.scan) return;
    state.scan.counts = d.counts;
    if (d.found || d.review) { state.scan.seq = (state.scan.seq || 0) + 1; state.scan.feed.unshift({ id: state.scan.seq, source: d.source, text: d.found || d.review, review: !!d.review }); state.scan.feed.length = Math.min(state.scan.feed.length, 6); }
    render();
    state.scan.animated = state.scan.seq || 0;
  });
  events.addEventListener('scan:done', async (e) => { await refresh(); state.scan.done = JSON.parse(e.data); render(); });
  events.addEventListener('scan:error', (e) => { state.error = `The scan stopped: ${JSON.parse(e.data).message}`; state.stage = 'connect'; render(); });
  events.addEventListener('rec', (e) => {
    const d = JSON.parse(e.data);
    const r = recs().find((x) => x.key === d.key);
    if (!r) return;
    const was = r.status;
    Object.assign(r, { status: d.status, history: d.history, statusAt: d.history.at(-1)?.at });
    if (state.stage !== 'app') return;
    render();
    if (d.status === 'confirmed' && was !== 'confirmed') toast(`${displayOf(r).provider}: ${d.label}`, r.save ? `+${inr(r.save)}/mo` : '');
  });
}

async function startScan() {
  state.error = null;
  const sources = Object.keys(state.sources).filter((k) => state.sources[k]);
  state.scan = { sources, counts: {}, feed: [], done: null };
  state.stage = 'scan';
  render();
  try { await api('/api/scan', { body: { sources } }); }
  catch (e) { state.error = e.message; state.stage = 'connect'; render(); }
}

async function recAction(key, action) {
  try {
    const res = await api(`/api/recs/${encodeURIComponent(key)}/${action}`, { method: 'POST' });
    const r = recs().find((x) => x.key === key);
    Object.assign(r, { status: res.status, history: res.history, statusAt: res.history.at(-1)?.at });
    render();
  } catch (e) { toast(e.message); }
}

async function fixAll() {
  const list = openRecs();
  const before = saveable();
  await Promise.all(list.map((r) => api(`/api/recs/${encodeURIComponent(r.key)}/fix`, { method: 'POST' }).then((res) => Object.assign(r, { status: res.status, history: res.history, statusAt: res.history.at(-1)?.at })).catch(() => {})));
  setTimeout(() => { render(); toast(`${list.length} fixes started`, `+${inr(before)}/mo`); }, reduceMotion ? 0 : 450);
}

async function loadItems() {
  state.items = null;
  render();
  state.items = (await api('/api/items')).items;
  render();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || !root.contains(t)) return;
  const act = t.dataset.act, key = t.dataset.key;
  if (act === 'quick-login') login(t.dataset.email, state.accounts.password);
  else if (act === 'new-user') { try { await api('/api/test-users', { method: 'POST' }); await boot(); } catch (err) { state.error = err.message; render(); } }
  else if (act === 'toggle-src') { state.sources[t.dataset.src] = !state.sources[t.dataset.src]; render(); }
  else if (act === 'start-scan') startScan();
  else if (act === 'go-app') { state.stage = 'app'; state.tab = 'home'; state.scan = null; render(); }
  else if (act === 'tab') {
    const go = () => { state.tab = t.dataset.tab; render(); root.querySelector('.screen') && (root.querySelector('.screen').scrollTop = 0); if (state.tab === 'data') loadItems(); };
    state.sheet ? closeSheet(go) : go();
  }
  else if (act === 'filter') { state.filter = t.dataset.f; render(); }
  else if (act === 'open-rec') openSheet({ type: 'rec', key });
  else if (act === 'open-bill') openSheet({ type: 'bill', key });
  else if (act === 'account') openSheet({ type: 'account' });
  else if (act === 'close') closeSheet();
  else if (act === 'fix') recAction(key, 'fix');
  else if (act === 'dismiss') { await recAction(key, 'dismiss'); closeSheet(); }
  else if (act === 'reopen') recAction(key, 'reopen');
  else if (act === 'cal') { state.calSel = t.dataset.d; render(); }
  else if (act === 'item-filter') { state.itemFilter = t.dataset.f; render(); }
  else if (act === 'item') { state.openItem = state.openItem === Number(t.dataset.id) ? null : Number(t.dataset.id); render(); }
  else if (act === 'rescan') closeSheet(() => { state.stage = 'connect'; render(); });
  else if (act === 'regenerate') { await api('/api/reset', { method: 'POST' }); closeSheet(async () => { await refresh(); state.stage = 'connect'; state.tab = 'home'; render(); }); }
  else if (act === 'switch') { await api('/api/logout', { method: 'POST' }); events?.close(); state.sheet = null; state.data = null; state.tab = 'home'; state.accounts = await api('/api/test-accounts'); state.stage = 'signin'; render(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.sheet) closeSheet(); });

boot();
