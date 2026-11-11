// The search loop shared by the bot trainer (src/balance/trainer.js) and, later, the Balance Lab's
// stage 2 auto-tuner: values move one step at a time along a list of allowed choices (which are also
// the limits), each trial is flown on the very same matches (same seeds, opponents and sides) as the
// current values, and a change is kept only when it wins by more than the noise between matches.
// Pure: no workers, no files.

const mean = (xs) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : 0);

// One step either way from each field's current value: [{ key, value }]. fields: [[key, choices], ...].
export function neighbours(fields, values) {
  const out = [];
  for (const [key, choices] of fields) {
    // The nearest allowed value to the current one (a hand-edited value may sit between two).
    let i = 0;
    for (let k = 1; k < choices.length; k++) if (Math.abs(choices[k] - values[key]) < Math.abs(choices[i] - values[key])) i = k;
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < choices.length && choices[j] !== values[key]) out.push({ key, value: choices[j] });
    if (choices[i] !== values[key]) out.push({ key, value: choices[i] });
  }
  return out;
}

// Paired comparison of a trial against the current values, match by match: { diff, se, better }.
// better: the trial's mean is higher by more than z standard errors of the difference, and by at least
// floor (tiny gains are not worth a change even when steady).
export function compare(base, trial, { z = 2, floor = 0 } = {}) {
  const d = base.map((b, i) => trial[i] - b);
  const m = mean(d);
  const sd = d.length > 1 ? Math.sqrt(d.reduce((n, x) => n + (x - m) ** 2, 0) / (d.length - 1)) : Infinity;
  const se = sd / Math.sqrt(d.length || 1);
  return { diff: m, se, better: d.length > 1 && m > z * se && m > floor };
}

// One round of the search for one subject: try every neighbour, keep each field's best step that wins
// beyond the noise, and when that changes more than one field, check the steps together against the
// best single one (they may not add up). evaluate(values[]) -> Promise<scores[][]> (one score list per
// values, matched index by index). Returns { values, changes: [{ key, from, to, diff, se }], scores }.
export async function searchStep(fields, values, evaluate, opts = {}) {
  const trials = neighbours(fields, values).map((n) => ({ ...n, values: { ...values, [n.key]: n.value } }));
  const [base, ...scores] = await evaluate([values, ...trials.map((t) => t.values)]);
  const wins = new Map(); // key -> best winning trial
  trials.forEach((t, i) => {
    const c = compare(base, scores[i], opts);
    t.result = c;
    t.scores = scores[i];
    if (c.better && (!wins.has(t.key) || c.diff > wins.get(t.key).result.diff)) wins.set(t.key, t);
  });
  const steps = [...wins.values()].sort((p, q) => q.result.diff - p.result.diff);
  const change = (t) => ({ key: t.key, from: values[t.key], to: t.value, diff: t.result.diff, se: t.result.se });
  const all = trials.map((t) => ({ key: t.key, value: t.value, diff: t.result.diff, se: t.result.se })); // every trial
  if (!steps.length) return { values, changes: [], scores: base, tried: trials.length, trials: all };
  if (steps.length === 1) return { values: steps[0].values, changes: [change(steps[0])], scores: steps[0].scores, tried: trials.length, trials: all };
  const together = { ...values };
  for (const t of steps) together[t.key] = t.value;
  const [both] = await evaluate([together]);
  if (mean(both) >= mean(steps[0].scores)) return { values: together, changes: steps.map(change), scores: both, tried: trials.length + 1, trials: all };
  return { values: steps[0].values, changes: [change(steps[0])], scores: steps[0].scores, tried: trials.length + 1, trials: all };
}
