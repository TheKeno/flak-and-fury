import { loadContent } from './content/load.js';
import { createWorld, addPlane, stepWorld, DT } from './sim/world.js';
import { autopilotCommand } from './sim/ai.js';
import { createKeyboard } from './input/keyboard.js';
import { createMouse } from './input/mouse.js';
import { createRenderer, MAX_ZOOM } from './render/renderer.js';
import { createMixer } from './audio/mixer.js';
import { createSoundscape } from './audio/soundscape.js';
import { createTuningPanel } from './ui/tuning.js';
import { surfaceAt } from './sim/ground.js';
import { clamp } from './sim/math.js';

const canvas = document.getElementById('screen');
const overlay = document.getElementById('start');

const content = await loadContent('countryside');
const world = createWorld({
  map: content.map,
  planeDefs: content.planeDefs,
  weapons: content.weapons,
  groundDefs: content.groundDefs,
  servicing: content.settings.servicing,
  collisions: content.settings.collisions,
  fire: content.settings.fire,
  waves: content.settings.waves,
  pads: content.settings.pads,
  rules: content.settings.rules,
});
// Share the world's rules object with the settings so the tuning panel saves the Testing switches.
content.settings.rules = world.rules;
const player = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
// A sparring partner until real bots arrive in milestone 5.
addPlane(world, { defId: 'fighter_v12', team: 1, nation: 'uk', controller: 'bot:target' });
const renderer = createRenderer(canvas, world, content);
const keyboard = createKeyboard();
const mouse = createMouse(canvas, content.settings.camera);

let showHelp = true;
let paused = false;
const tuning = createTuningPanel({
  content,
  world,
  player,
  getMixer: () => mixer,
  onPause: (p) => setPaused(p),
});
function setPaused(p) {
  paused = p;
  tuning.showPaused(p);
}

// Free look (V), our debug view for the ground war: the arrows move the camera anywhere, the wheel
// zooms, 1/2/3 jump to the front, the bridge and your plane, W/S step the fast forward. Meanwhile an
// autopilot flies your plane level, and nothing saves it if it's shot down.
const SPEEDS = [1, 2, 4, 8];
const freeCfg = content.settings.freeLook;
const free = { on: false, x: 0, y: 0, tx: 0, ty: 0, zoom: 1, speed: 0, autopilot: {} };
function setFreeLook(on) {
  free.on = on;
  free.speed = 0;
  if (!on) return;
  const c = renderer.centre();
  free.x = free.tx = c.x;
  free.y = free.ty = c.y;
  free.zoom = Math.max(renderer.zoom, freeCfg.zoom);
  free.autopilot = {};
}
// Somewhere worth looking: the middle of the front line, the bridge, or your plane.
function jumpTo(what) {
  let x = player.x;
  let y = player.y;
  if (what !== 'plane') {
    const bridge = world.ground.find((o) => o.type === 'bridge');
    x = bridge?.x ?? world.map.width / 2;
    if (what === 'front') {
      // Each side's leading unit, measured in its own direction of advance; the front is between them.
      const home = (team) => world.map.airfields.find((a) => a.team === team);
      const dir = Math.sign((home(1)?.x ?? 1) - (home(0)?.x ?? 0)) || 1;
      const lead = (team, sign) => {
        let best = null;
        for (const o of world.ground) {
          if (!o.mobile || !o.alive || o.team !== team) continue;
          if (best === null || o.x * sign > best * sign) best = o.x;
        }
        return best;
      };
      const a = lead(0, dir);
      const b = lead(1, -dir);
      if (a !== null && b !== null) x = (a + b) / 2;
      else if (a !== null || b !== null) x = a ?? b;
      else renderer.message('NO TROOPS OUT - SHOWING THE BRIDGE', '#f0e8c0');
    }
    y = surfaceAt(world, x) + 60; // the ground low in the view
  }
  free.tx = x;
  free.ty = y;
}
function moveFreeLook(dt) {
  const k = keyboard.held;
  const speed = freeCfg.panSpeed * free.zoom * (k('ShiftLeft') || k('ShiftRight') ? 3 : 1) * dt;
  const dx = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0);
  const dy = (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0);
  // The mouse drags the view along too.
  const [mx, my] = mouse.takePan();
  const perPixel = freeCfg.mousePan * free.zoom;
  free.tx = clamp(free.tx + dx * speed + mx * perPixel, 0, world.map.width);
  free.ty = clamp(free.ty + dy * speed - my * perPixel, 0, world.map.ceiling + 160);
  const e = 1 - Math.exp(-dt * 6);
  free.x += (free.tx - free.x) * e;
  free.y += (free.ty - free.y) * e;
}
canvas.addEventListener('wheel', (e) => {
  if (!free.on) return;
  e.preventDefault();
  free.zoom = clamp(free.zoom * Math.exp(e.deltaY * 0.0012), 1, MAX_ZOOM);
}, { passive: false });
// Clicking the game takes keyboard focus back from the tuning panel.
canvas.addEventListener('mousedown', () => document.activeElement?.blur());
let muted = false;
let sound = null;
let mixer = null;

