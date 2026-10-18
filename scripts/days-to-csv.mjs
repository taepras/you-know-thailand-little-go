#!/usr/bin/env node
// Flattens data/days.json into a CSV of questions (one row per question, in day order, no date column).
//
//   node scripts/days-to-csv.mjs [out.csv]      (default: data/days.csv)
//
// Columns: id, question, answer, unit, decimal_places, tags (joined with ";").
// Written with a UTF-8 BOM so Excel opens the Thai text correctly.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.resolve(process.argv[2] || path.join(root, 'data/days.csv'));
const days = JSON.parse(fs.readFileSync(path.join(root, 'data/days.json'), 'utf8'));

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const header = ['id', 'question', 'answer', 'unit', 'decimal_places', 'tags'];
const rows = Object.keys(days).sort().flatMap((date) => days[date]).map((q) =>
  [q.id, q.question, q.answer, q.unit, q.decimal_places, (q.tags || []).join(';')].map(cell).join(','));

fs.writeFileSync(outPath, `﻿${[header.join(','), ...rows].join('\n')}\n`);
console.log(`wrote ${rows.length} rows to ${path.relative(process.cwd(), outPath)}`);
