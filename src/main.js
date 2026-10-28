import { loadContent } from './content/load.js';
import { createWorld, addPlane, stepWorld, DT } from './sim/world.js';
import { createKeyboard } from './input/keyboard.js';
import { createMouseLook } from './input/mouse.js';
import { createRenderer } from './render/renderer.js';
import { createMixer } from './audio/mixer.js';
import { createSoundscape } from './audio/soundscape.js';
import { createTuningPanel } from './ui/tuning.js';

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
  rules: content.settings.rules,
});
// Share the world's rules object with the settings so the tuning panel saves the Testing switches.
content.settings.rules = world.rules;
const player = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
// A sparring partner until real bots arrive in milestone 5.
addPlane(world, { defId: 'fighter_v12', team: 1, nation: 'uk', controller: 'bot:target' });
const renderer = createRenderer(canvas, world, content);
const keyboard = createKeyboard();
const look = createMouseLook(canvas, content.settings.camera);

let showHelp = true;
let paused = false;
const tuning = createTuningPanel({
  content,
  world,
  player,
  getMixer: () => mixer,
  onPause: (p) => (paused = p),
});
// Clicking the game takes keyboard focus back from the tuning panel.
canvas.addEventListener('mousedown', () => document.activeElement?.blur());
let muted = false;
let sound = null;
let mixer = null;

addEventListener('keydown', (e) => {
  if (e.code === 'KeyH') showHelp = !showHelp;
  if (e.code === 'KeyT') tuning.toggle();
  if (e.code === 'KeyM' && mixer) mixer.setMuted((muted = !muted));
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
  structure: (by, e) => `FLEW INTO A ${(e.what ?? 'BUILDING').toUpperCase()}`,
};

function causeText(e) {
  const killer = world.planes.find((pl) => pl.id === e.by);
  const name = killer ? `${killer.def.name.toUpperCase()} (${content.nations[killer.nation]?.name.toUpperCase() ?? ''})` : null;
  return (CAUSES[e.cause] ?? CAUSES.ground)(name, e);
}

let radarWarnAt = 0;
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
    if (e.by === player.id && e.type === 'squadWiped') renderer.message('INFANTRY SQUAD WIPED OUT', '#e8c860');
    if (e.type === 'shotDown') {
      if (e.by === player.id) renderer.message('ENEMY SHOT DOWN!', '#e8c860');
      else if (e.plane === player.id) renderer.message('YOU ARE GOING DOWN', '#ff8070');
    }
  }
}

let lastSweeps = 0;
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  if (paused) acc = 0;
  while (acc >= DT) {
    stepWorld(world, { p1: keyboard.read() });
    handleEvents();
    acc -= DT;
  }
  // Mouse look wins while the right button is held; otherwise the arrow keys look around.
  const view = look.active ? look : keyboard.readLook();
  renderer.render(player, dt, { showHelp, look: view });
  sound?.setLook(renderer.cam.lookX, view.active);
  if (renderer.radarSweeps !== lastSweeps) {
    lastSweeps = renderer.radarSweeps;
    sound?.radarTick();
  }
  sound?.update(player, renderer.centre(), dt);
  requestAnimationFrame(frame);
}

// Browsers only allow audio after a click, so the game waits for one.
overlay.addEventListener('click', async () => {
  overlay.classList.add('hidden');
  mixer = await createMixer(content.settings.audio);
  // Open the game as localhost:8080/?mute to start silent (M toggles sound as usual).
  if (new URLSearchParams(location.search).has('mute')) mixer.setMuted((muted = true));
  sound = createSoundscape(mixer, world);
  last = performance.now();
  requestAnimationFrame(frame);
});

renderer.render(player, 0, { showHelp });
window.__game = { world, player, renderer, get mixer() { return mixer; } };
