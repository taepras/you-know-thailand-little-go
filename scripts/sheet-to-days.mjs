#!/usr/bin/env node
// Rebuilds data/days.json from checked rows in the Thailand questions Google Sheet.
//
//   node scripts/sheet-to-days.mjs [--start YYYY-MM-DD] [--csv PATH] [--tag-mode avoid|balanced|shared] [--out PATH]
//
// --csv accepts a downloaded CSV export for offline runs; otherwise the sheet is fetched.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashString, mulberry32, pickDailyQuestions, QUESTIONS_PER_DAY } from '../js/game.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bankPath = path.join(root, 'data/questions-v1.json');
const outPath = path.join(root, 'data/days.json');
const sheetUrl = 'https://docs.google.com/spreadsheets/d/1hiuFoonVwOIFRuifnmFIbEZoCa-KlDf7qFPxxEPgO7c/export?format=csv&gid=747488169';
const defaultStart = '2026-10-17';

function options(args) {
  const result = { start: defaultStart, csvPath: null, tagMode: 'avoid', outputPath: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('usage: node scripts/sheet-to-days.mjs [--start YYYY-MM-DD] [--csv PATH] [--tag-mode avoid|balanced|shared] [--out PATH]');
      process.exit(0);
    }
    if (['--start', '--csv', '--tag-mode', '--out'].includes(args[i])) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${args[i - 1]}`);
      if (args[i - 1] === '--start') result.start = value;
      else if (args[i - 1] === '--csv') result.csvPath = path.resolve(value);
      else if (args[i - 1] === '--tag-mode') result.tagMode = value;
      else result.outputPath = path.resolve(value);
      continue;
    }
    throw new Error(`Unknown option: ${args[i]}`);
  }
  if (!isDateKey(result.start)) throw new Error(`Invalid start date: ${result.start}`);
  if (!['avoid', 'balanced', 'shared'].includes(result.tagMode)) {
    throw new Error(`Invalid tag mode "${result.tagMode}"; use "avoid", "balanced", or "shared"`);
  }
  result.outputPath ||= path.join(root, {
    avoid: 'data/days.json',
    balanced: 'data/days-balanced.json',
    shared: 'data/days-grouped.json',
  }[result.tagMode]);
  return result;
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function questionsFromCsv(text, bank) {
  const [header, ...rows] = parseCsv(text);
  const required = [
    'status', 'question', 'time', 'answer', 'unit', 'decimal_places',
    'tags', 'reference', 'reference link',
  ];
  const columns = new Map(header.map((name, index) => [name.trim().toLowerCase(), index]));
  const missing = required.filter((name) => !columns.has(name));
  if (missing.length) throw new Error(`Sheet CSV is missing columns: ${missing.join(', ')}`);

  const value = (cells, name) => (cells[columns.get(name)] ?? '').trim();
  const bankIds = new Map(bank.map((question, index) => [question.question, `q${index}`]));
  const questions = [];

  rows.forEach((cells, index) => {
    if (value(cells, 'status').toLowerCase() !== 'checked') return;
    const sheetRow = index + 2;
    const base = value(cells, 'question');
    const time = value(cells, 'time');
    if (!base) throw new Error(`Checked row ${sheetRow} has no question`);
    const bankQuestion = time
      ? `${base.endsWith('?') ? base.slice(0, -1) : base} ${time}${base.endsWith('?') ? '?' : ''}`
      : base;
    const rawAnswer = value(cells, 'answer');
    const answer = Number(rawAnswer);
    const rawDecimalPlaces = value(cells, 'decimal_places');
    const decimalPlaces = rawDecimalPlaces ? Number(rawDecimalPlaces) : 0;
    if (!rawAnswer || !Number.isFinite(answer)) {
      throw new Error(`Checked row ${sheetRow} has an invalid answer`);
    }
    if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0) {
      throw new Error(`Checked row ${sheetRow} has invalid decimal_places`);
    }

    questions.push({
      question: base,
      time,
      answer,
      unit: value(cells, 'unit'),
      decimal_places: decimalPlaces,
      tags: value(cells, 'tags').split(';').map((tag) => tag.trim()).filter(Boolean),
      id: bankIds.get(bankQuestion) || `sheet-row-${sheetRow}`,
      reference: value(cells, 'reference'),
      reference_link: value(cells, 'reference link'),
    });
  });

  if (questions.length < QUESTIONS_PER_DAY || questions.length % QUESTIONS_PER_DAY !== 0) {
    throw new Error(`Found ${questions.length} checked rows; the count must be a multiple of ${QUESTIONS_PER_DAY}`);
  }
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error('Checked rows produced duplicate question IDs');
  }
  return questions;
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function overlapCost(questions) {
  let cost = 0;
  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      cost += questions[i].tags.filter((tag) => questions[j].tags.includes(tag)).length;
    }
  }
  return cost;
}

function pickSharedQuestions(pool, date) {
  const rng = mulberry32(hashString(`yktlg:shared:${date}`));
  let bestSet = null;
  let bestCost = -1;

  for (let attempt = 0; attempt < 80; attempt++) {
    const remaining = [...pool];
    const set = [remaining.splice(Math.floor(rng() * remaining.length), 1)[0]];

    while (set.length < QUESTIONS_PER_DAY) {
      let bestCandidates = [];
      let bestIncrement = -1;
      for (const candidate of remaining) {
        const increment = set.reduce((sum, question) =>
          sum + question.tags.filter((tag) => candidate.tags.includes(tag)).length, 0);
        if (increment > bestIncrement) {
          bestIncrement = increment;
          bestCandidates = [candidate];
        } else if (increment === bestIncrement) {
          bestCandidates.push(candidate);
        }
      }
      const next = bestCandidates[Math.floor(rng() * bestCandidates.length)];
      set.push(next);
      remaining.splice(remaining.indexOf(next), 1);
    }

    const cost = overlapCost(set);
    if (cost > bestCost) {
      bestSet = set;
      bestCost = cost;
    }
  }
  return bestSet;
}

function makeBalancedSchedule(questions, start) {
  let bestGroups = [];
  for (let attempt = 0; attempt < 5_000; attempt++) {
    const rng = mulberry32(hashString(`yktlg:balanced:${start}:${attempt}`));
    const remaining = [...questions];
    const groups = [];

    while (remaining.length >= QUESTIONS_PER_DAY) {
      const counts = new Map();
      for (const question of remaining) {
        for (const tag of question.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
      const eligibleTags = [...counts]
        .filter(([, count]) => count >= QUESTIONS_PER_DAY)
        .sort((a, b) => a[1] - b[1]);
      if (!eligibleTags.length) break;

      const leastCommon = eligibleTags[0][1];
      const themeOptions = eligibleTags.filter(([, count]) => count === leastCommon);
      const theme = themeOptions[Math.floor(rng() * themeOptions.length)][0];
      const candidates = remaining.filter((question) => question.tags.includes(theme))
        .map((question) => ({
          question,
          options: question.tags.filter((tag) => (counts.get(tag) || 0) >= QUESTIONS_PER_DAY).length,
          tieBreak: rng(),
        }))
        .sort((a, b) => a.options - b.options || a.tieBreak - b.tieBreak)
        .slice(0, QUESTIONS_PER_DAY)
        .map(({ question }) => question);

      groups.push({ theme, questions: candidates });
      const selected = new Set(candidates);
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (selected.has(remaining[i])) remaining.splice(i, 1);
      }
    }

    if (groups.length > bestGroups.length) bestGroups = groups;
    if (bestGroups.length * QUESTIONS_PER_DAY === questions.length) break;
  }

  if (!bestGroups.length) throw new Error('Could not create any balanced theme days');
  const days = {};
  let cost = 0;
  bestGroups.forEach((group, index) => {
    if (!group.questions.every((question) => question.tags.includes(group.theme))) {
      throw new Error(`Generated a question without its day theme (${group.theme})`);
    }
    days[addDays(start, index)] = group;
    cost += overlapCost(group.questions);
  });
  const scheduled = bestGroups.length * QUESTIONS_PER_DAY;
  const scheduledIds = new Set(bestGroups.flatMap((group) => group.questions.map((question) => question.id)));
  return {
    days,
    overlapCost: cost,
    excludedCount: questions.length - scheduled,
    scheduledCount: scheduled,
    excludedQuestions: questions.filter((question) => !scheduledIds.has(question.id)),
  };
}

function makeSchedule(questions, start, tagMode) {
  if (tagMode === 'balanced') return makeBalancedSchedule(questions, start);

  const used = new Set();
  const days = {};
  let cost = 0;

  for (let offset = 0; offset < questions.length / QUESTIONS_PER_DAY; offset++) {
    const date = addDays(start, offset);
    const pool = questions.filter((question) => !used.has(question.id));
    const set = tagMode === 'shared'
      ? pickSharedQuestions(pool, date)
      : pickDailyQuestions(pool, date);
    for (const question of set) used.add(question.id);
    cost += overlapCost(set);
    days[date] = set;
  }
  return { days, overlapCost: cost, excludedCount: 0, scheduledCount: questions.length, excludedQuestions: [] };
}

async function readSheetCsv(csvPath) {
  if (csvPath) return fs.readFileSync(csvPath, 'utf8');
  const response = await fetch(sheetUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Sheet export failed: HTTP ${response.status} ${response.statusText}`);
  return response.text();
}

