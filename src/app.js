import { bills, categories, credit, scanFeed, scanTotals, TODAY } from './data.js';

// ---------- helpers ----------
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const num = (n) => Math.round(n).toLocaleString('en-IN');
const byId = (id) => bills.find((b) => b.id === id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (dt) => dt.toISOString().slice(0, 10);
const fmtDay = (s) => { const d = parse(s); return `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const daysFrom = (s) => Math.round((parse(s) - parse(TODAY)) / 864e5);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const icon = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/></svg>',
  bills: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  credit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
};

// ---------- state ----------
const state = {
  stage: 'welcome', // welcome | connect | scan | app
  sources: { Gmail: true, SMS: true, CIBIL: true },
  tab: 'home', // home | bills | credit | cal | saved
  filter: 'all',
  fixed: {},
  sheet: null, // { id, step: 'detail' | 'done' }
  calSel: null,
};

const visible = () => bills.filter((b) => state.sources[b.source.rail] || (b.source2 && state.sources[b.source2.rail]));
const openFixes = () => visible().filter((b) => b.action && !state.fixed[b.id]);
const saveable = () => openFixes().reduce((s, b) => s + b.action.save, 0);
const owed = () => openFixes().reduce((s, b) => s + (b.action.oneOff || 0), 0);
const savedMonthly = () => visible().filter((b) => state.fixed[b.id]).reduce((s, b) => s + b.action.save, 0);
const savedOneOff = () => visible().filter((b) => state.fixed[b.id]).reduce((s, b) => s + (b.action.oneOff || 0), 0);
const outgoing = () => visible().reduce((s, b) => s + b.monthly, 0);
const due = (b) => b.debit ?? b.monthly; // what actually leaves the account on nextDebit

// ---------- views ----------
function viewWelcome() {
  return `
  <div class="onb">
    <div class="topbar"><span class="brand">cut<b>my</b>bills</span></div>
    <div class="onb-hero">
      <h1>Same life.<br>Lower bills.</h1>
      <p>We read your bills, find the cheaper way to get the same thing, and do the switching for you.</p>
      <div class="leak">
        <div>Paying for 300 Mbps, <span>using 62.</span></div>
        <div>Two cloud plans, <span>one phone.</span></div>
        <div>A card at 42% <span>when 13.5% is on offer.</span></div>
      </div>
    </div>
    <button class="btn" data-act="go-connect">Find my savings</button>
    <p class="small muted" style="text-align:center;margin-top:12px">Takes about a minute. We never ask for a bank password.</p>
  </div>`;
}

function viewConnect() {
  const src = [
    ['Gmail', 'GM', 'Bills and receipts in your inbox. Read-only, bills only.'],
    ['SMS', 'SM', 'Debit and AutoPay alerts. Read on your phone, never uploaded.'],
    ['CIBIL', 'CB', 'Your loans and cards. Checking does not affect your score.'],
  ];
  const any = Object.values(state.sources).some(Boolean);
  return `
  <div class="onb">
    <div class="topbar"><button data-act="go-welcome" aria-label="Back">${icon.back}</button><span></span></div>
    <div style="padding:14px 0 22px">
      <h1>Where should we look?</h1>
      <p class="muted" style="margin-top:8px">Each source finds bills the others miss. Use all three for the full picture.</p>
    </div>
    ${src
      .map(
        ([k, m, d]) => `
      <button class="source" data-act="toggle-src" data-src="${k}" role="switch" aria-checked="${state.sources[k]}">
        <span class="mark">${m}</span>
        <span><h3>${k === 'SMS' ? 'SMS' : k}</h3><p>${d}</p></span>
        <span class="toggle ${state.sources[k] ? 'on' : ''}"></span>
      </button>`
      )
      .join('')}
    <div class="promise">
      <span>We store what each bill is, never the message itself.</span>
      <span>Disconnect any source and its data is deleted.</span>
    </div>
    <div style="flex:1"></div>
    <button class="btn" data-act="go-scan" ${any ? '' : 'disabled style="opacity:.4"'}>Start scan</button>
  </div>`;
}

function viewScan() {
  const rails = Object.keys(state.sources).filter((k) => state.sources[k]);
  return `
  <div class="onb">
    <div class="topbar"><span class="brand">cut<b>my</b>bills</span></div>
    <div style="padding-top:14px"><h1 id="scan-title">Reading your bills</h1></div>
    <div class="scan-counts">
      ${rails
        .map(
          (r) => `<div class="scan-count"><div class="v num" id="c-${r}">0</div><div class="k">${r === 'CIBIL' ? 'accounts' : r === 'SMS' ? 'messages' : 'emails'}</div><div class="f num" id="f-${r}">0 bills</div></div>`
        )
        .join('')}
    </div>
    <div class="feed" id="feed"></div>
    <div id="scan-result"></div>
  </div>`;
}

function topbar() {
  const s = savedMonthly();
  return `<div class="topbar">
    <span class="brand">cut<b>my</b>bills</span>
    <button class="saved-chip" data-act="tab" data-tab="saved">Saved <strong class="num" id="saved-chip">${inr(s)}</strong>/mo</button>
  </div>`;
}

function row(b, opts = {}) {
  const a = b.action;
  const done = state.fixed[b.id];
  let end;
  if (!a) end = `<div class="row-amt num">${inr(b.monthly)}</div><span class="verb quiet">Best price</span>`;
  else if (done && opts.due) end = `<div class="row-amt num">${inr(due(b))}</div><span class="verb done">✓ ${esc(a.done)}</span>`;
  else if (done) end = `<div class="row-save num">${a.oneOff ? '+' + inr(a.oneOff) : `−${inr(a.save)}<span class="small muted">/mo</span>`}</div><span class="verb done">✓ ${esc(a.done)}</span>`;
  else if (opts.due) end = `<div class="row-amt num">${inr(due(b))}</div><span class="verb">${esc(a.verb)}</span>`;
  else if (a.oneOff) end = `<div class="row-save num">+${inr(a.oneOff)}</div><span class="verb">${esc(a.verb)}</span>`;
  else end = `<div class="row-save num">−${inr(a.save)}<span class="small muted">/mo</span></div><span class="verb">${esc(a.verb)}</span>`;
  const sub = opts.home && a && !done ? esc(a.headline) : `${b.monthly ? inr(b.monthly) + ' ' + esc(b.unit) : esc(b.unit)}`;
  return `<button class="row" data-act="open" data-id="${b.id}">
    <span class="mark">${b.mark}</span>
    <span class="row-main"><div class="row-title">${esc(b.provider)}</div><div class="row-sub">${sub}</div></span>
    <span class="row-end">${end}</span>
  </button>`;
}

function viewHome() {
  const amt = saveable();
  const fixes = openFixes().sort((x, y) => (y.action.save || y.action.oneOff / 12) - (x.action.save || x.action.oneOff / 12));
  const upcoming = visible()
    .filter((b) => b.nextDebit && daysFrom(b.nextDebit) >= 0 && daysFrom(b.nextDebit) <= 7)
    .sort((x, y) => x.nextDebit.localeCompare(y.nextDebit));
  const o = owed();
  const inProgress = visible().filter((b) => state.fixed[b.id]);
  const sub = amt
    ? `That is <strong class="num">${inr(amt * 12)}</strong> a year${o ? `, plus <strong class="num">${inr(o)}</strong> owed to you.` : '.'}`
    : inProgress.length
      ? `${inProgress.length} fixes are in progress. We will tell you as each one lands, and whenever a price changes.`
      : 'We will tell you the moment a cheaper option appears.';
  return `
  ${topbar()}
  <section class="hero">
    <div class="hero-label">${amt ? 'You can save every month' : 'Nothing left to fix'}</div>
    <div class="hero-amount num ${amt ? '' : 'zero'}" id="hero-amt"><span class="rupee">₹</span><span id="hero-num">${num(amt)}</span></div>
    <div class="hero-sub">${sub}</div>
    ${
      fixes.length
        ? `<div class="slider" id="slider" role="slider" aria-label="Slide to fix all ${fixes.length}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
            <div class="slider-fill" id="slider-fill"></div>
            <div class="slider-label" id="slider-label">Slide to fix all ${fixes.length}</div>
            <div class="slider-knob" id="slider-knob">${icon.arrow}</div>
          </div>
          <div class="slider-note">Starts every fix at once. Anything that needs your OK waits for you.</div>`
        : ''
    }
  </section>
  ${
    fixes.length
      ? `<div class="section-head"><h2>Biggest fixes</h2><button class="link" data-act="tab" data-tab="bills">All ${visible().length} bills</button></div>
         <div class="rows">${fixes.slice(0, 5).map((b) => row(b, { home: true })).join('')}</div>`
      : ''
  }
  ${
    !fixes.length && inProgress.length
      ? `<div class="section-head"><h2>In progress</h2><button class="link" data-act="tab" data-tab="saved">All ${inProgress.length}</button></div>
         <div class="rows">${inProgress.slice(0, 5).map((b) => row(b)).join('')}</div>`
      : ''
  }
  ${
    upcoming.length
      ? `<div class="section-head"><h2>Going out this week</h2><button class="link" data-act="tab" data-tab="cal">Calendar</button></div>
         <div class="rows">${upcoming
           .map(
             (b) => `<button class="row" data-act="open" data-id="${b.id}"><span class="mark">${b.mark}</span><span class="row-main"><div class="row-title">${esc(b.provider)}</div><div class="row-sub">${fmtDay(b.nextDebit)}, ${esc(b.rail)}</div></span><span class="row-end"><div class="row-amt num">${inr(due(b))}</div></span></button>`
           )
           .join('')}</div>`
      : ''
  }
  <p class="sample-note">Prototype with a sample household. Prices are illustrative.</p>`;
}

function viewBills() {
  const list = visible();
  const cats = categories.filter((c) => list.some((b) => b.category === c.id));
  const shown = state.filter === 'all' ? cats : cats.filter((c) => c.id === state.filter);
  return `
  ${topbar()}
  <h1 style="margin-top:10px">Your bills</h1>
  <div class="summary">
    <div class="stat"><div class="v num">${inr(outgoing())}</div><div class="k">going out a month</div></div>
    <div class="stat save"><div class="v num">${inr(saveable())}</div><div class="k">you can cut a month</div></div>
  </div>
  <div class="chips" style="margin-top:18px">
    <button class="chip ${state.filter === 'all' ? 'on' : ''}" data-act="filter" data-f="all">All</button>
    ${cats.map((c) => `<button class="chip ${state.filter === c.id ? 'on' : ''}" data-act="filter" data-f="${c.id}">${c.name}</button>`).join('')}
  </div>
  ${shown
    .map((c) => {
      const items = list.filter((b) => b.category === c.id);
      const cut = items.filter((b) => b.action && !state.fixed[b.id]).reduce((s, b) => s + b.action.save, 0);
      return `<div class="cat-head"><h3>${c.name}</h3><span class="muted num">${cut ? `${inr(cut)}/mo to cut` : ''}</span></div>
      <div class="rows">${items.map((b) => row(b)).join('')}</div>`;
    })
    .join('')}`;
}

function gauge(score) {
  const t = (score - 300) / 600;
  const a = Math.PI * (1 - t);
  const x = 120 + 100 * Math.cos(a);
  const y = 125 - 100 * Math.sin(a);
  return `<svg viewBox="0 0 240 140" aria-hidden="true">
    <path d="M20 125 A100 100 0 0 1 220 125" fill="none" stroke="var(--raised)" stroke-width="14" stroke-linecap="round"/>
    <path d="M20 125 A100 100 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="var(--gold)" stroke-width="14" stroke-linecap="round"/>
  </svg>`;
}

function viewCredit() {
  if (!state.sources.CIBIL)
    return `${topbar()}<h1 style="margin-top:10px">Credit</h1><div class="empty"><p>Connect your CIBIL report to see your loans, cards and the cheapest way to carry them.</p><button class="btn" style="margin-top:18px" data-act="connect-cibil">Connect CIBIL</button></div>`;
  const items = visible().filter((b) => b.category === 'credit');
  const cut = items.filter((b) => !state.fixed[b.id]).reduce((s, b) => s + (b.action ? b.action.save : 0), 0);
  const cardDone = state.fixed['cc-hdfc'];
  const util = credit.utilisation; // stays until the transfer actually clears
  return `
  ${topbar()}
  <h1 style="margin-top:10px">Credit</h1>
  <div class="gauge">${gauge(credit.score)}<div class="gauge-v"><div class="v num">${credit.score}</div><div class="k">CIBIL score, pulled ${credit.pulled}</div></div></div>
  <div class="factors">
    <div class="stat"><div class="k">Card limit used</div><div class="v num" style="color:${util > 30 ? 'var(--coral)' : 'var(--text)'}">${util}%</div><div class="bar ${util > 30 ? 'hot' : ''}"><i style="width:${util}%"></i></div></div>
    <div class="stat"><div class="k">Paid on time</div><div class="v num">${credit.onTime}%</div><div class="bar"><i style="width:${credit.onTime}%"></i></div></div>
    <div class="stat"><div class="k">Open accounts</div><div class="v num">${credit.accounts}</div></div>
    <div class="stat"><div class="k">Credit age</div><div class="v">${credit.age}</div></div>
  </div>
  ${
    cardDone
      ? `<div class="tip" style="background:var(--gold-soft)"><strong style="color:var(--gold)">Card balance moving.</strong> Once the transfer clears, your card use drops to zero, the biggest lever on your score.</div>`
      : `<div class="tip"><strong>64% of your card limit is in use.</strong> Lenders read anything over 30% as stretched. Moving the HDFC balance fixes this and the 42% interest together.</div>`
  }
  <div class="section-head"><h2>Loans and cards</h2><span class="muted num small">${cut ? inr(cut) + '/mo to cut' : ''}</span></div>
  <div class="rows">${items.map((b) => row(b)).join('')}</div>`;
}

function viewCal() {
  const list = visible().filter((b) => b.nextDebit);
  const start = parse(TODAY);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const days = Array.from({ length: 35 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return iso(d); });
  const byDay = {};
  list.forEach((b) => (byDay[b.nextDebit] = [...(byDay[b.nextDebit] || []), b]));
  const firstDebit = Object.keys(byDay).sort()[0];
  const sel = state.calSel || firstDebit;
  const in30 = list.filter((b) => daysFrom(b.nextDebit) >= 0 && daysFrom(b.nextDebit) <= 30).reduce((s, b) => s + due(b), 0);
  const selItems = byDay[sel] || [];
  return `
  ${topbar()}
  <h1 style="margin-top:10px">Calendar</h1>
  <div class="summary"><div class="stat"><div class="v num">${inr(in30)}</div><div class="k">going out in 30 days</div></div><div class="stat"><div class="v num">${Object.keys(byDay).length}</div><div class="k">debit days</div></div></div>
  <div class="cal">
    ${DOW.map((d) => `<div class="dow">${d[0]}</div>`).join('')}
    ${days
      .map((d) => {
        const has = byDay[d];
        const past = daysFrom(d) < 0;
        const dd = parse(d).getUTCDate();
        return `<button class="d ${has ? 'has' : ''} ${d === sel ? 'sel' : ''} ${d === TODAY ? 'today' : ''}" ${has ? `data-act="cal" data-d="${d}"` : 'tabindex="-1"'} style="${past ? 'opacity:.35' : ''}" aria-label="${fmtDay(d)}${has ? ', ' + has.length + ' debits' : ''}">${dd === 1 ? MONTHS[parse(d).getUTCMonth()] : dd}${has ? '<i class="dot"></i>' : ''}</button>`;
      })
      .join('')}
  </div>
  <div class="day-head"><h3>${sel ? fmtDay(sel) : ''}</h3><span class="muted num">${inr(selItems.reduce((s, b) => s + due(b), 0))}</span></div>
  <div class="rows">${selItems.map((b) => row(b, { due: true })).join('')}</div>`;
}

function viewSaved() {
  const m = savedMonthly();
  const one = savedOneOff();
  const done = visible().filter((b) => state.fixed[b.id]);
  return `
  <div class="topbar"><button data-act="tab" data-tab="home" aria-label="Back">${icon.back}</button><span class="brand">cut<b>my</b>bills</span></div>
  <section class="hero">
    <div class="hero-label">Your fixes save every year</div>
    <div class="hero-amount num ${m ? '' : 'zero'}"><span class="rupee">₹</span>${num(m * 12)}</div>
    <div class="hero-sub">${m ? `<strong class="num">${inr(m)}</strong> a month from ${done.length} fixes${one ? `, plus <strong class="num">${inr(one)}</strong> back once` : ''}. Counted as saved once each one lands.` : 'Your first fix is one swipe away on Home.'}</div>
  </section>
  <div class="section-head"><h2>Saving streak</h2><span class="muted small">${m ? 'Starts this month' : 'Not started'}</span></div>
  <div class="streak">${Array.from({ length: 12 }, (_, i) => `<i class="${m && i === 0 ? 'on' : ''}"></i>`).join('')}</div>
  <p class="small muted" style="margin-top:8px">A month counts when every bill is on its best price.</p>
  ${
    done.length
      ? `<div class="section-head"><h2>What you fixed</h2></div><div class="rows">${done.map((b) => row(b)).join('')}</div>`
      : `<div class="empty"><button class="btn" data-act="tab" data-tab="home">Find my first fix</button></div>`
  }`;
}

function sheetHtml() {
  const b = byId(state.sheet.id);
  const a = b.action;
  const done = state.sheet.step === 'done' || state.fixed[b.id];
  const sources = [b.source, b.source2].filter(Boolean);
  const evidence = `<div class="evidence">${sources.map((s) => `<div class="ev"><b>${s.rail}</b><span>${esc(s.text)}</span></div>`).join('')}</div>`;
  let body, foot;
  if (!a) {
    body = `<div class="sheet-top"><span class="mark">${b.mark}</span><div><h2>${esc(b.provider)}</h2><div class="muted small">${esc(b.title)}</div></div></div>
      <div class="sheet-save num">${inr(b.monthly)}<span>${esc(b.unit)}</span></div>
      <p style="margin:16px 0">This is already the best price we know for how you use it. We check again every month.</p>
      <h3 style="margin-bottom:8px">Found in</h3>${evidence}`;
    foot = `<button class="btn ghost" data-act="close">Close</button>`;
  } else if (done) {
    body = `<div class="done-state"><div class="tick">${icon.check}</div><h2>${esc(a.done)}</h2>
      <p class="muted" style="margin-top:6px">${a.oneOff ? `About ${inr(a.oneOff)} coming back to you.` : `${inr(a.save)} a month added to your savings.`}</p></div>
      <h3 style="margin:18px 0 6px">What happens next</h3><ol class="steps">${a.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
    foot = `<button class="btn" data-act="close">Done</button>`;
  } else {
    body = `<div class="sheet-top"><span class="mark">${b.mark}</span><div><h2>${esc(b.provider)}</h2><div class="muted small">${esc(b.title)}</div></div></div>
      <div class="muted small">${a.oneOff ? 'You get back' : 'You save'}</div>
      <div class="sheet-save num">${a.oneOff ? inr(a.oneOff) + '<span>one time</span>' : inr(a.save) + '<span>a month</span>'}</div>
      <h3 style="margin-top:16px">${esc(a.headline)}</h3>
      <div class="compare"><div><span class="k">Now</span><span class="now">${esc(a.now)}</span></div><div><span class="k">Better</span><span class="better">${esc(a.better)}</span></div></div>
      <h3>Why</h3><ul class="why">${a.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <h3 style="margin-bottom:8px">Found in</h3>${evidence}
      <h3 style="margin:18px 0 4px">What happens</h3><ol class="steps">${a.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="fine">${esc(a.partner)} Confidence: ${a.confidence.toLowerCase()}.</p>`;
    foot = `<button class="btn" data-act="fix" data-id="${b.id}">${esc(a.verb)}${a.save ? ` and save ${inr(a.save)}/mo` : ''}</button>
      <button class="btn ghost" data-act="close">Not now</button>`;
  }
  return `<div class="scrim" id="scrim" data-act="close"></div>
  <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="${esc(b.provider)}">
    <div class="sheet-grab"></div><div class="sheet-body">${body}</div><div class="sheet-foot">${foot}</div>
  </div>`;
}

function tabbar() {
  const t = [['home', 'Home', icon.home], ['bills', 'Bills', icon.bills], ['credit', 'Credit', icon.credit], ['cal', 'Calendar', icon.cal]];
  return `<nav class="tabbar">${t
    .map(([k, l, i]) => `<button class="tab ${state.tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}" aria-current="${state.tab === k}">${i}${l}</button>`)
    .join('')}</nav>`;
}

// ---------- render ----------
const root = document.getElementById('device');
let lastTab = null;

function render() {
  const scroller = root.querySelector('.screen');
  const keep = scroller && lastTab === state.tab ? scroller.scrollTop : 0;
  let html;
  if (state.stage === 'welcome') html = viewWelcome();
  else if (state.stage === 'connect') html = viewConnect();
  else if (state.stage === 'scan') html = viewScan();
  else {
    const v = { home: viewHome, bills: viewBills, credit: viewCredit, cal: viewCal, saved: viewSaved }[state.tab]();
    html = `<main class="screen">${v}</main>${tabbar()}${state.sheet ? sheetHtml() : ''}<div class="toast" id="toast"></div>`;
  }
  root.innerHTML = html;
  const s2 = root.querySelector('.screen');
  if (s2) s2.scrollTop = keep;
  lastTab = state.tab;
  if (state.stage === 'app' && state.tab === 'home') bindSlider();
}

function openSheet(id) {
  state.sheet = { id, step: 'detail' };
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelector('#scrim')?.classList.add('open');
    root.querySelector('#sheet')?.classList.add('open');
    root.querySelector('#sheet .btn')?.focus({ preventScroll: true });
  }));
}

