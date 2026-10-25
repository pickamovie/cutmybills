# CutMyBills

Same life, lower bills. CutMyBills reads a household's bills from three sources — Gmail receipts, transaction SMS and the CIBIL report — finds the cheaper way to get the same thing, and makes the switch, refinance or cancellation one tap away.

This repo currently holds the **clickable prototype**: every screen of the MVP running on a sample Pune household, for user testing and investor demos. No backend yet; all data is in `src/data.js` and prices are illustrative.

## Run it

No install and no build step needed.

```sh
# any static server works; ES modules don't load from file://
python3 -m http.server 8000
# open http://localhost:8000
```

For a single self-contained file (to share or host anywhere):

```sh
node scripts/bundle.mjs   # writes dist/index.html, which also opens from file://
```

## What's in the prototype

| Screen | What it shows |
| --- | --- |
| Welcome | The promise, with three real examples of overpaying |
| Connect | Gmail, SMS and CIBIL as separate toggles, each with its privacy promise |
| Scan | Detections streaming in per source, then merged into one bill list |
| Home | One number (what you can save a month), slide to fix everything, biggest fixes, this week's debits |
| Bill sheet | Now vs better, why, the exact email or SMS it was found in, what happens, partner disclosure |
| Bills | Every bill by category, with its payment rail and one action |
| Credit | CIBIL score, card use, loans and cards with refinance and balance-transfer fixes |
| Calendar | What actually leaves the account on each day in the next 30 |
| Saved | Yearly saving from fixes, streak, everything fixed |

## Structure

```
index.html          app shell, fonts
src/styles.css      design tokens and all styles
src/data.js         sample household: bills, actions, credit report, scan feed
src/app.js          state, views, slide-to-fix, sheet, scan animation
scripts/bundle.mjs  inlines everything into dist/index.html
```

## Design rules

- **Gold means money you save. Coral means money you are overpaying.** No other colour carries meaning.
- One number on Home. Everything else is a layer below.
- Every bill row has exactly one verb: Switch, Stop, Pause, Refinance, Port, Claim, or Best price.
- Every recommendation shows its source email or SMS, its confidence, and what any partner pays us.
- Nothing is counted as saved until it lands; requested fixes say so.
- Type: Bricolage Grotesque for numbers and headings, Figtree for text. Respects reduced motion.

## Next

1. Real Gmail scan: OAuth read-only, bill extraction with an LLM, start Google's restricted-scope verification now (4–8 weeks).
2. Android SMS reader with on-device parsing; Play Store READ_SMS declaration.
3. CIBIL report parsing from the free annual report, then a bureau API partner.
4. Price database for mobile and broadband plans, refreshed on a schedule.
