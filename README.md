# You know Thailand a little go?

A daily, mobile-friendly number-estimation game about Thailand's statistics. Every day you get 5 numeric questions, 30 seconds each. The closer your estimate, the higher your score (100 per question, 500 max). After each question you see how other players answered, and a summary page closes the day.

The UI is in Thai. Questions are in [data/questions-v1.json](data/questions-v1.json).

## Run it

It's a static site with no build step, but it loads the questions with `fetch`, so it needs a server (opening `index.html` directly won't work):

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

Handy URL/dev tricks:

- `?date=2026-10-18` previews another day's questions.
- Progress is stored in `localStorage` under `yktlg:v1:*`. Clear it to replay a day.
- After finishing, "เล่นชุดใหม่ทันที" starts an extra set without waiting for tomorrow.

## How it works

| Screen | What it does |
| --- | --- |
| Cover | Date, players today, how to play |
| Question | 30 s timer, numeric input with live thousands separators |
| Reveal | Histogram of other players' answers, green "good guess" zone, answer line, your guess |
| Summary | Total score, score histogram, shareable result, all answers, play another set |

**Daily selection:** the date (Asia/Bangkok) seeds an RNG, so everyone gets the same 5 questions. It tries thousands of random sets and keeps the one with the least tag overlap between questions.

**Scoring:** per question, `100 * exp(-error)`.
- *log* questions (counts, money, big numbers): error is orders of magnitude off, scale 0.25.
- *linear* questions (percentages, "per 100", years): error is absolute distance over a scale (12 for percentages, 10 for years, 3 for small percentages, 0.1 for ratios).
- A question can override this with optional `kind` / `scale` fields in the JSON.

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

## Adding questions

Append to [data/questions-v1.json](data/questions-v1.json) only. A question's id is its array index, and the daily selection depends on it, so reordering or deleting entries changes past days' sets. Fields: `question`, `answer`, `unit`, `decimal_places`, `tags`.