addEventListener('keydown', (e) => {
  if (e.code === 'KeyH') showHelp = !showHelp;
  // The panel needs the cursor back.
  if (e.code === 'KeyT' && tuning.toggle()) mouse.release();
  if (e.code === 'KeyM' && mixer) mixer.setMuted((muted = !muted));
  if (e.code === 'KeyP') setPaused(!paused);
  if (e.code === 'KeyV') setFreeLook(!free.on);
  if (free.on && !e.repeat) {
    if (e.code === 'Digit1') jumpTo('front');
    if (e.code === 'Digit2') jumpTo('bridge');
    if (e.code === 'Digit3') jumpTo('plane');
    if (e.code === 'KeyW') free.speed = Math.min(SPEEDS.length - 1, free.speed + 1);
    if (e.code === 'KeyS') free.speed = Math.max(0, free.speed - 1);
  }
});

const CAUSES = {
  guns: (by) => (by ? `SHOT DOWN BY ${by}` : 'SHOT DOWN'),
  bomb: () => 'BLOWN UP BY A BOMB',
  collision: (by) => (by ? `MID-AIR COLLISION WITH ${by}` : 'MID-AIR COLLISION'),
  fire: () => 'CONSUMED BY FIRE',
  blackout: () => 'BLACKED OUT AND WENT IN',
  stall: () => 'STALLED INTO THE GROUND',
  inverted: () => 'HIT THE GROUND UPSIDE DOWN',
  tooFast: () => 'HIT THE GROUND TOO FAST',
  ground: () => 'FLEW INTO THE GROUND',
  belly: () => 'BELLY LANDING WENT WRONG',
  rough: () => 'HIT ROUGH GROUND TOO FAST',
  flak: () => 'SHOT DOWN BY FLAK',
  mgNest: () => 'SHOT DOWN BY AN MG NEST',
  infantry: () => 'SHOT DOWN BY INFANTRY',
  tank: () => 'SHOT DOWN BY A TANK',
  structure: (by, e) => `FLEW INTO A ${(e.what ?? 'BUILDING').toUpperCase()}`,
};

function causeText(e) {
  const killer = world.planes.find((pl) => pl.id === e.by);
  const name = killer ? `${killer.def.name.toUpperCase()} (${content.nations[killer.nation]?.name.toUpperCase() ?? ''})` : null;
  return (CAUSES[e.cause] ?? CAUSES.ground)(name, e);
}

