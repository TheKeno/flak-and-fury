// Live tuning panel (press T). Sliders edit the loaded data objects directly, so changes apply
// instantly; "Save to files" writes them back to data/*.json through the local dev server.
import { updateGunRates } from '../sim/weapons.js';
import { spawnAtAirfield } from '../sim/plane.js';
import { rearmFully } from '../sim/airfield.js';

// [key, label, min, max, step, help]
const PLANE_FIELDS = [
  ['turnRate', 'Turn rate (held)', 0.8, 4, 0.05, 'Full rotation speed when a turn key is held (rad/s). Lower = heavier steering.'],
  ['fineTurn', 'Tap strength', 0.05, 1, 0.01, 'Share of the turn rate you get on a quick tap. Lower = finer aiming.'],
  ['turnRampTime', 'Time to full turn', 0, 1.5, 0.05, 'Seconds of holding a turn key before reaching the full turn rate.'],
  ['slowTurnBonus', 'Slow-speed turn bonus', 0, 2, 0.05, 'Extra turn rate when flying slowly, peaking just above the stall. 0.8 = 80% tighter turns at the edge of the stall.'],
  ['slowTurnSpeed', 'Slow-speed bonus starts', 60, 160, 1, 'Speed below which the turn bonus starts to build up. Must be above the stall speed.'],
  ['thrust', 'Thrust', 50, 89, 1, 'Engine pull. Keep below 90 (gravity) or the plane can climb straight up forever.'],
  ['dragCoef', 'Drag', 0.002, 0.008, 0.0001, 'Air resistance. Top speed is about the square root of thrust / drag.'],
  ['stallSpeed', 'Stall speed', 30, 90, 1, 'Below this the wings stop lifting and the nose drops.'],
  ['takeoffSpeed', 'Take-off speed', 30, 90, 1, 'Speed needed to lift off the runway.'],
  ['maxLandingSpeed', 'Max landing speed', 50, 160, 1, 'Touching down faster than this is a crash.'],
  ['groundFriction', 'Ground friction', 5, 40, 1, 'How quickly the plane slows when rolling on the ground.'],
  ['hp', 'Hit points', 20, 400, 5, 'How much damage the plane takes before it goes down.'],
  ['hitRadius', 'Hit size', 3, 14, 0.5, 'Size of the plane for bullets (px). Smaller = harder to hit.'],
  ['toughness', 'Airframe toughness', 0.3, 3, 0.05, 'Divides collision damage. 1 = normal, higher = sturdier.'],
  ['rearView', 'Rear visibility', 0, 1, 0.05, 'How far mouse look can swing back over the tail. Cramped canopies (the 109) see less.'],
  ['endurance', 'Fuel endurance', 30, 900, 10, 'Seconds of flying at full throttle on a full tank. Idling burns about an eighth as much.'],
];
const GUN_FIELDS = [
  ['rpm', 'Rate of fire (per gun)', 200, 2000, 10, 'Rounds per minute per gun.'],
  ['damage', 'Damage per round', 0.02, 12, 0.01, 'Randomised +/-50% on each hit.'],
  ['velocity', 'Muzzle velocity', 150, 700, 5, 'Bullet speed. Lower = more lead needed.'],
  ['spread', 'Spread', 0, 0.06, 0.001, 'Random aim error (rad). Lower = tighter grouping.'],
  ['drop', 'Bullet drop', 0, 1, 0.01, 'Share of gravity pulling the round down.'],
  ['life', 'Range (seconds)', 0.3, 2.5, 0.05, 'How long a round flies before it is spent.'],
  ['ammo', 'Ammo per gun', 10, 1000, 10, 'Rounds per gun. Applies on the next rearm.'],
];
const BOMB_FIELDS = [
  ['blastRadius', 'Blast radius', 10, 90, 1, 'Explosion reach (px).'],
  ['blastDamage', 'Blast damage', 10, 400, 5, 'Damage at the centre of the blast.'],
  ['craterRadius', 'Crater radius', 2, 40, 1, 'Width of the hole dug in the ground.'],
  ['craterDepth', 'Crater depth', 0, 25, 0.5, 'Depth of the hole.'],
  ['drag', 'Bomb drag', 0, 0.5, 0.01, 'Air resistance on the falling bomb.'],
];
const CAMERA_FIELDS = [
  ['leadX', 'Look-ahead (sideways)', 0, 0.45, 0.01, 'How far ahead of the plane the camera looks, as a share of screen width.'],
  ['leadY', 'Look-ahead (up/down)', 0, 0.35, 0.01, 'How far the view leads up into a climb or down into a dive (follows your flight path), as a share of screen height.'],
  ['leadSpeed', 'Swing speed', 0.2, 6, 0.1, 'How quickly the look-ahead swings across when you change direction.'],
  ['leadSpeedY', 'Swing speed (up/down)', 0.2, 8, 0.1, 'How quickly the view swings up into a climb or down into a dive.'],
  ['height', 'Plane height on screen', 0.2, 0.8, 0.01, 'Where the plane sits vertically (0 = bottom, 1 = top).'],
  ['lookRange', 'Mouse look: reach', 0, 0.5, 0.01, 'How far the camera slides when you hold right mouse and point (share of the view).'],
  ['lookSensitivity', 'Mouse look: drag for full look', 40, 600, 10, 'How far (screen pixels) you drag with right mouse held to turn your head all the way. Lower = more sensitive.'],
  ['lookSpeed', 'Mouse look: speed', 0.5, 12, 0.1, 'How quickly the view follows the pointer and eases back. Lower = heavier, more resistance.'],
  ['lookZoom', 'Mouse look: zoom-out', 0, 0.4, 0.01, 'Extra zoom-out while looking around.'],
  ['zoomMax', 'Speed zoom: max zoom-out', 1, 1.8, 0.01, '1 = no zoom. 1.35 = see 35% more of the world at top speed.'],
  ['zoomStartSpeed', 'Speed zoom: starts at', 0, 250, 5, 'Speed (px/s) where the view begins to widen. Level top speed is about 150.'],
  ['zoomFullSpeed', 'Speed zoom: full at', 0, 300, 5, 'Speed (px/s) where the view is fully zoomed out. Dives reach about 200.'],
  ['zoomSpeed', 'Speed zoom: smoothness', 0.2, 5, 0.1, 'How quickly the zoom follows your speed. Lower = slower, smoother.'],
];
const SERVICING_FIELDS = [
  ['crewDelay', 'Crew walk-out time', 0, 5, 0.1, 'Seconds after you stop before the ground crew start work.'],
  ['repairPerSec', 'Repair speed', 1, 100, 1, 'Hit points repaired per second.'],
  ['refuelTime', 'Refuel time', 0.5, 30, 0.5, 'Seconds to fill an empty tank.'],
  ['rearmTime', 'Rearm time', 0.5, 20, 0.5, 'Seconds to reload all guns and bombs.'],
];
const COLLISION_FIELDS = [
  ['headOnSpeed', 'Head-on: fatal from', 0, 300, 5, 'Closing speed at which two noses meeting kills both planes.'],
  ['fatalSpeed', 'Any angle: fatal from', 50, 400, 5, 'Closing speed at which any collision kills both planes.'],
  ['hardSpeed', 'Hard hit from', 10, 200, 5, 'Closing speed separating a graze from a hard hit.'],
  ['grazeDamage', 'Graze damage', 0, 40, 1, 'Base damage of a graze (split between the planes).'],
  ['hardDamage', 'Hard hit damage', 0, 120, 1, 'Base damage of a hard hit (split between the planes).'],
  ['grazeTumble', 'Graze: out of control', 0, 4, 0.1, 'Seconds without control after a graze.'],
  ['hardTumble', 'Hard hit: out of control', 0, 6, 0.1, 'Seconds without control after a hard hit.'],
  ['driveWeight', 'Rammer takes more', 0, 1, 0.05, '0 = damage always shared equally. 1 = all of it on the plane that drove into the other.'],
  ['evadeBonus', 'Evasion bonus', 0, 1, 0.05, 'Share of damage removed for a plane turning away at the moment of contact.'],
  ['hardFireChance', 'Hard hit: fire chance', 0, 1, 0.05, 'Chance a hard hit sets a plane on fire.'],
  ['tailDamage', 'Prop strike: tail damage', 0, 1, 0.05, 'Tail authority lost when a propeller chews into it (1 = none left).'],
  ['wingPull', 'Damaged wing pull', 0, 2, 0.05, 'How hard a damaged wing drags the nose round (rad/s).'],
  ['pushApart', 'Push apart', 0, 4, 0.1, 'How hard colliding planes are shoved away from each other.'],
  ['grace', 'Re-collide delay', 0, 3, 0.1, 'Seconds before the same two planes can collide again.'],
];
const RADAR_FIELDS = [
  ['sweepTime', 'Sweep time', 0.3, 8, 0.1, 'Seconds for the radar beam to cross the map. Contacts only update when the beam passes them.'],
  ['afterglow', 'Afterglow', 0.3, 8, 0.1, 'Seconds a plot keeps glowing on the phosphor after being swept.'],
  ['lowGap', 'Low-level gap', 0, 150, 5, 'Planes flying lower than this above the ground drop off the radar, friend or foe (you too).'],
];
const HUD_FIELDS = [
  ['lastFlightTime', 'Last-flight report', 0, 30, 1, 'Seconds the LAST FLIGHT damage report stays after you respawn.'],
];
const AUDIO_FIELDS = [
  ['master', 'Master volume', 0, 1, 0.01, '1.0 = full loudness.'],
  ['engine', 'Engines & wind', 0, 1.5, 0.01, ''],
  ['sfx', 'Guns & explosions', 0, 1.5, 0.01, ''],
  ['ambience', 'Ambience', 0, 1.5, 0.01, ''],
  ['music', 'Music', 0, 1.5, 0.01, ''],
];

