// Balance Lab page: runs a scenario's bot matches in Web Workers (src/balance/worker.js, the same runner
// as tools/balance.mjs), saves each run to balance/results/ through tools/serve.mjs, and shows the report
// (src/balance/report.js). Open as balance-lab.html on the dev server.
import { cleanContent, newRun, planMatches, runFileName, withDefaults } from '../balance/plan.js';
import { analyse, compareRuns } from '../balance/report.js';
import { train, plannedMatches, tacticsFile, summariseTraining, TRAIN_DEFAULTS } from '../balance/trainer.js';
import { TACTIC_FIELDS, tacticsIn, describeTactics } from '../sim/tactics.js';
import { LEVER } from '../balance/levers.js';

const $ = (id) => document.getElementById(id);
const CORES = navigator.hardwareConcurrency || 4;
const SAVE_EVERY = 20; // matches between saves of a run in progress
const getJson = async (path) => {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};
const putJson = async (path, obj) => {
  // Data files stay readable (and diff well); run files are kept compact.
  const body = path.startsWith('data/') ? JSON.stringify(obj, null, 2) + '\n' : JSON.stringify(obj);
  const r = await fetch(path, { method: 'PUT', body });
  if (!r.ok) throw new Error(`Saving ${path}: ${await r.text()}`);
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`;
};
function status(text, warn = false) {
  $('status').textContent = text;
  $('status').className = warn ? 'warn' : '';
}

const S = {
  raw: null, // the data files as loaded
  names: {}, // plane id -> name
  scenarios: {}, // file name -> scenario
  queue: [], // runs waiting: { scenario, mode, matchup, threads }
  active: null, // the run in progress
  results: [], // result file names
};

// ---- loading ----
async function loadData() {
  const [planes, weapons, ground, settings, tactics] = await Promise.all(['planes', 'weapons', 'ground', 'settings', 'bot-tactics'].map((f) => getJson(`data/${f}.json`)));
  S.raw = { planes, weapons, ground, settings, tactics, maps: {} };
  S.names = Object.fromEntries(Object.entries(planes).filter(([, d]) => d?.name).map(([id, d]) => [id, d.name]));
}
async function loadMap(name) {
  if (!S.raw.maps[name]) S.raw.maps[name] = await getJson(`maps/${name}.ldtk`);
}
async function loadLists() {
  const list = await getJson('/api/balance');
  S.results = list.results;
  for (const f of list.scenarios) S.scenarios[f] = await getJson(`balance/scenarios/${f}`);
}

// ---- tabs ----
for (const b of document.querySelectorAll('header [data-tab]')) {
  b.onclick = () => {
    for (const o of document.querySelectorAll('header [data-tab]')) o.classList.toggle('on', o === b);
    for (const t of ['run', 'results', 'scenarios']) $(`tab-${t}`).hidden = t !== b.dataset.tab;
    if (b.dataset.tab === 'results') refreshResults();
  };
}

// ---- Run tab ----
const scenario = () => S.scenarios[$('scenario').value];
const mode = () => document.querySelector('input[name=mode]:checked').value;
const threads = () => ($('half').checked ? Math.max(1, Math.floor(CORES / 2)) : CORES);
function fillScenarios() {
  for (const sel of [$('scenario'), $('scenEdit')]) {
    const keep = sel.value;
    sel.innerHTML = Object.keys(S.scenarios).map((f) => `<option value="${esc(f)}">${esc(S.scenarios[f].title ?? f)}</option>`).join('');
    if (keep && S.scenarios[keep]) sel.value = keep;
  }
  fillRunForm();
  fillScenarioForm();
}
function fillRunForm() {
  const s = scenario();
  if (!s) return;
  $('scenAbout').textContent = s.about ?? '';
  $('planePicks').innerHTML = s.planes.map((id) => `<label class="chk"><input type="checkbox" data-plane="${esc(id)}" checked /> ${esc(S.names[id] ?? id)}</label>`).join(' ');
  const opts = s.planes.map((id) => `<option value="${esc(id)}">${esc(S.names[id] ?? id)}</option>`).join('');
  $('mx').innerHTML = opts;
  $('my').innerHTML = opts;
  $('my').selectedIndex = Math.min(1, s.planes.length - 1);
  for (const el of document.querySelectorAll('#planePicks input')) el.onchange = estimate;
  estimate();
}
function chosenRun() {
  const s = { ...scenario() };
  s.planes = [...document.querySelectorAll('#planePicks input:checked')].map((el) => el.dataset.plane);
  const m = mode();
  const matchup = m === 'matchup' ? [$('mx').value, $('my').value] : null;
  return { scenario: s, mode: m, matchup };
}
// Seconds per match on one worker, from the last run (a 20-minute match took about 30 s in Node).
function secondsPerMatch(minutes) {
  let per = 30 / 20;
  try {
    per = Number(localStorage.getItem('balanceLab.secPerGameMinute')) || per;
  } catch {}
  return per * minutes;
}
// How many matches at once n workers are worth (measured: 16 threads on 8 cores ran about 7 times
// as fast as one; workers past the real cores add little).
const speedOf = (n) => Math.min(n, Math.max(1, CORES / 2)) * 0.9;
function estimate() {
  $('cores').textContent = `${threads()} of ${CORES} threads`;
  try {
    const { scenario: s, mode: m, matchup } = chosenRun();
    if (m !== 'matchup' && s.planes.length < 2) throw new Error('Pick at least two planes');
    if (m === 'matchup' && matchup[0] === matchup[1]) throw new Error('Pick two different planes');
    const n = planMatches(s, m, matchup).length;
    const secs = (n * secondsPerMatch(withDefaults(s).minutes)) / speedOf(threads());
    $('estimate').textContent = `${n} matches, about ${clock(secs)}`;
    $('estimate').className = 'dim';
    $('start').disabled = false;
  } catch (e) {
    $('estimate').textContent = e.message;
    $('estimate').className = 'warn';
    $('start').disabled = true;
  }
}
$('scenario').onchange = fillRunForm;
for (const el of document.querySelectorAll('input[name=mode], #mx, #my')) el.onchange = estimate;
$('half').onchange = () => {
  estimate();
  trainEstimate();
};
$('start').onclick = () => {
  S.queue.push({ ...chosenRun(), half: $('half').checked });
  showQueue();
  if (!S.active) nextRun();
};
$('cancel').onclick = () => {
  if (S.active) S.active.cancel();
};
function describe(q) {
  if (q.kind === 'train') return `Train bots: ${q.opts.rounds} rounds, ${q.opts.seeds} matches per opponent${q.half ? ', half cores' : ''}`;
  const what = q.mode === 'matchup' ? `${S.names[q.matchup[0]]} v ${S.names[q.matchup[1]]}` : `${q.mode}, ${q.scenario.planes.length} planes`;
  return `${q.scenario.title ?? q.scenario.name}: ${what}${q.half ? ', half cores' : ''}`;
}
function showQueue() {
  const el = $('queue');
  if (!S.queue.length) {
    el.textContent = 'Empty.';
    return;
  }
  el.innerHTML = S.queue.map((q, i) => `<div>${i + 1}. ${esc(describe(q))} <button data-drop="${i}">remove</button></div>`).join('');
  for (const b of el.querySelectorAll('[data-drop]')) {
    b.onclick = () => {
      S.queue.splice(Number(b.dataset.drop), 1);
      showQueue();
    };
  }
}
window.addEventListener('beforeunload', (e) => {
  if (S.active) e.preventDefault();
});

async function nextRun() {
  const q = S.queue.shift();
  showQueue();
  if (!q) return;
  S.active = { cancel: () => {} }; // busy from now on, so Start only queues
  try {
    await (q.kind === 'train' ? trainOne(q) : runOne(q));
  } catch (e) {
    status(String(e.message ?? e), true);
  }
  S.active = null;
  $('cancel').disabled = true;
  $('busy').textContent = '';
  nextRun();
}

// Runs jobs on n Web Workers (src/balance/worker.js): onResult(index, result) as each match ends,
// onPartial(index, share) while one runs. Resolves when all are done, or at once when cancelled
// (S.active.cancel), leaving the matches in progress unfinished. Shared by runs and the bot training.
function pool(jobs, n, content, { onResult, onPartial }) {
  let next = 0;
  let cancelled = false;
  const workers = [];
  return new Promise((resolve, reject) => {
    S.active.cancel = () => {
      cancelled = true;
      for (const w of workers) w.terminate();
      resolve();
    };
    let live = Math.max(1, Math.min(n, jobs.length));
    if (!jobs.length) return resolve();
    for (let i = 0, k = live; i < k; i++) {
      const w = new Worker(new URL('../balance/worker.js', import.meta.url), { type: 'module' });
      workers.push(w);
      w.postMessage({ content });
      const feed = () => {
        if (cancelled) return;
        if (next >= jobs.length) {
          w.terminate();
          if (--live === 0) resolve();
          return;
        }
        const index = next++;
        w.postMessage({ job: { ...jobs[index], index } });
      };
      w.onmessage = ({ data }) => {
        if (data.progress != null) onPartial?.(data.index, data.progress);
        else if (data.error) {
          for (const o of workers) o.terminate();
          reject(new Error(data.error));
        } else {
          onResult(data.index, data.result);
          feed();
        }
      };
      w.onerror = (e) => reject(new Error(e.message || 'worker failed'));
      feed();
    }
  });
}

async function runOne(q) {
  const s = withDefaults(q.scenario);
  await loadMap(s.map);
  const run = newRun(s, { mode: q.mode, matchup: q.matchup, names: S.names });
  const file = `balance/results/${runFileName(run)}`;
  const jobs = planMatches(s, q.mode, q.matchup);
  const results = new Array(jobs.length);
  const partial = new Map(); // index -> share done of a match in progress
  const n = Math.min(jobs.length, q.half ? Math.max(1, Math.floor(CORES / 2)) : CORES);
  const content = cleanContent(S.raw);
  const t0 = performance.now();
  let done = 0;
  const save = async () => {
    run.matches = results.filter(Boolean);
    await putJson(file, run);
  };
  $('cancel').disabled = false;
  $('current').className = '';
  const show = () => {
    const spent = (performance.now() - t0) / 1000;
    const progress = done + [...partial.values()].reduce((a, b) => a + b, 0);
    const left = progress > 0.2 ? (spent / progress) * (jobs.length - progress) : null;
    $('current').textContent = `${describe(q)} — ${done} of ${jobs.length} matches on ${n} workers, ${clock(spent)} spent${left != null ? `, about ${clock(left)} left` : ''}`;
    $('progress').firstElementChild.style.width = `${(100 * progress) / jobs.length}%`;
    $('busy').textContent = `running ${Math.floor((100 * progress) / jobs.length)}%`;
    document.title = `${Math.floor((100 * progress) / jobs.length)}% Balance Lab`;
  };
  const tick = setInterval(show, 1000);
  await pool(jobs, n, content, {
    onPartial: (i, share) => partial.set(i, share),
    onResult: (i, result) => {
      partial.delete(i);
      results[i] = result;
      done++;
      if (done % SAVE_EVERY === 0) save().catch((e) => status(e.message, true));
    },
  }).finally(() => clearInterval(tick));
  partial.clear();
  show();
  run.finished = new Date().toISOString();
  await save();
  const spent = (performance.now() - t0) / 1000;
  if (done === jobs.length) {
    try {
      localStorage.setItem('balanceLab.secPerGameMinute', String((spent * speedOf(n)) / done / s.minutes));
    } catch {}
  }
  document.title = 'Balance Lab';
  status(`Saved ${file} (${done} matches, ${clock(spent)})`);
  $('current').textContent = `Last: ${describe(q)} — ${done} matches${done < jobs.length ? ' (cancelled)' : ''}, saved to ${file}.`;
  S.lastFile = file.split('/').pop();
  estimate();
}

// ---- Bot training ----
// Train bots: the trainer (src/balance/trainer.js) on the same workers; then the tactics go straight
// into data/bot-tactics.json (the old ones into bot-tactics.previous.json for Restore), the record into
// balance/results/, and a quick run of the fighters starts to show the effect on the battle.
const trainOpts = () => ({ rounds: Number($('trRounds').value) || TRAIN_DEFAULTS.rounds, seeds: Number($('trSeeds').value) || TRAIN_DEFAULTS.seeds });
// An arena match: 2 a side, no ground war; measured about 0.25 s per game-minute on one worker.
const ARENA_SEC_PER_MINUTE = 0.25;
function trainEstimate() {
  const n = plannedMatches(trainOpts(), S.raw?.tactics);
  const secs = (n * TRAIN_DEFAULTS.minutes * ARENA_SEC_PER_MINUTE) / speedOf($('half').checked ? Math.max(1, Math.floor(CORES / 2)) : CORES);
  $('trEstimate').textContent = `about ${n} short air-only matches, roughly ${clock(secs)}, then a quick run`;
}
for (const id of ['trRounds', 'trSeeds']) $(id).onchange = trainEstimate;
$('train').onclick = () => {
  S.queue.push({ kind: 'train', opts: trainOpts(), half: $('half').checked });
  showQueue();
  if (!S.active) nextRun();
};
$('restore').onclick = async () => {
  if (S.active?.training) return status('Wait for the training to finish first.', true);
  try {
    const [cur, prev] = await Promise.all([getJson('data/bot-tactics.json'), getJson('data/bot-tactics.previous.json')]);
    await putJson('data/bot-tactics.json', prev);
    await putJson('data/bot-tactics.previous.json', cur);
    S.raw.tactics = prev;
    status('Restored the previous bot tactics (press Restore again to undo).');
    showTactics();
  } catch (e) {
    status(e.message, true);
  }
};
function showTactics() {
  const t = S.raw?.tactics;
  if (!t) return;
  const rows = TRAIN_DEFAULTS.planes.map((id) => `<tr><td>${esc(S.names[id] ?? id)}</td><td class="dim" style="white-space:normal">${esc(describeTactics(tacticsIn(t, id)))}</td></tr>`).join('');
  const when = t.trained ? `<p class="dim">Last trained ${esc(t.trained.slice(0, 16).replace('T', ' '))}.</p>` : '<p class="dim">Not trained yet: every plane flies the default tactics.</p>';
  $('trNow').innerHTML = `<table><tr><th>plane</th><th>how its bots fight now</th></tr>${rows}</table>${when}`;
}

async function trainOne(q) {
  await loadMap('countryside');
  const content = cleanContent(S.raw);
  const n = q.half ? Math.max(1, Math.floor(CORES / 2)) : CORES;
  const planned = plannedMatches(q.opts, S.raw.tactics);
  const t0 = performance.now();
  let done = 0;
  let stop = false;
  S.active.training = true;
  const lines = [];
  const log = (text) => {
    lines.push(text);
    $('trLog').innerHTML = lines.slice(-12).map((l) => `<div>${esc(l)}</div>`).join('');
  };
  const show = () => {
    const share = Math.min(1, done / planned);
    const spent = (performance.now() - t0) / 1000;
    const left = done > 20 ? (spent / done) * Math.max(0, planned - done) : null;
    $('current').textContent = `Training bots — ${done} of about ${planned} matches on ${n} workers, ${clock(spent)} spent${left != null ? `, about ${clock(left)} left` : ''}${stop ? ' — stopping, the best so far is kept' : ''}`;
    $('progress').firstElementChild.style.width = `${100 * share}%`;
    $('busy').textContent = `training ${Math.floor(100 * share)}%`;
    document.title = `${Math.floor(100 * share)}% Training bots`;
  };
  const tick = setInterval(show, 1000);
  $('cancel').disabled = false;
  // Cancel drops the step in hand at once; the trainer keeps the best tactics found so far.
  const runJobs = async (jobs) => {
    if (stop) return [];
    const res = new Array(jobs.length);
    const running = pool(jobs, n, content, {
      onResult: (i, r) => {
        res[i] = r;
        done++;
      },
    });
    const halt = S.active.cancel;
    S.active.cancel = () => {
      stop = true;
      halt();
    };
    await running;
    return res.filter(Boolean);
  };
  let result;
  try {
    result = await train(S.raw.tactics, runJobs, { ...q.opts, names: S.names, log, cancelled: () => stop });
  } finally {
    clearInterval(tick);
    S.active.training = false;
  }
  show();
  const before = S.raw.tactics;
  const file = `${result.started.slice(0, 19).replace(/[T:]/g, '-')}-train-bots.json`.toLowerCase();
  // The record first: if writing the tactics fails, the training is not lost.
  await putJson(`balance/results/${file}`, result);
  await putJson('data/bot-tactics.previous.json', before);
  const now = tacticsFile(result, before._notes);
  await putJson('data/bot-tactics.json', now);
  S.raw.tactics = now;
  document.title = 'Balance Lab';
  status(`Bots trained in ${clock((performance.now() - t0) / 1000)}; tactics saved (Restore puts the old ones back). Record: balance/results/${file}`);
  $('current').textContent = `Last: bot training — ${result.matches} matches, saved to balance/results/${file}. Its report is in Results.`;
  $('trLog').innerHTML = result.summary.map((l) => `<p>${esc(l)}</p>`).join('');
  S.lastFile = file;
  showTactics();
  // The effect on the real battle: a quick run of the fighters, started by itself.
  const scen = Object.values(S.scenarios).find((x) => x.name === 'fighters');
  if (scen && !stop) {
    S.queue.unshift({ scenario: { ...scen }, mode: 'quick', matchup: null, half: q.half });
    showQueue();
  }
}

// ---- Results tab ----
async function refreshResults() {
  const list = await getJson('/api/balance');
  S.results = list.results.slice().reverse(); // newest first
  const opts = S.results.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  const keep = $('runPick').value || S.lastFile;
  $('runPick').innerHTML = opts;
  if (keep && S.results.includes(keep)) $('runPick').value = keep;
  const keepC = $('runCompare').value;
  $('runCompare').innerHTML = `<option value="">(nothing)</option>${opts}`;
  if (keepC) $('runCompare').value = keepC;
  showReport();
}
$('refresh').onclick = refreshResults;
$('runPick').onchange = showReport;
$('runCompare').onchange = showReport;

const cache = new Map();
async function loadRun(f) {
  if (!cache.has(f)) cache.set(f, await getJson(`balance/results/${f}`));
  return cache.get(f);
}
let selected = null; // the matchup shown in detail: 'x|y'

async function showReport() {
  const f = $('runPick').value;
  const el = $('report');
  if (!f) {
    el.innerHTML = '<p class="dim">No runs yet.</p>';
    return;
  }
  try {
    const run = await loadRun(f);
    if (run.kind === 'training') {
      el.innerHTML = trainingHtml(run);
      return;
    }
    if (run.kind === 'tuning') {
      el.innerHTML = tuningHtml(run);
      wireTuning(run, f);
      return;
    }
    if (run.kind === 'tuning-state' || run.state?.kind === 'tuning-state') {
      el.innerHTML = '<p class="dim">The auto-tuner\'s checkpoint: a tuning in progress (or stopped; carry on with <code>node tools/tune-planes.mjs --resume</code>). Its report appears when it is done.</p>';
      return;
    }
    if (!run.matches.length) {
      el.innerHTML = '<p class="dim">This run has no matches yet.</p>';
      return;
    }
    const other = $('runCompare').value;
    if (other && other !== f) {
      const before = await loadRun(other);
      if (before.kind === 'training') throw new Error('Pick a Balance Lab run to compare with, not a training.');
      el.innerHTML = compareHtml(compareRuns(before, run), other, f);
      return;
    }
    const r = analyse(run);
    if (!selected || !r.matchups.some((m) => `${m.x}|${m.y}` === selected)) {
      const worst = r.matchups.reduce((p, q) => (!p || Math.abs(q.push) > Math.abs(p.push) ? q : p), null);
      selected = worst ? `${worst.x}|${worst.y}` : null;
    }
    el.innerHTML = reportHtml(r, run);
    for (const td of el.querySelectorAll('[data-pair]')) {
      td.onclick = () => {
        selected = td.dataset.pair;
        showReport();
      };
    }
    drawCharts(r);
  } catch (e) {
    el.innerHTML = `<p class="warn">${esc(e.message)}</p>`;
  }
}

const sign = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v}`);
// Muted diverging colour for a front push: olive for pushing forward, rust for losing ground.
function pushColour(v, max) {
  const k = Math.min(1, Math.abs(v) / (max || 1));
  const [r, g, b] = v >= 0 ? [111, 133, 96] : [168, 96, 63];
  return `rgba(${r},${g},${b},${0.15 + 0.75 * k})`;
}
function bar(v, max) {
  const w = Math.min(50, (50 * Math.abs(v)) / (max || 1));
  const left = v >= 0 ? 50 : 50 - w;
  return `<div class="bar"><i style="left:${left}%;width:${w}%;background:${pushColour(v, max)}"></i><b></b></div>`;
}

