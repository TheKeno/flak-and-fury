import { loadContent } from './content/load.js';
import { createWorld, addPlane, setBots, stepWorld, DT } from './sim/world.js';
import { autopilotCommand } from './sim/ai.js';
import { createKeyboard } from './input/keyboard.js';
import { createMouse } from './input/mouse.js';
import { createRenderer, MAX_ZOOM } from './render/renderer.js';
import { createMixer } from './audio/mixer.js';
import { createSoundscape } from './audio/soundscape.js';
import { createRecordings } from './audio/recordings.js';
import { createTuningPanel } from './ui/tuning.js';
import { createSetup } from './ui/setup.js';
import { createOptions, cleanName, toggleFullscreen, restoreFullscreen } from './ui/options.js';
import { setKeyNames, speedText, sinkText as sinkUnits } from './render/hud.js';
import { surfaceAt } from './sim/ground.js';
import { NO_COMMAND } from './sim/plane.js';
import { placeBots as fillSides, changeSeat, freeSide, playersOn, MAX_PLAYERS } from './sim/seats.js';
import { releasePilot } from './sim/bailout.js';
import { clamp } from './sim/math.js';
import { hostGame, joinGame, cleanCode } from './net/session.js';
import { createGuestView } from './net/guest.js';
import { takePoses, writePoses } from './render/interpolate.js';

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
  bailout: content.settings.bailout,
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
// The two sides: what their bots fly and how good they are, and how many planes each should have
// (the rules' wingmen and enemies; the setup screen sets them, the tuning panel can go past it for tests).
// Players take bots' places (src/sim/seats.js).
const SIDES = [
  { team: 0, nation: nationOf(choice.plane), defId: choice.plane, planes: () => world.rules.wingmen + 1, skillKey: 'wingmanSkill' },
  { team: 1, nation: nationOf(choice.enemy), defId: choice.enemy, planes: () => world.rules.enemies, skillKey: 'enemySkill' },
];
const TEAMS = SIDES.map((s) => s.team);
const placeBots = () => fillSides(world, SIDES.map((s) => ({ ...s, planes: s.planes(), skill: world.rules[s.skillKey] })));
placeBots();
const renderer = createRenderer(canvas, world, content);
const keyboard = createKeyboard();
const mouse = createMouse(canvas, content.settings.camera);
setKeyNames(keyboard.keyName);

let showHelp = content.settings.hud.showHelp ?? true;
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
// The player's own options (src/ui/options.js), kept in this browser and written over the loaded settings.
const options = createOptions({
  settings: content.settings,
  bindings: keyboard.bindings,
  parent: document.getElementById('wrap'),
  onChange(id) {
    if (id.startsWith('audio.') || ['master', 'engine', 'sfx', 'ambience', 'music'].includes(id)) mixer?.applyLevels();
    if (id === 'audio.muteInBackground') applyMute();
    if (id === 'bindings') showControls();
    if (id === 'name' && !guest) {
      player.callsign = options.name || null;
      $('pilot-name').value = options.name;
      drawSetup();
    }
  },
});
// Your callsign, shown to the other side online.
if (options.name) player.callsign = options.name;

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
canvas.addEventListener('mousedown', () => {
  document.activeElement?.blur();
  if (started && !menuOpen) backToFullscreen();
});
let muted = false;
let sound = null;
let mixer = null;
// Online play: host is set while hosting (src/net/session.js); guest while in someone else's game,
// with view (src/net/guest.js) showing the host's world and commands waiting to be sent.
let host = null;
let guest = null;

// A guest only sees the host's world: free look's fast forward and the tuning panel change the world
// itself, so they stay with the host.
const HOST_ONLY = new Set(['tuning', 'freeLook']);

// Mute (M), and with audio.muteInBackground also while the tab is hidden.
function applyMute() {
  mixer?.setMuted(muted || (document.hidden && content.settings.audio.muteInBackground !== false));
}

