// The Sound Lab (sound-lab.html): audition and tune sounds without flying, on the game's own audio
// code, and save to data/sound.json. Open with ?mute to start silent.
import { createMixer } from '../audio/mixer.js';
import { createEngineVoice } from '../audio/engine-synth.js';
import { createTankEngine } from '../audio/loops.js';
import { buildVoices, renderGun as renderGunVoice } from '../audio/gun-voices.js';
import { spatialize } from '../audio/spatial.js';
import * as rawSfx from '../audio/sfx.js';
import { createFire, createBombWhistle, createScrape, createRadarStatic } from '../audio/loops.js';
import { createRecordings, newGroup, withRecordings } from '../audio/recordings.js';
import { DRIVERS } from '../audio/sound-data.js';

const sfx = withRecordings(rawSfx);

const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
};

const [sound, settings, planes, weapons, ground] = await Promise.all(
  ['sound', 'settings', 'planes', 'weapons', 'ground'].map((n) => json(`data/${n}.json`)),
);
const clone = (o) => JSON.parse(JSON.stringify(o));
let saved = clone(sound);
let dirty = false;

// path, label, min, max, step, explanation
const ENGINE_FIELDS = [
  ['res.0.0', 'Low stack, Hz', 30, 300, 1, 'The main exhaust resonance: the chest of the engine.'],
  ['res.0.1', 'Low sharpness', 1, 20, 0.1, 'Higher rings longer and more like a note.'],
  ['res.0.2', 'Low level', 0, 2, 0.01, ''],
  ['res.1.0', 'Mid stack, Hz', 100, 1000, 1, 'Sets the growl.'],
  ['res.1.1', 'Mid sharpness', 1, 20, 0.1, ''],
  ['res.1.2', 'Mid level', 0, 2, 0.01, ''],
  ['res.2.0', 'High stack, Hz', 400, 4000, 10, 'Rasp and crackle on top.'],
  ['res.2.1', 'High sharpness', 1, 20, 0.1, ''],
  ['res.2.2', 'High level', 0, 1, 0.01, ''],
  ['cylSpread', 'Cylinder unevenness', 0, 0.6, 0.01, 'Differences between cylinders. Low is a smooth V12, high is a lumpy radial.'],
  ['noise', 'Exhaust noise', 0, 1.5, 0.01, 'Burst of noise in each firing.'],
  ['crackle', 'Throttle-off crackle', 0, 1, 0.01, 'Pops when the throttle is closed at speed. Test with Load near 0.'],
  ['drive', 'Distortion', 0.5, 6, 0.1, 'How hard the sound is pushed into saturation.'],
  ['pulseMs', 'Pulse length, ms', 0.2, 5, 0.1, 'Length of the click in each firing.'],
  ['noiseMs', 'Noise length, ms', 0.5, 15, 0.1, 'Length of the noise in each firing.'],
  ['prop', 'Propeller whomp', 0, 1, 0.01, 'How much the blades chop the sound.'],
  ['washBase', 'Prop wash at idle', 0, 0.5, 0.01, ''],
  ['washLoad', 'Prop wash with load', 0, 1, 0.01, ''],
  ['toneBase', 'Brightness, base Hz', 200, 4000, 10, 'The low-pass filter opens from here.'],
  ['toneLoad', 'Brightness with load', 0, 10000, 50, ''],
  ['toneRpm', 'Brightness with rpm', 0, 3, 0.01, ''],
  ['presenceBase', 'Bite at idle, dB', -12, 12, 0.5, 'Boost or cut around 2.4 kHz.'],
  ['presenceLoad', 'Bite with load, dB', 0, 15, 0.5, ''],
  ['level', 'Volume', 0, 1.5, 0.01, ''],
  ['reverb', 'Reverb send', 0, 0.6, 0.01, ''],
  ['detune', 'Detune between engines', 0, 0.03, 0.0005, 'Only heard on planes with several engines: the beating of a twin.'],
];
const TANK_FIELDS = [
  ['engineIdle', 'Engine note idle, Hz', 10, 80, 1, ''],
  ['engineMove', 'Engine note moving, Hz', 10, 100, 1, ''],
  ['engineLp', 'Engine darkness, Hz', 80, 1200, 10, 'Lower is darker and further inside the hull.'],
  ['engineLevel', 'Engine level', 0, 1.5, 0.01, ''],
  ['lumpyIdle', 'Lumpiness idle, Hz', 1, 30, 0.5, 'Rate of the firing pulses.'],
  ['lumpyMove', 'Lumpiness moving, Hz', 1, 30, 0.5, ''],
  ['lumpyAmt', 'Lumpiness amount', 0, 1, 0.01, ''],
  ['trackFreq', 'Track pitch, Hz', 300, 5000, 10, 'The squeal of the tracks.'],
  ['trackQ', 'Track sharpness', 0.3, 12, 0.1, ''],
  ['chop', 'Track clank rate, Hz', 1, 25, 0.5, ''],
  ['chopAmt', 'Track clank depth', 0, 1, 0.01, ''],
  ['trackLevel', 'Track level', 0, 1.5, 0.01, ''],
  ['level', 'Overall volume', 0, 1.5, 0.01, ''],
];
const GUN_FIELDS = [
  ['crack', 'Crack level', 0, 2, 0.01, 'The supersonic snap.'],
  ['crackT', 'Crack length, s', 0.001, 0.03, 0.0005, ''],
  ['body', 'Body level', 0, 2.5, 0.01, 'The thump of the gas.'],
  ['bodyF', 'Body pitch, Hz', 20, 400, 1, ''],
  ['bodyT', 'Body length, s', 0.005, 0.4, 0.001, ''],
  ['tail', 'Tail level', 0, 2, 0.01, 'The gassy rush after the shot.'],
  ['tailT', 'Tail length, s', 0.005, 0.5, 0.001, ''],
  ['mech', 'Action level', 0, 1, 0.01, 'The mechanical clack.'],
  ['mechF', 'Action pitch, Hz', 300, 6000, 10, ''],
  ['dur', 'Total length, s', 0.03, 2, 0.01, 'Long enough for the tail, or it is cut off.'],
  ['level', 'Volume', 0, 2, 0.01, ''],
];
const SPACE_FIELDS = [
  ['reverbReturn', 'Reverb level', 0, 1, 0.01, 'How loud the reverb is overall.'],
  ['reverbSeconds', 'Reverb length, s', 0.2, 6, 0.1, ''],
  ['reverbDecay', 'Reverb decay', 0.5, 8, 0.1, 'Higher dies away faster.'],
  ['duckDepth', 'Ducking depth ×', 0, 2, 0.01, 'How far big bangs push engines and ambience down. 1 = as designed.'],
  ['duckRelease', 'Ducking release ×', 0.1, 4, 0.01, 'How slowly they come back. 1 = as designed.'],
  ['limiterThreshold', 'Limiter threshold, dB', -30, 0, 0.5, 'Loud sums get held under this.'],
  ['limiterRelease', 'Limiter release, s', 0.02, 1, 0.01, ''],
];
const LEVEL_FIELDS = [
  ['master', 'Master', 0, 2, 0.005, 'The game plays at this level too.'],
  ['engine', 'Engines and wind', 0, 2, 0.005, ''],
  ['sfx', 'Guns and explosions', 0, 2, 0.01, ''],
  ['ambience', 'Ambience', 0, 2, 0.01, ''],
  ['hearRange', 'Hearing range', 150, 2000, 10, 'Engines and most sounds fade out by this distance (a screen is about 480).'],
  ['bangRange', 'Bang range', 150, 3000, 10, 'The same for explosions, flak and gunfire.'],
];

// One-shots and impacts: audition only for now, their numbers are still in code. Each plays as the game does.
const ONE_SHOTS = {
  explosion: ['Explosion', (w) => sfx.explosion(mixer, w, 1)],
  flakBurst: ['Flak burst', (w) => sfx.flakBurst(mixer, w)],
  touchdown: ['Touchdown', (w) => sfx.touchdown(mixer, w, 40)],
  gearDown: ['Gear motor', (w) => sfx.gearMotor(mixer, w, 1.2, true)],
  bellyCrunch: ['Belly crunch', (w) => sfx.bellyCrunch(mixer, w, 40)],
  midair: ['Midair collision', (w) => sfx.midair(mixer, w, 1, false)],
  helmetCreak: ['Helmet creak', () => sfx.helmetCreak(mixer)],
  gearHorn: ['Gear-up horn', () => sfx.gearHorn(mixer)],
  ignite: ['Fire ignites', (w) => sfx.ignite(mixer, w)],
  rollWhoosh: ['Roll whoosh', (w) => sfx.rollWhoosh(mixer, w)],
  shrapnel: ['Shrapnel on the airframe', () => sfx.shrapnel(mixer, voices, 5)],
  collapseMasonry: ['Building collapses', (w) => sfx.collapse(mixer, w, 'masonry', 1)],
  collapseMetal: ['Metal collapses', (w) => sfx.collapse(mixer, w, 'metal', 1)],
  collapseWood: ['Wood collapses', (w) => sfx.collapse(mixer, w, 'wood', 1)],
  collapseCanvas: ['Canvas collapses', (w) => sfx.collapse(mixer, w, 'canvas', 1)],
  splash: ['Splash', (w) => sfx.splash(mixer, w)],
  fireOut: ['Fire put out', (w) => sfx.fireOut(mixer, w)],
  hammering: ['Hammering', (w) => sfx.hammering(mixer, w)],
  radarPowerDown: ['Radar power-down', () => sfx.radarPowerDown(mixer)],
  clank: ['Bullet on metal', (w) => sfx.play(mixer, voices.clank, w, { gain: 0.7, reverb: 0.2 })],
  thunk: ['Being hit', (w) => sfx.play(mixer, voices.thunk, w, { gain: 0.6 })],
  snap: ['Near miss', (w) => sfx.play(mixer, voices.snap, w, { gain: 0.35, reverb: 0.05 })],
  thud: ['Bullet in soil', (w) => sfx.play(mixer, voices.thud, w, { gain: 0.5 })],
  patter: ['Splinter tick', (w) => sfx.play(mixer, voices.patter, w, { gain: 0.4 })],
  release: ['Bomb release', (w) => sfx.play(mixer, voices.release, w, { gain: 0.7, rate: 0.8 })],
  click: ['Empty gun click', (w) => sfx.play(mixer, voices.click, w, { gain: 0.5 })],
};
// Tracked here so they can be ticked and noted; their audition comes with the recording stage.
const LOOPS = { wind: 'Wind, dive scream, stall, wheels', bombWhistle: 'Bomb whistle', scrape: 'Belly scrape', fire: 'Burning fire', radarStatic: 'Radar static', heartbeat: 'Heartbeat and breathing', crew: 'Ground crew at work' };
// Loops that can be auditioned here, with the value the game drives them by.
const LOOP_TEST = {
  fire: ['Intensity', 0, 1, 0.7, (m) => createFire(m)],
  bombWhistle: ['Fall speed', 0, 300, 150, (m) => createBombWhistle(m)],
  scrape: ['Speed', 0, 100, 40, (m) => createScrape(m)],
  radarStatic: ['Level', 0, 1, 0.5, (m) => createRadarStatic(m)],
};

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k !== null && k !== undefined));
  return e;
};
const getPath = (o, path) => path.split('.').reduce((a, k) => a[k], o);
const setPath = (o, path, v) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((a, k) => a[k], o)[last] = v;
};
const statusOf = (id) => (sound.status[id] ??= {});

// Changes go to a running game in another window as they happen. The game keeps them until it
// reloads, so Save stays what makes them last. Only volumes that changed are sent, so the player's
// own options in that browser aren't overwritten.
const channel = new BroadcastChannel('flak-sound-lab');
let sentAudio = clone(settings.audio);
let sendTimer = 0;
let sendFinal = false;
function broadcast(final) {
  sendFinal ||= final;
  if (sendTimer) return;
  sendTimer = setTimeout(() => {
    const audio = Object.fromEntries(Object.entries(settings.audio).filter(([k, v]) => sentAudio[k] !== v));
    sentAudio = clone(settings.audio);
    channel.postMessage({ type: 'sound', sound, audio, final: sendFinal });
    sendTimer = 0;
    sendFinal = false;
  }, 50);
}
let lastHere = -Infinity;
channel.onmessage = ({ data }) => {
  if (data.type === 'here') lastHere = performance.now();
};
setInterval(() => {
  channel.postMessage({ type: 'ping' });
  const linked = performance.now() - lastHere < 4000;
  $('link').textContent = linked ? 'Game linked' : 'No game linked';
  $('link').style.color = linked ? 'var(--done)' : '';
}, 1500);