const BOT_MODES = [
  ['on', 'On: fly and fight'],
  ['passive', 'Passive: fly, never shoot'],
  ['off', 'Off: parked at its airfield'],
];

const decimals = (step) => (String(step).split('.')[1] ?? '').length;

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

function slider(obj, [key, label, min, max, step, help], onChange) {
  const fmt = (v) => Number(v).toFixed(decimals(step));
  const range = el('input', { type: 'range', min, max, step, value: obj[key] });
  const num = el('input', { type: 'number', min, max, step, value: fmt(obj[key]) });
  const set = (v) => {
    v = Number(v);
    if (Number.isNaN(v)) return;
    obj[key] = v;
    range.value = v;
    num.value = fmt(v);
    onChange?.(key, v);
  };
  range.addEventListener('input', () => set(range.value));
  num.addEventListener('change', () => set(num.value));
  const row = el('label', { class: 'row', title: help }, el('span', {}, label), range, num);
  row.refresh = () => {
    range.value = obj[key];
    num.value = fmt(obj[key]);
  };
  return row;
}

export function createTuningPanel({ content, world, player, getMixer, onPause }) {
  const { planeDefs, weapons, settings, notes } = content;
  // What Reset returns to: the values last loaded from or saved to the files.
  const snapshot = () => structuredClone({ planeDefs, weapons, settings });
  let saved = snapshot();
  const rows = [];
  const add = (row) => (rows.push(row), row);

  const def = player.def;
  const planeId = Object.keys(planeDefs).find((k) => planeDefs[k] === def);
  const topSpeed = el('div', { class: 'info' });
  const showTopSpeed = () => (topSpeed.textContent = `Level top speed ≈ ${Math.sqrt(def.thrust / def.dragCoef).toFixed(0)} px/s`);
  showTopSpeed();

  const section = (title, open, ...content) => el('details', open ? { open: '' } : {}, el('summary', {}, title), ...content);

  const planeSection = section(
    `Plane: ${def.name}`,
    true,
    topSpeed,
    ...PLANE_FIELDS.map((f) => add(slider(def, f, showTopSpeed))),
  );

  const gunSections = (def.armament?.guns ?? []).map(({ weapon, count }) =>
    section(
      `Guns: ${count} × ${weapons[weapon].name}`,
      false,
      ...GUN_FIELDS.map((f) =>
        add(
          slider(weapons[weapon], f, (key) => {
            if (key === 'rpm') for (const p of world.planes) p.guns.forEach(updateGunRates);
          }),
        ),
      ),
    ),
  );
  const bombId = def.armament?.bombs?.weapon;
  const bombSection = bombId
    ? section(`Bombs: ${weapons[bombId].name}`, false, ...BOMB_FIELDS.map((f) => add(slider(weapons[bombId], f))))
    : '';
  // Testing switches. world.rules is the same object as settings.rules, so these are saved too.
  const isBot = (p) => p.seats.some((s) => s.controller.startsWith('bot'));
  const parkBots = () => {
    if (world.rules.bots === 'off') for (const p of world.planes.filter(isBot)) spawnAtAirfield(p, world);
  };
  const botSelect = el(
    'select',
    {
      onchange: () => {
        world.rules.bots = botSelect.value;
        parkBots();
      },
    },
    ...BOT_MODES.map(([v, label]) => el('option', { value: v }, label)),
  );
  botSelect.value = world.rules.bots;
  const ruleBoxes = [];
  const toggle = (key, label, help) => {
    const box = el('input', { type: 'checkbox', onchange: () => (world.rules[key] = box.checked) });
    box.checked = world.rules[key];
    ruleBoxes.push([box, key]);
    return el('label', { class: 'row check', title: help }, el('span', {}, label), box);
  };
  const testSection = section(
    'Testing',
    true,
    el('label', { class: 'row select', title: 'Turn the enemy AI off or make it harmless while you test.' }, el('span', {}, 'Enemy AI'), botSelect),
    toggle('ramming', 'Mid-air collisions', 'Planes that touch both go down.'),
    toggle('friendlyFire', 'Friendly fire', 'Your rounds and bombs can hit your own side.'),
    toggle('autoGear', 'Automatic landing gear', 'Gear raises after take-off and lowers on approach. G always overrides for the rest of the flight. Off: G only.'),
  );

  const cameraSection = section('Camera', true, ...CAMERA_FIELDS.map((f) => add(slider(settings.camera, f))));
  const propBox = el('input', { type: 'checkbox', onchange: () => (settings.collisions.propStrikes = propBox.checked) });
  propBox.checked = settings.collisions.propStrikes;
  const collisionSection = section(
    'Collisions',
    false,
    el('label', { class: 'row check', title: 'Propeller into a tail wrecks the tail and bends the propeller (the Soviet "taran").' }, el('span', {}, 'Propeller strikes (taran)'), propBox),
    ...COLLISION_FIELDS.map((f) => add(slider(settings.collisions, f))),
  );
  const radarSection = section('Radar', false, ...RADAR_FIELDS.map((f) => add(slider(settings.radar, f))));
  const hudSection = section('HUD', false, ...HUD_FIELDS.map((f) => add(slider(settings.hud, f))));
  const servicingSection = section('Ground crew', false, ...SERVICING_FIELDS.map((f) => add(slider(settings.servicing, f))));
  const audioSection = section(
    'Sound',
    true,
    ...AUDIO_FIELDS.map((f) => add(slider(settings.audio, f, () => getMixer()?.applyLevels()))),
  );

  const status = el('div', { class: 'status' });
  const say = (msg, ok = true) => {
    status.textContent = msg;
    status.className = `status ${ok ? 'ok' : 'bad'}`;
  };

  async function save() {
    const files = {
      'data/planes.json': { ...notes.planes, ...planeDefs },
      'data/weapons.json': { ...notes.weapons, ...weapons },
      'data/settings.json': { ...notes.settings, ...settings },
    };
    try {
      for (const [path, data] of Object.entries(files)) {
        const res = await fetch(path, { method: 'PUT', body: JSON.stringify(data, null, 2) + '\n' });
        if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
      }
      saved = snapshot();
      say(`Saved to files at ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      say(`Save failed: ${e.message}`, false);
    }
  }

  function reset() {
    for (const [k, v] of Object.entries(saved.planeDefs)) Object.assign(planeDefs[k], structuredClone(v));
    for (const [k, v] of Object.entries(saved.weapons)) Object.assign(weapons[k], structuredClone(v));
    Object.assign(settings.camera, saved.settings.camera);
    Object.assign(settings.audio, saved.settings.audio);
    Object.assign(settings.servicing, saved.settings.servicing);
    Object.assign(settings.collisions, saved.settings.collisions);
    Object.assign(settings.radar, saved.settings.radar);
    Object.assign(settings.hud, saved.settings.hud);
    Object.assign(world.rules, saved.settings.rules);
    botSelect.value = world.rules.bots;
    for (const [box, key] of ruleBoxes) box.checked = world.rules[key];
    parkBots();
    propBox.checked = settings.collisions.propStrikes;
    for (const p of world.planes) p.guns.forEach(updateGunRates);
    getMixer()?.applyLevels();
    rows.forEach((r) => r.refresh());
    showTopSpeed();
    say('Reset to the last saved values');
  }

  function refill() {
    player.hp = player.def.hp;
    player.engineDamage = 0;
    player.burning = false;
    player.fuel = 1;
    player.engineRunning = true;
    player.lowFuelWarned = false;
    player.tailDamage = player.wingPull = player.tumble = 0;
    player.propBent = false;
    rearmFully(player);
    say('Plane repaired and rearmed');
  }

  let paused = false;
  const pauseBtn = el('button', {
    onclick: () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Resume' : 'Pause';
      onPause(paused);
    },
  }, 'Pause');

  const panel = el(
    'div',
    { id: 'tuning', class: 'hidden' },
    el('div', { class: 'head' }, el('strong', {}, 'Tuning'), el('span', {}, 'T to close · hover a slider for help')),
    el('div', { class: 'buttons' },
      el('button', { onclick: save, title: 'Write the current values into data/planes.json, weapons.json and settings.json' }, 'Save to files'),
      el('button', { onclick: reset, title: 'Go back to the values last loaded from the files' }, 'Reset'),
      el('button', { onclick: refill, title: 'Repair, refuel and rearm your plane' }, 'Repair & rearm'),
      pauseBtn,
    ),
    status,
    testSection,
    planeSection,
    ...gunSections,
    bombSection,
    collisionSection,
    radarSection,
    servicingSection,
    cameraSection,
    hudSection,
    audioSection,
    el('p', { class: 'foot' }, `Editing plane type "${planeId}". Changes apply instantly to every plane of this type.`),
  );
  document.body.append(panel);

  // Keys used on the panel's sliders and number boxes must not fly the plane (T still closes it).
  panel.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyT') e.stopPropagation();
  });

  return {
    toggle() {
      panel.classList.toggle('hidden');
      if (panel.classList.contains('hidden')) document.activeElement?.blur();
    },
  };
}
