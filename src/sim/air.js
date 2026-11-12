// Engine and air at height, and the negative-g cutout (settings.flight).
//
// Thin air. Each plane has a rated height (`ratedHeight`, absolute world y) from its real engine's
// supercharger: up to it the engine gives full power, above it power fades, to 1 / (1 + over / fadeSpan)
// (with fadeSpan 800 about a third less 400 units higher). So a low-rated plane (Ki-43, La-5FN) is
// strong in the ground war and weak high up, the turbocharged P-47 and P-38 keep their power to the
// ceiling. The air itself thins for everyone: drag and the wings' grip (turn rate) fall off a little
// with height, by thinDrag and thinGrip at thinTop (straight line from the ground up, no more above it).
// Turning needs power: above its rated height a plane's turn rate falls with its power too, by turnPower
// of the power lost (0.375: 60% power keeps 85% of the turn), so a high, slow, short-of-breath plane no
// longer out-turns everyone on the slow-turn bonus. Stall speed rises with height for every plane, by
// stallRise at thinTop (the slow-turn band, slowTurnSpeed, moves up with it; see flyingDef).
//
// Propeller thrust falls with speed (fighter design pass, 2026-11-12). An engine gives power, and a
// propeller's pull is about power over speed, so a plane pulls hard when slow and runs out of push near
// its top speed: climb comes from power, top speed from power against drag, and the dive almost only from
// drag (the propeller adds little that fast), so a clean heavy plane out-dives a better climber. A plane's
// `thrust` is its pull at propSpeed; the pull is thrust x (propSpeed / speed)^propFall, levelled off at
// propStatic x thrust when slow (a standing propeller doesn't pull without limit). propFall 0 is the old
// constant thrust. Only in the air: the take-off roll keeps its own pull (groundThrust).
//
// Negative g. A carburettor engine (`negGCutout: true`: Spitfire, Ki-43, P-47 ...) starves when the pilot
// pushes the nose hard down: past negGLimit g of push for negGHold seconds it cuts out and sputters for
// negGCut seconds (longer while the push goes on). Injected engines (Bf 109, La-5FN) bunt freely. Only
// the push of the manoeuvre counts, not gravity: the sim has no lift model, so level flight upside down
// is 0 g here and stays allowed. Switched off for now (negG false, owner 2026-11-11: far too severe in
// the Spitfire); the per-plane flags stay in the data.

export const DEFAULT_FLIGHT = {
  fadeSpan: 800, // units above the rated height where power is down to half
  thinDrag: 0.15, // share of drag gone at thinTop
  thinGrip: 0.1, // share of turn rate gone at thinTop
  thinTop: 1200, // height (absolute y) where the air is thinnest for drag and grip
  turnPower: 0.375, // share of the power lost above the rated height that the turn rate loses too
  stallRise: 0.12, // share stall speed (and slowTurnSpeed) rise by at thinTop
  propFall: 1, // how propeller thrust falls with speed: 0 constant, 1 power over speed
  propSpeed: 120, // speed (units/s) at which a plane's pull is its thrust
  propStatic: 1.6, // the most a slow plane's pull rises to, times its thrust
  negG: false, // the negative-g cutout on or off for every plane
  negGLimit: 1.5, // g of push (turn rate x speed / gravity, nose towards the belly) that starves a carburettor
  negGHold: 0.12, // seconds of such a push before it cuts out (a tap to aim doesn't)
  negGCut: 1, // seconds the engine sputters after it cuts out
};

const cfgOf = (world) => world.flight ?? DEFAULT_FLIGHT;

// Does this plane's engine cut out under negative g? (Carburettor, and the mechanic switched on.)
export const cutsOut = (world, def) => !!cfgOf(world).negG && !!def.negGCutout;

// Engine power share at height y (1 at or under the rated height). No ratedHeight: never fades.
export function powerAt(world, def, y) {
  const rated = def.ratedHeight;
  if (rated == null || y <= rated) return 1;
  return 1 / (1 + (y - rated) / cfgOf(world).fadeSpan);
}

// The propeller's pull at speed v, as a share of the plane's thrust.
export function propAt(world, v) {
  const c = cfgOf(world);
  const k = c.propFall ?? 0;
  if (!k) return 1;
  return Math.min(c.propStatic ?? 1.6, ((c.propSpeed ?? 120) / Math.max(1, v)) ** k);
}

// Level top speed at full power low down, where thrust x prop share = drag x v^2 (no thin air, no turn).
export function levelTop(flight, thrust, dragCoef) {
  const world = { flight };
  let v = Math.sqrt(thrust / dragCoef);
  for (let i = 0; i < 40; i++) v = Math.sqrt((thrust * propAt(world, v)) / dragCoef);
  return v;
}

// How thin the air is at y, 0 (ground) .. 1 (thinTop), for drag and grip.
const thinness = (cfg, y) => Math.min(1, Math.max(0, y / cfg.thinTop));
export const dragAt = (world, y) => 1 - cfgOf(world).thinDrag * thinness(cfgOf(world), y);
export const gripAt = (world, y) => 1 - cfgOf(world).thinGrip * thinness(cfgOf(world), y);
// Turn rate share at y from the air and the engine: thin-air grip times the power the turn needs.
export function turnAt(world, def, y) {
  const k = cfgOf(world).turnPower ?? 0;
  return gripAt(world, y) * (1 - k * (1 - powerAt(world, def, y)));
}
// Stall speed (and the slow-turn band) factor at y.
export const stallAt = (world, y) => 1 + (cfgOf(world).stallRise ?? 0) * thinness(cfgOf(world), y);

// One air tick. pull: g of the manoeuvre towards the pilot's head (negative = pushing). p.negG counts the
// seconds of a hard push, p.cutout the seconds of sputter left (updateEngine cuts the power meanwhile).
export function updateNegG(p, world, pull, dt) {
  const cfg = cfgOf(world);
  p.cutout = Math.max(0, (p.cutout ?? 0) - dt);
  if (!cutsOut(world, p.def) || pull > -cfg.negGLimit) {
    p.negG = 0;
    return;
  }
  p.negG = (p.negG ?? 0) + dt;
  if (p.negG < cfg.negGHold || !p.engineRunning) return;
  // Pushing on: keep it sputtering at least half the cut time after the push ends.
  if (p.cutout <= 0) world.events.push({ type: 'negGCutout', plane: p.id, x: p.x, y: p.y });
  p.cutout = Math.max(p.cutout, p.cutout > 0 ? cfg.negGCut * 0.5 : cfg.negGCut);
}