// Keys and mouse buttons as bound in the options. Free look's own keys (1/2/3, W/S speed) stay fixed:
// it's a debug view.
keyboard.onPress((code, e) => {
  // Typing a room code or a callsign isn't flying.
  if (e?.target instanceof HTMLInputElement) return;
  const acts = keyboard.actionsOf(code);
  if (acts.includes('menu')) return menuKey();
  // The game's own fullscreen (not the browser's F11), so it can keep Esc for the menu.
  if (acts.includes('fullscreen')) {
    e?.preventDefault?.();
    return toggleFullscreen();
  }
  if (menuOpen) return;
  for (const act of acts) {
    if (guest && HOST_ONLY.has(act)) {
      renderer.message('ONLY THE HOST CAN DO THAT', '#f0e8c0');
      continue;
    }
    if (act === 'help') showHelp = !showHelp;
    // The panel needs the cursor back.
    if (act === 'tuning' && tuning.toggle()) mouse.release();
    if (act === 'mute') {
      muted = !muted;
      applyMute();
    }
    if (act === 'freeLook') setFreeLook(!free.on);
  }
  if (free.on) {
    if (code === 'Digit1') jumpTo('front');
    if (code === 'Digit2') jumpTo('bridge');
    if (code === 'Digit3') jumpTo('plane');
    if (code === 'KeyW') free.speed = Math.min(SPEEDS.length - 1, free.speed + 1);
    if (code === 'KeyS') free.speed = Math.max(0, free.speed - 1);
  }
});

// The in-game menu (Esc). Single player pauses; online the world goes on for the others, so the V
// autopilot flies your plane until you're back. The browser itself takes Esc to free the mouse (and
// to leave fullscreen) without always passing the key on, so losing the mouse opens the menu too.
let started = false;
let menuOpen = false;
let menuAt = 0;
const online = () => Boolean(host || guest);
const pauseScreen = document.getElementById('pause');
function openMenu() {
  if (!started || menuOpen) return;
  menuOpen = true;
  menuAt = performance.now();
  free.autopilot = {};
  if (!online()) setPaused(true);
  document.getElementById('pause-title').textContent = online() ? 'AUTOPILOT ENGAGED' : 'PAUSED';
  document.getElementById('pause-note').textContent = online() ? 'THE GAME GOES ON: YOUR PLANE FLIES LEVEL UNTIL YOU RESUME.' : '';
  document.getElementById('quit').textContent = host ? 'END ONLINE GAME' : guest ? 'LEAVE GAME' : 'QUIT TO TITLE';
  pauseScreen.classList.remove('hidden');
  mouse.release();
}
function closeMenu() {
  if (!menuOpen) return;
  options.close();
  setup.hide();
  pauseScreen.classList.add('hidden');
  menuOpen = false;
  if (!online()) setPaused(false);
  backToFullscreen();
  // After the player's own Esc the browser won't hand the mouse back without a click.
  setTimeout(() => !mouse.locked() && !menuOpen && renderer.message('CLICK THE GAME TO GRAB THE MOUSE', '#f0e8c0'), 150);
}
// Firefox can't keep Esc in fullscreen: back into it (and the mouse grabbed again) on the click that
// resumes. Going fullscreen can drop the mouse for a moment; that mustn't reopen the menu.
let fullscreenAt = -1e9;
function backToFullscreen() {
  const going = restoreFullscreen();
  if (going) {
    fullscreenAt = performance.now();
    going.then(() => mouse.capture());
  }
  mouse.capture();
}
function menuKey() {
  if (!started) {
    if (options.isOpen) options.back();
    return;
  }
  if (setup.isOpen && menuOpen) {
    setup.hide();
    pauseScreen.classList.remove('hidden');
    return;
  }
  if (!menuOpen) return openMenu();
  // The same press that freed the mouse (and opened the menu) mustn't close it again.
  if (performance.now() - menuAt < 300) return;
  if (options.isOpen) options.back();
  else closeMenu();
}
mouse.onLockLost = () => performance.now() - fullscreenAt > 800 && openMenu();
document.addEventListener('fullscreenchange', () => !document.fullscreenElement && openMenu());
document.getElementById('resume').addEventListener('click', closeMenu);
document.getElementById('pause-sides').addEventListener('click', () => {
  pauseScreen.classList.add('hidden');
  openSetup();
});
document.getElementById('quit').addEventListener('click', () => location.reload());
document.getElementById('pause-options').addEventListener('click', () => {
  pauseScreen.classList.add('hidden');
  options.open(() => pauseScreen.classList.remove('hidden'));
});

