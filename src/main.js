import { loadContent } from './content/load.js';
import { createWorld, addPlane, setBots, stepWorld, DT } from './sim/world.js';
import { autopilotCommand } from './sim/ai.js';
import { createKeyboard } from './input/keyboard.js';
import { createMouse } from './input/mouse.js';
import { createRenderer, MAX_ZOOM } from './render/renderer.js';
import { createMixer } from './audio/mixer.js';
import { createSoundscape } from './audio/soundscape.js';
import { createTuningPanel } from './ui/tuning.js';
import { surfaceAt } from './sim/ground.js';
import { NO_COMMAND } from './sim/plane.js';
import { clamp } from './sim/math.js';
import { hostGame, joinGame, cleanCode } from './net/session.js';
import { createGuestView } from './net/guest.js';

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
  zones: content.settings.zones,
  runway: content.settings.runway,
  landing: content.settings.landing,
  decor: content.settings.decor,
  bots: content.settings.bots,
  radar: content.settings.radar,
  rules: content.settings.rules,
});
// Share the world's rules object with the settings so the tuning panel saves the Testing switches.
content.settings.rules = world.rules;
// Your plane and the enemy's, picked in the tuning panel (it reloads with ?plane=...&enemy=...) until the
// hangar (milestone 8). Each flies in its own nation's colours; your wingmen fly your plane.
const params = new URLSearchParams(location.search);
const planeId = (key, fallback) => (content.planeDefs[params.get(key)] ? params.get(key) : fallback);
const choice = { plane: planeId('plane', 'bf109g6'), enemy: planeId('enemy', 'spitfire') };
const nationOf = (defId) => content.planeDefs[defId].nation;
// On a guest, your plane is the one the host gave you (it changes when the first snapshot arrives).
let player = addPlane(world, { defId: choice.plane, team: 0, nation: nationOf(choice.plane), controller: 'p1' });
// Bots: your wingmen and the enemy, as many and as good as the rules say (Testing in the tuning panel).
// Online players take bots' places on their side.
const SIDES = [
  { team: 0, nation: nationOf(choice.plane), defId: choice.plane, count: 'wingmen', skill: 'wingmanSkill' },
  { team: 1, nation: nationOf(choice.enemy), defId: choice.enemy, count: 'enemies', skill: 'enemySkill' },
];
const isOnline = (p) => p.seats.some((s) => s.controller.startsWith('net'));
const guestsOn = (team) => world.planes.filter((p) => p.team === team && isOnline(p)).length;
const placeBots = () => {
  for (const s of SIDES) setBots(world, { ...s, count: Math.max(0, world.rules[s.count] - guestsOn(s.team)), skill: world.rules[s.skill] });
};
placeBots();
const renderer = createRenderer(canvas, world, content);
const keyboard = createKeyboard();
const mouse = createMouse(canvas, content.settings.camera);