function writeDays(days, outputPath) {
  const body = Object.entries(days).map(([date, day]) => {
    if (!Array.isArray(day)) {
      return `  ${JSON.stringify(date)}: ${JSON.stringify(day, null, 2).split('\n').join('\n  ')}`;
    }
    return `  ${JSON.stringify(date)}: [\n${day.map((question) => `    ${JSON.stringify(question)}`).join(',\n')}\n  ]`;
  }).join(',\n');
  fs.writeFileSync(outputPath, `{\n${body}\n}\n`);
}

async function main() {
  const { start, csvPath, tagMode, outputPath } = options(process.argv.slice(2));
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
  const csv = await readSheetCsv(csvPath);
  const questions = questionsFromCsv(csv, bank);
  const { days, overlapCost: cost, excludedCount, scheduledCount, excludedQuestions } =
    makeSchedule(questions, start, tagMode);
  writeDays(days, outputPath);
  const dates = Object.keys(days);
  console.log(
    `${path.relative(root, outputPath)}: ${dates.length} days, `
    + `${scheduledCount}/${questions.length} checked questions, ${dates[0]} → ${dates.at(-1)} `
    + `(tag overlap ${cost}, mode ${tagMode}`
    + (excludedCount ? `, excluded ${excludedCount}` : '') + ')',
  );
  for (const question of excludedQuestions) {
    console.log(`excluded ${question.id}: ${question.question}`);
  }
}

main().catch((error) => {
  console.error(`sheet-to-days: ${error.message}`);
  process.exitCode = 1;
});