// The same display scales and units as the HUD.
const kmh = (v) => speedText(v, content.settings.hud.units);
const sinkText = (v) => sinkUnits(v, content.settings.hud.units);
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
  const plane = killer ? `${killer.def.name.toUpperCase()} (${content.nations[killer.nation]?.name.toUpperCase() ?? ''})` : null;
  const name = killer?.callsign ? `${killer.callsign} IN A ${plane}` : plane;
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
    if (e.plane === player.id && e.type === 'bailedOut') renderer.recordLastFlight(player, e.deserter ? 'DESERTED TO THE OTHER SIDE' : 'BAILED OUT');
    if (e.plane === player.id && e.type === 'pilotKilled') renderer.message(e.cause === 'fall' ? 'YOU HIT THE GROUND TOO HARD' : 'THEY SHOT YOU IN YOUR PARACHUTE', '#ff8070');
    if (e.plane === player.id && e.type === 'chuteTorn') renderer.message('YOUR CANOPY IS TORN!', '#ff8070');
    if (e.plane === player.id && e.type === 'pilotLanded') renderer.message(e.team === player.team ? 'DOWN SAFE: YOU MARCH WITH THE TROOPS' : 'DOWN SAFE', '#a8e090');
    if (e.type === 'bailedOut' && e.deserter && e.plane !== player.id) renderer.message('A PILOT HAS DESERTED: WHITE FLAG IN THE AIR', '#f0e8c0');
    if (e.plane === player.id && e.type === 'spawn') renderer.startLastFlightTimer();
    if (e.plane === player.id) {
      if (e.type === 'fuelLow') renderer.message('LOW FUEL - HEAD HOME', '#ffb070');
      if (e.type === 'bombRelease' && player.state === 'ground') renderer.message('BOMB AWAY... ON THE GROUND?!', '#ffd870');
      if (e.type === 'engineOut') renderer.message('ENGINE OUT - OUT OF FUEL', '#ff8070');
      if (e.type === 'serviceDone') renderer.message('GROUND CREW: ALL DONE', '#a8e090');
      if (e.type === 'crewKilled') renderer.message(e.team === player.team ? 'YOU RAN DOWN YOUR OWN MECHANIC' : 'ENEMY MECHANIC RUN DOWN', '#ff8070');
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

let lastSweeps = 0;
let lastFacing = 1;
let last = performance.now();
let acc = 0;
// Where things were before and after the last tick, for drawing between them (a guest's view does
// its own blending, between snapshots).
let before = null;
let after = null;
// Runs the world's ticks due by now (on a guest: gathers the commands and shows the host's world).
// Returns the frame's dt.
function advance(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt * (free.on ? SPEEDS[free.speed] : 1);
  if (paused) acc = 0;
  let stepped = false;
  while (acc >= DT) {
    const auto = free.on || (menuOpen && online());
    const cmd = auto ? autopilotCommand(world, player, freeCfg.autopilotHeight, free.autopilot) : keyboard.read();
    if (guest) guest.commands.push(cmd);
    else {
      // The frame is drawn between the last two ticks: note where things were before the last one.
      if (acc < 2 * DT) before = takePoses(world);
      stepWorld(world, { p1: cmd, ...host?.commands() });
      handleEvents();
      host?.afterTick();
      stepped = true;
    }
    acc -= DT;
  }
  if (stepped) after = takePoses(world);
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
  // Screens faster than the sim's 60 ticks a second draw most frames between two ticks: show things
  // part-way between them, then put the true values back before the sim runs again.
  const blend = !guest && before && after;
  if (blend) writePoses(world, before, after, paused ? 1 : acc / DT);
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
  if (blend) writePoses(world, after);
  requestAnimationFrame(frame);
}

// Browsers only allow audio (and grabbing the mouse) after a click, so the game starts on one.
async function start() {
  overlay.classList.add('hidden');
  setup.hide();
  started = true;
  mouse.capture();
  mixer = await createMixer(content.settings.audio, content.sound.space);
  mixer.recordings = createRecordings(mixer, content.sound);
  await mixer.recordings.load();
  // Open the game as localhost:8080/?mute to start silent (M toggles sound as usual).
  if (new URLSearchParams(location.search).has('mute')) muted = true;
  applyMute();
  sound = createSoundscape(mixer, world, content.settings.audio, content.sound, content.planeDefs);
  // The Sound Lab in another window of this browser tunes the running game (until a reload).
  const lab = new BroadcastChannel('flak-sound-lab');
  lab.onmessage = ({ data }) => {
    if (data.type === 'ping') return lab.postMessage({ type: 'here' });
    Object.assign(content.settings.audio, data.audio);
    mixer.applyLevels();
    sound.liveUpdate(data.sound, data.final);
  };
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
  applyMute();
});