function reportHtml(r, run) {
  const name = (id) => esc(run.names[id] ?? id);
  const max = Math.max(1, ...r.strength.map((p) => Math.abs(p.push)), ...r.matchups.map((m) => Math.abs(m.push)));
  let h = `<h3>Summary</h3><div class="summary">${r.summary.map((s) => `<p>${esc(s)}</p>`).join('')}</div>`;
  h += `<p class="dim">Run ${esc(r.run.scenario)} (${esc(r.run.mode)}), ${r.run.done} of ${r.run.planned} matches, started ${esc(r.run.started.slice(0, 16).replace('T', ' '))}. Front push: how far a plane's side moved the front towards the enemy, averaged over the match, in metres. ± is the noise (2 standard errors).</p>`;

  h += '<h3>Strength list</h3><div class="wide"><table><tr><th>plane</th><th class="num">push</th><th class="num">±</th><th></th><th></th><th class="num">air kills</th><th class="num">deaths</th><th class="num">kills/life</th><th class="num">tank kills</th><th class="num">trucks+soldiers</th><th class="num">reached depot</th><th class="num">matches</th></tr>';
  for (const p of r.strength) {
    const s = p.stats;
    h += `<tr><td>${esc(p.name)}</td><td class="num">${sign(p.push)} m</td><td class="num">${Math.round(2 * p.se) || '–'}</td><td>${bar(p.push, max)}</td>`;
    h += `<td class="${p.flag ? `flag-${p.flag}` : 'dim'}">${p.flag === 'strong' ? 'too strong?' : p.flag === 'weak' ? 'too weak?' : 'within noise'}</td>`;
    h += `<td class="num">${s.airKills}</td><td class="num">${s.deaths}</td><td class="num">${s.killsPerLife}</td><td class="num">${s.tankKills}</td><td class="num">${s.otherGround}</td><td class="num">${s.reachedDepot == null ? '–' : `${Math.round(s.reachedDepot * 100)}%`}</td><td class="num">${p.n}</td></tr>`;
  }
  h += '</table></div><p class="dim">Per match averages, over all its matchups (not the same-plane baselines).</p>';

  // Matchup grid: row plane's push against the column plane.
  const planes = run.planes;
  const pair = (x, y) => r.matchups.find((m) => (m.x === x && m.y === y) || (m.x === y && m.y === x));
  h += '<h3>Matchup grid</h3><p class="dim">Each cell: how far the row plane pushes the front against the column plane. Faded with a ~ : within the noise. The diagonal is the same-plane baseline (map bias for the left side). Click a cell for its details.</p><div class="wide"><table class="grid"><tr><th></th>';
  h += planes.map((id) => `<th>${name(id)}</th>`).join('') + '</tr>';
  for (const x of planes) {
    h += `<tr><th class="rowh">${name(x)}</th>`;
    for (const y of planes) {
      if (x === y) {
        const b = r.baselines.find((o) => o.id === x);
        h += `<td class="self">${b?.n ? sign(b.push) : ''}</td>`;
        continue;
      }
      const m = pair(x, y);
      if (!m) {
        h += '<td class="self"></td>';
        continue;
      }
      const v = m.x === x ? m.push : -m.push;
      const key = `${m.x}|${m.y}`;
      h += `<td data-pair="${esc(key)}" class="${key === selected ? 'sel' : ''}" style="background:${m.real ? pushColour(v, max) : 'transparent'};${m.real ? '' : 'color:var(--dim)'}" title="${name(x)} v ${name(y)}: ${sign(v)} m ± ${Math.round(2 * m.se)}">${m.real ? '' : '~'}${sign(v)}</td>`;
    }
    h += '</tr>';
  }
  h += '</table></div>';

  const m = r.matchups.find((o) => `${o.x}|${o.y}` === selected);
  if (m) {
    h += `<h3>${name(m.x)} against ${name(m.y)}</h3>`;
    h += `<p>${name(m.x)} pushes the front ${sign(m.push)} m (± ${Math.round(2 * m.se)}) over ${m.n} matches: ${m.real ? '<span class="warn">one-sided</span>' : 'within the noise'}. Reached the enemy depot: ${name(m.x)} ${m.reachedX}×, ${name(m.y)} ${m.reachedY}×.</p>`;
    h += `<canvas class="chart" id="chartMatchup" width="760" height="220"></canvas><p class="dim">Front over time from ${name(m.x)}'s side (up: towards the enemy). Line: mean over the matches; band: ± one standard deviation.</p>`;
    h += `<h3>Quick analysis</h3><ul class="notes">${m.notes.map((n) => `<li>${esc(n)}</li>`).join('') || '<li class="dim">No clear differences.</li>'}</ul><p class="dim">What differs, not proven causes. Values named are in TUNING.md.</p>`;
    h += `<div class="wide"><table><tr><th>stat (per match unless said)</th><th class="num">${name(m.x)}</th><th class="num">${name(m.y)}</th><th></th></tr>`;
    for (const c of m.compare) {
      const f = (v) => (v == null ? '–' : c.pct ? `${Math.round(v * 100)}%` : Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 100) / 100);
      h += `<tr><td>${esc(c.label)}</td><td class="num">${f(c.x)}</td><td class="num">${f(c.y)}</td><td class="${c.real && c.worth ? '' : 'dim'}">${c.real && c.worth ? 'clear difference' : c.worth ? 'could be luck' : ''}</td></tr>`;
    }
    h += '</table></div>';
  }

  h += '<h3>Same-plane baselines</h3><canvas class="chart" id="chartBase" width="760" height="220"></canvas><p class="dim">The front when both sides fly the same plane, from the left side (all baselines together). This is how much it wanders by luck alone.</p>';
  h += '<table><tr><th>plane</th><th class="num">push (left side)</th><th class="num">spread (sd)</th><th class="num">matches</th></tr>';
  for (const b of r.baselines) if (b.n) h += `<tr><td>${esc(b.name)}</td><td class="num">${sign(b.push)} m</td><td class="num">${b.sd}</td><td class="num">${b.n}</td></tr>`;
  h += '</table>';
  return h;
}