function closeSheet() {
  root.querySelector('#scrim')?.classList.remove('open');
  root.querySelector('#sheet')?.classList.remove('open');
  setTimeout(() => { state.sheet = null; render(); }, reduceMotion ? 0 : 260);
}

function refreshSheet() {
  // Replace sheet content in place so it stays open.
  const tmp = document.createElement('div');
  tmp.innerHTML = sheetHtml();
  const next = tmp.querySelector('#sheet');
  const cur = root.querySelector('#sheet');
  cur.innerHTML = next.innerHTML;
}

function toast(text, sub) {
  const t = root.querySelector('#toast');
  if (!t) return;
  t.innerHTML = `${esc(text)}${sub ? `<span>${esc(sub)}</span>` : ''}`;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

function tween(el, from, to, ms, prefix = '') {
  if (!el) return;
  if (reduceMotion) { el.textContent = prefix + num(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - p) ** 3;
    el.textContent = prefix + num(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- fixing ----------
function fixOne(id) {
  const b = byId(id);
  state.fixed[id] = true;
  state.sheet.step = 'done';
  refreshSheet();
  // Update the screen behind the sheet without closing it.
  const scroller = root.querySelector('.screen');
  const keep = scroller ? scroller.scrollTop : 0;
  const tmp = document.createElement('div');
  tmp.innerHTML = { home: viewHome, bills: viewBills, credit: viewCredit, cal: viewCal, saved: viewSaved }[state.tab]();
  scroller.innerHTML = tmp.innerHTML;
  scroller.scrollTop = keep;
  if (state.tab === 'home') bindSlider();
  const chip = root.querySelector('#saved-chip');
  if (chip) chip.textContent = inr(savedMonthly());
  void b;
}

function fixAll() {
  const items = openFixes();
  const before = saveable();
  const savedBefore = savedMonthly();
  items.forEach((b) => (state.fixed[b.id] = true));
  tween(root.querySelector('#hero-num'), before, 0, 1100);
  tween(root.querySelector('#saved-chip'), savedBefore, savedMonthly(), 1100, '₹');
  setTimeout(() => { render(); toast(`${items.length} fixes started`, `+${inr(savedMonthly() - savedBefore)}/mo`); }, reduceMotion ? 0 : 1300);
}

function bindSlider() {
  const el = root.querySelector('#slider');
  if (!el) return;
  const knob = el.querySelector('#slider-knob');
  const fill = el.querySelector('#slider-fill');
  const label = el.querySelector('#slider-label');
  let startX = 0, x = 0, dragging = false;
  const max = () => el.clientWidth - 64;
  const set = (v) => {
    x = Math.max(0, Math.min(max(), v));
    knob.style.transform = `translateX(${x}px)`;
    fill.style.width = `${x + 64}px`;
    label.style.opacity = String(1 - x / max());
    el.setAttribute('aria-valuenow', String(Math.round((x / max()) * 100)));
  };
  const finish = () => {
    el.classList.add('done');
    knob.style.transition = fill.style.transition = 'all .2s';
    set(max());
    knob.innerHTML = icon.check;
    label.style.opacity = '1';
    label.textContent = 'Fixing everything';
    fixAll();
  };
  knob.addEventListener('pointerdown', (e) => { dragging = true; startX = e.clientX - x; knob.setPointerCapture(e.pointerId); knob.style.transition = fill.style.transition = 'none'; });
  knob.addEventListener('pointermove', (e) => { if (dragging) set(e.clientX - startX); });
  const up = () => {
    if (!dragging) return;
    dragging = false;
    if (x > max() * 0.86) finish();
    else { knob.style.transition = fill.style.transition = 'all .25s'; set(0); }
  };
  knob.addEventListener('pointerup', up);
  knob.addEventListener('pointercancel', up);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); finish(); } });
}

