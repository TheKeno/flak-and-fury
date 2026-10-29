// Live tuning panel (press T). Sliders edit the loaded data objects directly, so changes apply
// instantly; "Save to files" writes them back to data/*.json through the local dev server.
import { updateGunRates } from '../sim/weapons.js';
import { spawnAtAirfield } from '../sim/plane.js';
import { rearmFully } from '../sim/airfield.js';
import { ignite } from '../sim/fire.js';
import { createGround } from '../sim/ground.js';
import { createArmy } from '../sim/army.js';

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
  ['groundThrust', 'Ground acceleration', 0.1, 1.5, 0.05, 'Share of engine pull you get while rolling on the wheels. Lower = longer take-off roll.'],
  ['tailUpSpeed', 'Tail lifts at', 0.2, 1, 0.05, 'Share of take-off speed at which the tail has fully lifted during the take-off roll.'],
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
const FIRE_FIELDS = [
  ['burnTime', 'Time to live on fire', 3, 90, 1, 'Seconds a fire takes to finish a plane, whatever its hit points. Land and stop before then.'],
  ['hitShortens', 'Hits feed the fire', 0, 1, 0.01, 'Seconds of fire time lost per hit point of damage taken while burning.'],
  ['roughAt', 'Engine rough from', 0, 1, 0.05, 'Share of the fire time left when the engine starts coughing and losing power.'],
  ['quitAt', 'Engine quits at', 0, 30, 0.5, 'Seconds of fire time left when the engine fails. It can be restarted once the fire is out.'],
  ['pilotTime', 'Put out in a field', 0.5, 30, 0.5, 'Seconds the pilot needs to beat the fire out once stopped away from home.'],
  ['crewTime', 'Put out by ground crew', 0.2, 10, 0.1, 'Seconds the ground crew need once stopped on your own airstrip.'],
  ['engineHarm', 'Engine damage from fire', 0, 1, 0.05, 'Engine damage left behind once a fire is out.'],
];
const RADAR_FIELDS = [
  ['sweepTime', 'Sweep time', 0.3, 8, 0.1, 'Seconds for the radar beam to cross the map. Contacts only update when the beam passes them.'],
  ['afterglow', 'Afterglow', 0.3, 8, 0.1, 'Seconds a plot keeps glowing on the phosphor after being swept.'],
  ['lowGap', 'Low-level gap', 0, 150, 5, 'Planes flying lower than this above the ground drop off the radar, friend or foe (you too).'],
  ['dropout', 'Damaged: echoes lost', 0, 1, 0.05, 'Share of echoes a radar loses when its station is nearly destroyed (less when lightly damaged). Damage also adds noise, blotches, a stuttering sweep and misplaced echoes.'],
];
const GROUND_FIELDS = [
  ['hp', 'Hit points', 1, 400, 1, 'Damage it takes to destroy (infantry: per soldier). Applies when targets are restored.'],
  ['points', 'Points', 0, 50, 1, 'Score for destroying it (infantry: per soldier).'],
  ['bulletFactor', 'Bullet damage taken', 0, 1, 0.05, 'Share of bullet damage it takes. Bombs always do full damage. Low = bombs only.'],
];
// Extra sliders for the ground objects that shoot.
const DEFENCE_FIELDS = {
  flak: [
    ['range', 'Reach', 100, 1200, 10, 'How far away it can engage a plane.'],
    ['minAltitude', 'Blind below', 0, 200, 5, 'Planes lower than this above the ground are ignored. Fly low to dodge flak.'],
    ['minElevation', 'Lowest barrel angle', 0, 1.2, 0.05, 'The barrel cannot point lower than this (rad), so far-off low planes are safe.'],
    ['turnRate', 'Barrel swing speed', 0.1, 4, 0.05, 'How fast the gun traverses (rad/s). Low = fast crossing planes outrun it.'],
    ['interval', 'Time between shots', 0.5, 8, 0.1, 'Seconds to reload.'],
    ['velocity', 'Shell speed', 100, 600, 5, 'Higher = less lead needed, more accurate at range.'],
    ['spread', 'Aim error', 0, 0.1, 0.002, 'Random error in where the barrel points (rad).'],
    ['fuseError', 'Fuse error', 0, 0.4, 0.01, 'How far off the time fuse can be, as a share of the flight time.'],
    ['burstRadius', 'Burst radius', 5, 80, 1, 'Reach of the shrapnel.'],
    ['burstDamage', 'Burst damage', 0, 120, 1, 'Damage at the centre of a burst.'],
    ['fireChance', 'Fire chance', 0, 1, 0.05, 'Chance a burst at the centre sets the plane on fire; less further out.'],
  ],
  mgNest: [
    ['range', 'Reach', 50, 600, 5, 'How far it can shoot. Fly higher than this to stay out of it.'],
    ['turnRate', 'Swing speed', 0.2, 8, 0.1, 'How fast the gun follows a plane (rad/s).'],
    ['burst', 'Burst length', 0.1, 5, 0.1, 'Seconds of firing per burst.'],
    ['pause', 'Pause between bursts', 0, 6, 0.1, 'Seconds of rest between bursts (varies a little).'],
    ['rpm', 'Rate of fire', 100, 1500, 10, 'Rounds per minute while firing.'],
    ['velocity', 'Muzzle velocity', 150, 600, 5, ''],
    ['damage', 'Damage per round', 0, 5, 0.05, 'Randomised +/-50% on each hit.'],
    ['spread', 'Spread', 0, 0.15, 0.005, 'Random aim error (rad).'],
  ],
  tank: [
    ['speed', 'Speed', 1, 20, 0.5, 'How fast tanks advance (world units per second).'],
    ['engageRange', 'Stops to fight at', 0, 300, 5, 'An enemy this close ahead stops the tank to fight.'],
    ['roofFactor', 'Roof armour', 0, 1, 0.05, 'Share of bullet damage from a steep dive onto the thin roof (the front and sides take Bullet damage taken).'],
    ['gunRange', 'Main gun reach', 30, 400, 5, 'How far the main gun fires at ground targets.'],
    ['gunInterval', 'Main gun reload', 0.5, 15, 0.5, 'Seconds between shots (varies a little).'],
    ['gunDepression', 'Main gun depression', 0, 1, 0.05, 'How far the gun dips below the hull (rad). A tank cresting a hill cannot reach targets below it.'],
    ['gunElevation', 'Main gun elevation', 0, 1.5, 0.05, 'How far the gun lifts above the hull (rad).'],
    ['tiltRate', 'Hull settling', 0.5, 20, 0.5, 'How quickly the hull tilts to the slope of the ground. Low = slow, heavy rocking; high = follows every bump.'],
    ['shellRadius', 'Shell blast radius', 2, 40, 1, ''],
    ['shellDamage', 'Shell damage', 0, 150, 1, 'Damage at the centre of a shell burst.'],
    ['range', 'MG reach', 30, 400, 5, 'The coaxial MG: how far it shoots at low planes and soldiers.'],
    ['mgAltitude', 'MG: planes below', 0, 200, 5, 'It only shoots at planes lower than this above the ground.'],
    ['wreckBlock', 'Wreck blocks the way', 0, 120, 1, 'Seconds a knocked-out tank blocks the road for the tanks behind it. 0: they drive over wrecks.'],
    ['creepSpeed', 'Creep speed while fighting', 0, 1, 0.05, 'Share of its speed a lead tank keeps rolling forward at while it fights, so the tanks behind get into range. 0: it stops.'],
    ['creepHold', 'Closest it creeps to the enemy', 0, 150, 5, 'A fighting tank stops creeping this close to the nearest enemy.'],
    ['aaRange', 'Roof MG: reach', 0, 400, 5, 'How far the roof (anti-aircraft) MG reaches. 0 takes it off.'],
    ['aaAltitude', 'Roof MG: planes below', 0, 400, 5, 'It only shoots at planes lower than this above the ground.'],
    ['aaDamage', 'Roof MG: damage per round', 0, 2, 0.05, 'Mostly for show: keep it low.'],
    ['aaSpread', 'Roof MG: spread', 0, 0.2, 0.005, 'How wild its aim is (radians).'],
    ['aaBurst', 'Roof MG: burst length', 0.1, 2, 0.05, 'Seconds of fire per burst.'],
    ['aaPause', 'Roof MG: pause between bursts', 0, 8, 0.1, 'Seconds of rest between bursts (varies a little).'],
  ],
  engineers: [
    ['speed', 'Speed', 1, 20, 0.5, 'How fast engineers march to the river.'],
  ],
  bridge: [
    ['rebuildTime', 'Rebuild time', 5, 300, 5, 'Seconds a full squad of engineers needs to rebuild the bridge from nothing.'],
  ],
  infantry: [
    ['speed', 'Marching speed', 1, 20, 0.5, 'How fast squads sent out with the tanks march.'],
    ['engageRange', 'Stops to fight at', 0, 300, 5, 'Marching squads stop when an enemy is this close ahead.'],
    ['range', 'Reach', 30, 400, 5, 'How far a rifle can reach a plane.'],
    ['interval', 'Time between shots', 0.3, 8, 0.1, 'Seconds between shots per soldier (varies by half).'],
    ['velocity', 'Muzzle velocity', 150, 600, 5, ''],
    ['damage', 'Damage per round', 0, 5, 0.05, 'Randomised +/-50% on each hit.'],
    ['spread', 'Spread', 0, 0.2, 0.005, 'Random aim error (rad).'],
  ],
};
const PAD_FIELDS = [
  ['margin', 'Level ground beyond', 0, 30, 1, 'Extra flat ground on each side of a structure. Applies when the page is reloaded (after Save to files).'],
  ['blend', 'Blend into the hill', 1, 80, 1, 'How far the flat pad eases back into the slope. Applies when the page is reloaded (after Save to files).'],
];
const WAVE_FIELDS = [
  ['first', 'First wave after', 0, 300, 5, 'Seconds from the start before the first tank columns roll out.'],
  ['interval', 'Time between waves', 10, 400, 5, 'Seconds between waves from an undamaged depot. A damaged depot takes up to 2.5 times as long.'],
  ['tanks', 'Tanks per wave', 0, 8, 1, 'Fewer from a damaged depot (at least one while it stands, unless the side is at its cap).'],
  ['maxTanks', 'Max tanks per side', 0, 20, 1, 'Tanks support the infantry: a wave only sends tanks while the side has fewer than this out.'],
  ['squads', 'Infantry squads per wave', 0, 6, 1, 'Fewer from a damaged depot.'],
  ['squadSize', 'Soldiers per squad', 1, 12, 1, ''],
  ['engineers', 'Engineers', 0, 8, 1, 'Engineers sent with a wave when the bridge is down (0 = none).'],
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
  ['hearRange', 'Hearing range', 150, 2000, 10, 'Engines, tanks and most sounds fade out to silence by this distance (a screen is about 480).'],
  ['bangRange', 'Bangs and MGs carry', 150, 3000, 10, 'Explosions, flak, tank guns and machine-gun fire are heard out to this distance.'],
];