// A bot training record: the plain-words summary, the tactics before and after, and each step taken.
function trainingHtml(t) {
  const name = (id) => esc(S.names[id] ?? id);
  let h = `<h3>Bot training</h3><div class="summary">${summariseTraining(t, S.names).map((s) => `<p>${esc(s)}</p>`).join('')}</div>`;
  h += `<p class="dim">Started ${esc(t.started.slice(0, 16).replace('T', ' '))}, ${t.matches} matches. Score: kills per life, each own crash or collision counted as ${t.options.penalty} kill lost.</p>`;
  h += '<h3>Tactics before and after</h3><div class="wide"><table><tr><th>plane</th>' + TACTIC_FIELDS.map(([, label]) => `<th>${esc(label)}</th>`).join('') + '</tr>';
  for (const id of t.options.planes) {
    const a = tacticsIn(t.before, id);
    const b = tacticsIn(t.after, id);
    h += `<tr><td>${name(id)}</td>${TACTIC_FIELDS.map(([k]) => `<td class="num${a[k] === b[k] ? ' dim' : ''}">${a[k] === b[k] ? b[k] : `${a[k]} → ${b[k]}`}</td>`).join('')}</tr>`;
  }
  h += '</table></div>';
  if (t.beforeStats) {
    h += '<h3>Check: every pairing, before and after</h3><table><tr><th>plane</th><th class="num">kills/life before</th><th class="num">after</th><th class="num">own crashes+collisions per life before</th><th class="num">after</th></tr>';
    for (const id of t.options.planes) {
      const b = t.beforeStats[id];
      const a = t.afterStats?.[id];
      h += `<tr><td>${name(id)}</td><td class="num">${b.killsPerLife}</td><td class="num">${a?.killsPerLife ?? '–'}</td><td class="num">${b.ownFaultPerLife}</td><td class="num">${a?.ownFaultPerLife ?? '–'}</td></tr>`;
    }
    h += '</table>';
  }
  h += '<h3>Steps</h3><table><tr><th>round</th><th>plane</th><th>kept changes (score gain ± noise)</th></tr>';
  for (const s of t.history) h += `<tr><td class="num">${s.round}</td><td>${name(s.plane)}</td><td class="dim" style="white-space:normal">${s.changes.length ? s.changes.map((c) => `${esc(c.key)} ${c.from} → ${c.to} (+${c.diff} ± ${Math.round(2 * c.se * 100) / 100})`).join(', ') : 'none beat the noise'}</td></tr>`;
  h += '</table>';
  return h;
}

