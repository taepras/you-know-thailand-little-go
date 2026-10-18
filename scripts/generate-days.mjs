#!/usr/bin/env node
// Builds data/days.json: a day-by-day list of question sets, so each day can be hand-curated.
//
//   node scripts/generate-days.mjs [--start YYYY-MM-DD] [--days 90] [--force]
//
// - Sets come from the same tag-avoiding picker the game uses, but a question is never reused
//   across generated days until the bank runs out.
// - Days already in the file are left untouched (so your hand edits survive); --force regenerates
//   them. New days are appended after the existing ones.
// - Each question is stored in full (with its id), so curating a day = editing its 5 entries.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withIds, pickDailyQuestions, bangkokDateKey, QUESTIONS_PER_DAY } from '../js/game.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bankPath = path.join(root, 'data/questions-v1.json');
const outPath = path.join(root, 'data/days.json');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const force = args.includes('--force');
const count = parseInt(opt('days', '90'), 10);
let start = opt('start', bangkokDateKey());
if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(count > 0)) {
  console.error('usage: generate-days.mjs [--start YYYY-MM-DD] [--days N] [--force]');
  process.exit(1);
}

const bank = withIds(JSON.parse(fs.readFileSync(bankPath, 'utf8')));
const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};

const addDays = (key, n) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const days = { ...existing };
const dates = Array.from({ length: count }, (_, i) => addDays(start, i));
if (force) dates.forEach((d) => delete days[d]);

// questions already scheduled (kept days) shouldn't be repeated by new days
const used = new Set(Object.values(days).flat().map((q) => q.id));
let added = 0;
for (const date of dates) {
  if (days[date]) continue;
  let pool = bank.filter((q) => !used.has(q.id));
  if (pool.length < QUESTIONS_PER_DAY) { used.clear(); pool = bank; } // bank exhausted: start over
  const set = pickDailyQuestions(pool, date);
  set.forEach((q) => used.add(q.id));
  days[date] = set;
  added++;
}

const sorted = Object.keys(days).sort();
const body = sorted.map((date) =>
  `  ${JSON.stringify(date)}: [\n${days[date].map((q) => `    ${JSON.stringify(q)}`).join(',\n')}\n  ]`).join(',\n');
fs.writeFileSync(outPath, `{\n${body}\n}\n`);
console.log(`days.json: ${sorted.length} days (${added} new), ${sorted[0]} → ${sorted[sorted.length - 1]}`);
