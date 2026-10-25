# CutMyBills

Same life, lower bills. CutMyBills reads a household's bills from three sources (Gmail receipts, bank and operator SMS, and the CIBIL report), merges them into one list, and finds the cheaper way to get the same thing: a smaller plan, a lower rate, a duplicate to drop, money owed back.

This repo has two parts:

| Folder | What it is |
| --- | --- |
| `app/` | **The working web app.** Node server, SQLite, test users, a real scan pipeline over generated test data, live progress and fix tracking. |
| `prototype/` | The first clickable design prototype (static, no backend). Kept for reference. |

## Run the web app

Needs Node 22.5 or newer. Nothing to install.

```sh
cd app
npm start            # http://localhost:3000
npm test             # pipeline tests
```

On first start it creates `app/data/cutmybills.db` and seeds four test households. Every test account uses the password `test1234`.

| Test household | What the scan should find |
| --- | --- |
| Kavya Deshmukh, Pune | 300 Mbps used at 62, a card revolving at 42%, an unused gym, two cloud plans, four streaming apps, SBI and Bajaj loans above today's rates, 80D not claimed |
| Arjun Rao, Bengaluru | Gigabit fibre peaking at 140 Mbps, oversized postpaid, two food memberships; card paid in full (no fix) |
| Ravi Kumar, Delhi | 36 units over Delhi's free 200, a 22% loan, two design tools, ₹2.1 lakh of EPF left with an old employer |
| Meera Iyer, Chennai | Senior health cover priced well above comparable plans, a DTH bill in a format the rules cannot read |

"Create a new test household" on the sign-in screen generates a random one.

### Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | 3000 | Server port |
| `DB_PATH` | `app/data/cutmybills.db` | SQLite file |
| `SCAN_PACE_MS` | 90 | Delay per message so the live scan is watchable; 0 for instant |
| `FIX_CONFIRM_MS` | 25000 | How long before a requested fix is marked confirmed (stands in for the provider replying) |
| `ANTHROPIC_API_KEY` | unset | When set, bills the rules cannot read are sent to the Claude API after names, numbers and IDs are removed |
| `CMB_MODEL` | `claude-haiku-5-5` | Model used for that extraction |

## How it works

```
raw messages (items table)
  -> lib/parse.mjs      one detection per message: rules for Indian providers and bank SMS formats
  -> lib/llm.mjs        optional Claude extraction for unknown formats, after lib/redact.mjs
  -> lib/reconcile.mjs  merges detections into bills (an invoice email + its AutoPay SMS + the CIBIL account)
  -> lib/recommend.mjs  rules against lib/catalog.mjs produce fixes with a monthly saving or one-time amount
  -> SQLite             bills, fixes and their status history
```

- `lib/seed.mjs` renders each test household as realistic raw text: invoices, renewal notices, UPI AutoPay and card e-mandate SMS, operator usage SMS, EMI debits, a CIBIL report, plus noise (OTPs, newsletters, delivery updates).
- Fixes move from open to requested to confirmed. Confirmations arrive in the browser live over Server-Sent Events.
- The Test data screen (tap your initials) shows every raw message and what the scan made of it.

**Prices and rates in `lib/catalog.mjs` are illustrative test values, not live prices.**

### API

| Method and path | Purpose |
| --- | --- |
| `GET /api/test-accounts` | Seeded test accounts for the sign-in screen |
| `POST /api/login`, `POST /api/logout` | Session cookie |
| `POST /api/test-users` | Create and sign in to a random test household |
| `GET /api/state` | Bills, fixes, credit profile, review items, last scan |
| `POST /api/scan` | Start a scan with `{ "sources": ["Gmail", "SMS", "CIBIL"] }` |
| `GET /api/events` | Live stream: `scan:start`, `scan:item`, `scan:done`, `rec` |
| `POST /api/recs/:key/fix` (or `dismiss`, `reopen`) | Change a fix's status |
| `GET /api/items` | Raw test messages with their parse status |
| `POST /api/reset` | Regenerate this household's messages dated from today |

## Design

- Gold means money you can save; coral means money you are overpaying. No other colour carries meaning.
- One number on Home, rolling into place, with a bar showing how much of the monthly outflow can go.
- Primary actions are hard-edged buttons that press in, inspired by CRED's NeoPOP; everything else is soft and quiet.
- Every fix shows the exact email, SMS or report line it came from, its confidence and any partner fee.
- Nothing counts as saved until it is confirmed.
- Phone first; on desktop it becomes a sidebar app with fixes opening in a side drawer.

## Next

1. Real Gmail scan with OAuth in testing mode (up to 100 test users without Google verification).
2. Android SMS reader with on-device parsing.
3. CIBIL report PDF upload and parsing.
4. A maintained price database in place of `catalog.mjs`.
