import {
  QUESTIONS_PER_DAY, SECONDS_PER_QUESTION, MAX_SCORE_PER_QUESTION, hashString, mulberry32,
  pickDailyQuestions, bangkokDateKey, formatThaiDate, msUntilNextBangkokMidnight,
  scoreFor, scoreTier, rankTitle, allowsNegative, fmtNum, sanitizeInput, groupDigits, parseGuess, kindOf,
} from './game.js';
import { backend } from './data.js';
import { revealChart, scoreChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const referenceLink = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};
const MAX_TOTAL = QUESTIONS_PER_DAY * MAX_SCORE_PER_QUESTION;
const TIER_EMOJI = { great: '🟩', good: '🟨', meh: '🟧', bad: '🟥' };

// ?date=YYYY-MM-DD lets you preview another day's puzzle (handy while testing)
const params = new URLSearchParams(location.search);
const dateParam = params.get('date');
const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') ? dateParam : bangkokDateKey();
const requestedMode = params.get('mode');
const mode = requestedMode === 'grouped' || requestedMode === 'balanced' ? requestedMode : 'random';
const dayFileByMode = {
  random: 'data/days-random.json',
  grouped: 'data/days-grouped.json',
  balanced: 'data/days-balanced.json',
};
const modeStorageSuffix = mode === 'random' ? '' : `:${mode}`;
const roundKey = `yktlg:v1:round:${dateKey}${modeStorageSuffix}`;
let checkedQuestions = [];
let curatedDays = {};
let dayThemes = {};
let round = 0; // 0 = the daily set; 1+ = extra sets played the same day
let setKey = dateKey; // seeds question selection and keys the backend data
let storageKey = `yktlg:v1:${dateKey}${modeStorageSuffix}`;

let questions = [];
let state = { phase: 'cover', answers: [], qStart: null }; // phase: cover | q | reveal | done
let timerRaf = 0;
let countdownId = 0;

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function themeFromQuestions(dayQuestions) {
  const counts = new Map();
  for (const question of dayQuestions) {
    for (const tag of new Set(question.tags || [])) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function makeExtraSet(n) {
  const extraSetKey = `${mode === 'random' ? dateKey : `${dateKey}:${mode}`}#${n}`;
  if (mode === 'random') return { questions: pickDailyQuestions(checkedQuestions, extraSetKey), theme: '' };

  const counts = new Map();
  for (const question of checkedQuestions) {
    for (const tag of new Set(question.tags || [])) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const themes = [...counts].filter(([, count]) => count >= QUESTIONS_PER_DAY).map(([tag]) => tag).sort();
  if (!themes.length) return { questions: pickDailyQuestions(checkedQuestions, extraSetKey), theme: '' };

  const rng = mulberry32(hashString(`yktlg:extra-theme:${extraSetKey}`));
  const theme = themes[Math.floor(rng() * themes.length)];
  const pool = checkedQuestions.filter((question) => question.tags?.includes(theme));
  return { questions: pickDailyQuestions(pool, extraSetKey), theme };
}

// ---------- persistence ----------
function loadState() {
  try { return JSON.parse(localStorage.getItem(storageKey)) || null; } catch { return null; }
}
function saveState() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* private mode etc. */ }
}

// ---------- screen switching ----------
function show(name) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== `s-${name}`;
  cancelAnimationFrame(timerRaf);
  clearInterval(countdownId);
}

function renderDots(el, current) {
  el.innerHTML = Array.from({ length: QUESTIONS_PER_DAY }, (_, i) => {
    const a = state.answers[i];
    const cls = a ? scoreTier(a.score) : i === current ? 'current' : '';
    return `<span class="${cls}"></span>`;
  }).join('');
}

// ---------- 1. cover ----------
async function showCover() {
  show('cover');
  $('cover-date').textContent = formatThaiDate(dateKey);
  const btn = $('start-btn');
  btn.textContent = state.phase === 'done' ? 'ดูผลวันนี้' : state.answers.length || state.phase !== 'cover' ? 'เล่นต่อ' : 'เล่นเลย!';
  const themeEl = $('cover-theme');
  const theme = dayThemes[dateKey];
  themeEl.textContent = mode !== 'random' && theme ? `ธีมวันนี้: ${theme}` : '';
  themeEl.hidden = mode === 'random' || !theme;
  $('reset-data-btn').hidden = params.get('debug') !== '1';
  $('cover-played').innerHTML = '&nbsp;';
  const n = await backend.getPlayerCount(setKey);
  const total = n + (state.phase === 'done' ? 1 : 0);
  $('cover-played').textContent = `วันนี้มีคนเล่นแล้ว ${total.toLocaleString('en-US')} คน`;
}