let showHelp = true;
let paused = false;
const tuning = createTuningPanel({
  content,
  world,
  player,
  choice,
  placeBots,
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
// Online play: host is set while hosting (src/net/session.js); guest while in someone else's game,
// with view (src/net/guest.js) showing the host's world and commands waiting to be sent.
let host = null;
let guest = null;

// A guest only sees the host's world: pausing, free look's fast forward and the tuning panel all
// change the world itself, so they stay with the host.
const HOST_ONLY = new Set(['KeyT', 'KeyP', 'KeyV']);

addEventListener('keydown', (e) => {
  // Typing a room code isn't flying.
  if (e.target instanceof HTMLInputElement) return;
  if (guest && HOST_ONLY.has(e.code)) {
    if (!e.repeat) renderer.message('ONLY THE HOST CAN DO THAT', '#f0e8c0');
    return;
  }
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

// The same display scales as the HUD.
const kmh = (v) => Math.round(v * 3.6 * 0.4 * 3.2);
const sinkText = (v) => `${Math.round(v * 0.4)} M/S`;
const deg = (a) => Math.round((a * 180) / Math.PI);
const CAUSES = {
  guns: (by) => (by ? `SHOT DOWN BY ${by}` : 'SHOT DOWN'),
  bomb: () => 'BLOWN UP BY A BOMB',
  collision: (by) => (by ? `MID-AIR COLLISION WITH ${by}` : 'MID-AIR COLLISION'),
  fire: () => 'CONSUMED BY FIRE',
  blackout: () => 'BLACKED OUT AND WENT IN',
  stall: (by, e) => (e.what ? `STALLED INTO THE GROUND (SINKING ${sinkText(e.what.sink)}, MAX ${sinkText(e.what.limit)})` : 'STALLED INTO THE GROUND'),
  inverted: () => 'HIT THE GROUND UPSIDE DOWN',
  tooFast: (by, e) => (e.what ? `LANDED TOO FAST (${kmh(e.what.speed)}, MAX ${kmh(e.what.limit)})` : 'HIT THE GROUND TOO FAST'),
  tooSteep: (by, e) => `NOSE TOO FAR DOWN (${deg(e.what.angle)}°, MAX ${deg(e.what.limit)}°)`,
  tailFirst: (by, e) => `NOSE TOO HIGH - TAIL FIRST (${deg(e.what.angle)}°, MAX ${deg(e.what.limit)}°)`,
  hardLanding: () => 'BOUNCED ONE HARD LANDING TOO MANY',
  ground: () => 'FLEW INTO THE GROUND',
  belly: () => 'BELLY LANDING WENT WRONG',
  rough: () => 'HIT ROUGH GROUND TOO FAST',
  taxiRoll: () => 'TRIED TO ROLL WHILE TAXIING',
  flak: () => 'SHOT DOWN BY FLAK',
  mgNest: () => 'SHOT DOWN BY AN MG NEST',
  infantry: () => 'SHOT DOWN BY INFANTRY',
  tank: () => 'SHOT DOWN BY A TANK',
  infantryRam: () => 'FLEW THROUGH ONE SOLDIER TOO MANY',
  structure: (by, e) => `FLEW INTO A ${(e.what ?? 'BUILDING').toUpperCase()}`,
};

function causeText(e) {
  if (e.by === e.plane && e.cause === 'bomb') return 'BLEW YOURSELF UP WITH YOUR OWN BOMB';
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
    if (e.plane === player.id && e.type === 'abandoned') renderer.recordLastFlight(player, 'ABANDONED THE PLANE');
    if (e.plane === player.id && e.type === 'spawn') renderer.startLastFlightTimer();
    if (e.plane === player.id) {
      if (e.type === 'fuelLow') renderer.message('LOW FUEL - HEAD HOME', '#ffb070');
      if (e.type === 'bombRelease' && player.state === 'ground') renderer.message('BOMB AWAY... ON THE GROUND?!', '#ffd870');
      if (e.type === 'engineOut') renderer.message('ENGINE OUT - OUT OF FUEL', '#ff8070');
      if (e.type === 'serviceDone') renderer.message('GROUND CREW: ALL DONE', '#a8e090');
      if (e.type === 'hedgeHit') renderer.message('THROUGH THE HEDGE!', '#ffd070');
      if (e.type === 'wallHit') {
        renderer.shake(5);
        renderer.message('STONE WALL - GEAR TORN OFF!', '#ff9070');
      }
      if (e.type === 'bump') {
        renderer.shake(3);
        renderer.message(`BUMPED INTO THE ${world.groundDefs[e.kind].name.toUpperCase()}!`, '#ffb070');
      }
      if (e.type === 'recovered') renderer.message('PLANE RECOVERED - GROUND CREW TAKE OVER', '#f0e8c0');
      if (e.type === 'hardLanding') renderer.shake(e.plop ? 2 : 3 + 3 * e.severity);
      if (e.type === 'hardLanding') renderer.message(e.plop ? 'HEAVY LANDING' : e.noseDown ? 'HARD LANDING - PROPELLER STRUCK!' : 'HARD LANDING - BOUNCED!', '#ffb070');
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
    if (e.by === player.id && e.type === 'groundDestroyed' && e.points > 0) {
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
    if (e.type === 'runwayCratered' && e.by === player.id && e.points > 0) {
      renderer.message(e.closed ? `ENEMY RUNWAY CLOSED +${e.points}` : `RUNWAY HIT +${e.points}`, '#e8c860');
    }
    if (e.type === 'runwayClosed' && e.team === player.team) renderer.message('OUR RUNWAY IS CLOSED!', '#ff8070');
    else if (e.type === 'runwayClosed' && e.by !== player.id) renderer.message('ENEMY RUNWAY CLOSED', '#e8c860');
    if (e.type === 'runwayReopened') renderer.message(e.team === player.team ? 'OUR RUNWAY IS OPEN AGAIN' : 'ENEMY RUNWAY REOPENED', e.team === player.team ? '#a8e090' : '#ffb070');
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
let lastFacing = 1;
let last = performance.now();
let acc = 0;
// Runs the world's ticks due by now (on a guest: gathers the commands and shows the host's world).
// Returns the frame's dt.
function advance(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt * (free.on ? SPEEDS[free.speed] : 1);
  if (paused) acc = 0;
  while (acc >= DT) {
    const cmd = free.on ? autopilotCommand(world, player, freeCfg.autopilotHeight, free.autopilot) : withMouse(keyboard.read());
    if (guest) guest.commands.push(cmd);
    else {
      stepWorld(world, { p1: cmd, ...host?.commands() });
      handleEvents();
      host?.afterTick();
    }
    acc -= DT;
  }
  if (guest) {
    // One message a frame carries this frame's ticks of commands.
    guest.net.sendCommands(guest.commands);
    guest.commands = [];
    world.events = guest.view.update(dt);
    // Your plane is whichever the host gave you; find it again if it was replaced.
    if (!world.planes.includes(player)) player = world.planes.find((p) => p.id === guest.planeId) ?? player;
    handleEvents();
  }
  return dt;
}

function frame(now) {
  const dt = advance(now);
  mouse.panMode = free.on;
  mouse.update(dt);
  // The sticky mouse look is relative to where the plane points: turn around and it turns with you
  // (looking ahead stays ahead, looking back stays back).
  const facing = Math.cos(player.angle) >= 0 ? 1 : -1;
  if (facing !== lastFacing) mouse.x = -mouse.x;
  lastFacing = facing;
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

// Browsers only allow audio (and grabbing the mouse) after a click, so the game starts on one.
async function start() {
  overlay.classList.add('hidden');
  mouse.capture();
  mixer = await createMixer(content.settings.audio);
  // Open the game as localhost:8080/?mute to start silent (M toggles sound as usual).
  if (new URLSearchParams(location.search).has('mute')) mixer.setMuted((muted = true));
  sound = createSoundscape(mixer, world, content.settings.audio);
  last = performance.now();
  requestAnimationFrame(frame);
  if (host) keepTicking();
}

// Browsers stop animation frames in a hidden tab. A host's world must go on for their guests, so a
// worker's steady timer (not slowed like the page's own timers) keeps it ticking while hidden;
// nothing is drawn.
function keepTicking() {
  const code = 'setInterval(() => postMessage(0), 1000 / 60);';
  const worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  worker.onmessage = () => document.hidden && advance(performance.now());
}
// A guest's hidden tab sends nothing more, and the host keeps the last command held: let go of
// everything first.
document.addEventListener('visibilitychange', () => {
  if (guest && document.hidden) guest.net.sendCommands([NO_COMMAND]);
});

// The title menu: single player, or host or join an online game (src/net/session.js).
const $ = (id) => document.getElementById(id);
const planeName = (defId) => content.planeDefs[defId].name.toUpperCase();
$('plane-name').textContent = planeName(choice.plane);
function showMenu(id) {
  for (const m of overlay.querySelectorAll('.menu')) m.classList.toggle('hidden', m.id !== id);
}
function status(id, text, bad = false) {
  $(id).textContent = text;
  $(id).classList.toggle('bad', bad);
}
// Back closes any connection by starting the page afresh.
for (const b of overlay.querySelectorAll('.back')) b.addEventListener('click', () => location.reload());
$('solo').addEventListener('click', start);

// Hosting: your friend joins with the room code, on your side or against you, taking a bot's place.
let friendSide = 'same';
const sideOf = () => (friendSide === 'same' ? player.team : 1 - player.team);
function setSide(side) {
  friendSide = side;
  $('side-same').classList.toggle('on', side === 'same');
  $('side-enemy').classList.toggle('on', side === 'enemy');
}
$('side-same').addEventListener('click', () => setSide('same'));
$('side-enemy').addEventListener('click', () => setSide('enemy'));
function hostStatus() {
  const friends = world.planes.filter(isOnline);
  if (!friends.length) return status('host-status', 'WAITING FOR A FRIEND. START WHEN YOU LIKE: THEY CAN JOIN ANY TIME.');
  const p = friends[0];
  status('host-status', `FRIEND JOINED IN A ${p.def.name.toUpperCase()}, ${p.team === player.team ? 'ON YOUR SIDE' : 'AGAINST YOU'}.`);
}
$('host').addEventListener('click', async () => {
  showMenu('host-menu');
  status('host-status', 'OPENING A ROOM...');
  try {
    host = await hostGame(world, content.settings.net, {
      onJoin(g, hello) {
        const defId = content.planeDefs[hello.plane]?.name ? hello.plane : choice.plane;
        const p = addPlane(world, { defId, team: sideOf(), nation: nationOf(defId), controller: g.controller });
        g.planeId = p.id;
        placeBots();
        // The side is settled once someone has joined.
        $('side-same').disabled = $('side-enemy').disabled = true;
        hostStatus();
        renderer.message(`A FRIEND JOINED: ${planeName(defId)}, ${p.team === player.team ? 'ON OUR SIDE' : 'ON THE ENEMY SIDE'}`, '#e8c860');
        return { planeId: p.id };
      },
      onLeave(g) {
        const i = world.planes.findIndex((p) => p.id === g.planeId);
        if (i >= 0) world.planes.splice(i, 1);
        placeBots();
        hostStatus();
        renderer.message('YOUR FRIEND HAS LEFT THE GAME', '#ffb070');
      },
    });
    $('room-code').textContent = host.code;
    $('host-start').disabled = false;
    hostStatus();
  } catch (err) {
    status('host-status', `COULD NOT OPEN A ROOM: ${(err.type ?? err.message ?? err).toString().toUpperCase()}`, true);
  }
});
$('host-start').addEventListener('click', start);

// Joining: the host's world replaces ours once the first snapshot arrives.
$('join').addEventListener('click', () => {
  showMenu('join-menu');
  $('join-code').focus();
});
$('join-code').addEventListener('input', () => {
  $('join-code').value = cleanCode($('join-code').value);
  $('join-go').disabled = $('join-code').value.length < 4;
});
$('join-code').addEventListener('keydown', (e) => e.key === 'Enter' && !$('join-go').disabled && $('join-go').click());
const JOIN_ERRORS = { 'peer-unavailable': 'NO GAME WITH THAT CODE', network: 'NO CONNECTION TO THE BROKER' };
$('join-go').addEventListener('click', async () => {
  // Connected and the world has arrived: this click starts the engine.
  if (guest?.view.ready) return start();
  $('join-go').disabled = $('join-code').disabled = true;
  status('join-status', 'CONNECTING...');
  const view = createGuestView(world, content.settings.net);
  try {
    const net = await joinGame($('join-code').value, { plane: choice.plane }, {
      onMessage(m) {
        if (m?.t === 'welcome') {
          guest.planeId = m.planeId;
          status('join-status', 'CONNECTED. WAITING FOR THE HOST TO START...');
        }
        if (m?.t !== 'snap') return;
        const first = !view.ready;
        view.receive(m);
        if (!first) return;
        player = world.planes.find((p) => p.id === guest.planeId) ?? player;
        status('join-status', 'CONNECTED. CLICK TO FLY.');
        $('join-go').textContent = 'START ENGINE';
        $('join-go').disabled = false;
        renderer.render(player, 0, { showHelp });
      },
      onClose() {
        overlay.classList.remove('hidden');
        document.exitPointerLock?.();
        showMenu('join-menu');
        $('join-go').disabled = true;
        status('join-status', 'LOST THE CONNECTION TO THE HOST.', true);
      },
    });
    guest = { net, view, commands: [], planeId: null };
    // Your own planes go: from now on the world is the host's.
    world.planes.length = 0;
  } catch (err) {
    $('join-go').disabled = $('join-code').disabled = false;
    status('join-status', `COULD NOT JOIN: ${JOIN_ERRORS[err.type] ?? (err.type ?? err.message ?? err).toString().toUpperCase()}`, true);
  }
});

renderer.render(player, 0, { showHelp });
window.__game = { world, renderer, get player() { return player; }, get mixer() { return mixer; }, get host() { return host; }, get guest() { return guest; } };