// ---------- scan ----------
function runScan() {
  const rails = Object.keys(state.sources).filter((k) => state.sources[k]);
  const feed = scanFeed.filter((f) => rails.includes(f.rail));
  const feedEl = root.querySelector('#feed');
  const counts = Object.fromEntries(rails.map((r) => [r, 0]));
  const total = reduceMotion ? 1 : 4200;
  const t0 = performance.now();
  rails.forEach((r) => tween(root.querySelector(`#c-${r}`), 0, scanTotals[r].read, total));
  feed.forEach((f, i) => {
    setTimeout(() => {
      counts[f.rail]++;
      const fe = root.querySelector(`#f-${f.rail}`);
      if (fe) fe.textContent = `${counts[f.rail]} found`;
      const item = document.createElement('div');
      item.className = 'feed-item';
      item.innerHTML = `<b>${f.rail}</b><span>${esc(f.text)}</span>`;
      feedEl.prepend(item);
      while (feedEl.children.length > 6) feedEl.lastChild.remove();
    }, reduceMotion ? 0 : (i / feed.length) * total);
  });
  setTimeout(() => {
    const n = visible().length;
    const hits = Object.values(counts).reduce((s, c) => s + c, 0);
    root.querySelector('#scan-title').textContent = `Found ${n} bills`;
    root.querySelector('#scan-result').innerHTML = `
      <div class="scan-result">
        ${hits > n ? `<p class="small muted" style="margin-bottom:18px">${hits} matches across your sources, merged into ${n} bills so nothing is counted twice.</p>` : ''}
        <div class="hero-label">You can save every month</div>
        <div class="hero-amount num"><span class="rupee">₹</span><span id="scan-amt">0</span></div>
        <button class="btn" style="margin-top:18px" data-act="go-app">Show me how</button>
      </div>`;
    root.querySelector('#feed').style.display = 'none';
    tween(root.querySelector('#scan-amt'), 0, saveable(), 900);
    root.querySelector('[data-act="go-app"]').focus({ preventScroll: true });
  }, reduceMotion ? 50 : total + 400);
  void t0;
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || !root.contains(t)) return;
  const act = t.dataset.act;
  if (act === 'go-welcome') { state.stage = 'welcome'; render(); }
  else if (act === 'go-connect') { state.stage = 'connect'; render(); }
  else if (act === 'toggle-src') { state.sources[t.dataset.src] = !state.sources[t.dataset.src]; render(); }
  else if (act === 'go-scan') { state.stage = 'scan'; render(); runScan(); }
  else if (act === 'go-app') { state.stage = 'app'; state.tab = 'home'; render(); }
  else if (act === 'tab') { state.tab = t.dataset.tab; state.sheet = null; render(); root.querySelector('.screen').scrollTop = 0; }
  else if (act === 'filter') { state.filter = t.dataset.f; render(); }
  else if (act === 'open') openSheet(t.dataset.id);
  else if (act === 'close') closeSheet();
  else if (act === 'fix') fixOne(t.dataset.id);
  else if (act === 'cal') { state.calSel = t.dataset.d; render(); }
  else if (act === 'connect-cibil') { state.sources.CIBIL = true; render(); }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.sheet) closeSheet(); });

render();