// ---- The auto-tuner's record (tools/tune-planes.mjs): report, Apply, Undo, Discard ----
const localTime = (iso) => new Date(iso).toLocaleString('sv-SE').slice(0, 16);
const pct = (m) => `${m > 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`;
const shown = (v) => (Array.isArray(v) ? v.join(' / ') : v);
function tuningHtml(t) {
  const r = t.result;
  const name = (id) => esc(r.names[id] ?? S.names[id] ?? id);
  // Version 2 records measure the exchange share (air-to-air, the arena): push is the share - 50 in points.
  const exchange = t.measure === 'exchange';
  const sgn = (v) => (v == null ? '–' : exchange ? `${Math.round(50 + v)}%` : `${v > 0 ? '+' : ''}${Math.round(v)} m`);
  const unit = exchange ? 'points' : 'm';
  const state = t.applied ? `<p class="warn">Applied ${esc(localTime(t.applied.at))}: these numbers are in data/planes.json now (Undo puts the old ones back).</p>`
    : t.discarded ? `<p class="dim">Discarded ${esc(localTime(t.discarded))}.</p>` : '';
  let h = `<h3>Auto-tuner</h3>${state}<div class="summary">${t.summary.map((s) => `<p>${esc(s)}</p>`).join('')}</div>`;
  h += `<div class="row"><button id="tuneApply" ${t.applied || t.discarded || !r.changes.length ? 'disabled' : ''}>Apply</button> <button id="tuneUndo" ${t.applied ? '' : 'disabled'}>Undo</button> <button id="tuneDiscard" ${t.applied || t.discarded ? 'disabled' : ''}>Discard</button> <span id="tuneMsg" class="dim"></span></div>`;
  if (r.flights.length) h += `<h3>Test flights before Apply</h3><ul>${r.flights.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>`;
  h += `<h3>${exchange ? 'Exchange share' : 'Front push'} and kills per life, before and after</h3><table><tr><th>plane</th><th class="num">before</th><th class="num">after</th><th class="num">kills/life before</th><th class="num">after</th><th class="num">${exchange ? 'fresh seeds after' : 'full run after'}</th><th>left outside even</th></tr>`;
  const fresh = r.checks?.normal?.after;
  const full = t.checks?.['full-after'];
  for (const p of r.planes) {
    const out = r.outside.find((o) => o.plane === p);
    const f = fresh ? fresh[p] : full?.find((x) => x.id === p);
    h += `<tr><td>${name(p)}</td><td class="num">${sgn(r.before[p].push)}</td><td class="num">${sgn(r.after[p].push)}</td><td class="num">${r.before[p].kpl}</td><td class="num">${r.after[p].kpl}</td><td class="num">${f ? `${sgn(f.push)} ± ${Math.round(2 * f.se)}` : '–'}</td><td class="dim" style="white-space:normal">${out ? esc(out.why) : ''}</td></tr>`;
  }
  h += '</table>';
  h += '<h3>Changes and why</h3>';
  if (!r.changes.length) h += '<p class="dim">None.</p>';
  else {
    h += '<table><tr><th>plane</th><th>number</th><th class="num">now</th><th class="num">tuned</th><th class="num">change</th></tr>';
    for (const c of r.changes) h += `<tr><td>${name(c.plane)}</td><td>${esc(LEVER[c.key]?.label ?? c.key)}</td><td class="num">${esc(shown(c.from))}</td><td class="num">${esc(shown(c.to))}</td><td class="num">${pct(c.mult)}</td></tr>`;
    h += '</table><p class="dim">Each step was kept because it moved its plane towards even by more than the noise:</p><ul>';
    for (const s of r.history) if (s.kept) h += `<li>${name(s.plane)}: ${esc(LEVER[s.kept.key]?.label ?? s.kept.key)} ${pct(s.kept.from)} → ${pct(s.kept.to)}, ${exchange ? 'exchange share' : 'front push'} ${sgn(s.pushBefore)} → ${sgn(s.kept.pushAfter)} (gain ${s.kept.gain} ± ${Math.round(2 * s.kept.se * 10) / 10} ${unit} over ${s.kept.seeds} matches per setup)</li>`;
    h += '</ul>';
  }
  // The matchup grid, after: the row plane's exchange share against the column plane (version 1 records:
  // the kills-per-life ratio).
  h += exchange ? '<h3>Matchups after (exchange share of the row plane against the column; mild counters: 40-60%, never past 70/30)</h3><table><tr><th></th>' : '<h3>Matchups after (kills-per-life ratio, row against column; mild counters: under about 1.5, never past 2.3)</h3><table><tr><th></th>';
  for (const q of r.planes) h += `<th class="num">${name(q)}</th>`;
  h += '</tr>';
  for (const p of r.planes) {
    h += `<tr><td>${name(p)}</td>`;
    for (const q of r.planes) {
      const m = r.after[p].matchups[q];
      const lop = m ? Math.max(m.ratio, 1 / m.ratio) : 0;
      const cell = exchange ? (m ? `<td class="num${Math.abs(m.push) > 20 ? ' warn' : Math.abs(m.push) <= 10 ? ' dim' : ''}">${Math.round(50 + m.push)}%</td>` : '') : `<td class="num${lop > 2.3 ? ' warn' : lop <= 1.5 ? ' dim' : ''}">${m?.ratio}</td>`;
      h += p === q || !m ? '<td></td>' : cell;
    }
    h += '</tr>';
  }
  h += '</table>';
  if (t.duels?.after) {
    h += `<h3>Duels</h3><p>${t.duels.before.filter((d) => d.pass).length} pass before, ${t.duels.after.filter((d) => d.pass).length} after.`;
    if (t.duels.broken.length) h += ` <span class="warn">Passed before, fail now: ${t.duels.broken.map(esc).join(', ')}.</span>`;
    if (t.duels.fixed.length) h += ` Failed before, pass now: ${t.duels.fixed.map(esc).join(', ')}.`;
    h += ' The duels are reported, not a gate: most failures are bot problems.</p>';
  }
  const skillRow = (skill) => {
    if (exchange) {
      const c = r.checks?.[skill];
      return c ? `<tr><td>${skill}</td>${r.planes.map((p) => `<td class="num">${sgn(c.before[p].push)} → ${sgn(c.after[p].push)}</td>`).join('')}</tr>` : '';
    }
    const b = t.checks?.[`${skill}-before`];
    const a = t.checks?.[`${skill}-after`];
    if (!b || !a) return '';
    return `<tr><td>${skill}</td>${r.planes.map((p) => `<td class="num">${sgn(b.find((x) => x.id === p)?.push)} → ${sgn(a.find((x) => x.id === p)?.push)}</td>`).join('')}</tr>`;
  };
  const rowsSk = skillRow('easy') + skillRow('ace');
  if (rowsSk) h += `<h3>Check at easy and ace (${exchange ? 'exchange share' : 'quick runs, front push'} before → after)</h3><table><tr><th></th>${r.planes.map((p) => `<th class="num">${name(p)}</th>`).join('')}</tr>${rowsSk}</table>`;
  const changed = [...new Set(r.changes.map((c) => c.plane))];
  if (changed.length) {
    const keys = ['topSpeed', 'turnTime', 'slowTurnTime', 'climbRate', 'diveSpeed', 'zoomHeight', 'hp', 'topSpeedHigh', 'climbRateHigh', 'turnRateHigh', 'slowTurnRateHigh'];
    h += `<h3>Plane sheet of the changed planes (before → after)</h3><div class="wide"><table><tr><th>plane</th>${keys.map((k) => `<th class="num">${k}</th>`).join('')}</tr>`;
    for (const p of changed) h += `<tr><td>${name(p)}</td>${keys.map((k) => { const a = r.sheets.before[p][k]; const b = r.sheets.after[p][k]; return `<td class="num${a === b ? ' dim' : ''}">${a === b ? a : `${a} → ${b}`}</td>`; }).join('')}</tr>`;
    h += '</table></div>';
  }
  h += `<p class="dim">Tuned for ${Math.round(t.spent / 360) / 10} h of a ${t.hours} h budget, ${r.matchesFlown} matches; ended: ${esc(r.ended)}. Files: ${Object.values(t.files).filter(Boolean).map(esc).join(', ')}.</p>`;
  return h;
}

