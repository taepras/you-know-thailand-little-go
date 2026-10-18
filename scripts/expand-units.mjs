#!/usr/bin/env node
// Rewrites questions whose unit starts with a Thai magnitude word into plain units:
//   101.67 "ล้านไร่"  ->  101,670,000 "ไร่"   (and "...กี่ล้านไร่?" -> "...กี่ไร่?")
//
//   node scripts/expand-units.mjs
//
// Applies to data/questions-v1.json and data/days.json (which holds copies of the questions).
// Idempotent: converted questions no longer match, so re-running changes nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bankPath = path.join(root, 'data/questions-v1.json');
const daysPath = path.join(root, 'data/days.json');

// longest first so ล้านล้าน isn't read as ล้าน
const MULTIPLIERS = [
  ['ล้านล้าน', 1e12],
  ['ล้าน', 1e6],
  ['แสน', 1e5],
  ['หมื่น', 1e4],
  ['พัน', 1e3],
];

let converted = 0;
function expand(q) {
  const hit = MULTIPLIERS.find(([word]) => q.unit.startsWith(word));
  if (!hit) return q;
  const [word, mult] = hit;
  const newUnit = q.unit.slice(word.length);
  if (!newUnit) return q;
  if (!q.question.includes(q.unit)) console.warn(`unit "${q.unit}" not found in text: ${q.question}`);
  converted++;
  return {
    ...q,
    question: q.question.replace(q.unit, newUnit),
    answer: Math.round(Number((q.answer * mult).toPrecision(15))),
    unit: newUnit,
    decimal_places: 0,
  };
}

// questions-v1.json
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
fs.writeFileSync(bankPath, `${JSON.stringify(bank.map(expand), null, 2)}\n`);
const bankCount = converted;

// days.json (same layout generate-days.mjs writes: one question per line)
if (fs.existsSync(daysPath)) {
  const days = JSON.parse(fs.readFileSync(daysPath, 'utf8'));
  const body = Object.keys(days).sort().map((date) =>
    `  ${JSON.stringify(date)}: [\n${days[date].map((q) => `    ${JSON.stringify(expand(q))}`).join(',\n')}\n  ]`).join(',\n');
  fs.writeFileSync(daysPath, `{\n${body}\n}\n`);
}
console.log(`converted ${bankCount} questions in questions-v1.json, ${converted - bankCount} entries in days.json`);