const touch = () => {
  broadcast(true);
  dirty = true;
  $('save').textContent = 'Save *';
  $('save').classList.add('on');
};

let mixer = null;
let voices = null;
let scope = null;
let muted = new URLSearchParams(location.search).has('mute');
let tab = 'design';
let design = { type: 'build', id: 'inline' };
const drops = new Map(); // what the last drop on a slot should warn about
let slotPlaying = null; // the one slot heard on its own, stopped by a second click
let selected = 'build:inline';
let vehicleSel = null;
let filterNotDone = false;
const vehicleFilter = { nation: '', kind: '', status: '', notDone: false, sort: 'nation', dir: 1 };

// Audio can only start from a click, so everything waits for the first one that needs it.
async function audio() {
  if (!mixer) {
    mixer = await createMixer(settings.audio, sound.space);
    mixer.recordings = createRecordings(mixer, sound);
    await mixer.recordings.load();
    voices = buildVoices(mixer.ctx, sound.guns);
    mixer.setMuted(muted);
    scope = mixer.ctx.createAnalyser();
    scope.fftSize = 1024;
    mixer.limiter.connect(scope);
    drawScope();
  }
  if (mixer.ctx.state === 'suspended') await mixer.ctx.resume();
  return mixer;
}

function drawScope() {
  const c = $('scope');
  const g = c.getContext('2d');
  const d = new Float32Array(scope.fftSize);
  const step = () => {
    scope.getFloatTimeDomainData(d);
    // The master level is often tiny, so the picture is scaled to it to stay readable.
    const zoom = 1 / Math.max(0.02, 0.9 * settings.audio.master);
    g.fillStyle = '#0b0c0d';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#a8905c';
    g.beginPath();
    for (let i = 0; i < d.length; i += 3) {
      const x = (i / d.length) * c.width;
      const y = c.height / 2 - Math.max(-1, Math.min(1, d[i] * zoom)) * (c.height / 2);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    requestAnimationFrame(step);
  };
  step();
}

// Listening position, shared by everything played: the game's own distance model.
const listen = { distance: 0 };
const where = (x = listen.distance, range = settings.audio.hearRange, vx = 0) =>
  (x === 0 && vx === 0 ? { dist: 0, pan: 0, gain: 1, cutoff: 18000, delay: 0, doppler: 1 } : spatialize({ x: 0, y: 0, vx: 0, vy: 0 }, x, 0, vx, 0, range));

// Whatever is playing on the open page.
let live = null;
function stopLive() {
  live?.stop();
  live = null;
}

function slider(obj, [path, label, min, max, step, tip], onChange, locked) {
  const out = el('output', { textContent: getPath(obj, path) });
  const input = el('input', { type: 'range', min, max, step, value: getPath(obj, path), title: tip, disabled: locked });
  input.oninput = () => {
    const v = Number(input.value);
    setPath(obj, path, v);
    out.textContent = v;
    onChange?.(false);
    if (obj !== listen) broadcast(false);
  };
  input.onchange = () => {
    touch();
    onChange?.(true);
  };
  return el('label', { className: 'field', title: tip }, el('span', { textContent: label }), input, out);
}

const testSlider = (state, key, label, min, max, step) => {
  const out = el('output', { textContent: state[key] });
  const input = el('input', { type: 'range', min, max, step, value: state[key] });
  input.oninput = () => {
    state[key] = Number(input.value);
    out.textContent = state[key];
  };
  return el('label', { className: 'field' }, el('span', { textContent: label }), input, out);
};

const distanceControl = () => testSlider(listen, 'distance', 'Listen from, distance', 0, 1500, 10);

function button(text, fn, title) {
  return el('button', { textContent: text, title, onclick: fn });
}

// Vehicles using a build, for "what does this change".
function vehiclesOnBuild(buildId) {
  return sound.vehicles.filter((v) => sound.engines[v.engine]?.build === buildId);
}
const engineOf = (v) => {
  const eng = sound.engines[v.engine] ?? { cylinders: 12 };
  const data = planes[v.id]?.engine ?? v.estimate ?? {};
  return { cylinders: eng.cylinders, idleRpm: data.idleRpm ?? 800, cruiseRpm: data.cruiseRpm ?? 2300, maxRpm: data.maxRpm ?? 2800, propBlades: data.propBlades ?? 3, gearRatio: data.gearRatio ?? 0.6 };
};
const inGame = (v) => Boolean(planes[v.id] || (ground[v.id] && v.kind === 'tank'));

// The left list: every sound with its tick.
function soundItems() {
  const builds = (kind) => Object.entries(sound.builds).filter(([, b]) => b.kind === kind).map(([id, b]) => [`build:${id}`, b.name]);
  return [
    ['Aircraft engine builds', builds('plane')],
    ['Tank builds', builds('tank')],
    ['Guns', Object.keys(sound.guns).map((n) => [`gun:${n}`, gunTitle(n)])],
    ['One-shots and impacts', Object.entries(ONE_SHOTS).map(([id, [name]]) => [`sfx:${id}`, name])],
    ['Loops', Object.entries(LOOPS).map(([id, name]) => [`loop:${id}`, name])],
    ['Your layers', Object.entries(sound.layers).map(([id, l]) => [`layer:${id}`, l.name])],
  ];
}
const GUN_NAMES = { rifle: 'Rifle-calibre MG', heavy: 'Heavy MG', cannon20: '20 mm cannon', cannon30: '30 mm cannon', infantryRifle: 'Infantry rifle', flakGun: 'Flak gun', tankGun: 'Tank gun' };
const gunTitle = (n) => GUN_NAMES[n] ?? n;

function updateCount() {
  const all = soundItems().flatMap(([, items]) => items);
  const done = all.filter(([id]) => sound.status[id]?.done).length;
  const files = allFiles();
  const mb = files.reduce((a, f) => a + (f.size ?? 0), 0) / 1e6;
  $('count').textContent = `${done} / ${all.length} done · ${files.length} recordings, ${mb.toFixed(1)} MB`;
}

function renderList() {
  const list = $('list');
  list.replaceChildren();
  list.style.display = tab === 'sounds' || tab === 'design' ? '' : 'none';
  if (tab === 'design') return renderPicker();
  if (tab !== 'sounds') return;
  const filter = el('input', { type: 'checkbox', checked: filterNotDone, onchange: (e) => { filterNotDone = e.target.checked; renderList(); } });
  list.append(el('label', {}, filter, ' only not done'), el('div', { className: 'buttons' }, button('New layer', addLayer, 'Your own sound, attached to vehicles: wing creak, tracks, rattles')));
  for (const [group, items] of soundItems()) {
    const shown = items.filter(([id]) => !filterNotDone || !sound.status[id]?.done);
    if (!shown.length) continue;
    list.append(el('div', { className: 'group', textContent: group }));
    for (const [id, name] of shown) {
      const done = Boolean(sound.status[id]?.done);
      const tick = el('input', { type: 'checkbox', checked: done, title: 'Finished: locks its sliders' });
      tick.onclick = (e) => e.stopPropagation();
      tick.onchange = () => {
        statusOf(id).done = tick.checked;
        touch();
        updateCount();
        renderList();
        if (id === selected) renderMain();
      };
      const flagged = licenceFlag(id);
      list.append(el('div', {
        className: `row${id === selected ? ' sel' : ''}${done ? ' isdone' : ''}`,
        onclick: () => {
          selected = id;
          renderList();
          renderMain();
        },
      }, tick, el('span', { textContent: name }), flagged ? el('b', { className: 'warn', title: flagged, textContent: ' !' }) : null));
    }
  }
}

// Notes on any page: the facts, and your own line.
function notesPanel(id, hasReference = true) {
  const s = statusOf(id);
  const area = (key, hint) => {
    const t = el('textarea', { value: s[key] ?? '', placeholder: hint });
    t.onchange = () => {
      s[key] = t.value;
      touch();
    };
    return t;
  };
  return el('div', { className: 'wide' },
    hasReference ? el('h3', { textContent: 'Reference' }) : null,
    hasReference ? area('reference', 'Facts about this sound') : null,
    el('h3', { textContent: 'Your notes' }),
    area('note', 'e.g. too thin at distance'));
}

// Saved values come back while the button is held, and on Reset for good.
function compareButtons(id, getCurrent, getSaved, write, apply) {
  let keep = null;
  const hold = el('button', { textContent: 'Hold: hear saved', title: 'Plays the last saved version while held' });
  hold.onpointerdown = () => {
    keep = clone(getCurrent());
    const s = getSaved();
    if (s) {
      write(clone(s));
      apply();
      broadcast(true);
    }
  };
  const release = () => {
    if (!keep) return;
    write(keep);
    keep = null;
    apply();
    broadcast(true);
  };
  hold.onpointerup = release;
  hold.onpointerleave = release;
  return el('div', { className: 'buttons' }, hold,
    button('Reset to saved', () => {
      const s = getSaved();
      if (!s) return;
      write(clone(s));
      apply();
      touch();
      renderMain();
    }),
    button('Copy as text', () => navigator.clipboard?.writeText(JSON.stringify({ [id]: getCurrent() }, null, 2)), 'To paste to Claude or keep somewhere'));
}

function pageHead(id, title, sub) {
  const done = Boolean(sound.status[id]?.done);
  return el('div', {}, el('h2', { textContent: title }),
    sub ? el('div', { className: 'dim', textContent: sub }) : null,
    done ? el('div', { className: 'warn', textContent: 'Marked done: untick it in the list to change it.' }) : null);
}

function renderPlaneBuild(id, buildId) {
  const build = sound.builds[buildId];
  const locked = Boolean(sound.status[id]?.done);
  const using = vehiclesOnBuild(buildId);
  const state = { vehicle: using.find(inGame)?.id ?? using[0]?.id ?? 'spitfire', rpm: 2300, load: 0.8, roughness: 0.1, misfire: 0 };
  const box = el('div', {});
  let voice = null;
  let flyby = 0;
  const play = async () => {
    await audio();
    stopLive();
    const v = sound.vehicles.find((x) => x.id === state.vehicle);
    const spec = v ? engineOf(v) : { cylinders: 12, propBlades: 3, gearRatio: 0.6 };
    voice = createEngineVoice(mixer, spec, build, v?.count ?? 1);
    voice.start();
    playBtn.textContent = 'Stop';
    let frame = 0;
    const tick = () => {
      const t = flyby ? (mixer.now - flyby) / 6 : 0;
      if (t >= 1) flyby = 0;
      const w = flyby ? where(-700 + t * 1400, settings.audio.hearRange, 233) : where();
      voice.update({ ...state, gain: w.gain, pan: w.pan, cutoff: w.cutoff, doppler: w.doppler });
      frame = requestAnimationFrame(tick);
    };
    tick();
    live = {
      stop() {
        cancelAnimationFrame(frame);
        voice.dispose();
        voice = null;
        playBtn.textContent = 'Play';
      },
    };
  };
  const playBtn = button('Play', () => (voice ? stopLive() : play()));
  const select = el('select', { onchange: () => {
    state.vehicle = select.value;
    if (voice) play();
  } }, ...sound.vehicles.filter((v) => v.kind === 'plane').map((v) => el('option', { value: v.id, textContent: `${v.name}${v.count > 1 ? ` × ${v.count}` : ''}`, selected: v.id === state.vehicle })));
  box.append(
    pageHead(id, build.name, `Changes ${using.length} vehicles: ${using.map((v) => v.name).join(', ') || 'none'}`),
    el('h3', { textContent: 'Test' }),
    el('div', { className: 'buttons' }, playBtn, 'as', select,
      button('Start-up', () => voice?.start(), 'Starter motor and catching'),
      button('Failure', () => {
        state.misfire = 1;
        state.rpm = 700;
        setTimeout(() => renderTestValues(), 0);
      }, 'Sets misfire to full and drops the rpm'),
      button('Flyby', () => { if (mixer) flyby = mixer.now; }, 'Passes by over 6 seconds with Doppler and distance')),
  );
  const tests = el('div', {});
  const renderTestValues = () => tests.replaceChildren(
    testSlider(state, 'rpm', 'Rpm', 300, 3200, 10),
    testSlider(state, 'load', 'Load (throttle)', 0, 1, 0.01),
    testSlider(state, 'roughness', 'Roughness', 0, 1, 0.01),
    testSlider(state, 'misfire', 'Misfire', 0, 1, 0.01),
  );
  renderTestValues();
  const apply = () => voice?.setSynth(build.synth);
  box.append(tests, distanceControl(), el('h3', { textContent: 'Character' }),
    compareButtons(id, () => build.synth, () => saved.builds[buildId]?.synth, (v) => { build.synth = v; }, apply),
    clipPanel(id, 'plane'), ...ENGINE_FIELDS.map((f) => slider(build.synth, f, apply, locked)), notesPanel(id));
  return box;
}

function renderTankBuild(id, buildId) {
  const build = sound.builds[buildId];
  const locked = Boolean(sound.status[id]?.done);
  const using = vehiclesOnBuild(buildId);
  const state = { moving: true };
  let voice = null;
  const play = async () => {
    await audio();
    stopLive();
    voice = createTankEngine(mixer, build);
    playBtn.textContent = 'Stop';
    let frame = 0;
    const tick = () => {
      voice.update(where(), state.moving);
      frame = requestAnimationFrame(tick);
    };
    tick();
    live = {
      stop() {
        cancelAnimationFrame(frame);
        voice.stop();
        voice = null;
        playBtn.textContent = 'Play';
      },
    };
  };
  const playBtn = button('Play', () => (voice ? stopLive() : play()));
  const moving = el('input', { type: 'checkbox', checked: true, onchange: () => { state.moving = moving.checked; } });
  const isDefault = el('input', { type: 'checkbox', checked: sound.defaultTankBuild === buildId, disabled: sound.defaultTankBuild === buildId, onchange: () => {
    sound.defaultTankBuild = buildId;
    touch();
    renderMain();
  } });
  const apply = () => voice?.setSynth(build.synth);
  return el('div', {},
    pageHead(id, build.name, `Vehicles: ${using.map((v) => v.name).join(', ') || 'none'}`),
    el('h3', { textContent: 'Test' }),
    el('div', { className: 'buttons' }, playBtn, el('label', {}, moving, ' moving')),
    distanceControl(),
    el('label', {}, isDefault, ' played by the generic tank in the game today'),
    el('h3', { textContent: 'Character' }),
    compareButtons(id, () => build.synth, () => saved.builds[buildId]?.synth, (v) => { build.synth = v; }, apply),
    clipPanel(id, 'tank'), ...TANK_FIELDS.map((f) => slider(build.synth, f, apply, locked)), notesPanel(id));
}

function renderGun(id, name) {
  const recipe = sound.guns[name];
  const locked = Boolean(sound.status[id]?.done);
  const users = Object.entries(weapons).filter(([, w]) => w?.voice === name);
  const rpmOf = users[0]?.[1].rpm ?? 500;
  const state = { rpm: rpmOf };
  let burst = 0;
  // Same two offset layers as the game's own shot.
  const fire = () => {
    const w = where(listen.distance, settings.audio.bangRange);
    const near = listen.distance === 0;
    const gain = near ? 0.42 : 0.8;
    sfx.play(mixer, voices[name], w, { gain, reverb: near ? 0.08 : 0.3 });
    sfx.play(mixer, voices[name], w, { gain: gain * 0.45, rate: 0.93, offset: 0.007 });
  };
  const stopBurst = () => {
    clearTimeout(burst);
    burst = 0;
    live = null;
    burstBtn.classList.remove('on');
  };
  const burstBtn = button('Burst', async () => {
    await audio();
    if (burst) return stopBurst();
    stopLive();
    live = { stop: stopBurst };
    burstBtn.classList.add('on');
    const shot = () => {
      fire();
      burst = setTimeout(shot, 60000 / state.rpm);
    };
    shot();
  }, 'Fires until pressed again');
  const apply = (final) => {
    if (final && voices) voices[name] = renderGunVoice(mixer.ctx, recipe, name); // re-rendered when the slider is let go
  };
  return el('div', {},
    pageHead(id, gunTitle(name), users.length ? `Used by: ${users.map(([w]) => w).join(', ')}` : 'Ground weapon'),
    el('h3', { textContent: 'Test' }),
    el('div', { className: 'buttons' }, button('Fire', async () => { await audio(); fire(); }), burstBtn),
    testSlider(state, 'rpm', 'Rounds per minute', 60, 2000, 10),
    distanceControl(),
    el('h3', { textContent: 'Character' }),
    compareButtons(id, () => recipe, () => saved.guns[name], (v) => Object.assign(recipe, v), () => apply(true)),
    recordingPanel(id), ...GUN_FIELDS.map((f) => slider(recipe, f, apply, locked)), notesPanel(id));
}

function renderOneShot(id, key) {
  const [name, fn] = ONE_SHOTS[key];
  return el('div', {}, pageHead(id, name),
    el('p', { className: 'dim', textContent: 'The synthesized numbers are still in the code. Use its Synth level and recordings below.' }),
    el('div', { className: 'buttons' }, button('Play', async () => { await audio(); fn(where(listen.distance, settings.audio.bangRange)); })),
    distanceControl(), recordingPanel(id), notesPanel(id));
}

function renderLoop(id, key) {
  const test = LOOP_TEST[key];
  const state = { value: test?.[3] ?? 1 };
  let voice = null;
  const stop = () => {
    voice?.stop();
    voice = null;
  };
  const playBtn = test ? button('Play', async () => {
    if (voice) return stopLive();
    await audio();
    stopLive();
    const parts = [test[4](mixer.recordings.scoped(id)), ...(mixer.recordings.rec(id)?.groups ?? []).map((g) => mixer.recordings.createLoop(g)).filter(Boolean)];
    const [synthVoice, ...recorded] = parts;
    voice = { stop() { synthVoice.stop(); recorded.forEach((r) => r.stop()); } };
    let frame = 0;
    const tick = () => {
      const w = where();
      if (key === 'radarStatic') synthVoice.update(state.value);
      else synthVoice.update(w, state.value);
      recorded.forEach((r) => r.update(w, state.value));
      frame = requestAnimationFrame(tick);
    };
    tick();
    playBtn.textContent = 'Stop';
    live = { stop() { cancelAnimationFrame(frame); stop(); playBtn.textContent = 'Play'; } };
  }) : null;
  return el('div', {}, pageHead(id, LOOPS[key]),
    test ? el('div', {}, el('div', { className: 'buttons' }, playBtn), testSlider(state, 'value', test[0], test[1], test[2], (test[2] - test[1]) / 100), distanceControl())
      : el('p', { className: 'dim', textContent: 'No audition here yet: listen to it in the game. Its Synth level works; to add a recording, make a layer and attach it to the planes.' }),
    recordingPanel(id, test ? { loop: true, driver: test[0] } : { synthOnly: true }), notesPanel(id));
}

// The Vehicles tab: the whole roster, and one vehicle's sound set-up.
function renderVehicles() {
  const f = vehicleFilter;
  const nations = [...new Set(sound.vehicles.map((v) => v.nation))];
  const pick = (key, options) => el('select', { onchange: (e) => { f[key] = e.target.value; renderMain(); } },
    ...options.map(([value, text]) => el('option', { value, textContent: text, selected: f[key] === value })));
  const row = (v) => {
    const eng = sound.engines[v.engine];
    const build = sound.builds[eng?.build];
    return { v, nation: v.nation, name: v.name, engine: eng?.name ?? '?', count: v.count, layout: eng ? `${eng.layout} ${eng.cylinders}` : '', status: inGame(v) ? 'In game' : v.later ? 'Later' : 'Planned', build: build?.name ?? '?', done: sound.status[`build:${eng?.build}`]?.done ? 'Done' : '' };
  };
  const rows = sound.vehicles.map(row)
    .filter((r) => (!f.nation || r.nation === f.nation) && (!f.kind || r.v.kind === f.kind) && (!f.status || r.status === f.status) && (!f.notDone || !r.done))
    .sort((a, b) => String(a[f.sort]).localeCompare(String(b[f.sort]), undefined, { numeric: true }) * f.dir);
  const COLS = [['nation', 'Nation'], ['name', 'Vehicle'], ['engine', 'Engine'], ['count', '×'], ['layout', 'Layout'], ['status', 'Status'], ['build', 'Sound build'], ['done', 'Done']];
  const head = el('tr', {}, ...COLS.map(([key, text]) => el('th', { textContent: text + (f.sort === key ? (f.dir > 0 ? ' ▲' : ' ▼') : ''), onclick: () => {
    f.dir = f.sort === key ? -f.dir : 1;
    f.sort = key;
    renderMain();
  } })));
  const body = rows.map((r) => el('tr', { onclick: () => { design = { type: 'vehicle', id: r.v.id }; setTab('design'); } },
    ...COLS.map(([key]) => (key === 'engine'
      ? el('td', {}, r.engine, sound.engines[r.v.engine]?.checked ? null : el('span', { className: 'dim', textContent: ' (unchecked)' }))
      : key === 'status'
        ? el('td', {}, el('span', { className: `badge${r.status === 'In game' ? ' game' : ''}`, textContent: r.status }))
        : el('td', { textContent: r[key] })))));
  const notDone = el('input', { type: 'checkbox', checked: f.notDone, onchange: () => { f.notDone = notDone.checked; renderMain(); } });
  return el('div', {},
    vehicleSel ? renderVehicle(vehicleSel) : null,
    el('h2', { textContent: `Vehicles (${rows.length})` }),
    el('div', { className: 'buttons' },
      pick('nation', [['', 'All nations'], ...nations.map((n) => [n, n])]),
      pick('kind', [['', 'Aircraft and tanks'], ['plane', 'Aircraft'], ['tank', 'Tanks']]),
      pick('status', [['', 'Any status'], ['In game', 'In game'], ['Planned', 'Planned'], ['Later', 'Later']]),
      el('label', {}, notDone, ' not done'),
      button('Add vehicle', addVehicle),
      button('Add engine', addEngine)),
    el('table', {}, el('thead', {}, head), el('tbody', {}, ...body)),
    el('p', { className: 'dim', textContent: 'Engine names and planned rpm are from memory, not checked against references, until ticked on the vehicle.' }));
}

function addVehicle() {
  const name = prompt('Name of the new vehicle?');
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (sound.vehicles.some((v) => v.id === id)) return alert('That vehicle is already there.');
  const engine = Object.keys(sound.engines)[0];
  sound.vehicles.push({ id, name, nation: 'Germany', kind: 'plane', engine, count: 1, estimate: { idleRpm: 800, cruiseRpm: 2300, maxRpm: 2800, propBlades: 3, gearRatio: 0.6 } });
  vehicleSel = id;
  touch();
  renderMain();
}

function addEngine() {
  const name = prompt('Name of the new engine?');
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (sound.engines[id]) return alert('That engine is already there.');
  sound.engines[id] = { name, layout: 'inline', cylinders: 12, build: 'inline', checked: false };
  touch();
  renderMain();
}

function renderVehicle(id) {
  const v = sound.vehicles.find((x) => x.id === id);
  if (!v) return null;
  const engId = v.engine;
  const eng = sound.engines[engId];
  const change = (fn) => (e) => {
    fn(e.target);
    touch();
    renderMain();
  };
  const textField = (label, obj, key, type = 'text') => el('label', { className: 'field' }, el('span', { textContent: label }),
    el('input', { type, value: obj[key] ?? '', onchange: change((t) => { obj[key] = type === 'number' ? Number(t.value) : t.value; }) }), el('span'));
  const choose = (label, value, options, fn) => el('label', { className: 'field' }, el('span', { textContent: label }),
    el('select', { onchange: change((t) => fn(t.value)) }, ...options.map(([k, text]) => el('option', { value: k, textContent: text, selected: k === value }))), el('span'));
  const builds = Object.entries(sound.builds).filter(([, b]) => b.kind === v.kind).map(([k, b]) => [k, b.name]);
  const sharing = eng ? sound.vehicles.filter((x) => x.engine === engId).map((x) => x.name).join(', ') : '';
  return el('div', { className: 'wide' },
    el('h2', { textContent: v.name }),
    el('div', { className: 'dim', textContent: `${inGame(v) ? 'In game' : v.later ? 'Later' : 'Planned'} · id ${v.id}` }),
    el('div', { className: 'buttons' },
      button('Open sound build', () => { selected = `build:${eng?.build}`; setTab('sounds'); }),
      button('Close', () => { vehicleSel = null; renderMain(); })),
    textField('Name', v, 'name'),
    textField('Nation', v, 'nation'),
    choose('Kind', v.kind, [['plane', 'Aircraft'], ['tank', 'Tank']], (k) => { v.kind = k; }),
    choose('Engine', engId, Object.entries(sound.engines).map(([k, e]) => [k, e.name]), (k) => { v.engine = k; }),
    textField('Engines on it', v, 'count', 'number'),
    v.estimate && !planes[v.id] ? el('div', {}, el('h3', { textContent: 'Estimated numbers, until it is built' }),
      textField('Idle rpm', v.estimate, 'idleRpm', 'number'), textField('Cruise rpm', v.estimate, 'cruiseRpm', 'number'), textField('Max rpm', v.estimate, 'maxRpm', 'number'), textField('Propeller blades', v.estimate, 'propBlades', 'number'), textField('Gear ratio', v.estimate, 'gearRatio', 'number')) : null,
    eng ? el('div', {}, el('h3', { textContent: `Engine: ${eng.name}` }),
      el('div', { className: 'dim', textContent: `Used by: ${sharing}` }),
      textField('Engine name', eng, 'name'),
      choose('Layout', eng.layout, [['inline', 'Inline'], ['radial', 'Radial']], (k) => { eng.layout = k; }),
      textField('Cylinders', eng, 'cylinders', 'number'),
      choose('Sound build', eng.build, builds, (k) => { eng.build = k; }),
      el('label', {}, el('input', { type: 'checkbox', checked: Boolean(eng.checked), onchange: change((t) => { eng.checked = t.checked; }) }), ' engine details checked against a reference'),
      el('div', { className: 'buttons' }, button('Make own copy', () => makeOwnCopy(engId), 'Gives this engine its own build, starting as an exact copy')),
      notesPanel(`engine:${engId}`)) : null,
    el('h3', { textContent: 'Your layers on it' }),
    el('div', {}, ...layerList(v)),
    el('hr'));
}

function makeOwnCopy(engId) {
  const eng = sound.engines[engId];
  const from = sound.builds[eng.build];
  let id = `${engId}Build`;
  for (let n = 2; sound.builds[id]; n++) id = `${engId}Build${n}`;
  sound.builds[id] = { ...clone(from), name: eng.name };
  // The recordings come along, and so do the layers attached to the build it left.
  if (sound.recordings[`build:${eng.build}`]) sound.recordings[`build:${id}`] = clone(sound.recordings[`build:${eng.build}`]);
  for (const l of Object.values(sound.layers)) if (l.attach[`build:${eng.build}`]) l.attach[`build:${id}`] = clone(l.attach[`build:${eng.build}`]);
  sound.status[`build:${id}`] = { reference: `Split from ${from.name}.` }; // a new sound to work on: not done yet
  eng.build = id;
  touch();
  updateCount();
  renderMain();
}

function renderMix() {
  const applyLevels = () => mixer?.applyLevels();
  const applySpace = (final) => { if (final) mixer?.applySpace(); };
  return el('div', {}, el('h2', { textContent: 'Mix' }),
    el('p', { className: 'dim', textContent: 'Levels are saved to settings.json, shared with the T panel. The game\'s options menu can override volumes per browser.' }),
    el('h3', { textContent: 'Levels and hearing' }),
    ...LEVEL_FIELDS.map((f) => slider(settings.audio, f, applyLevels, false)),
    el('h3', { textContent: 'Reverb, ducking and limiter' }),
    ...SPACE_FIELDS.map((f) => slider(sound.space, f, applySpace, false)),
    el('div', { className: 'buttons' }, button('Test: explosion over engine', async () => {
      await audio();
      stopLive();
      const v = createEngineVoice(mixer, { cylinders: 12, propBlades: 3, gearRatio: 0.6 }, sound.builds.inline);
      v.start();
      v.update({ rpm: 2300, load: 0.8 });
      const again = setInterval(() => v.update({ rpm: 2300, load: 0.8 }), 200);
      setTimeout(() => sfx.explosion(mixer, where(200, settings.audio.bangRange), 1), 3000);
      const end = setTimeout(() => stopLive(), 8000);
      live = { stop() { clearInterval(again); clearTimeout(end); v.dispose(); } };
    }, 'Engine start-up, then a bang, to hear ducking and reverb together'),
    button('Stop', stopLive)));
}

function renderGuide() {
  const p = (t) => el('p', { textContent: t });
  const h = (t) => el('h3', { textContent: t });
  return el('div', { className: 'wide' }, el('h2', { textContent: 'Guide' }),
    h('Working here'),
    p('Sound Design is the place to start. Pick a shared sound or an engine on the left, drop files on the slots, and hover a slot for what it expects. Test Flight plays everything together. The other tabs hold the full settings; Advanced on a slot takes you there.'),
    p('Pick a sound, press Play or Fire, and drag. Engines change as you drag; guns are re-rendered when you let go. Press Save to write the files; the game picks them up on its next reload. Saving does not commit to git.'),
    p('Tick a sound in the list when it is finished: its sliders lock until you untick it. Your notes stay editable and are the way to leave instructions for Claude for later.'),
    h('Shared builds'),
    p('A vehicle uses a real engine, and an engine uses a sound build. A build lists everything it changes. To give one engine its own sound, open a vehicle in the Vehicles tab and press Make own copy. The copy starts as an exact copy and is not done, because it is a new sound to work on. Cylinders, rpm and propeller stay with the vehicle, so planes on one build still differ.'),
    h('Hearing it as in the game'),
    p('Start-up: on the Start-up slot, drag the start and end markers around the part you want and the pale Caught marker to where the engine is running. The running engine stays silent until then and fades in as the clip fades out. A plane can start rolling during a long clip, because only the sound follows it.'),
    p('For the running game: put the game and the Lab in separate windows side by side, because a hidden tab stops drawing and is muted. The header says Game linked when it is listening. Changes reach it as you drag; guns, reverb, clips and layers update when you let go or add a file. The game keeps them until it reloads, so press Save to keep them. The Under menu plays a running engine beneath whatever you audition, to hear whether a sound survives in the mix.'),
    p('The Listen from slider applies the game\'s distance fade, muffling and delay. The Master level here is the game\'s, so it can be very quiet; turn it up on the Mix tab while working if you need to, and remember it saves too.'),
    h('Finding an engine clip\'s rpm by ear'),
    p('Play the synth beside the clip and raise Rpm until the two sound matched. That rpm is the one to enter when clip support arrives.'),
    h('Recordings: getting ready'),
    p('Drag WAV, MP3, OGG or FLAC files onto a Recordings box. Files go to assets/audio/ and are mixed to mono, because the game places each sound itself. Several files in one group are random variations. Clean up in your editor first: trim silence, avoid wind or narration, and keep one-shots short, because everything is decoded into memory at load. The count in the header shows the total. Large files also bloat git.'),
    p('Fill in licence and source for each file. A red ! in the list means one is missing or marked other, so it can be reviewed before release.'),
    h('Recorded engines'),
    p('On a build, add up to three clips, usually idle, cruise and full, and enter the rpm of each. The game pitches them to the engine and crossfades between the two nearest. Synth level and Clip level blend them with the synth. Misfires dip the recording too. Clips with very different rpm from the engine sound stretched. Tanks take a standing clip, a moving clip and a tracks clip instead.'),
    h('Your layers'),
    p('New layer makes your own sound. Continuous layers loop and follow a game value, from Value low to Value high; triggered layers play a one-shot when a value passes the threshold, with a cooldown and a chance. Attach a layer to a whole build, one vehicle, or everything of a kind, with its own volume, pitch and threshold there. Cockpit only is heard just from inside that plane. Make own copy splits a layer off for one vehicle.'),
    h('Not here yet'),
    p('Sliders for the synthesized one-shots and loops. Use Synth level and recordings on those for now. Curves are straight lines between low and high, not drawn. New kinds of game value need Claude.'));
}

function renderMain() {
  stopLive();
  stopSlot();
  const main = $('main');
  main.replaceChildren();
  main.scrollTop = 0;
  if (tab === 'design') return main.append(renderDesign());
  if (tab === 'vehicles') return main.append(renderVehicles());
  if (tab === 'mix') return main.append(renderMix());
  if (tab === 'guide') return main.append(renderGuide());
  const [type, key] = selected.split(':');
  if (type === 'build') {
    if (!sound.builds[key]) selected = 'build:inline';
    const id = selected.split(':')[1];
    main.append(sound.builds[id].kind === 'tank' ? renderTankBuild(selected, id) : renderPlaneBuild(selected, id));
  } else if (type === 'gun') main.append(renderGun(selected, key));
  else if (type === 'sfx') main.append(renderOneShot(selected, key));
  else if (type === 'layer') main.append(sound.layers[key] ? renderLayer(selected, key) : el('p', { textContent: 'That layer is gone.' }));
  else main.append(renderLoop(selected, key));
}

function setTab(name) {
  tab = name;
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  renderList();
  renderMain();
}

async function saveAll() {
  const put = async (path, data) => {
    const res = await fetch(path, { method: 'PUT', body: JSON.stringify(data, null, 2) + '\n' });
    if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
  };
  const button = $('save');
  try {
    await put('data/sound.json', sound);
    // Re-read so a change the T panel saved meanwhile isn't overwritten; only the audio block is ours.
    const fresh = await json('data/settings.json');
    fresh.audio = { ...fresh.audio, ...settings.audio };
    await put('data/settings.json', fresh);
    saved = clone(sound);
    dirty = false;
    button.textContent = 'Saved';
    button.classList.remove('on');
  } catch (e) {
    button.textContent = 'Save failed';
    alert(`Could not save: ${e.message}\nIs the server running from tools/serve.mjs?`);
  }
}


// --- Recordings ---
const LICENCES = [['', 'Licence?'], ['cc0', 'CC0'], ['own', 'My own recording'], ['other', 'Other']];

function allFiles() {
  const files = [];
  for (const r of Object.values(sound.recordings)) {
    r.groups?.forEach((g) => files.push(...g.files));
    if (r.clips) files.push(...r.clips);
    if (r.startup) files.push(...r.startup.files);
  }
  for (const l of Object.values(sound.layers)) files.push(...l.group.files);
  return files;
}

function filesOf(id) {
  if (id.startsWith('layer:')) return sound.layers[id.slice(6)]?.group.files ?? [];
  const r = sound.recordings[id];
  return [...(r?.groups ?? []).flatMap((g) => g.files), ...(r?.clips ?? []), ...(r?.startup?.files ?? [])];
}

function licenceFlag(id) {
  const files = filesOf(id);
  if (files.some((f) => !f.licence)) return 'A recording has no licence';
  if (files.some((f) => f.licence === 'other')) return 'A recording has a non-CC0 licence: review it before release';
  return '';
}

const recOf = (id) => (sound.recordings[id] ??= { synth: 1 });

// Sends files to the server and returns what the data needs to know about them.
async function upload(fileList) {
  await audio();
  const added = [];
  for (const file of fileList) {
    const res = await fetch(`recording/${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
    if (!res.ok) {
      alert(`${file.name}: ${await res.text()}\nThe server may be an old copy: restart it with node tools/serve.mjs 8080.`);
      continue;
    }
    const { path, size } = await res.json();
    const buf = await mixer.recordings.ensure(path);
    if (!buf) {
      alert(`${file.name} could not be decoded.`);
      continue;
    }
    if (size > 5e6) alert(`${file.name} is ${(size / 1e6).toFixed(1)} MB. That is large to load and to keep in git; consider trimming it.`);
    added.push({ path, size, start: 0, end: buf.duration, licence: '', source: '' });
  }
  return added;
}

// A box that takes dropped files or a click.
function dropBox(text, onFiles) {
  const input = el('input', { type: 'file', multiple: true, accept: '.wav,.mp3,.ogg,.flac', style: 'display:none' });
  input.onchange = async () => onFiles(await upload([...input.files]));
  const box = el('div', { className: 'dim', textContent: text, style: 'border:1px dashed var(--line);padding:10px;margin:6px 0;cursor:pointer' }, input);
  box.onclick = (e) => { if (e.target !== input) input.click(); };
  box.ondragover = (e) => { e.preventDefault(); box.style.borderColor = 'var(--accent)'; };
  box.ondragleave = () => { box.style.borderColor = ''; };
  box.ondrop = async (e) => {
    e.preventDefault();
    box.style.borderColor = '';
    onFiles(await upload([...e.dataTransfer.files]));
  };
  return box;
}

// The waveform: drag the two markers to trim.
function waveform(file, locked, onChange) {
  const c = el('canvas', { width: 700, height: 70, style: 'width:100%;max-width:700px;height:70px;background:#0b0c0d;display:block;touch-action:none' });
  const draw = () => {
    const buf = mixer?.recordings.buffers.get(file.path);
    const g = c.getContext('2d');
    g.fillStyle = '#0b0c0d';
    g.fillRect(0, 0, c.width, c.height);
    if (!buf) return;
    const d = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(d.length / c.width));
    g.strokeStyle = '#7f837c';
    g.beginPath();
    for (let x = 0; x < c.width; x++) {
      let peak = 0;
      for (let i = x * step, n = 0; n < step && i < d.length; n += Math.ceil(step / 40), i += Math.ceil(step / 40)) peak = Math.max(peak, Math.abs(d[i]));
      g.moveTo(x + 0.5, 35 - peak * 34);
      g.lineTo(x + 0.5, 35 + peak * 34);
    }
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.65)';
    const a = (file.start / buf.duration) * c.width;
    const b = (file.end / buf.duration) * c.width;
    g.fillRect(0, 0, a, c.height);
    g.fillRect(b, 0, c.width - b, c.height);
    g.fillStyle = '#a8905c';
    g.fillRect(a - 1, 0, 2, c.height);
    g.fillRect(b - 1, 0, 2, c.height);
    if (file.caught != null) {
      g.fillStyle = '#c4c5bb';
      g.fillRect((file.caught / buf.duration) * c.width - 1, 0, 2, c.height);
    }
  };
  let grab = null;
  c.onpointerdown = (e) => {
    const buf = mixer?.recordings.buffers.get(file.path);
    if (!buf || locked) return;
    const t = (e.offsetX / c.clientWidth) * buf.duration;
    grab = Math.abs(t - file.start) < Math.abs(t - file.end) ? 'start' : 'end';
    if (file.caught != null && Math.abs(t - file.caught) < Math.abs(t - file[grab])) grab = 'caught';
    c.setPointerCapture(e.pointerId);
  };
  c.onpointermove = (e) => {
    if (!grab) return;
    const buf = mixer.recordings.buffers.get(file.path);
    const t = Math.max(0, Math.min(buf.duration, (e.offsetX / c.clientWidth) * buf.duration));
    if (grab === 'start') file.start = Math.min(t, file.end - 0.005);
    else if (grab === 'end') file.end = Math.max(t, file.start + 0.005);
    else file.caught = Math.max(file.start, Math.min(file.end, t));
    if (file.caught != null) file.caught = Math.max(file.start, Math.min(file.end, file.caught));
    draw();
  };
  c.onpointerup = () => {
    if (!grab) return;
    grab = null;
    touch();
    onChange?.();
  };
  audio().then(() => mixer.recordings.ensure(file.path)).then(draw);
  return c;
}

function fileRow(file, locked, remove, onChange, extra = []) {
  const licence = el('select', { disabled: locked, onchange: () => { file.licence = licence.value; touch(); updateCount(); renderList(); } },
    ...LICENCES.map(([k, t]) => el('option', { value: k, textContent: t, selected: file.licence === k })));
  const source = el('input', { placeholder: 'Source: site, author, link', value: file.source ?? '', disabled: locked, onchange: () => { file.source = source.value; touch(); } });
  return el('div', { style: 'margin:8px 0;padding:6px;border:1px solid var(--line)' },
    el('div', { textContent: `${file.path.split('/').pop()}  (${((file.size ?? 0) / 1e6).toFixed(2)} MB)` }),
    waveform(file, locked, onChange),
    el('div', { className: 'buttons' }, licence, source, ...extra, locked ? null : button('Remove', remove)));
}

const GROUP_FIELDS = [
  ['gain', 'Volume', 0, 3, 0.01, ''],
  ['pitch', 'Pitch, semitones', -24, 24, 0.1, ''],
  ['delay', 'Delay, s', 0, 1, 0.005, 'Against the other layers: a recorded boom after a synthesized crack.'],
  ['fadeIn', 'Fade in, s', 0, 2, 0.005, ''],
  ['fadeOut', 'Fade out, s', 0, 3, 0.005, ''],
  ['lowpass', 'Low-pass, Hz', 100, 20000, 10, 'Cuts highs above this.'],
  ['highpass', 'High-pass, Hz', 20, 4000, 5, 'Cuts lows below this.'],
  ['drive', 'Distortion', 0, 1, 0.01, ''],
  ['pitchVar', 'Random pitch', 0, 0.3, 0.005, 'Change on each play, so repeats do not sound the same.'],
  ['gainVar', 'Random volume', 0, 0.5, 0.01, ''],
  ['reverb', 'Reverb', 0, 1, 0.01, ''],
];
const LOOP_FIELDS = [
  ['xfade', 'Loop seam fade, s', 0, 1, 0.005, 'Fades the end of the loop into its start to hide the seam. Applies when played again.'],
  ['gainLow', 'Volume at low value', 0, 2, 0.01, ''],
  ['gainHigh', 'Volume at high value', 0, 2, 0.01, ''],
  ['pitchLow', 'Pitch × at low value', 0.25, 3, 0.01, ''],
  ['pitchHigh', 'Pitch × at high value', 0.25, 3, 0.01, ''],
];

function groupPanel(group, id, locked, opts = {}) {
  const box = el('div', {});
  const redo = () => renderMain();
  const trial = group.files.length && !opts.loop ? button('Play this group', async () => {
    await audio();
    mixer.recordings.playGroup(group, where(listen.distance, settings.audio.bangRange));
  }) : null;
  const reverse = el('input', { type: 'checkbox', checked: group.reverse, disabled: locked, onchange: () => { group.reverse = reverse.checked; touch(); } });
  box.append(
    ...group.files.map((f, i) => fileRow(f, locked, () => { group.files.splice(i, 1); touch(); updateCount(); redo(); })),
    locked ? null : dropBox('Drop recordings here, or click. Several files are random variations.', (added) => {
      group.files.push(...added);
      if (added.length) touch();
      updateCount();
      renderList();
      redo();
    }),
    el('div', { className: 'buttons' }, trial, opts.loop ? null : el('label', {}, reverse, ' reverse')),
    ...GROUP_FIELDS.map((f) => slider(group, f, null, locked)),
    ...(opts.loop ? LOOP_FIELDS.map((f) => slider(group, f, null, locked)) : []),
    opts.loop ? slider(group, ['mapFrom', `Value low (${opts.driver ?? 'value'})`, opts.min ?? 0, opts.max ?? 1, ((opts.max ?? 1) - (opts.min ?? 0)) / 100, ''], null, locked) : null,
    opts.loop ? slider(group, ['mapTo', `Value high (${opts.driver ?? 'value'})`, opts.min ?? 0, opts.max ?? 1, ((opts.max ?? 1) - (opts.min ?? 0)) / 100, ''], null, locked) : null,
  );
  return box;
}

function synthLevelSlider(id, locked) {
  const rec = recOf(id);
  return slider(rec, ['synth', 'Synth level', 0, 2, 0.01, 'The synthesized sound beside its recordings. 0 leaves only the recordings.'], () => mixer?.recordings.scoped(id), locked);
}

function recordingPanel(id, opts = {}) {
  const locked = Boolean(sound.status[id]?.done);
  const rec = recOf(id);
  rec.groups ??= [];
  const box = el('div', {}, el('h3', { textContent: 'Recordings' }), synthLevelSlider(id, locked));
  if (opts.synthOnly) return box;
  rec.groups.forEach((g, i) => box.append(
    el('h3', { textContent: `Group ${i + 1}` }),
    locked ? null : el('div', { className: 'buttons' }, button('Remove group', () => { rec.groups.splice(i, 1); touch(); updateCount(); renderList(); renderMain(); })),
    groupPanel(g, id, locked, opts),
  ));
  if (!locked) box.append(el('div', { className: 'buttons' }, button(rec.groups.length ? 'Add another group' : 'Add recordings', () => { rec.groups.push(newGroup()); touch(); renderMain(); }, 'A group plays together with the other groups')));
  return box;
}

// Engine and tank clips.
function clipPanel(id, kind) {
  const locked = Boolean(sound.status[id]?.done);
  const rec = recOf(id);
  rec.clips ??= [];
  rec.clipLevel ??= 1;
  const box = el('div', {}, el('h3', { textContent: 'Recorded clips' }),
    el('p', { className: 'dim', textContent: kind === 'plane' ? 'Up to three loops, each at the rpm it was recorded. Press Play again after adding one.' : 'A standing engine, a moving engine and tracks. Press Play again after adding one.' }),
    synthLevelSlider(id, locked),
    slider(rec, ['clipLevel', 'Clip level', 0, 3, 0.01, 'The recordings as a whole.'], null, locked));
  if (kind === 'plane') {
    rec.loadLow ??= 0.6;
    box.append(slider(rec, ['loadLow', 'Clips at closed throttle', 0, 1, 0.01, 'Same rpm, throttle off: how loud the clips stay.'], null, locked));
  }
  rec.clips.forEach((clip, i) => {
    const extra = [];
    if (kind === 'plane') {
      const rpm = el('input', { type: 'number', min: 100, max: 6000, value: clip.rpm ?? 2300, disabled: locked, title: 'The rpm it was recorded at', style: 'width:90px', onchange: () => { clip.rpm = Number(rpm.value); touch(); } });
      extra.push(el('label', {}, 'rpm ', rpm));
    } else {
      const role = el('select', { disabled: locked, onchange: () => { clip.role = role.value; touch(); } },
        ...[['idle', 'Engine standing'], ['move', 'Engine moving'], ['tracks', 'Tracks']].map(([k, t]) => el('option', { value: k, textContent: t, selected: clip.role === k })));
      extra.push(role);
    }
    box.append(fileRow(clip, locked, () => { rec.clips.splice(i, 1); touch(); updateCount(); renderMain(); }, () => {}, extra));
    box.append(slider(clip, ['gain', 'This clip level', 0, 3, 0.01, ''], null, locked), slider(clip, ['xfade', 'Loop seam fade, s', 0, 1, 0.005, 'Hides the loop seam. Applies when played again.'], null, locked));
  });
  if (!locked) {
    box.append(dropBox('Drop clips here, or click.', (added) => {
      for (const f of added) rec.clips.push({ ...f, gain: 1, xfade: 0.05, ...(kind === 'plane' ? { rpm: 2300 } : { role: 'idle' }) });
      if (added.length) touch();
      updateCount();
      renderList();
      renderMain();
    }));
  }
  return box;
}

// --- Your layers ---
function addLayer() {
  const name = prompt('Name of the new layer? (wing creak, tracks...)');
  if (!name) return;
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}${Object.keys(sound.layers).length}`;
  sound.layers[id] = { name, type: 'triggered', kind: 'plane', hearing: 'cockpit', driver: 'turn', threshold: 2, cooldown: 3, chance: 0.5, group: newGroup(), attach: {} };
  selected = `layer:${id}`;
  touch();
  updateCount();
  renderList();
  renderMain();
}

function targets(kind) {
  const label = kind === 'plane' ? 'All aircraft' : 'All tanks';
  return [
    [`all:${kind}`, label],
    ...Object.entries(sound.builds).filter(([, b]) => b.kind === kind).map(([k, b]) => [`build:${k}`, `Build: ${b.name}`]),
    ...sound.vehicles.filter((v) => v.kind === kind).map((v) => [`${kind}:${v.id}`, v.name]),
  ];
}

function renderLayer(id, key) {
  const layer = sound.layers[key];
  const locked = Boolean(sound.status[id]?.done);
  const change = (fn) => (e) => { fn(e.target.value); touch(); renderMain(); };
  const pick = (label, value, options, fn) => el('label', { className: 'field' }, el('span', { textContent: label }),
    el('select', { disabled: locked, onchange: change(fn) }, ...options.map(([k, t]) => el('option', { value: k, textContent: t, selected: k === value }))), el('span'));
  const drivers = DRIVERS[layer.kind];
  const driver = drivers.find((d) => d.key === layer.driver) ?? drivers[0];
  const state = { value: (driver.min + driver.max) / 2 };
  let frame = 0;
  let host = null;
  const testBtn = button('Test', async () => {
    if (host) return stopLive();
    await audio();
    stopLive();
    const testKey = '@test';
    layer.attach[testKey] = { gain: 1, pitch: 0 };
    host = mixer.recordings.createLayerHost([testKey]);
    delete layer.attach[testKey];
    const tick = () => {
      host.update({ [driver.key]: state.value }, where(), layer.hearing === 'cockpit' || listen.distance === 0);
      frame = requestAnimationFrame(tick);
    };
    tick();
    testBtn.textContent = 'Stop';
    live = { stop() { cancelAnimationFrame(frame); host.stop(); host = null; testBtn.textContent = 'Test'; } };
  }, 'Runs the layer as the game would, from the value below');
  const used = Object.keys(layer.attach);
  const attachRows = targets(layer.kind).map(([k, text]) => {
    const a = layer.attach[k];
    const tick = el('input', { type: 'checkbox', checked: Boolean(a), onchange: () => {
      if (tick.checked) layer.attach[k] = { gain: 1, pitch: 0 };
      else delete layer.attach[k];
      touch();
      renderMain();
    } });
    return el('div', {}, el('label', {}, tick, ` ${text}`),
      a ? el('div', { style: 'margin-left:24px' },
        slider(a, ['gain', 'Volume here', 0, 3, 0.01, ''], null, false),
        slider(a, ['pitch', 'Pitch here, semitones', -24, 24, 0.1, ''], null, false),
        layer.type === 'triggered' ? slider(Object.assign(a, { threshold: a.threshold ?? layer.threshold }), ['threshold', 'Threshold here', driver.min, driver.max, (driver.max - driver.min) / 100, ''], null, false) : null) : null);
  });
  return el('div', {},
    pageHead(id, layer.name, used.length ? `Used by: ${used.map((k) => targets(layer.kind).find(([t]) => t === k)?.[1] ?? k).join(', ')}` : 'Not attached to anything yet'),
    el('div', { className: 'buttons' },
      button('Rename', () => { const n = prompt('New name?', layer.name); if (n) { layer.name = n; touch(); renderList(); renderMain(); } }),
      button('Make own copy', () => {
        const copy = clone(layer);
        const newId = `${key}copy${Object.keys(sound.layers).length}`;
        copy.name = `${layer.name} copy`;
        copy.attach = {};
        sound.layers[newId] = copy;
        selected = `layer:${newId}`;
        touch();
        updateCount();
        renderList();
        renderMain();
      }, 'A separate layer with the same files and settings, attached to nothing'),
      button('Delete', () => {
        if (!confirm(`Delete the layer ${layer.name}? Its files stay in assets/audio/.`)) return;
        delete sound.layers[key];
        delete sound.status[id];
        selected = 'build:inline';
        touch();
        updateCount();
        renderList();
        renderMain();
      })),
    pick('For', layer.kind, [['plane', 'Aircraft'], ['tank', 'Tanks']], (v) => { layer.kind = v; layer.driver = DRIVERS[v][0].key; layer.attach = {}; }),
    pick('Type', layer.type, [['triggered', 'Triggered one-shot'], ['continuous', 'Continuous loop']], (v) => { layer.type = v; }),
    pick('Follows', driver.key, drivers.map((d) => [d.key, d.label]), (v) => { layer.driver = v; }),
    pick('Heard', layer.hearing, [['cockpit', 'Cockpit only'], ['world', 'By everyone nearby']], (v) => { layer.hearing = v; }),
    layer.type === 'triggered' ? el('div', {},
      slider(layer, ['threshold', 'Threshold', driver.min, driver.max, (driver.max - driver.min) / 100, 'Can play when the value is at or above this.'], null, locked),
      slider(layer, ['cooldown', 'Cooldown, s', 0, 30, 0.1, 'Shortest time between plays.'], null, locked),
      slider(layer, ['chance', 'Chance', 0, 1, 0.01, 'Chance it plays each time the cooldown has passed.'], null, locked)) : null,
    el('h3', { textContent: 'Test' }),
    el('div', { className: 'buttons' }, testBtn),
    testSlider(state, 'value', driver.label, driver.min, driver.max, (driver.max - driver.min) / 100),
    distanceControl(),
    el('h3', { textContent: 'Sound' }),
    groupPanel(layer.group, id, locked, { loop: layer.type === 'continuous', driver: driver.label, min: driver.min, max: driver.max }),
    el('h3', { textContent: 'Attach to' }),
    ...attachRows,
    notesPanel(id));
}

// For a vehicle's page: the layers reaching it, with a direct way to attach another.
function layerList(v) {
  const eng = sound.engines[v.engine];
  const keys = [`${v.kind}:${v.id}`, `build:${eng?.build}`, `all:${v.kind}`];
  const rows = Object.entries(sound.layers).filter(([, l]) => l.kind === v.kind).map(([id, l]) => {
    const through = keys.find((k) => l.attach[k]);
    const tick = el('input', { type: 'checkbox', checked: Boolean(through), onchange: () => {
      if (tick.checked) l.attach[keys[0]] = { gain: 1, pitch: 0 };
      else for (const k of keys) delete l.attach[k];
      touch();
      renderMain();
    } });
    return el('div', {}, el('label', {}, tick, ` ${l.name}`), through && through !== keys[0] ? el('span', { className: 'dim', textContent: ` (through ${through})` }) : null, ' ', button('Open', () => { selected = `layer:${id}`; setTab('sounds'); }));
  });
  return rows.length ? rows : [el('div', { className: 'dim', textContent: 'No layers yet: New layer on the Sounds tab.' })];
}

// --- Sound Design: one page per sound, a list of slots to drop files on ---
const ENGINE_SLOTS = [
  ['idle', 'Idle', 'idleRpm', 'A steady loop of the engine at idle, 5-10 s, with no rpm change. Close and exterior if possible, with no wind or speech.'],
  ['cruise', 'Cruise', 'cruiseRpm', 'The same at a steady mid rpm. Optional: if idle and full sound fine together, leave it empty.'],
  ['full', 'Full', 'maxRpm', 'The same at full power and steady rpm. Avoid flypasts: the pitch changes and they cannot loop.'],
];
const STARTUP_HELP = 'One whole start: starter, cough and catching, ideally 3-6 s after trimming. It should end on a running engine. Drag the pale Caught marker to where it is running.';
const TANK_SLOTS = [
  ['idle', 'Standing', 'A steady loop of the engine idling with the tank still, 5-10 s.'],
  ['move', 'Moving', 'A steady loop of the engine working as the tank drives, 5-10 s, ideally without tracks.'],
  ['tracks', 'Tracks', 'A steady loop of squealing, clanking tracks, 5-10 s. It only plays while the tank moves.'],
];
const m = (a, b, c, d, e, f) => ({ mapFrom: a, mapTo: b, gainLow: c, gainHigh: d, pitchLow: e, pitchHigh: f });
const AIRFRAME_SLOTS = {
  airflow: ['Airflow', 'continuous', 'speed', m(30, 160, 0, 1, 0.8, 1.3), 'A steady loop of air rushing past, 5-10 s, with no engine in it. It plays louder and higher with airspeed. Even car or wind noise works.'],
  rattle: ['Rattle', 'continuous', 'speed', m(80, 170, 0, 1, 1, 1.1), 'A steady loop of loose metal shaking, 5-10 s. It gets louder with airspeed, so it should not have obvious hits that give the loop away.'],
  creak: ['Creak', 'triggered', 'turn', null, '3-4 short creaks or groans of 1-2 s, each different. One plays at random in hard turns, so they need to sound good alone and not be too loud.'],
  damage: ['Damage', 'continuous', 'damage', m(0.1, 0.8, 0, 1, 1, 1), 'A steady loop of knocking or rough rattling, 5-10 s. It fades in as the plane takes damage, so it should sound like something is broken.'],
};
const LOOPING = new Set(['idle', 'cruise', 'full', 'move', 'tracks', 'airflow', 'rattle', 'damage']);

const pageBuild = () => {
  if (design.type === 'build') return design.id;
  if (design.type === 'engine') return sound.engines[design.id]?.build;
  return sound.engines[sound.vehicles.find((v) => v.id === design.id)?.engine]?.build;
};

// Measures only what it can and warns without blocking.
function checkDrop(key, buf) {
  const notes = [];
  if (LOOPING.has(key) && buf.duration > 30) notes.push(`This is ${buf.duration.toFixed(0)} s: a loop usually needs 5-10 s.`);
  if (LOOPING.has(key) && buf.duration < 1) notes.push('Very short for a loop: repeats will be obvious.');
  if (!LOOPING.has(key) && key !== 'startup' && buf.duration > 4) notes.push(`This is ${buf.duration.toFixed(1)} s: long for a one-shot. Consider trimming.`);
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i += 8) peak = Math.max(peak, Math.abs(d[i]));
  let lead = 0;
  while (lead < d.length && Math.abs(d[lead]) < peak * 0.05) lead++;
  if (lead / buf.sampleRate > 0.25) notes.push(`It has ${(lead / buf.sampleRate).toFixed(1)} s of silence at the start: drag the start marker in.`);
  if (peak < 0.05) notes.push('It is very quiet.');
  return notes.join(' ');
}

// Plays a slot alone; a second click stops it.
function playToggle(play) {
  const b = button('▶', async (e) => {
    e.preventDefault();
    const mine = slotPlaying?.b === b;
    stopSlot();
    if (mine) return;
    await audio();
    const src = play();
    if (!src) return;
    slotPlaying = { b, src };
    b.textContent = '■';
    src.onended = () => {
      b.textContent = '▶';
      if (slotPlaying?.src === src) slotPlaying = null;
    };
  }, 'Play it alone. Click again to stop.');
  return b;
}

function stopSlot() {
  if (!slotPlaying) return;
  const { b, src } = slotPlaying;
  slotPlaying = null;
  b.textContent = '▶';
  src.stop();
}

function slotRow({ key, name, help, files, group, level, play, advanced, locked, onFiles, body, sub, shared }) {
  const filled = files.length > 0;
  const tick = el('input', { type: 'checkbox', checked: filled, disabled: true });
  const summary = el('summary', { title: help },
    tick, el('span', { className: 'sname', textContent: name }),
    el('span', { className: 'sfile', textContent: filled ? files.map((f) => f.path.split('/').pop()).join(', ') : help.split(/[.:]/)[0] }),
    sub ? el('span', { className: 'dim', textContent: sub }) : null,
    filled && play ? playToggle(play) : null,
    level ? (() => {
      const input = el('input', { type: 'range', min: 0, max: 3, step: 0.01, value: level.obj[level.key] ?? 1, title: 'Level', disabled: locked, style: 'width:90px' });
      input.onclick = (e) => e.stopPropagation();
      input.oninput = () => { level.obj[level.key] = Number(input.value); broadcast(false); };
      input.onchange = touch;
      return input;
    })() : null,
    advanced ? button('Advanced', (e) => { e.preventDefault(); advanced(); }) : null);
  const box = el('details', { className: `slot${filled ? '' : ' empty'}` }, summary);
  if (drops.get(key)) {
    box.open = true;
    box.append(el('div', { className: 'warn sbody', textContent: drops.get(key) }));
  }
  const inner = el('div', { className: 'sbody' }, el('div', { className: 'dim', textContent: help }));
  if (body) inner.append(...body);
  if (!locked) {
    const take = async (raw) => {
      const added = await upload(raw);
      if (!added.length) return;
      drops.set(key, added.map((f) => checkDrop(key, mixer.recordings.buffers.get(f.path))).filter(Boolean).join(' '));
      onFiles(added);
      touch();
      updateCount();
      renderList();
      renderMain();
    };
    inner.append(dropBoxFor(take, filled));
    box.ondragover = (e) => { e.preventDefault(); box.classList.add('over'); };
    box.ondragleave = () => box.classList.remove('over');
    box.ondrop = (e) => {
      e.preventDefault();
      box.classList.remove('over');
      take([...e.dataTransfer.files]);
    };
  }
  box.append(inner);
  void group;
  void shared;
  return box;
}

function dropBoxFor(take, filled) {
  const input = el('input', { type: 'file', multiple: true, accept: '.wav,.mp3,.ogg,.flac', style: 'display:none' });
  input.onchange = () => take([...input.files]);
  const box = el('div', { className: 'dim', textContent: filled ? 'Drop or click to add or replace' : 'Drop a file on this slot, or click', style: 'border:1px dashed var(--line);padding:8px;margin:6px 0;cursor:pointer' }, input);
  box.onclick = (e) => { if (e.target !== input) input.click(); };
  return box;
}

// The airframe sounds are ordinary layers, made the first time a file lands on the slot.
function airframeLayer(key) {
  const id = `slot_${key}`;
  if (sound.layers[id]) return sound.layers[id];
  const [name, type, driver, mapping] = AIRFRAME_SLOTS[key];
  sound.layers[id] = { name, type, kind: 'plane', hearing: 'cockpit', driver, threshold: 1.5, cooldown: 3, chance: 0.4, group: { ...newGroup(), ...(mapping ?? {}) }, attach: { 'all:plane': { gain: 1, pitch: 0 } } };
  return sound.layers[id];
}

const removeFile = (list, i) => button('Remove', () => { list.splice(i, 1); drops.clear(); touch(); updateCount(); renderList(); renderMain(); });

function engineSlots(buildId, specs, locked) {
  const id = `build:${buildId}`;
  const rec = recOf(id);
  rec.clips ??= [];
  const spec = specs[0] ?? {};
  const row = ([key, name, rpmKey, help]) => {
    const clip = rec.clips.find((c) => c.slot === key);
    const rpm = clip ? el('input', { type: 'number', min: 100, max: 6000, value: clip.rpm, disabled: locked, title: 'The rpm it was recorded at', style: 'width:90px', onchange: () => { clip.rpm = Number(rpm.value); touch(); } }) : null;
    return slotRow({
      key, name, locked, help: `${help} About ${spec[rpmKey] ?? 2300} rpm on this engine.`,
      files: clip ? [clip] : [],
      sub: clip ? `${clip.rpm} rpm` : null,
      level: clip ? { obj: clip, key: 'gain' } : null,
      play: clip ? () => mixer?.recordings.playGroup({ ...newGroup(), gain: clip.gain ?? 1, pitchVar: 0, gainVar: 0, files: [clip] }, where()) : null,
      advanced: () => { selected = id; setTab('sounds'); },
      onFiles: ([f]) => {
        if (clip) rec.clips.splice(rec.clips.indexOf(clip), 1);
        rec.clips.push({ ...f, slot: key, gain: 1, xfade: 0.05, rpm: spec[rpmKey] ?? 2300 });
      },
      body: clip ? [el('label', {}, 'Recorded at rpm ', rpm), fileRow(clip, locked, () => { rec.clips.splice(rec.clips.indexOf(clip), 1); drops.clear(); touch(); updateCount(); renderMain(); }, null, []), slider(clip, ['xfade', 'Loop seam fade, s', 0, 1, 0.005, 'Hides the loop seam.'], null, locked)] : [],
    });
  };
  rec.startup ??= { files: [], gain: 1, fade: 0.6 };
  const st = rec.startup;
  const startRow = slotRow({
    key: 'startup', name: 'Start-up', locked, help: STARTUP_HELP, files: st.files,
    level: st.files.length ? { obj: st, key: 'gain' } : null,
    play: st.files.length ? () => mixer?.recordings.playGroup({ ...newGroup(), gain: st.gain ?? 1, pitchVar: 0, gainVar: 0, files: st.files }, where()) : null,
    onFiles: (added) => { for (const f of added) st.files.push({ ...f, caught: f.end * 0.8 }); },
    body: [...st.files.map((f, i) => fileRow(f, locked, () => { st.files.splice(i, 1); drops.clear(); touch(); updateCount(); renderMain(); }, null, [])),
      slider(st, ['fade', 'Fade into the engine, s', 0.05, 3, 0.05, 'How long the clip and the running engine cross after Caught.'], null, locked)],
  });
  return [el('h3', { textContent: 'Engine' }), ...ENGINE_SLOTS.map(row), startRow];
}

function tankSlots(buildId, locked) {
  const id = `build:${buildId}`;
  const rec = recOf(id);
  rec.clips ??= [];
  return [el('h3', { textContent: 'Engine and tracks' }), ...TANK_SLOTS.map(([key, name, help]) => {
    const clip = rec.clips.find((c) => c.role === key);
    return slotRow({
      key, name, locked, help, files: clip ? [clip] : [],
      level: clip ? { obj: clip, key: 'gain' } : null,
      play: clip ? () => mixer?.recordings.playGroup({ ...newGroup(), gain: clip.gain ?? 1, pitchVar: 0, gainVar: 0, files: [clip] }, where()) : null,
      advanced: () => { selected = id; setTab('sounds'); },
      onFiles: ([f]) => {
        if (clip) rec.clips.splice(rec.clips.indexOf(clip), 1);
        rec.clips.push({ ...f, role: key, gain: 1, xfade: 0.05 });
      },
      body: clip ? [fileRow(clip, locked, () => { rec.clips.splice(rec.clips.indexOf(clip), 1); drops.clear(); touch(); updateCount(); renderMain(); }, null, []), slider(clip, ['xfade', 'Loop seam fade, s', 0, 1, 0.005, 'Hides the loop seam.'], null, locked)] : [],
    });
  })];
}

// A shared slot on a plane's own page can have its own volume and pitch there.
function layerOverride(layer, vehicleId) {
  const key = `plane:${vehicleId}`;
  const a = layer.attach[key];
  const own = el('input', { type: 'checkbox', checked: Boolean(a), onchange: () => {
    if (own.checked) layer.attach[key] = { gain: 1, pitch: 0 };
    else delete layer.attach[key];
    touch();
    renderMain();
  } });
  return el('div', {}, el('label', {}, own, ' own volume and pitch on this plane'),
    a ? slider(a, ['gain', 'Volume here', 0, 3, 0.01, ''], null, false) : null,
    a ? slider(a, ['pitch', 'Pitch here, semitones', -24, 24, 0.1, 'Lower for heavy planes.'], null, false) : null);
}

function layerSlot(key, layer, help, locked, vehicleId) {
  const files = layer?.group.files ?? [];
  return slotRow({
    key, name: layer?.name ?? AIRFRAME_SLOTS[key]?.[0], locked, help, files,
    level: layer && files.length ? { obj: layer.group, key: 'gain' } : null,
    play: files.length ? () => mixer?.recordings.playGroup({ ...layer.group, pitchVar: 0 }, where()) : null,
    advanced: layer ? () => { selected = `layer:${Object.keys(sound.layers).find((k) => sound.layers[k] === layer)}`; setTab('sounds'); } : null,
    onFiles: (added) => {
      const target = layer ?? airframeLayer(key);
      if (target.type === 'continuous') target.group.files = added.slice(0, 1);
      else target.group.files.push(...added);
    },
    body: [...files.map((f, i) => fileRow(f, locked, () => { files.splice(i, 1); drops.clear(); touch(); updateCount(); renderMain(); }, null, [])),
      layer && vehicleId ? layerOverride(layer, vehicleId) : null].filter(Boolean),
  });
}

function airframeSlots(locked, vehicleId) {
  return [el('h3', { textContent: 'Airframe: shared with all aircraft' }),
    ...Object.entries(AIRFRAME_SLOTS).map(([key, def]) => layerSlot(key, sound.layers[`slot_${key}`], `${def[4]} Follows ${DRIVERS.plane.find((d) => d.key === def[2]).label.toLowerCase()}.`, locked, vehicleId))];
}

// Guns of the planes on this page, by the sound they use.
function gunVoices(vehicles) {
  const voiceNames = new Set();
  const weaponsBy = new Map();
  for (const v of vehicles) {
    for (const g of planes[v.id]?.armament?.guns ?? []) {
      const voice = weapons[g.weapon]?.voice;
      if (!voice) continue;
      voiceNames.add(voice);
      if (!weaponsBy.has(voice)) weaponsBy.set(voice, new Set());
      weaponsBy.get(voice).add(weapons[g.weapon].name ?? g.weapon);
    }
  }
  if (!voiceNames.size) for (const n of ['rifle', 'heavy', 'cannon20', 'cannon30']) voiceNames.add(n);
  return [...voiceNames].map((n) => [n, [...(weaponsBy.get(n) ?? [])]]);
}

function groupSlot(id, key, name, help, locked, sub) {
  const rec = recOf(id);
  rec.groups ??= [];
  const group = rec.groups[0];
  const files = group?.files ?? [];
  return slotRow({
    key, name, help, locked, files, sub,
    level: group && files.length ? { obj: group, key: 'gain' } : null,
    play: files.length ? () => mixer.recordings.playGroup({ ...group, pitchVar: 0 }, where(listen.distance, settings.audio.bangRange)) : null,
    advanced: () => { selected = id; setTab('sounds'); },
    onFiles: (added) => {
      if (!rec.groups[0]) rec.groups[0] = newGroup();
      rec.groups[0].files.push(...added);
    },
    body: files.map((f, i) => fileRow(f, locked, () => { files.splice(i, 1); drops.clear(); touch(); updateCount(); renderMain(); }, null, [])),
  });
}

function otherSlots(vehicles, locked) {
  return [el('h3', { textContent: 'Guns: shared by calibre' }),
    ...gunVoices(vehicles).map(([name, used]) => groupSlot(`gun:${name}`, `gun${name}`, gunTitle(name), '3-4 single shots, each with the crack and a short tail, and trimmed tight to the start. No bursts: the game fires each round itself.', locked, used.join(', '))),
    el('h3', { textContent: 'Landing: shared with all aircraft' }),
    groupSlot('sfx:touchdown', 'touchdown', 'Touchdown', '2-3 short thumps of wheels hitting the ground, under 1 s, with no engine in them.', locked)];
}

// Slots added by hand on this engine or plane.
function extraSlots(attachKey, kind, locked) {
  const mine = Object.entries(sound.layers).filter(([id, l]) => l.attach[attachKey] && !id.startsWith('slot_'));
  const add = button('+ Add slot', () => {
    const name = prompt('Name of the new slot? (siren, wooden creak...)');
    if (!name) return;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}${Object.keys(sound.layers).length}`;
    sound.layers[id] = { name, type: 'continuous', kind, hearing: 'cockpit', driver: DRIVERS[kind][0].key, threshold: 1, cooldown: 3, chance: 1, group: newGroup(), attach: { [attachKey]: { gain: 1, pitch: 0 } } };
    touch();
    updateCount();
    renderList();
    renderMain();
  }, 'Your own sound here. Advanced sets what it follows and whether it loops.');
  return [el('h3', { textContent: 'Extra slots' }),
    ...mine.map(([id, l]) => layerSlot(id, l, `Your own slot. It follows ${DRIVERS[l.kind].find((d) => d.key === l.driver)?.label ?? l.driver}. Advanced changes that.`, locked)),
    locked ? el('span') : el('div', { className: 'buttons' }, add)];
}

function slotCounts(buildId) {
  const rec = sound.recordings[`build:${buildId}`];
  const kind = sound.builds[buildId].kind;
  if (kind === 'tank') return [TANK_SLOTS.filter(([k]) => rec?.clips?.some((c) => c.role === k)).length, TANK_SLOTS.length];
  const clips = ENGINE_SLOTS.filter(([k]) => rec?.clips?.some((c) => c.slot === k)).length;
  const start = rec?.startup?.files?.length ? 1 : 0;
  const air = Object.keys(AIRFRAME_SLOTS).filter((k) => sound.layers[`slot_${k}`]?.group.files.length).length;
  return [clips + start + air, ENGINE_SLOTS.length + 1 + Object.keys(AIRFRAME_SLOTS).length];
}

function renderPicker() {
  const list = $('list');
  const item = (type, id, text, cls, extra) => el('div', {
    className: `row ${cls}${design.type === type && design.id === id ? ' sel' : ''}`,
    onclick: () => { design = { type, id }; renderList(); renderMain(); },
  }, el('span', { textContent: text }), extra ? el('span', { className: 'dim', textContent: extra }) : null);
  const section = (kind, title) => {
    list.append(el('div', { className: 'group', textContent: title }));
    for (const [buildId, b] of Object.entries(sound.builds).filter(([, x]) => x.kind === kind)) {
      const [have, all] = slotCounts(buildId);
      list.append(item('build', buildId, b.name, '', ` ${have}/${all}`));
      for (const [engId, eng] of Object.entries(sound.engines).filter(([, e]) => e.build === buildId)) {
        const users = sound.vehicles.filter((v) => v.engine === engId);
        if (!users.length) continue;
        list.append(item('engine', engId, eng.name, 'indent'));
        for (const v of users) {
          list.append(item('vehicle', v.id, `${v.name}${v.count > 1 ? ` × ${v.count}` : ''}`, 'indent2', inGame(v) ? '' : v.later ? ' (later)' : ' (planned)'));
        }
      }
    }
  };
  section('plane', 'Aircraft');
  section('tank', 'Tanks');
}

function synthToggle(id, locked) {
  const rec = recOf(id);
  const on = (rec.synth ?? 1) > 0;
  const startup = rec.startup?.files?.length;
  return el('div', { className: 'buttons' },
    el('label', { title: 'Off leaves only your recordings. With no clips in it, this sound goes silent.' },
      el('input', { type: 'checkbox', checked: on, disabled: locked, onchange: (e) => {
        if (e.target.checked) rec.synth = rec.synthWas || 1;
        else {
          rec.synthWas = rec.synth ?? 1;
          rec.synth = 0;
        }
        touch();
        renderMain();
      } }), ' Synth on'),
    !on && !rec.clips?.length ? el('span', { className: 'warn', textContent: 'No clips and no synth: this engine is silent.' }) : null,
    !on && !startup && sound.builds[id.slice(6)]?.kind === 'plane' ? el('span', { className: 'warn', textContent: 'No start-up clip: engine starts are silent.' }) : null);
}

// Everything on the page, together: one engine voice and the layers on it.
function testFlight(buildId, vehicles, kind) {
  const usable = vehicles.length ? vehicles : sound.vehicles.filter((v) => v.kind === kind).slice(0, 1);
  const state = { vehicle: usable.find(inGame)?.id ?? usable[0]?.id, throttle: 0, speed: 0, turn: 0, damage: 0, moving: 1 }; // Run: the start-up, then idle on the ground
  const box = el('div', {}, el('h3', { textContent: 'Test Flight' }));
  let running = null;
  let flyby = 0;
  const run = async () => {
    await audio();
    stopLive();
    const v = sound.vehicles.find((x) => x.id === state.vehicle);
    const build = sound.builds[buildId];
    const recId = `build:${buildId}`;
    const host = mixer.recordings.createLayerHost([`${kind}:${v?.id}`, recId, `all:${kind}`]);
    let voice;
    if (kind === 'tank') voice = createTankEngine(mixer, build, recId);
    else {
      voice = createEngineVoice(mixer, engineOf(v), build, v.count, recId);
      voice.start();
    }
    const spec = v ? engineOf(v) : {};
    let frame = 0;
    const tick = () => {
      const t = flyby ? (mixer.now - flyby) / 6 : 0;
      if (t >= 1) flyby = 0;
      const w = flyby ? where(-700 + t * 1400, settings.audio.hearRange, 233) : where();
      if (kind === 'tank') {
        voice.update(w, Boolean(state.moving));
        host.update({ moving: state.moving, speed: state.moving ? 5 : 0 }, w, false);
      } else {
        const rpm = spec.idleRpm + (spec.maxRpm - spec.idleRpm) * state.throttle;
        voice.update({ rpm, load: state.throttle, roughness: 0.08 + state.damage * 0.5, misfire: state.damage * 0.22, gain: w.gain, pan: w.pan, cutoff: w.cutoff, doppler: w.doppler });
        host.update({ rpm, load: state.throttle, speed: state.speed, turn: state.turn, damage: state.damage, altitude: 200, ground: 0, inverted: 0, service: 0 }, w, !flyby);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    running = voice;
    runBtn.textContent = 'Stop';
    live = {
      stop() {
        cancelAnimationFrame(frame);
        if (kind === 'tank') voice.stop();
        else voice.dispose();
        host.stop();
        running = null;
        runBtn.textContent = 'Run';
      },
    };
  };
  const runBtn = button('Run', () => (running ? stopLive() : run()));
  const pick = el('select', { onchange: () => { state.vehicle = pick.value; if (running) run(); } },
    ...usable.map((v) => el('option', { value: v.id, textContent: `${v.name}${v.count > 1 ? ` × ${v.count}` : ''}`, selected: v.id === state.vehicle })));
  box.append(el('div', { className: 'buttons' }, runBtn, 'as', pick,
    kind === 'plane' ? button('Start-up', () => running?.start(), 'Plays the start again') : null,
    button('Flyby', () => { if (mixer) flyby = mixer.now; }, 'Passes by over 6 seconds. Cockpit-only layers go quiet, as they would outside.')));
  box.append(slider(settings.audio, LEVEL_FIELDS[0], () => mixer?.applyLevels(), false));
  if (kind === 'tank') box.append(testSlider(state, 'moving', 'Moving', 0, 1, 1));
  else box.append(testSlider(state, 'throttle', 'Throttle', 0, 1, 0.01), testSlider(state, 'speed', 'Airspeed', 0, 250, 1), testSlider(state, 'turn', 'Turn strength', 0, 4, 0.05), testSlider(state, 'damage', 'Damage', 0, 1, 0.01));
  return box;
}

function renderDesign() {
  const buildId = pageBuild();
  const build = sound.builds[buildId];
  if (!build) {
    design = { type: 'build', id: 'inline' };
    return renderDesign();
  }
  const id = `build:${buildId}`;
  const kind = build.kind;
  const doneId = `design:${design.type}:${design.id}`;
  const locked = Boolean(sound.status[doneId]?.done);
  const vehicle = design.type === 'vehicle' ? sound.vehicles.find((v) => v.id === design.id) : null;
  const engine = design.type === 'engine' ? sound.engines[design.id] : vehicle ? sound.engines[vehicle.engine] : null;
  const engineId = design.type === 'engine' ? design.id : vehicle?.engine;
  const usingBuild = vehiclesOnBuild(buildId);
  const onPage = vehicle ? [vehicle] : design.type === 'engine' ? sound.vehicles.filter((v) => v.engine === design.id) : usingBuild;
  const enginesOnBuild = Object.entries(sound.engines).filter(([, e]) => e.build === buildId);
  const title = vehicle?.name ?? engine?.name ?? build.name;
  const finished = el('input', { type: 'checkbox', checked: locked, onchange: () => {
    statusOf(doneId).done = finished.checked;
    touch();
    renderMain();
  } });
  const page = el('div', { className: 'wide' },
    el('h2', { textContent: title }),
    el('div', { className: 'dim', textContent: `Sound: ${build.name}. ${vehicle ? `Engine: ${engine?.name}${vehicle.count > 1 ? ` × ${vehicle.count}` : ''}.` : `Planes: ${onPage.map((v) => v.name).join(', ') || 'none'}.`}` }));
  if (enginesOnBuild.length > 1) {
    page.append(el('p', { className: 'warn', textContent: `Shared sound. Engine and start-up slots here also affect: ${enginesOnBuild.filter(([k]) => k !== engineId).map(([, e]) => e.name).join(', ')}.` }));
  }
  if (engineId && engine) {
    const same = el('select', { onchange: () => { engine.build = same.value; touch(); renderList(); renderMain(); } },
      ...Object.entries(sound.builds).filter(([, b]) => b.kind === kind).map(([k, b]) => el('option', { value: k, textContent: b.name, selected: k === buildId })));
    page.append(el('div', { className: 'buttons' },
      enginesOnBuild.length > 1 ? button('Give this engine its own sound', () => { makeOwnCopy(engineId); renderList(); }, 'An exact copy to start from, for this engine alone') : null,
      el('label', {}, 'Same as ', same)));
  }
  const others = Object.entries(sound.builds).filter(([k, b]) => b.kind === kind && k !== buildId);
  if (others.length) {
    const from = el('select', {}, el('option', { value: '', textContent: 'Copy clips from...' }), ...others.map(([k, b]) => el('option', { value: k, textContent: b.name })));
    from.onchange = () => {
      if (!from.value || !confirm(`Replace this sound's clips and start-up with those of ${sound.builds[from.value].name}?`)) return;
      const src = sound.recordings[`build:${from.value}`] ?? {};
      const rec = recOf(id);
      rec.clips = clone(src.clips ?? []);
      rec.startup = clone(src.startup ?? { files: [], gain: 1, fade: 0.6 });
      rec.synth = src.synth ?? 1;
      touch();
      updateCount();
      renderList();
      renderMain();
    };
    page.append(el('div', { className: 'buttons' }, from));
  }
  page.append(
    synthToggle(id, locked),
    el('label', {}, finished, ' finished: locks this page'),
    testFlight(buildId, onPage, kind),
    distanceControl(),
    ...(kind === 'tank' ? tankSlots(buildId, locked) : [
      ...engineSlots(buildId, onPage.map(engineOf), locked),
      ...airframeSlots(locked, vehicle?.id),
      ...otherSlots(onPage, locked),
    ]),
    ...extraSlots(vehicle ? `${kind}:${vehicle.id}` : id, kind, locked),
  );
  if (vehicle) page.append(el('div', { className: 'buttons' }, button('Edit vehicle details', () => { vehicleSel = vehicle.id; setTab('vehicles'); })));
  drops.clear();
  return page;
}

document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
$('save').onclick = saveAll;
const showMute = () => {
  $('mute').textContent = muted ? 'Unmute' : 'Mute';
  $('mute').classList.toggle('on', muted);
};
$('mute').onclick = () => {
  muted = !muted;
  mixer?.setMuted(muted);
  showMute();
};
addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});
showMute();
updateCount();
setTab('design');

// The running engine under auditions. It has its own life: changing page leaves it on.
let bed = null;
function fillBedMenu() {
  const select = $('bed');
  select.replaceChildren(el('option', { value: '', textContent: 'Nothing' }),
    ...Object.entries(sound.builds).filter(([, b]) => b.kind === 'plane').map(([k, b]) => el('option', { value: k, textContent: b.name })));
}
fillBedMenu();
$('bed').onfocus = () => {
  const keep = $('bed').value;
  fillBedMenu();
  $('bed').value = keep;
};
$('bed').onchange = async () => {
  bed?.stop();
  bed = null;
  const build = sound.builds[$('bed').value];
  if (!build) return;
  await audio();
  const voice = createEngineVoice(mixer, { cylinders: 12, propBlades: 3, gearRatio: 0.6 }, build, 1, `build:${$('bed').value}`);
  voice.start();
  const beat = setInterval(() => voice.update({ rpm: 2300, load: 0.8 }), 100);
  bed = { stop() { clearInterval(beat); voice.dispose(); } };
};