// Apply writes the tuned numbers into data/planes.json, only if the file still has the numbers the tuner
// started from; Undo writes those back. The record keeps what was done.
function wireTuning(t, file) {
  const msg = (text, warn) => {
    $('tuneMsg').textContent = text;
    $('tuneMsg').className = warn ? 'warn' : 'dim';
  };
  const setAll = async (which) => {
    const planes = await getJson('data/planes.json');
    const other = which === 'to' ? 'from' : 'to';
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const value = (def, key) => (key === 'ammo' ? def.armament.guns.map((g) => g.ammo) : def[key]);
    const off = t.result.changes.filter((c) => !same(value(planes[c.plane], c.key), c[other]));
    if (off.length) throw new Error(`data/planes.json changed since: ${off.map((c) => `${c.plane} ${c.key}`).join(', ')}. Nothing written.`);
    for (const c of t.result.changes) {
      const def = planes[c.plane];
      if (c.key === 'ammo') def.armament.guns.forEach((g, i) => { g.ammo = c[which][i]; });
      else def[c.key] = c[which];
    }
    await putJson('data/planes.json', planes);
  };
  const save = async () => {
    await putJson(`balance/results/${file}`, t);
    cache.set(file, t);
    showReport();
  };
  $('tuneApply').onclick = async () => {
    try {
      await setAll('to');
      t.applied = { at: new Date().toISOString() };
      await save();
    } catch (e) { msg(e.message, true); }
  };
  $('tuneUndo').onclick = async () => {
    try {
      await setAll('from');
      t.undone = new Date().toISOString();
      t.applied = null;
      await save();
    } catch (e) { msg(e.message, true); }
  };
  $('tuneDiscard').onclick = async () => {
    try {
      t.discarded = new Date().toISOString();
      await save();
    } catch (e) { msg(e.message, true); }
  };
}