function onStart() {
  if (state.phase === 'done') return showSummary();
  if (state.phase === 'reveal') return showReveal(state.answers.length - 1);
  state.phase = 'q';
  saveState();
  showQuestion(state.answers.length);
}

// ---------- 2. question ----------
function showQuestion(i) {
  const q = questions[i];
  show('question');
  renderDots($('q-dots'), i);
  $('q-counter').textContent = `${i + 1}/${QUESTIONS_PER_DAY}`;
  $('q-time').textContent = q.time || '';
  $('q-time').hidden = !q.time;
  $('q-text').textContent = q.question;
  $('q-unit').textContent = q.unit;
  const input = $('q-input');
  input.value = '';
  input.dataset.len = '';
  input.placeholder = fmtNum(q, 0);
  $('sign-btn').hidden = !allowsNegative(q);
  $('submit-btn').disabled = true;

  if (!state.qStart) { state.qStart = Date.now(); saveState(); }
  let submitted = false;
  const submit = () => {
    if (submitted) return;
    submitted = true;
    cancelAnimationFrame(timerRaf);
    const guess = parseGuess(input.value);
    const timeLeft = Math.max(0, SECONDS_PER_QUESTION - (Date.now() - state.qStart) / 1000);
    state.answers.push({ guess, score: scoreFor(q, guess), timeLeft: Math.round(timeLeft * 10) / 10 });
    state.phase = 'reveal';
    state.qStart = null;
    saveState();
    showReveal(i);
  };

  const refresh = () => {
    const g = parseGuess(input.value);
    $('submit-btn').disabled = g == null;
  };
  input.oninput = () => {
    // reformat with thousands separators (not for years) and keep the caret next to the same digit
    const caret = input.selectionStart ?? input.value.length;
    const sigBefore = input.value.slice(0, caret).replace(/,/g, '').length;
    const clean = sanitizeInput(input.value, allowsNegative(q));
    const text = kindOf(q) === 'year' ? clean : groupDigits(clean);
    if (text !== input.value) {
      input.value = text;
      let pos = 0, seen = 0;
      while (pos < text.length && seen < sigBefore) if (text[pos++] !== ',') seen++;
      input.setSelectionRange(pos, pos);
    }
    input.dataset.len = text.length > 15 ? 'xl' : text.length > 11 ? 'l' : '';
    refresh();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter' && !$('submit-btn').disabled) submit(); };
  $('sign-btn').onclick = () => {
    input.value = input.value.startsWith('-') ? input.value.slice(1) : `-${input.value}`;
    refresh();
    input.focus();
  };
  $('submit-btn').onclick = submit;

  const timer = $('timer');
  const badge = $('timer-badge');
  const tick = () => {
    const left = SECONDS_PER_QUESTION - (Date.now() - state.qStart) / 1000;
    if (left <= 0) {
      timer.style.setProperty('--p', 0);
      badge.textContent = '0';
      return submit(); // time's up: whatever is typed counts (nothing typed = 0 points)
    }
    timer.style.setProperty('--p', (left / SECONDS_PER_QUESTION) * 100);
    timer.classList.toggle('urgent', left <= 10);
    badge.textContent = Math.ceil(left);
    timerRaf = requestAnimationFrame(tick);
  };
  tick();
  input.focus({ preventScroll: true });
}

// ---------- 3. reveal ----------
async function showReveal(i) {
  const q = questions[i];
  const a = state.answers[i];
  show('reveal');
  renderDots($('r-dots'), i);
  $('r-counter').textContent = `${i + 1}/${QUESTIONS_PER_DAY}`;
  $('r-time').textContent = q.time || '';
  $('r-time').hidden = !q.time;
  $('r-text').textContent = q.question;
  $('r-reference').textContent = q.reference ? `อ้างอิง: ${q.reference}` : '';
  $('r-reference').hidden = !q.reference;
  $('r-chart').innerHTML = '<div class="loading">กำลังโหลดคำตอบของคนอื่น…</div>';
  $('r-stats').innerHTML = '';
  const next = $('next-btn');
  const last = i === QUESTIONS_PER_DAY - 1;
  next.textContent = last ? 'ดูสรุปผล' : 'ข้อต่อไป';
  next.disabled = true;
  next.onclick = () => (last ? finishDay() : (state.phase = 'q', saveState(), showQuestion(i + 1)));

  const crowd = await backend.getCrowdAnswers(setKey, q);
  if ($('s-reveal').hidden) return; // user navigated away

  $('r-chart').innerHTML = revealChart({ q, crowd, guess: a.guess });
  requestAnimationFrame(() => requestAnimationFrame(() => $('r-chart').firstElementChild.classList.add('in')));

  const beaten = crowd.filter((g) => scoreFor(q, g) < a.score).length / crowd.length;
  const tier = scoreTier(a.score);
  const youLine = a.guess == null
    ? '<b>หมดเวลา</b> – ไม่ได้ตอบ'
    : `คุณตอบ <b class="you">${esc(fmtNum(q, a.guess))}</b>`;
  $('r-stats').innerHTML = `
    <div class="score-pill ${tier}"><span id="score-num">0</span><small>/ ${MAX_SCORE_PER_QUESTION} คะแนน</small></div>
    <div class="stat-text">${youLine}<br>เฉลย <b class="ans">${esc(fmtNum(q, q.answer))}</b> ${esc(q.unit)}<br>${a.guess == null ? '' : `แม่นกว่า ${Math.round(beaten * 100)}% ของผู้เล่น`}</div>`;
  countUp($('score-num'), a.score);
  next.disabled = false;
}

function countUp(el, to) {
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / 700);
    el.textContent = Math.round(to * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function finishDay() {
  state.phase = 'done';
  saveState();
  const scores = state.answers.map((a) => a.score);
  backend.submitResult(setKey, {
    guesses: state.answers.map((a) => a.guess),
    scores,
    total: scores.reduce((s, v) => s + v, 0),
  });
  showSummary();
}

// ---------- 4. summary ----------
async function showSummary() {
  show('summary');
  const scores = state.answers.map((a) => a.score);
  const total = scores.reduce((s, v) => s + v, 0);

  $('sum-date').textContent = `สรุปผลวันที่ ${formatThaiDate(dateKey)}${round ? ` · ชุดที่ ${round + 1}` : ''}`;
  $('sum-rank').textContent = rankTitle(total, MAX_TOTAL);
  $('sum-total').textContent = total;
  $('sum-max').textContent = MAX_TOTAL;
  $('sum-pct').innerHTML = '&nbsp;';
  $('sum-chart').innerHTML = '<div class="loading">กำลังโหลด…</div>';

  $('sum-tiles').innerHTML = scores.map((s, i) =>
    `<div class="tile ${scoreTier(s)}"><b>${s}</b><small>ข้อ ${i + 1}</small></div>`).join('');
  $('sum-review-list').innerHTML = state.answers.map((a, i) => {
    const q = questions[i];
    const mine = a.guess == null ? 'ไม่ได้ตอบ' : fmtNum(q, a.guess);
    const href = referenceLink(q.reference_link);
    const reference = q.reference
      ? `<span class="answer-reference">อ้างอิง: ${href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(q.reference)}</a>`
        : esc(q.reference)}</span>`
      : '';
    return `<li><span class="q">${esc(q.question)}</span>${q.time ? `<small class="review-time">${esc(q.time)}</small>` : ''}<span class="res">คุณตอบ <b>${esc(mine)}</b> · เฉลย <b>${esc(fmtNum(q, q.answer))}</b> ${esc(q.unit)} · ${a.score} คะแนน</span>${reference}</li>`;
  }).join('');

  const shareText = [
    `ยู โนว ไทยแลนด์ ลิตเติ้ล โก๊? ${formatThaiDate(dateKey)}`,
    `${scores.map((s) => TIER_EMOJI[scoreTier(s)]).join('')}  ${total}/${MAX_TOTAL}`,
    location.origin.startsWith('http') ? location.origin + location.pathname : '',
  ].filter(Boolean).join('\n');
  $('share-box').textContent = shareText;
  $('share-btn').onclick = () => shareResult(shareText);

  const tickCountdown = () => {
    const s = Math.floor(msUntilNextBangkokMidnight() / 1000);
    const p = (n) => String(n).padStart(2, '0');
    $('next-in').textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  };
  tickCountdown();
  countdownId = setInterval(tickCountdown, 1000);
  const tomorrowTheme = dayThemes[addDays(dateKey, 1)] || '';
  $('sum-tomorrow-theme').textContent = mode !== 'random' && tomorrowTheme
    ? `พรุ่งนี้: ธีม ${tomorrowTheme}`
    : '';
  $('sum-tomorrow-theme').hidden = mode === 'random' || !tomorrowTheme;
  const nextExtra = makeExtraSet(round + 1);
  $('again-btn').textContent = mode !== 'random' && nextExtra.theme
    ? `เล่นชุดใหม่ทันที · ธีม ${nextExtra.theme}`
    : 'เล่นชุดใหม่ทันที';

  const totals = await backend.getScoreDistribution(setKey, questions);
  if ($('s-summary').hidden) return;
  summaryChart = { totals, mine: total, max: MAX_TOTAL };
  drawSummaryChart(true);
  const below = totals.filter((t) => t < total).length / totals.length;
  $('sum-pct').textContent = `คะแนนสูงกว่า ${Math.round(below * 100)}% ของผู้เล่นวันนี้`;
}

let summaryChart = null; // data for the score histogram, redrawn when the container is resized
let summaryChartWidth = 0;
function drawSummaryChart(animate) {
  const wrap = $('sum-chart');
  const width = wrap.clientWidth - 16; // wrapper padding
  if (!summaryChart || $('s-summary').hidden || width <= 0) return;
  summaryChartWidth = width;
  wrap.innerHTML = scoreChart({ ...summaryChart, width });
  const svg = wrap.firstElementChild;
  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.add('in')));
  else svg.classList.add('in');
}
new ResizeObserver(() => {
  if (summaryChart && Math.abs($('sum-chart').clientWidth - 16 - summaryChartWidth) > 1) drawSummaryChart(false);
}).observe($('sum-chart'));

async function shareResult(text) {
  const btn = $('share-btn');
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); btn.textContent = 'คัดลอกแล้ว ✓'; setTimeout(() => (btn.textContent = 'แชร์ผลลัพธ์'), 1800); }
  } catch { /* user dismissed share sheet */ }
}

// ---------- sets ----------
function loadSet(n) {
  round = n;
  const modeSetKey = mode === 'random' ? dateKey : `${dateKey}:${mode}`;
  setKey = n ? `${modeSetKey}#${n}` : modeSetKey;
  storageKey = n
    ? `yktlg:v1:${dateKey}${modeStorageSuffix}:${n}`
    : `yktlg:v1:${dateKey}${modeStorageSuffix}`;
  // curated list for the date if there is one, else the seeded random pick
  const extra = n ? makeExtraSet(n) : null;
  questions = extra
    ? extra.questions
    : curatedDays[dateKey]?.length === QUESTIONS_PER_DAY
      ? curatedDays[dateKey]
      : pickDailyQuestions(checkedQuestions, setKey);
  if (extra?.theme) dayThemes[`${dateKey}#${n}`] = extra.theme;
  state = loadState() || { phase: 'cover', answers: [], qStart: null };
}

function playAnotherSet() {
  try { localStorage.setItem(roundKey, String(round + 1)); } catch { /* ignore */ }
  loadSet(round + 1);
  state.phase = 'q';
  saveState();
  showQuestion(0);
}

// ---------- boot ----------
async function boot() {
  const checkedRes = await fetch(dayFileByMode.random);
  if (!checkedRes.ok) throw new Error(`Could not load checked-question schedule (${checkedRes.status})`);
  const checkedData = await checkedRes.json();
  const checkedRows = Object.values(checkedData).flat();
  if (checkedRows.length < QUESTIONS_PER_DAY || checkedRows.some((question) => !question?.id)) {
    throw new Error('Checked-question schedule is invalid or has fewer than five questions');
  }
  checkedQuestions = [...new Map(checkedRows.map((question) => [question.id, question])).values()];

  let dayData = checkedData;
  if (mode !== 'random') {
    const r = await fetch(dayFileByMode[mode]);
    if (r.ok) dayData = await r.json();
  }
  curatedDays = {};
  dayThemes = {};
  for (const [date, day] of Object.entries(dayData)) {
    if (Array.isArray(day)) {
      curatedDays[date] = day;
      if (mode === 'grouped') dayThemes[date] = themeFromQuestions(day);
    } else if (day && Array.isArray(day.questions)) {
      curatedDays[date] = day.questions;
      if (typeof day.theme === 'string') dayThemes[date] = day.theme;
    }
  }
  let savedRound = 0;
  try { savedRound = parseInt(localStorage.getItem(roundKey), 10) || 0; } catch { /* ignore */ }
  loadSet(savedRound);
  $('start-btn').onclick = onStart;
  $('again-btn').onclick = playAnotherSet;
  $('reset-data-btn').onclick = () => {
    if (!confirm('ล้างข้อมูลการเล่นที่บันทึกไว้ทั้งหมดหรือไม่?')) return;
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('yktlg:v1:')) localStorage.removeItem(key);
      }
    } catch (err) {
      console.error('Could not clear saved game data', err);
      alert('ล้างข้อมูลไม่สำเร็จ กรุณาตรวจสอบการตั้งค่าเบราว์เซอร์');
      return;
    }
    const url = new URL(location.href);
    url.searchParams.delete('debug');
    location.assign(url);
  };
  showCover();
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px">โหลดเกมไม่สำเร็จ – ลองเปิดผ่านเซิร์ฟเวอร์ เช่น <code>python3 -m http.server</code></p>');
});