// The title menu: single player, or host or join an online game (src/net/session.js).
const $ = (id) => document.getElementById(id);
const planeName = (defId) => content.planeDefs[defId].name.toUpperCase();
function showMenu(id) {
  for (const m of overlay.querySelectorAll('.menu')) m.classList.toggle('hidden', m.id !== id);
}
function status(id, text, bad = false) {
  $(id).textContent = text;
  $(id).classList.toggle('bad', bad);
}
// Back closes any connection by starting the page afresh.
for (const b of overlay.querySelectorAll('.back')) b.addEventListener('click', () => location.reload());
$('solo').addEventListener('click', openSetup);
$('pilot-name').value = options.name;
$('pilot-name').addEventListener('input', () => options.setName($('pilot-name').value));
$('title-options').addEventListener('click', () => {
  overlay.classList.add('hidden');
  options.open(() => overlay.classList.remove('hidden'));
});
// The keys line on the title screen, as bound.
function showControls() {
  const k = keyboard.keyName;
  $('controls-line').textContent = [
    `${k('turnCcw')}/${k('turnCw')}: rotate`,
    `${k('throttleUp')}/${k('throttleDown')}: throttle`,
    `${k('roll')}: roll`,
    `${k('fire')}: guns`,
    `${k('bomb')}: bombs`,
    `${k('gear')}: gear`,
    'mouse: look',
    `${k('menu')}: menu`,
  ].join('  ·  ');
}
showControls();

// The setup screen. Single player and the host change the world directly; a guest's picks go to the
// host, who sends the table back.
const setup = createSetup({
  parent: document.getElementById('wrap'),
  planes: Object.keys(content.planeDefs).filter((id) => content.planeDefs[id].name).map((id) => [id, content.planeDefs[id].name]),
  levels: [['easy', 'EASY'], ['normal', 'NORMAL'], ['ace', 'ACE']],
  on: {
    planes(n) {
      world.rules.wingmen = n - 1;
      world.rules.enemies = n;
      sidesChanged();
    },
    skill(team, id) {
      world.rules[SIDES[team].skillKey] = id;
      sidesChanged();
    },
    botPlane(team, id) {
      Object.assign(SIDES[team], { defId: id, nation: nationOf(id) });
      sidesChanged();
    },
    side: (team) => askSeat({ team }),
    plane: (defId) => askSeat({ defId }),
    start() {
      if (menuOpen) closeMenu();
      else start();
    },
    back() {
      if (menuOpen) {
        setup.hide();
        pauseScreen.classList.remove('hidden');
      } else location.reload();
    },
  },
});
// The table as everyone sees it (`me` is worked out by whoever draws it).
function sidesTable() {
  return {
    planes: Math.max(1, Math.min(2, world.rules.enemies)),
    sides: SIDES.map((s) => ({
      team: s.team,
      label: s.team === 0 ? 'SIDE A' : 'SIDE B',
      skill: world.rules[s.skillKey],
      botPlane: s.defId,
      bots: world.planes.filter((p) => p.team === s.team && p.seats[0].controller.startsWith('bot')).length,
      players: playersOn(world, s.team).map((p) => ({ id: p.id, name: p.callsign ?? 'PILOT', plane: p.def.name, defId: Object.keys(content.planeDefs).find((k) => content.planeDefs[k] === p.def) })),
    })),
  };
}
let lastTable = null; // a guest's copy of the host's
function drawSetup() {
  const table = guest ? lastTable : sidesTable();
  if (!table) return;
  const myId = guest ? guest.planeId : player.id;
  const mine = table.sides.flatMap((s) => s.players).find((p) => p.id === myId);
  const ready = guest ? guest.view.ready || started : true;
  setup.draw({
    ...table,
    sides: table.sides.map((s) => ({ ...s, players: s.players.map((p) => ({ ...p, me: p.id === myId })) })),
    code: host?.code ?? null,
    canEdit: !guest,
    myPlane: mine?.defId ?? choice.plane,
    canSwitch: true,
    start: started ? 'RESUME' : 'START ENGINE',
    canStart: ready,
  });
}
function openSetup() {
  drawSetup();
  setup.say(guest && !guest.view.ready ? 'WAITING FOR THE HOST TO START...' : '');
  setup.show();
}
// Bots follow, and everyone's table with them.
function sidesChanged() {
  if (!guest) placeBots();
  drawSetup();
  host?.broadcast({ t: 'table', table: sidesTable() });
}
const SEAT_ERRORS = { full: 'THAT SIDE ALREADY HAS TWO PILOTS', wait: 'WAIT A MOMENT BEFORE SWITCHING AGAIN' };
function seatDone(reason) {
  if (reason) return setup.say(SEAT_ERRORS[reason] ?? reason, true);
  setup.say('');
  // Mid-game the change is on screen at once: back to the game to watch it.
  if (menuOpen) closeMenu();
}
function askSeat(req) {
  if (guest) return guest.net.send({ t: 'seat', team: req.team, defId: req.defId });
  const reason = changeSeat(world, player, req, DT);
  sidesChanged();
  seatDone(reason);
}