let radarWarnAt = 0;
let hangarWarnAt = 0;
function handleEvents() {
  for (const e of world.events) {
    renderer.onEvent(e);
    sound?.onEvent(e);
    if (e.plane === player.id && e.type === 'crash') renderer.recordLastFlight(player, causeText(e));
    if (e.plane === player.id && e.type === 'spawn') renderer.startLastFlightTimer();
    if (e.plane === player.id) {
      if (e.type === 'fuelLow') renderer.message('LOW FUEL - HEAD HOME', '#ffb070');
      if (e.type === 'engineOut') renderer.message('ENGINE OUT - OUT OF FUEL', '#ff8070');
      if (e.type === 'serviceDone') renderer.message('GROUND CREW: ALL DONE', '#a8e090');
      if (e.type === 'bellyLanding') renderer.message(e.collapsed ? 'GEAR COLLAPSED!' : 'BELLY LANDING!', '#ff9070');
      if (e.type === 'fire') renderer.message('FIRE! LAND AND STOP TO PUT IT OUT', '#ff8070');
      if (e.type === 'engineFire') renderer.message('ENGINE FAILED IN THE FIRE', '#ff8070');
      if (e.type === 'fireOut') renderer.message(e.crew ? 'GROUND CREW PUT THE FIRE OUT' : 'FIRE OUT - ENGINE DAMAGED', '#a8e090');
      if (e.type === 'recovered') renderer.message('RECOVERED TO BASE', '#f0e8c0');
    }
    if (e.type === 'collision' && (e.a === player.id || e.b === player.id)) {
      renderer.shake(e.severity === 'fatal' ? 8 : e.severity === 'hard' ? 6 : 3);
      const other = world.planes.find((pl) => pl.id === (e.a === player.id ? e.b : e.a));
      if (e.severity === 'fatal') renderer.message('MID-AIR COLLISION!', '#ff8070');
      else if (e.taran && player.engineDamage > 0 && other?.tailDamage > 0) renderer.message('TARAN! YOU CHEWED HIS TAIL', '#e8c860');
      else if (e.taran) renderer.message('RAMMED! TAIL SHREDDED', '#ff8070');
      else renderer.message(e.severity === 'hard' ? 'COLLISION!' : 'GRAZED!', '#ffb070');
    }
    if (e.by === player.id && e.type === 'groundDestroyed') {
      renderer.message(`${world.groundDefs[e.kind].name.toUpperCase()} DESTROYED +${e.points}`, '#e8c860');
    }
    if (e.type === 'groundDestroyed' && e.kind === 'radar') {
      const ours = world.ground.find((o) => o.id === e.id)?.team === player.team;
      if (ours) renderer.message('OUR RADAR STATION IS DOWN!', '#ff8070');
      else if (e.by !== player.id) renderer.message('ENEMY RADAR DESTROYED', '#e8c860');
    }
    // Warn (not too often) when your own radar station is under attack.
    if (e.type === 'groundHit' && e.kind === 'radar' && performance.now() > radarWarnAt) {
      if (world.ground.find((o) => o.id === e.id)?.team === player.team) {
        renderer.message('RADAR STATION UNDER ATTACK', '#ffb070');
        radarWarnAt = performance.now() + 10000;
      }
    }
    if (e.type === 'waveOut') {
      renderer.message(e.team === player.team ? 'OUR TANKS ARE ROLLING OUT' : 'ENEMY TANK COLUMN ON THE MOVE', e.team === player.team ? '#a8e090' : '#ffb070');
    }
    if (e.type === 'groundDestroyed' && e.kind === 'bridge') renderer.message('THE BRIDGE IS DOWN', '#ffb070');
    if (e.type === 'bridgeRebuilt') renderer.message(e.team === player.team ? 'OUR ENGINEERS REBUILT THE BRIDGE' : 'ENEMY ENGINEERS REBUILT THE BRIDGE', '#f0e8c0');
    if (e.type === 'groundDestroyed' && e.kind === 'hangar' && world.ground.find((o) => o.id === e.id)?.team === player.team) {
      renderer.message('OUR HANGAR IS DESTROYED - NO GROUND CREW', '#ff8070');
    }
    if (e.type === 'groundDestroyed' && e.kind === 'depot' && world.ground.find((o) => o.id === e.id)?.team === player.team) {
      renderer.message('OUR TANK DEPOT IS DESTROYED', '#ff8070');
    }
    if (e.type === 'groundHit' && e.kind === 'hangar' && performance.now() > hangarWarnAt) {
      if (world.ground.find((o) => o.id === e.id)?.team === player.team) {
        renderer.message('HANGAR UNDER FIRE!', '#ffb070');
        hangarWarnAt = performance.now() + 10000;
      }
    }
    if (e.by === player.id && e.type === 'squadWiped') renderer.message(e.kind === 'engineers' ? 'ENGINEERS WIPED OUT' : 'INFANTRY SQUAD WIPED OUT', '#e8c860');
    if (e.type === 'shotDown') {
      if (e.by === player.id) renderer.message('ENEMY SHOT DOWN!', '#e8c860');
      else if (e.plane === player.id) renderer.message('YOU ARE GOING DOWN', '#ff8070');
    }
  }
}

// Left mouse fires the guns, right mouse drops bombs, alongside Space and E.
function withMouse(cmd) {
  cmd.fire ||= mouse.fire;
  cmd.bomb ||= mouse.bomb;
  return cmd;
}

let lastSweeps = 0;
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt * (free.on ? SPEEDS[free.speed] : 1);
  if (paused) acc = 0;
  while (acc >= DT) {
    const cmd = free.on ? autopilotCommand(world, player, freeCfg.autopilotHeight, free.autopilot) : withMouse(keyboard.read());
    stepWorld(world, { p1: cmd });
    handleEvents();
    acc -= DT;
  }
  mouse.panMode = free.on;
  mouse.update(dt);
  if (free.on) moveFreeLook(dt);
  // Held arrow keys look around (and spring back); otherwise the mouse's sticky look holds the view.
  const keys = keyboard.readLook();
  const view = free.on ? null : keys.active ? keys : mouse;
  const shown = free.on ? { x: free.x, y: free.y, zoom: free.zoom, speed: SPEEDS[free.speed] } : null;
  renderer.render(player, dt, { showHelp, look: view, free: shown, paused });
  sound?.setLook(renderer.cam.lookX, Boolean(view?.active));
  if (renderer.radarSweeps !== lastSweeps) {
    lastSweeps = renderer.radarSweeps;
    sound?.radarTick();
  }
  sound?.update(free.on ? null : player, renderer.centre(), dt);
  requestAnimationFrame(frame);
}

// Browsers only allow audio after a click, so the game waits for one.
overlay.addEventListener('click', async () => {
  overlay.classList.add('hidden');
  mouse.capture();
  mixer = await createMixer(content.settings.audio);
  // Open the game as localhost:8080/?mute to start silent (M toggles sound as usual).
  if (new URLSearchParams(location.search).has('mute')) mixer.setMuted((muted = true));
  sound = createSoundscape(mixer, world, content.settings.audio);
  last = performance.now();
  requestAnimationFrame(frame);
});

renderer.render(player, 0, { showHelp });
window.__game = { world, player, renderer, get mixer() { return mixer; } };
