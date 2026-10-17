# CLAUDE.md

Daily number-estimation game about Thailand's stats. Vanilla HTML/CSS/ES modules, no build step, no dependencies. See [README.md](README.md) for the overview.

## Run / check

- Serve with `python3 -m http.server 8000` (the game `fetch`es `data/questions-v1.json`, so `file://` won't work).
- No test suite. Syntax check with `node --check js/*.js`. `js/game.js` is pure (no DOM), so it can be imported in node to test scoring and question selection.
- `?date=YYYY-MM-DD` previews another day. State lives in `localStorage` (`yktlg:v1:*`).

## Architecture

- `js/game.js`: pure logic (seeded RNG, daily pick, scoring, formatting). Keep it DOM-free.
- `js/data.js`: all "other players" data behind four methods (`getPlayerCount`, `getCrowdAnswers`, `getScoreDistribution`, `submitResult`). Currently a seeded mock; the plan is a Firestore backend with the same interface, swapped via `export const backend`. Don't call data sources from elsewhere.
- `js/charts.js`: SVG string builders. Bars animate by adding the `in` class after insertion.
- `js/app.js`: screen state machine (cover, question, reveal, summary). Phases persisted in state: `cover | q | reveal | done`. Extra sets use `setKey = date#N`; `dateKey` is for display only.

## Conventions and gotchas

- UI copy is Thai. Keep new strings Thai.
- Question ids are array indexes in `data/questions-v1.json`: **only append**, never reorder or delete, or past days change.
- The date is Asia/Bangkok time, not the browser's.
- Timer is wall-clock based (`state.qStart`), so refreshing mid-question doesn't reset it.
- Mobile first, but desktop is a full-width layout with a 640px content column (`--gutter` in CSS), not a phone frame.
- Colors and theme come from CSS variables in `:root` (with a dark-mode override); don't hardcode colors.
