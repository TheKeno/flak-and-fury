// Balance Lab page: runs a scenario's bot matches in Web Workers (src/balance/worker.js, the same runner
// as tools/balance.mjs), saves each run to balance/results/ through tools/serve.mjs, and shows the report
// (src/balance/analyse.js). Open as balance-lab.html on the dev server.
import { cleanContent, newRun, planMatches, runFileName, withDefaults } from '../balance/plan.js';
import { analyse, compareRuns } from '../balance/analyse.js';

const $ = (id) => document.getElementById(id);
const CORES = navigator.hardwareConcurrency || 4;
const SAVE_EVERY = 20; // matches between saves of a run in progress
const getJson = async (path) => {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};
const putJson = async (path, obj) => {
  const r = await fetch(path, { method: 'PUT', body: JSON.stringify(obj) });
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
  const [planes, weapons, ground, settings] = await Promise.all(['planes', 'weapons', 'ground', 'settings'].map((f) => getJson(`data/${f}.json`)));
  S.raw = { planes, weapons, ground, settings, maps: {} };
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
for (const el of document.querySelectorAll('input[name=mode], #mx, #my, #half')) el.onchange = estimate;
$('start').onclick = () => {
  S.queue.push({ ...chosenRun(), half: $('half').checked });
  showQueue();
  if (!S.active) nextRun();
};
$('cancel').onclick = () => {
  if (S.active) S.active.cancel();
};
function describe(q) {
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
    await runOne(q);
  } catch (e) {
    status(String(e.message ?? e), true);
  }
  S.active = null;
  $('cancel').disabled = true;
  $('busy').textContent = '';
  nextRun();
}

async function runOne(q) {
  const s = withDefaults(q.scenario);
  await loadMap(s.map);
  const run = newRun(s, { mode: q.mode, matchup: q.matchup, names: S.names });
  const file = `balance/results/${runFileName(run)}`;
  const jobs = planMatches(s, q.mode, q.matchup).map((j, index) => ({ ...j, index }));
  const results = new Array(jobs.length);
  const partial = new Map(); // index -> share done of a match in progress
  const n = Math.min(jobs.length, q.half ? Math.max(1, Math.floor(CORES / 2)) : CORES);
  const content = cleanContent(S.raw);
  const t0 = performance.now();
  let next = 0;
  let done = 0;
  let cancelled = false;
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
    $('current').textContent = `${describe(q)} — ${done} of ${jobs.length} matches on ${n} workers, ${clock(spent)} spent${left != null ? `, about ${clock(left)} left` : ''}${cancelled ? ' — stopping' : ''}`;
    $('progress').firstElementChild.style.width = `${(100 * progress) / jobs.length}%`;
    $('busy').textContent = `running ${Math.floor((100 * progress) / jobs.length)}%`;
    document.title = `${Math.floor((100 * progress) / jobs.length)}% Balance Lab`;
  };
  const tick = setInterval(show, 1000);
  await new Promise((resolve, reject) => {
    const workers = [];
    let live = n;
    S.active = {
      cancel: () => {
        cancelled = true;
        for (const w of workers) w.terminate();
        partial.clear();
        resolve();
      },
    };
    for (let i = 0; i < n; i++) {
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
        w.postMessage({ job: jobs[next++] });
      };
      w.onmessage = ({ data }) => {
        if (data.progress != null) partial.set(data.index, data.progress);
        else if (data.error) {
          for (const o of workers) o.terminate();
          reject(new Error(data.error));
        } else {
          partial.delete(data.index);
          results[data.index] = data.result;
          done++;
          if (done % SAVE_EVERY === 0) save().catch((e) => status(e.message, true));
          feed();
        }
      };
      w.onerror = (e) => reject(new Error(e.message || 'worker failed'));
      feed();
    }
  }).finally(() => clearInterval(tick));
  show();
  run.finished = new Date().toISOString();
  await save();
  const spent = (performance.now() - t0) / 1000;
  if (done && !cancelled) {
    try {
      localStorage.setItem('balanceLab.secPerGameMinute', String((spent * speedOf(n)) / done / s.minutes));
    } catch {}
  }
  document.title = 'Balance Lab';
  status(`Saved ${file} (${done} matches, ${clock(spent)})`);
  $('current').textContent = `Last: ${describe(q)} — ${done} matches${cancelled ? ' (cancelled)' : ''}, saved to ${file}.`;
  S.lastFile = file.split('/').pop();
  estimate();
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
    if (!run.matches.length) {
      el.innerHTML = '<p class="dim">This run has no matches yet.</p>';
      return;
    }
    const other = $('runCompare').value;
    if (other && other !== f) {
      const before = await loadRun(other);
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
  status(`${Object.keys(S.scenarios).length} scenarios, ${S.results.length} runs saved`);
} catch (e) {
  status(`Could not load: ${e.message}. Open this page from the dev server (node tools/serve.mjs).`, true);
}