function compareHtml(c, beforeFile, afterFile) {
  let h = `<h3>Compare two runs</h3><p class="dim">Before: ${esc(beforeFile)}<br />After: ${esc(afterFile)}</p>`;
  h += `<div class="summary">${c.summary.map((s) => `<p>${esc(s)}</p>`).join('')}</div>`;
  h += '<h3>Strength list</h3><div class="wide"><table><tr><th>plane</th><th class="num">before</th><th class="num">after</th><th class="num">change</th><th></th></tr>';
  for (const r of c.rows) h += `<tr><td>${esc(r.name)}</td><td class="num">${sign(r.before)} m</td><td class="num">${sign(r.after)} m</td><td class="num">${sign(r.change)}</td><td class="${r.real ? '' : 'dim'}">${r.real ? 'real change' : 'within noise'}</td></tr>`;
  h += '</table><h3>Matchups</h3><table><tr><th>matchup</th><th class="num">before</th><th class="num">after</th><th class="num">change</th><th></th></tr>';
  const name = (id) => esc(c.after.strength.find((p) => p.id === id)?.name ?? id);
  for (const m of c.matchups) h += `<tr><td>${name(m.x)} v ${name(m.y)}</td><td class="num">${sign(m.before)}</td><td class="num">${sign(m.after)}</td><td class="num">${sign(m.change)}</td><td class="${m.real ? '' : 'dim'}">${m.real ? 'real change' : 'within noise'}</td></tr>`;
  h += '</table>';
  return h;
}

