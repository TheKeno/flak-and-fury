import { loadContent } from './content/load.js';
import { createWorld, addPlane, stepWorld, DT } from './sim/world.js';
import { createKeyboard } from './input/keyboard.js';
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
  servicing: content.settings.servicing,
});
const player = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
// A sparring partner until real bots arrive in milestone 5.
addPlane(world, { defId: 'fighter_v12', team: 1, nation: 'uk', controller: 'bot:target' });
const renderer = createRenderer(canvas, world, content);
const keyboard = createKeyboard();

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

function handleEvents() {
  for (const e of world.events) {
    renderer.onEvent(e);
    sound?.onEvent(e);
    if (e.plane === player.id) {
      if (e.type === 'fuelLow') renderer.message('LOW FUEL - HEAD HOME', '#ffb070');
      if (e.type === 'engineOut') renderer.message('ENGINE OUT - OUT OF FUEL', '#ff8070');
      if (e.type === 'serviceDone') renderer.message('GROUND CREW: ALL DONE', '#a8e090');
      if (e.type === 'bellyLanding') renderer.message(e.collapsed ? 'GEAR COLLAPSED!' : 'BELLY LANDING!', '#ff9070');
      if (e.type === 'recovered') renderer.message('RECOVERED TO BASE', '#f0e8c0');
    }
    if (e.type === 'shotDown') {
      if (e.by === player.id) renderer.message('ENEMY SHOT DOWN!', '#e8c860');
      else if (e.plane === player.id) renderer.message('YOU ARE GOING DOWN', '#ff8070');
    }
  }
}

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
  renderer.render(player, dt, { showHelp });
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