const FREE_FIELDS = [
  ['panSpeed', 'Camera speed', 50, 1000, 10, 'How fast the arrows move the free-look camera (Shift: three times as fast).'],
  ['zoom', 'Starting zoom-out', 1, 1.8, 0.05, 'How wide the view is when free look starts. The mouse wheel changes it.'],
  ['autopilotHeight', 'Autopilot height', 60, 500, 10, 'Height above the ground the autopilot holds your plane at while you look around (a screen is about 270 high).'],
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
  const { planeDefs, weapons, settings, groundDefs, notes } = content;
  // What Reset returns to: the values last loaded from or saved to the files.
  const snapshot = () => structuredClone({ planeDefs, weapons, settings, groundDefs });
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
  const freeSection = section('Free look (V)', false, ...FREE_FIELDS.map((f) => add(slider(settings.freeLook, f))));
  const propBox = el('input', { type: 'checkbox', onchange: () => (settings.collisions.propStrikes = propBox.checked) });
  propBox.checked = settings.collisions.propStrikes;
  const collisionSection = section(
    'Collisions',
    false,
    el('label', { class: 'row check', title: 'Propeller into a tail wrecks the tail and bends the propeller (the Soviet "taran").' }, el('span', {}, 'Propeller strikes (taran)'), propBox),
    ...COLLISION_FIELDS.map((f) => add(slider(settings.collisions, f))),
  );
  const waveSection = section('Tank waves', false, ...WAVE_FIELDS.map((f) => add(slider(settings.waves, f))));
  const fireSection = section('Fire', false, ...FIRE_FIELDS.map((f) => add(slider(settings.fire, f))));
  const padSection = section('Structure pads', false, ...PAD_FIELDS.map((f) => add(slider(settings.pads, f))));
  const radarSection = section('Radar', false, ...RADAR_FIELDS.map((f) => add(slider(settings.radar, f))));
  const restoreTargets = () => {
    createGround(world);
    createArmy(world);
    say('Ground targets restored; tank waves start again');
  };
  const groundSection = section(
    'Ground targets',
    false,
    el('div', { class: 'buttons' }, el('button', { onclick: restoreTargets, title: 'Rebuild every ground object at full strength with the current hit points, clear the tank columns and start the waves again' }, 'Restore targets')),
    ...Object.entries(groundDefs).map(([type, d]) =>
      section(d.name, false, ...[...GROUND_FIELDS, ...(DEFENCE_FIELDS[type] ?? [])].map((f) => add(slider(d, f)))),
    ),
  );
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
      'data/ground.json': { ...notes.ground, ...groundDefs },
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
    for (const [k, v] of Object.entries(saved.groundDefs)) Object.assign(groundDefs[k], structuredClone(v));
    Object.assign(settings.camera, saved.settings.camera);
    Object.assign(settings.audio, saved.settings.audio);
    Object.assign(settings.servicing, saved.settings.servicing);
    Object.assign(settings.collisions, saved.settings.collisions);
    Object.assign(settings.radar, saved.settings.radar);
    Object.assign(settings.fire, saved.settings.fire);
    Object.assign(settings.waves, saved.settings.waves);
    Object.assign(settings.pads, saved.settings.pads);
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

  // The game owns the pause (P works too); the button asks for it and shows the state.
  let paused = false;
  const pauseBtn = el('button', { onclick: () => onPause(!paused) }, 'Pause');
  function showPaused(p) {
    paused = p;
    pauseBtn.textContent = p ? 'Resume' : 'Pause';
  }

  function setOnFire() {
    say(ignite(world, player) ? 'Your plane is on fire' : 'No fire: already burning or going down');
  }

  const panel = el(
    'div',
    { id: 'tuning', class: 'hidden' },
    el('div', { class: 'head' }, el('strong', {}, 'Tuning'), el('span', {}, 'T to close · hover a slider for help')),
    el('div', { class: 'buttons' },
      el('button', { onclick: save, title: 'Write the current values into data/planes.json, weapons.json, settings.json and ground.json' }, 'Save to files'),
      el('button', { onclick: reset, title: 'Go back to the values last loaded from the files' }, 'Reset'),
      el('button', { onclick: refill, title: 'Repair, refuel and rearm your plane' }, 'Repair & rearm'),
      pauseBtn,
      el('button', { onclick: setOnFire, title: 'Set your plane on fire to try the fire emergency' }, 'Set me on fire'),
    ),
    status,
    testSection,
    planeSection,
    ...gunSections,
    bombSection,
    collisionSection,
    fireSection,
    radarSection,
    groundSection,
    waveSection,
    padSection,
    servicingSection,
    cameraSection,
    freeSection,
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
    showPaused,
    toggle() {
      panel.classList.toggle('hidden');
      if (panel.classList.contains('hidden')) document.activeElement?.blur();
    },
  };
}