// A front-over-time chart: one or more series { t, mean, lo, hi, colour }.
function chart(canvas, series) {
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const pad = { l: 46, r: 10, t: 10, b: 22 };
  g.clearRect(0, 0, W, H);
  const all = series.flatMap((s) => [...s.lo, ...s.hi]);
  const lim = Math.max(20, ...all.map(Math.abs));
  const tMax = Math.max(1, ...series.map((s) => s.t[s.t.length - 1] ?? 0));
  const X = (t) => pad.l + ((W - pad.l - pad.r) * t) / tMax;
  const Y = (v) => pad.t + ((H - pad.t - pad.b) * (lim - v)) / (2 * lim);
  g.font = '11px Courier New';
  g.fillStyle = '#7f837c';
  g.strokeStyle = '#2c3135';
  for (const v of [-lim, -lim / 2, 0, lim / 2, lim]) {
    g.beginPath();
    g.moveTo(pad.l, Y(v));
    g.lineTo(W - pad.r, Y(v));
    g.stroke();
    g.fillText(`${Math.round(v)} m`, 2, Y(v) + 4);
  }
  for (let m = 0; m <= tMax / 60; m += 5) g.fillText(`${m} min`, X(m * 60) - 10, H - 6);
  for (const s of series) {
    if (!s.t.length) continue;
    g.fillStyle = s.band;
    g.beginPath();
    s.t.forEach((t, i) => g.lineTo(X(t), Y(s.hi[i])));
    for (let i = s.t.length - 1; i >= 0; i--) g.lineTo(X(s.t[i]), Y(s.lo[i]));
    g.fill();
    g.strokeStyle = s.colour;
    g.lineWidth = 1.5;
    g.beginPath();
    s.t.forEach((t, i) => g.lineTo(X(t), Y(s.mean[i])));
    g.stroke();
    g.lineWidth = 1;
  }
}
function drawCharts(r) {
  const m = r.matchups.find((o) => `${o.x}|${o.y}` === selected);
  if (m) chart($('chartMatchup'), [{ ...m.series, colour: '#a8905c', band: 'rgba(168,144,92,0.18)' }]);
  const bases = r.baselines.filter((b) => b.n);
  if (bases.length) {
    // All baselines in one: the mean of the means, the widest band.
    const len = Math.min(...bases.map((b) => b.series.t.length));
    const s = { t: bases[0].series.t.slice(0, len), mean: [], lo: [], hi: [] };
    for (let i = 0; i < len; i++) {
      s.mean.push(bases.reduce((n, b) => n + b.series.mean[i], 0) / bases.length);
      s.lo.push(Math.min(...bases.map((b) => b.series.lo[i])));
      s.hi.push(Math.max(...bases.map((b) => b.series.hi[i])));
    }
    chart($('chartBase'), [{ ...s, colour: '#7f837c', band: 'rgba(127,131,124,0.15)' }]);
  }
}

