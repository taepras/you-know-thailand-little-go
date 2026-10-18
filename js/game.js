// Pure game logic: seeded RNG, daily question selection, scoring, number formatting.
// No DOM access here so it can be unit-tested in node.

export const QUESTIONS_PER_DAY = 5;
export const SECONDS_PER_QUESTION = 60;
export const MAX_SCORE_PER_QUESTION = 100;
export const GOOD_ZONE_SCORE = 60; // guesses scoring >= this are shaded green on the reveal chart
const SCORE_SCALE_MULTIPLIER = 1.5;

// ---------- seeded randomness ----------

export function hashString(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- dates (Thailand time, so everyone gets the same puzzle at the same moment) ----------

export function bangkokDateKey(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return p; // YYYY-MM-DD
}

export function msUntilNextBangkokMidnight(now = new Date()) {
  const shifted = now.getTime() + 7 * 3600 * 1000;
  const dayMs = 24 * 3600 * 1000;
  return dayMs - (shifted % dayMs);
}

export function formatThaiDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return date.toLocaleDateString('th-TH', {
    timeZone: 'UTC', day: 'numeric', month: 'short', year: '2-digit',
  });
}

// ---------- question selection ----------

// Stable ids: position in data/questions-v1.json. Only ever append to the file so past days stay reproducible.
export function withIds(rawQuestions) {
  return rawQuestions.map((q, i) => ({ ...q, id: `q${i}` }));
}

function overlapCost(picked) {
  let cost = 0;
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      const a = picked[i], b = picked[j];
      const shared = a.tags.filter((t) => b.tags.includes(t)).length;
      cost += shared * 10; // shared tags are what we most want to avoid
      if (a.unit === b.unit) cost += 1; // mild nudge toward a mix of units
    }
  }
  return cost;
}

// Deterministic per date: everyone sees the same 5. Tries many random sets and keeps the one
// with the least tag overlap (0 whenever a fully disjoint set exists).
export function pickDailyQuestions(questions, dateKey, n = QUESTIONS_PER_DAY) {
  const rng = mulberry32(hashString(`yktlg:${dateKey}`));
  let best = null;
  let bestCost = Infinity;
  for (let attempt = 0; attempt < 4000 && bestCost > 0; attempt++) {
    const idxs = new Set();
    while (idxs.size < n) idxs.add(Math.floor(rng() * questions.length));
    const set = [...idxs].map((i) => questions[i]);
    const cost = overlapCost(set);
    if (cost < bestCost) { best = set; bestCost = cost; }
  }
  return best;
}

// ---------- scoring ----------
// 'log'    : counts / money / big numbers – judged by how many orders of magnitude off you are
// 'linear' : percentages, "per 100" ratios, years – judged by absolute distance
// A question may override with optional `kind` / `scale` fields in the JSON.

export function kindOf(q) {
  if (q.kind) return q.kind;
  if (q.unit === 'พ.ศ.') return 'year';
  if (q.unit.includes('%') || /จาก 100 /.test(`${q.unit} `)) return 'linear';
  if (q.unit === '' && Math.abs(q.answer) < 1) return 'linear'; // ratios such as the Gini coefficient
  return 'log';
}

export function scaleOf(q) {
  if (q.scale) return q.scale * SCORE_SCALE_MULTIPLIER;
  const kind = kindOf(q);
  if (kind === 'year') return 10 * SCORE_SCALE_MULTIPLIER;
  if (kind === 'linear') {
    if (q.unit === '' && Math.abs(q.answer) < 1) return 0.1 * SCORE_SCALE_MULTIPLIER;
    if (q.unit.includes('%') && Math.abs(q.answer) < 10) return 3 * SCORE_SCALE_MULTIPLIER;
    return 12 * SCORE_SCALE_MULTIPLIER;
  }
  return 0.25 * SCORE_SCALE_MULTIPLIER; // decades of error that cost ~49% of the score
}

export function allowsNegative(q) {
  return kindOf(q) === 'linear' && q.unit.includes('%');
}

export function scoreFor(q, guess) {
  if (guess == null || !Number.isFinite(guess)) return 0;
  const s = scaleOf(q);
  const err = kindOf(q) === 'log'
    ? Math.abs(Math.log10((Math.max(guess, 0) + 1) / (q.answer + 1))) / s
    : Math.abs(guess - q.answer) / s;
  return Math.round(MAX_SCORE_PER_QUESTION * Math.exp(-err));
}

export function scoreTier(score) {
  if (score >= 80) return 'great';
  if (score >= 50) return 'good';
  if (score >= 20) return 'meh';
  return 'bad';
}

export function rankTitle(total, max) {
  const r = total / max;
  if (r >= 0.9) return 'ปราชญ์สยาม';
  if (r >= 0.7) return 'ขาประจำสำมะโน';
  if (r >= 0.5) return 'พอรู้เรื่องอยู่';
  if (r >= 0.3) return 'นักท่องเที่ยวขาประจำ';
  return 'เพิ่งมาเมืองไทยหรือเปล่า?';
}

// ---------- chart axis helpers ----------

export function transformOf(q) {
  return kindOf(q) === 'log' ? (v) => Math.log10(Math.max(v, 0) + 1) : (v) => v;
}
export function inverseOf(q) {
  return kindOf(q) === 'log' ? (t) => 10 ** t - 1 : (t) => t;
}

// ---------- number formatting ----------

export function fmtNum(q, v) {
  if (v == null || !Number.isFinite(v)) return '–';
  const dp = q.decimal_places || 0;
  return v.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: Math.max(dp, 2),
    useGrouping: kindOf(q) !== 'year',
  });
}

export function fmtCompact(q, v) {
  if (v == null || !Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  if (kindOf(q) !== 'year' && abs >= 1e6) {
    const [div, word] = abs >= 1e12 ? [1e12, 'ล้านล้าน'] : [1e6, 'ล้าน'];
    const m = v / div;
    const digits = Math.abs(m) >= 100 ? 0 : Math.abs(m) >= 10 ? 1 : 2;
    return `${m.toLocaleString('en-US', { maximumFractionDigits: digits })} ${word}`;
  }
  return fmtNum(q, v);
}

export function sanitizeInput(raw, allowNeg) {
  let s = raw.replace(/,/g, '').replace(/[^\d.\-]/g, '');
  const neg = allowNeg && s.startsWith('-');
  s = s.replace(/-/g, '');
  const [intPart, ...rest] = s.split('.');
  s = rest.length ? `${intPart}.${rest.join('').slice(0, 3)}` : intPart;
  return (neg ? '-' : '') + s;
}

// Adds thousands separators to the integer part of an already-sanitized string ("-1234.5" -> "-1,234.5").
export function groupDigits(s) {
  const m = s.match(/^(-?)(\d*)(\..*)?$/);
  if (!m) return s;
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[3] || '');
}

export function parseGuess(s) {
  s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d*)?$/.test(s)) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}
