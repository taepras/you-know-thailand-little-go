// Data layer. Everything the UI needs from "other players" goes through this interface:
//
//   getPlayerCount(dateKey)                -> Promise<number>
//   getCrowdAnswers(dateKey, question)     -> Promise<number[]>   everyone's guesses for one question
//   getScoreDistribution(dateKey, qs)      -> Promise<number[]>   everyone's day totals
//   submitResult(dateKey, result)          -> Promise<void>       result = { guesses, scores, total }
//
// The mock below generates plausible, seeded data. To go live, write a second backend with the same
// four methods on top of Firestore (e.g. answers/{dateKey}/q/{id} docs + a `players` counter) and
// swap the export at the bottom.

import {
  hashString, mulberry32, gaussian, kindOf, scaleOf, allowsNegative, scoreFor,
} from './game.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mockCrowd(dateKey, q, count = 400) {
  const rng = mulberry32(hashString(`crowd:${dateKey}:${q.id}`));
  const kind = kindOf(q);
  const bias = (rng() - 0.5) * 0.5; // the crowd as a whole tends to under/over-estimate
  const dp = q.decimal_places || 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    let v;
    if (kind === 'log') {
      v = (q.answer + 1) * 10 ** (bias * 0.8 + gaussian(rng) * 0.35) - 1;
    } else if (kind === 'year') {
      v = q.answer + bias * 30 + gaussian(rng) * 12;
    } else {
      const s = scaleOf(q);
      v = q.answer + bias * s * 3 + gaussian(rng) * s * 1.6;
      if (!allowsNegative(q)) v = Math.min(Math.max(v, 0), q.unit === '%' || /จาก 100 /.test(`${q.unit} `) ? 100 : Infinity);
    }
    if (!allowsNegative(q)) v = Math.max(v, 0);
    const f = 10 ** Math.min(dp + 1, 3);
    out.push(Math.round(v * f) / f);
  }
  return out;
}

const mock = {
  async getPlayerCount(dateKey) {
    await wait(150);
    const rng = mulberry32(hashString(`players:${dateKey}`));
    return 800 + Math.floor(rng() * 2200);
  },

  async getCrowdAnswers(dateKey, q) {
    await wait(250);
    return mockCrowd(dateKey, q);
  },

  async getScoreDistribution(dateKey, questions) {
    await wait(250);
    const rng = mulberry32(hashString(`totals:${dateKey}`));
    const perQuestion = questions.map((q) => mockCrowd(dateKey, q).map((g) => scoreFor(q, g)));
    return Array.from({ length: 800 }, () =>
      perQuestion.reduce((sum, scores) => sum + scores[Math.floor(rng() * scores.length)], 0));
  },

  async submitResult(dateKey, result) {
    await wait(100);
    console.info('[mock backend] submitResult', dateKey, result);
  },
};

export const backend = mock;