// ---- Scenarios tab ----
const FIELDS = [
  ['title', 'title', 'text'],
  ['perSide', 'bots per side', 'number'],
  ['minutes', 'match length (game-minutes)', 'number'],
  ['skill', 'bot skill', ['easy', 'normal', 'ace']],
  ['map', 'map', ['countryside']],
  ['sample', 'front sampled every (s)', 'number'],
  ['seed', 'first seed', 'number'],
  ['sizes.quick', 'quick: matches per setup', 'number'],
  ['sizes.full', 'full: matches per setup', 'number'],
  ['sizes.matchup', 'one matchup: matches per setup', 'number'],
];
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  const at = keys.reduce((a, k) => (a[k] ??= {}), o);
  at[last] = v;
}
function fillScenarioForm() {
  const f = $('scenEdit').value;
  const s = withDefaults(S.scenarios[f] ?? {});
  $('scenForm').innerHTML = FIELDS.map(([key, label, type]) => {
    const v = getPath(s, key);
    const input = Array.isArray(type)
      ? `<select data-key="${key}">${type.map((o) => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input type="${type}" data-key="${key}" value="${esc(v ?? '')}" ${type === 'text' ? 'style="width:320px"' : ''} />`;
    return `<tr><td class="dim">${label}</td><td>${input}</td></tr>`;
  }).join('');
  $('scenPlanes').innerHTML = 'planes: ' + Object.keys(S.names).map((id) => `<label class="chk"><input type="checkbox" data-scen-plane="${esc(id)}" ${s.planes?.includes(id) ? 'checked' : ''} /> ${esc(S.names[id])}</label>`).join(' ');
}
$('scenEdit').onchange = fillScenarioForm;
function formScenario() {
  const s = structuredClone(S.scenarios[$('scenEdit').value] ?? {});
  for (const el of document.querySelectorAll('#scenForm [data-key]')) setPath(s, el.dataset.key, el.type === 'number' ? Number(el.value) : el.value);
  s.planes = [...document.querySelectorAll('[data-scen-plane]:checked')].map((el) => el.dataset.scenPlane);
  return s;
}
async function saveScenario(file, s) {
  await putJson(`balance/scenarios/${file}`, s);
  S.scenarios[file] = s;
  fillScenarios();
  $('scenEdit').value = file;
  fillScenarioForm();
  status(`Saved balance/scenarios/${file}`);
}
$('scenSave').onclick = () => saveScenario($('scenEdit').value, formScenario()).catch((e) => status(e.message, true));
$('scenSaveAs').onclick = () => {
  const name = prompt('Name for the new scenario (letters, digits, -)')?.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (!name) return;
  const s = { ...formScenario(), name };
  saveScenario(`${name}.json`, s).catch((e) => status(e.message, true));
};

// ---- start ----
try {
  await loadData();
  await loadLists();
  fillScenarios();
  trainEstimate();
  showTactics();
  status(`${Object.keys(S.scenarios).length} scenarios, ${S.results.length} runs saved`);
} catch (e) {
  status(`Could not load: ${e.message}. Open this page from the dev server (node tools/serve.mjs).`, true);
}