// Hosting: friends join with the room code, each on the side with fewer pilots, and can change it.
$('host').addEventListener('click', async () => {
  openSetup();
  setup.say('OPENING A ROOM...');
  try {
    host = await hostGame(world, content.settings.net, {
      onJoin(g, hello) {
        const team = freeSide(world, TEAMS);
        if (team === null) return null;
        const defId = content.planeDefs[hello.plane]?.name ? hello.plane : choice.plane;
        const p = addPlane(world, { defId, team, nation: nationOf(defId), controller: g.controller });
        if (cleanName(hello.name)) p.callsign = cleanName(hello.name);
        g.planeId = p.id;
        renderer.message(`${p.callsign ?? 'A FRIEND'} JOINED, ${p.team === player.team ? 'ON OUR SIDE' : 'ON THE ENEMY SIDE'}`, '#e8c860');
        // Sent once they've had their welcome.
        setTimeout(sidesChanged);
        placeBots();
        drawSetup();
        return { planeId: p.id, table: sidesTable() };
      },
      onLeave(g) {
        const p = world.planes.find((o) => o.id === g.planeId);
        if (p) {
          releasePilot(world, p);
          world.planes.splice(world.planes.indexOf(p), 1);
        }
        renderer.message(`${p?.callsign ?? 'A FRIEND'} HAS LEFT THE GAME`, '#ffb070');
        sidesChanged();
      },
      onMessage(g, m) {
        if (m?.t !== 'seat') return;
        const p = world.planes.find((o) => o.id === g.planeId);
        if (!p) return;
        const reason = changeSeat(world, p, { team: TEAMS.includes(m.team) ? m.team : p.team, defId: content.planeDefs[m.defId]?.name ? m.defId : null }, DT);
        g.conn.send({ t: 'seat', reason });
        sidesChanged();
      },
    });
    setup.say(`WAITING FOR FRIENDS: UP TO ${MAX_PLAYERS} PILOTS. START WHEN YOU LIKE, THEY CAN JOIN ANY TIME.`);
    drawSetup();
  } catch (err) {
    setup.say(`COULD NOT OPEN A ROOM: ${(err.type ?? err.message ?? err).toString().toUpperCase()}`, true);
  }
});

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
  $('join-go').disabled = $('join-code').disabled = true;
  status('join-status', 'CONNECTING...');
  const view = createGuestView(world, content.settings.net);
  try {
    const net = await joinGame($('join-code').value, { plane: choice.plane, name: options.name }, {
      onMessage(m) {
        if (m?.t === 'full') {
          status('join-status', 'THAT ROOM IS FULL.', true);
          return;
        }
        if (m?.t === 'welcome') {
          guest.planeId = m.planeId;
          lastTable = m.table;
          openSetup();
        }
        if (m?.t === 'table') {
          lastTable = m.table;
          drawSetup();
        }
        if (m?.t === 'seat') seatDone(m.reason);
        if (m?.t !== 'snap') return;
        const first = !view.ready;
        view.receive(m);
        if (!first) return;
        player = world.planes.find((p) => p.id === guest.planeId) ?? player;
        setup.say('');
        drawSetup();
        renderer.render(player, 0, { showHelp });
      },
      onClose() {
        started = false;
        menuOpen = false;
        pauseScreen.classList.add('hidden');
        options.close();
        setup.hide();
        overlay.classList.remove('hidden');
        mouse.release();
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
