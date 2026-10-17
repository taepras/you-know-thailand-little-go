// SVG chart builders (return markup strings). Bars animate in via the `.in` class set by the caller.
import {
  transformOf, inverseOf, scoreFor, fmtCompact, GOOD_ZONE_SCORE,
} from './game.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function bars(counts, x0, plotW, baseY, plotH) {
  const max = Math.max(...counts, 1);
  const slot = plotW / counts.length;
  return counts.map((c, i) => {
    const h = Math.max(c ? 2 : 0, (c / max) * plotH);
    return `<rect class="bar" style="--i:${i}" x="${(x0 + i * slot + 0.75).toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${(slot - 1.5).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/>`;
  }).join('');
}

// Answer-reveal histogram: crowd guesses + shaded "good guess" zone + answer line + your guess marker.
export function revealChart({ q, crowd, guess }) {
  const W = 320, H = 190, L = 10, R = 10, T = 50, B = 28;
  const plotW = W - L - R, baseY = H - B, plotH = baseY - T;
  const tf = transformOf(q), inv = inverseOf(q);

  const tv = crowd.map(tf).sort((a, b) => a - b);
  const n = tv.length;
  const ta = tf(q.answer);
  let lo = Math.min(tv[Math.floor(n * 0.02)], ta);
  let hi = Math.max(tv[Math.ceil(n * 0.98) - 1], ta);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x = (t) => L + ((t - lo) / (hi - lo)) * plotW;

  const BINS = 26;
  const counts = new Array(BINS).fill(0);
  for (const t of tv) {
    if (t < lo || t > hi) continue;
    counts[Math.min(BINS - 1, Math.floor(((t - lo) / (hi - lo)) * BINS))]++;
  }

  // good-guess zone: where a guess would score >= GOOD_ZONE_SCORE
  let zl = null, zr = null;
  for (let i = 0; i <= 240; i++) {
    const t = lo + ((hi - lo) * i) / 240;
    if (scoreFor(q, inv(t)) >= GOOD_ZONE_SCORE) { if (zl == null) zl = t; zr = t; }
  }
  const zone = zl == null ? '' : `<rect class="zone" x="${x(zl).toFixed(1)}" y="${T - 6}" width="${Math.max(2, x(zr) - x(zl)).toFixed(1)}" height="${plotH + 6}" rx="4"/>`;

  const ax = x(ta);
  let guessMarkup = '';
  let guessIsLeft = true;
  if (guess != null) {
    const tg = tf(guess);
    const clamped = Math.min(Math.max(tg, lo), hi);
    const gx = x(clamped);
    guessIsLeft = tg <= ta;
    const edge = tg < lo ? '◂ ' : tg > hi ? ' ▸' : '';
    guessMarkup = `
      <line class="guess-line" x1="${gx}" x2="${gx}" y1="${T - 6}" y2="${baseY}"/>
      <circle class="guess-dot" cx="${gx}" cy="${T - 6}" r="4"/>
      <text class="lbl guess" x="${gx + (guessIsLeft ? -6 : 6)}" y="${T - 22}" text-anchor="${guessIsLeft ? 'end' : 'start'}"><tspan class="cap" x="${gx + (guessIsLeft ? -6 : 6)}" dy="-13">คุณตอบ</tspan><tspan x="${gx + (guessIsLeft ? -6 : 6)}" dy="14">${esc(edge.startsWith('◂') ? edge : '')}${esc(fmtCompact(q, guess))}${esc(edge.endsWith('▸') ? edge : '')}</tspan></text>`;
  }
  const aSide = guess != null && guessIsLeft ? 1 : guess != null ? -1 : 1;
  const answerMarkup = `
    <line class="answer-line" x1="${ax}" x2="${ax}" y1="${T - 6}" y2="${baseY}"/>
    <text class="lbl answer" x="${ax + 6 * aSide}" y="${T - 22}" text-anchor="${aSide > 0 ? 'start' : 'end'}"><tspan class="cap" x="${ax + 6 * aSide}" dy="-13">เฉลย</tspan><tspan x="${ax + 6 * aSide}" dy="14">${esc(fmtCompact(q, q.answer))}</tspan></text>`;

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟคำตอบของผู้เล่นคนอื่น">
    ${zone}
    ${bars(counts, L, plotW, baseY, plotH)}
    <line class="axis" x1="${L}" x2="${W - R}" y1="${baseY}" y2="${baseY}"/>
    ${answerMarkup}
    ${guessMarkup}
    <text class="tick" x="${L}" y="${H - 8}" text-anchor="start">${esc(fmtCompact(q, inv(lo + pad)))}</text>
    <text class="tick" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(fmtCompact(q, inv(hi - pad)))}</text>
  </svg>`;
}

// Day-summary histogram of total scores, with your total marked.
// `width` is the real pixel width of the container, so text stays the same size and bins adapt.
export function scoreChart({ totals, mine, max, width = 320 }) {
  const W = Math.max(240, Math.round(width));
  const H = Math.round(Math.min(240, Math.max(150, W * 0.4)));
  const L = 10, R = 10, T = 34, B = 24;
  const plotW = W - L - R, baseY = H - B, plotH = baseY - T;
  const BINS = Math.min(40, Math.max(12, Math.round(plotW / 16)));
  const counts = new Array(BINS).fill(0);
  for (const t of totals) counts[Math.min(BINS - 1, Math.floor((t / max) * BINS))]++;
  const mx = L + (mine / max) * plotW;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟคะแนนของผู้เล่นทุกคนวันนี้">
    ${bars(counts, L, plotW, baseY, plotH)}
    <line class="axis" x1="${L}" x2="${W - R}" y1="${baseY}" y2="${baseY}"/>
    <line class="guess-line" x1="${mx}" x2="${mx}" y1="${T - 8}" y2="${baseY}"/>
    <circle class="guess-dot" cx="${mx}" cy="${T - 8}" r="4"/>
    <text class="lbl guess" x="${Math.min(Math.max(mx, 26), W - 26)}" y="${T - 16}" text-anchor="middle">คุณ ${mine}</text>
    <text class="tick" x="${L}" y="${H - 7}" text-anchor="start">0</text>
    <text class="tick" x="${W - R}" y="${H - 7}" text-anchor="end">${max}</text>
  </svg>`;
}
