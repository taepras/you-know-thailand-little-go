# You know Thailand a little go?

A daily, mobile-friendly number-estimation game about Thailand's statistics. Every day you get 5 numeric questions, 30 seconds each. The closer your estimate, the higher your score (100 per question, 500 max); scores now fall more gradually as guesses get farther from the answer. After each question you see how other players answered, and a summary page closes the day.

The UI is in Thai. Questions are in [data/questions-v1.json](data/questions-v1.json).

## Run it

It's a static site with no build step, but it loads the questions with `fetch`, so it needs a server (opening `index.html` directly won't work):

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

Handy URL/dev tricks:

- `?date=2026-10-18` previews another day's questions.
- `?debug=1` reveals a button on the cover to clear saved game data and restart.
- `?mode=random`, `?mode=grouped`, or `?mode=balanced` loads that schedule variant; grouped and balanced modes show the day's theme on the cover.
- Grouped and balanced result pages show tomorrow's theme and label the extra-set button with the theme of the set it starts.
- Progress is stored in `localStorage` under `yktlg:v1:*`. Clear it to replay a day.
- After finishing, "เล่นชุดใหม่ทันที" starts an extra set without waiting for tomorrow.

## How it works

| Screen | What it does |
| --- | --- |
| Cover | Date, players today, how to play |
| Question | 30 s timer, numeric input with live thousands separators |
| Reveal | Histogram of other players' answers, green "good guess" zone, answer line, your guess |
| Summary | Total score, score histogram, shareable result, all answers, play another set |

**Daily selection:** the selected schedule file is used for today's date when available. Dates without a scheduled set and extra sets are picked deterministically from the checked-question pool in [data/days-random.json](data/days-random.json), never from the full question bank. Grouped and balanced modes use their themed schedules; their extra sets are also picked only from checked questions.

**Scoring:** per question, `100 * exp(-distance / (base scale * 1.5))`; the 1.5 multiplier makes scores fall more gradually with error. *Log* questions (counts, money, big numbers) use orders of magnitude for distance; *linear* questions (percentages, "per 100", years) use absolute distance. A question can override the scoring type and base scale with optional `kind` / `scale` fields in the JSON.

## Project layout

```
index.html        markup for all four screens
css/style.css     styling (light/dark, responsive)
js/game.js        pure logic: RNG, question picking, scoring, formatting
js/data.js        data layer (currently a seeded mock backend)
js/charts.js      SVG histograms
js/app.js         UI state machine and persistence
data/             question bank
```

## Connecting a real backend (e.g. Firestore)

All "other players" data goes through four methods in [js/data.js](js/data.js):

```
getPlayerCount(setKey)              -> Promise<number>
getCrowdAnswers(setKey, question)   -> Promise<number[]>
getScoreDistribution(setKey, qs)    -> Promise<number[]>
submitResult(setKey, result)        -> Promise<void>   // { guesses, scores, total }
```

The current implementation is a mock that generates plausible seeded data. Write a Firestore version with the same four methods and change `export const backend = mock`. `setKey` is the date (`YYYY-MM-DD`), or `YYYY-MM-DD#N` for extra sets played the same day, so you may want to keep extra sets out of the daily stats.

## Curating days

`data/days.json` maps each date to its 5 questions (stored in full, one per line), so you can edit, swap or reorder any day by hand.
Curated questions retain their `reference` and `reference_link` source metadata when available; the current schedule uses only spreadsheet rows marked `checked`.

To rebuild the schedule from the Thailand questions Google Sheet:

```bash
node scripts/sheet-to-days.mjs
```

This replaces `data/days.json`, assigning every checked question once to five-question days starting on 2026-10-17. The sheet row order and date-seeded picker make the output deterministic for the same input. The sheet's `time` column is stored separately from `question` in each JSON entry and displayed with the question in the game.
In the game, `time` appears as an eyebrow above the question; references appear on each answer reveal and as source links in the final answer review.
All modes use the checked-question schedule as the allowlist for fallback and extra sets. To refresh that pool after changing row statuses in the sheet, run `node scripts/sheet-to-days.mjs --out data/days-random.json`.

Use `--tag-mode balanced` to give each day a shared theme tag present on all five questions, or `--tag-mode shared` to strongly group questions with shared tags. Without `--out`, each mode writes to its own file: `avoid` to `data/days.json`, `balanced` to `data/days-balanced.json`, and `shared` to `data/days-grouped.json`. `--out PATH` overrides the destination. For example, generate the shared-tag variant:

```bash
node scripts/sheet-to-days.mjs --tag-mode shared --out data/days-grouped.json
```

The default `--tag-mode avoid` preserves the tag-avoiding schedule. Use `--start YYYY-MM-DD` to choose another first date, or `--csv PATH` to use a downloaded CSV export instead of fetching the sheet.

Generate the themed variant with:

```bash
node scripts/sheet-to-days.mjs --tag-mode balanced --out data/days-balanced.json
```

Balanced mode writes each date as an object with a `theme` tag and a `questions` array. All five questions in that day include the theme tag. The current sheet's checked rows cannot all be partitioned into five-question theme groups, so the generator deterministically selects the largest complete schedule and reports excluded questions.

```bash
node scripts/generate-days.mjs --start 2026-10-17 --days 90
```

The script fills in days with the same tag-avoiding picker, without reusing a question across days. Re-running keeps days already in the file (your edits are safe) and only appends new dates; add `--force` to regenerate the dates in range. These generated days are separate from the checked-only random mode schedule.

## Adding questions

Append to [data/questions-v1.json](data/questions-v1.json) only. A question's id is its array index, and the daily selection depends on it, so reordering or deleting entries changes past days' sets. Fields: `question`, `answer`, `unit`, `decimal_places`, `tags`.
