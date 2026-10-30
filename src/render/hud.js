import { drawText, textWidth, lineHeight } from './font.js';
import { ownAirfieldAt, serviceProgress } from '../sim/airfield.js';
import { hangarHealth } from '../sim/ground.js';
import { homeRunway, runwayState, nextFill } from '../sim/runway.js';
import { approach, recoveryTime } from '../sim/plane.js';

const APPROACH_ALT = 80; // landing cues show below this height, gear down and descending
const CUE = { ok: '#80d070', hard: '#e0b040', bad: '#d06050' };

const JOBS = { repair: 'REPAIRING', refuel: 'REFUELLING', rearm: 'REARMING' };

// Read-outs: muted, so the stats sit back from the scene; warnings keep their strong colours.
const VALUE = '#d4d8c8';
const LABEL = '#a0a696';

// Display units (settings.hud.units). Speeds use the game's display scale, not physics units.
const UNITS = {
  metric: { speed: 'KM/H', sk: 1, alt: 'M', ak: 1, sink: 'M/S' },
  imperial: { speed: 'MPH', sk: 0.6214, alt: 'FT', ak: 3.281, sink: 'FT/S' },
  nautical: { speed: 'KN', sk: 0.54, alt: 'FT', ak: 3.281, sink: 'FT/S' },
};
const unitsOf = (u) => UNITS[u] ?? UNITS.metric;
export const speedValue = (v, u) => Math.round(v * 3.6 * 0.4 * 3.2 * unitsOf(u).sk);
export const speedText = (v, u) => `${speedValue(v, u)} ${unitsOf(u).speed}`;
export const sinkText = (v, u) => `${Math.round(v * 0.4 * unitsOf(u).ak)} ${unitsOf(u).sink}`;

// The keys for on-screen hints, as bound in the options (src/input/keyboard.js keyName).
let keyOf = (id) => id.toUpperCase();
export function setKeyNames(fn) {
  keyOf = fn;
}
const turnKeys = () => `${keyOf('turnCcw')}/${keyOf('turnCw')}`;

function bar(ctx, x, y, w, value, colour) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x, y, w + 1.6, 3);
  ctx.fillStyle = colour;
  ctx.fillRect(x + 0.8, y + 0.8, w * value, 1.4);
}

export function drawHud(ctx, world, plane, W, H, { showHelp, lastFlight, freeLook = false, units }) {
  if (!plane) return;
  const L = lineHeight();
  const u = unitsOf(units);

  const x = 6;
  let y = 6;
  const col = x + textWidth('GEAR') + 3; // values line up after the longest label
  const barW = 26;
  const stat = (label, value, colour = VALUE) => {
    drawText(ctx, label, x, y, LABEL);
    drawText(ctx, value, col, y, colour);
    y += L;
  };
  const meter = (label, value, colour, labelColour = LABEL) => {
    drawText(ctx, label, x, y, labelColour);
    bar(ctx, col, y + L * 0.2, barW, value, colour);
  };
  stat('SPD', speedText(plane.speed, units));
  stat('ALT', `${Math.max(0, Math.round((plane.y - world.terrain.heightAt(plane.x)) * 4 * u.ak))} ${u.alt}`);
  stat('RPM', Math.round(plane.rpm / 10) * 10);
  y += L * 0.2;
  meter('THR', plane.throttle, '#c8aa58');
  y += L;
  const lowFuel = plane.fuel < 0.15;
  meter('FUEL', plane.fuel, lowFuel ? '#e05040' : '#a89068');
  if (lowFuel && plane.engineRunning && Math.floor(performance.now() / 250) % 2) drawText(ctx, 'LOW', col + barW + 4, y, '#ff7040');
  y += L;
  const hp = Math.max(0, plane.hp / plane.def.hp);
  meter('HULL', hp, hp < 0.35 ? '#e05040' : hp < 0.6 ? '#e0a040' : '#78b868');
  y += L;
  if (plane.burning && !plane.dying) {
    // Time left before the fire finishes the plane.
    const flicker = Math.floor(performance.now() / 150) % 2 === 0;
    meter('FIRE', Math.max(0, plane.fireLeft) / world.fire.burnTime, '#ff6a50', flicker ? '#ff6a50' : '#ffc0a0');
    drawText(ctx, `${Math.max(0, Math.ceil(plane.fireLeft))}S`, col + barW + 4, y, '#ffc0a0');
    y += L;
  }
  const rounds = plane.guns.reduce((n, g) => n + g.ammo, 0);
  stat('GUN', Math.floor(rounds), rounds > 0 ? VALUE : '#e05040');
  if (plane.bombs) stat('BMB', plane.bombs.count, plane.bombs.count > 0 ? VALUE : '#808880');
  // Gear lamp: green down and locked, amber moving, red up.
  const gearText = plane.belly ? 'BELLY' : plane.gear >= 1 ? 'DOWN' : plane.gear <= 0 ? 'UP' : 'MOVING';
  const gearColour = plane.belly ? '#e05040' : plane.gear >= 1 ? '#80d070' : plane.gear <= 0 ? '#d06050' : '#e0b040';
  lamp(ctx, 'GEAR', gearText + (plane.gearManual ? ' (MAN)' : ''), gearColour, x, col, y);
  y += L;
  y = runwayLamp(ctx, world, plane, x, col, y);
  const cue = onApproach(world, plane) ? approach(plane, world) : null;
  if (cue) {
    drawText(ctx, 'LDG', x, y, LABEL);
    drawText(ctx, 'SPD', col, y, CUE[cue.speed]);
    drawText(ctx, 'ANG', col + textWidth('SPD '), y, CUE[cue.angle]);
    y += L;
  }
  y += L * 0.2;
  drawText(ctx, `KILLS ${plane.kills}  LOST ${plane.deaths}  SCORE ${plane.score}`, x, y, '#c8aa58');
  y += L;
  if (plane.consciousness < 1) {
    meter('PLT', plane.consciousness, plane.consciousness < 0.4 ? '#e05040' : '#80c0e0');
    y += L;
  }

  const blink = Math.floor(performance.now() / 300) % 2 === 0;
  // In free look the camera is elsewhere: your plane's calls and bars would only cover the view.
  const centre = (str, line, colour) => !freeLook && drawText(ctx, str, (W - textWidth(str)) / 2, 58 + line * L, colour);
  if (plane.waiting) waitingMessage(world, plane, centre);
  else if (plane.state === 'dead') centre('CRASHED - BACK TO THE HANGAR', 0, '#ff9070');
  else if (plane.dying) centre('GOING DOWN!', 0, blink ? '#ff6050' : '#ffb0a0');
  else if (plane.burning && plane.state === 'air') centre('ON FIRE - LAND NOW!', 0, blink ? '#ff6050' : '#ffc0a0');
  else if (plane.burning && plane.speed >= 2) centre('ON FIRE - STOP THE PLANE!', 0, blink ? '#ff6050' : '#ffc0a0');
  else if (plane.blackout) centre(`BLACKOUT - TAP ${turnKeys()}!`, 0, blink ? '#ff6050' : '#ffb0a0');
  else if (plane.tumble > 0) centre('OUT OF CONTROL!', 0, blink ? '#ff8050' : '#ffd0b0');
  else if (plane.y > world.map.ceiling) centre('TOO HIGH', 0, blink ? '#ffd060' : '#fff0c0');
  else if (plane.stalled && plane.state === 'air') centre('STALL', 0, blink ? '#ff6050' : '#ffc0b0');
  else if (cue && plane.y - world.terrain.heightAt(plane.x) < APPROACH_ALT / 2 && (cue.speed !== 'ok' || cue.angle !== 'ok')) {
    const call = cue.speed !== 'ok' ? 'TOO FAST' : cue.noseUp < 0 ? 'NOSE DOWN - FLARE' : 'NOSE TOO HIGH';
    centre(call, 0, cue.speed === 'bad' || cue.angle === 'bad' ? (blink ? '#ff6050' : '#ffc0a0') : '#ffd070');
  } else if (plane.gearWarning) centre(`GEAR UP!  (${keyOf('gear')})`, 0, blink ? '#ff5040' : '#ffd0b0');
  else if (!plane.engineRunning && plane.state === 'air') centre('ENGINE OUT - GLIDE HOME!', 0, blink ? '#ff9050' : '#ffd0b0');
  else if (plane.state === 'ground' && !plane.burning) groundMessage(ctx, world, plane, centre); // the fire bar shows instead

  if (!freeLook) {
    serviceBar(ctx, world, plane, W);
    fireBar(ctx, world, plane, W);
  }
  const below = damageReport(ctx, plane, x, y + L * 0.6); // under the plane stats
  if (lastFlight) drawLastFlight(ctx, lastFlight, x, below);

  if (showHelp) {
    // Top right, beside the radar scope (short lines: there's little room).
    const arrows = ['lookUp', 'lookDown', 'lookLeft', 'lookRight'].map(keyOf).join('/');
    const lines = [
      `${turnKeys()}  ROTATE`,
      `${keyOf('throttleUp')}/${keyOf('throttleDown')}  THROTTLE`,
      `${keyOf('roll')}  ROLL / TURN ON GROUND`,
      `${keyOf('fire')}  GUNS`,
      `${keyOf('bomb')}  BOMBS`,
      `${keyOf('gear')} GEAR   ${keyOf('abandon')} ABANDON (IN A FIELD)`,
      `MOUSE / ${arrows === 'UP/DOWN/LEFT/RIGHT' ? 'ARROWS' : arrows}  LOOK`,
      `${keyOf('menu')} MENU   ${keyOf('mute')} MUTE   ${keyOf('help')} HIDE HELP`,
      `${keyOf('freeLook')} FREE LOOK   ${keyOf('tuning')} TUNING`,
    ];
    const left = W - 6 - Math.max(...lines.map((l) => textWidth(l)));
    lines.forEach((l, i) => drawText(ctx, l, left, 4 + i * L, '#c8c8b8'));
  }
}

const onApproach = (world, p) =>
  p.state === 'air' && !p.dying && p.gear >= 0.9 && p.vy < 0 && p.y - world.terrain.heightAt(p.x) < APPROACH_ALT;

// A label, a small lamp and its state.
function lamp(ctx, label, text, colour, x, col, y) {
  const L = lineHeight();
  drawText(ctx, label, x, y, LABEL);
  ctx.fillStyle = colour;
  ctx.fillRect(col, y + L * 0.18, L * 0.45, L * 0.45);
  drawText(ctx, text, col + L * 0.8, y, colour);
}

// Your own runway: open, damaged (with the clear length) or closed for your plane.
function runwayLamp(ctx, world, plane, x, col, y) {
  const af = homeRunway(world, plane.team);
  if (!af) return y;
  const { state, length } = runwayState(world, af, plane.def.runwayNeeded ?? 0);
  const colour = state === 'open' ? '#80d070' : state === 'damaged' ? '#e0b040' : '#d06050';
  let text = state.toUpperCase();
  if (state === 'damaged') text += ` ${Math.floor(length)}`;
  if (state !== 'open') {
    const t = nextFill(world, af);
    text += Number.isFinite(t) ? `  FILL ${Math.ceil(t)}S` : '  NO CREW';
  }
  lamp(ctx, 'RWY', text, colour, x, col, y);
  return y + lineHeight();
}

// Waiting at home for a runway long enough to take off from.
function waitingMessage(world, plane, centre) {
  const af = homeRunway(world, plane.team);
  if (!af) return;
  const needed = plane.def.runwayNeeded ?? 0;
  const { length } = runwayState(world, af, needed);
  if (hangarHealth(world, plane.team) <= 0) {
    centre('AIRFIELD CLOSED - HANGAR DESTROYED', 0, '#ff7060');
    centre('NO CREW TO FILL THE CRATERS. YOU ARE GROUNDED', 1, '#ffb090');
    return;
  }
  // Would a plane with a shorter take-off run get off this runway? (Switching planes comes later.)
  const shorter = Object.values(world.planeDefs).some((d) => (d.runwayNeeded ?? 0) <= length);
  if (shorter) centre(`RUNWAY TOO SHORT FOR THE ${plane.def.name.toUpperCase()} - NEEDS ${needed}, ${Math.floor(length)} CLEAR`, 0, '#ffb090');
  else centre('AIRFIELD CLOSED - CREWS FILLING CRATERS', 0, '#ffb090');
  centre(`NEXT CRATER FILLED IN ${Math.ceil(nextFill(world, af))}S`, 1, '#f0e8c0');
}

function groundMessage(ctx, world, plane, centre) {
  const home = ownAirfieldAt(world, plane);
  if (plane.service) return; // the service bar says what's happening
  if (home && hangarHealth(world, plane.team) <= 0) {
    centre('HANGAR DESTROYED - NO GROUND CREW', 0, '#ff9070');
    return;
  }
  const up = keyOf('throttleUp');
  const abandon = keyOf('abandon');
  if (plane.strandedTimer > 0) {
    const left = Math.max(1, Math.ceil(recoveryTime(plane, world) - plane.strandedTimer));
    const why = plane.belly ? 'ON YOUR BELLY - STRANDED' : !plane.engineRunning ? 'ENGINE DEAD - STRANDED' : 'STUCK';
    centre(`${why}. RECOVERY IN ${left}S`, 0, '#ffb090');
    if (!home) centre(`WAIT TO SAVE THE PLANE, OR ${abandon}: ABANDON IT`, 1, '#f0e8c0');
  } else if (!home && plane.speed < 1 && !plane.burning) {
    centre(`LANDED IN A FIELD - OPEN THROTTLE (${up}) TO TAKE OFF`, 0, '#f0e8c0');
    centre(`OR ${abandon}: ABANDON THE PLANE`, 1, '#f0e8c0');
  } else if (plane.belly && !home) centre('BELLY LANDING!', 0, '#ff9070');
  else if (!plane.engineRunning) centre(home ? 'ENGINE STOPPED - THROTTLE TO IDLE FOR THE CREW' : 'OUT OF FUEL', 0, '#ffb090');
  else if (home && plane.speed < 2 && plane.throttle >= 0.05) centre(`THROTTLE TO IDLE (${keyOf('throttleDown')}) FOR GROUND CREW`, 0, '#f0f0e0');
  else if (plane.speed < 1 && plane.throttle < 0.05) centre(`HOLD ${up} TO OPEN THROTTLE`, 0, '#f0f0e0');
}

// Putting a fire out, once the plane has stopped: the pilot alone in a field, the crew at home.
function fireBar(ctx, world, plane, W) {
  if (!plane.burning || plane.dying || plane.state !== 'ground' || plane.speed >= 2) return;
  const crew = Boolean(ownAirfieldAt(world, plane));
  const label = crew ? 'GROUND CREW PUTTING OUT THE FIRE' : 'PUTTING OUT THE FIRE';
  const y = 72;
  drawText(ctx, label, (W - textWidth(label)) / 2, y, '#ffc0a0');
  const w = 80;
  const need = crew ? world.fire.crewTime : world.fire.pilotTime;
  bar(ctx, (W - w) / 2 - 1, y + lineHeight() + 1, w, Math.min(1, plane.fireOut / need), '#ff9050');
}

// Ground crew progress, under the radar scope.
function serviceBar(ctx, world, plane, W) {
  const s = plane.service;
  if (!s) return;
  const y = 44;
  const label = s.wait > 0 ? (s.setup ? 'GROUND CREW SETTING UP' : 'GROUND CREW COMING') : s.phase === 'done' ? `READY - OPEN THROTTLE (${keyOf('throttleUp')})` : JOBS[s.phase] ?? '';
  const colour = s.phase === 'done' ? '#a8e090' : '#f0e8c0';
  drawText(ctx, label, (W - textWidth(label)) / 2, y, colour);
  if (s.wait > 0 || s.phase === 'done') return;
  const w = 80;
  bar(ctx, (W - w) / 2 - 1, y + lineHeight() + 1, w, serviceProgress(plane, world), '#e8c860');
}

const RED = '#ff6a50';
const AMBER = '#e8b048';

// What's wrong with the plane, worst first. Each line stays as long as the damage does: until the
// plane is lost or the ground crew repair it.
export function damageLines(plane) {
  const lines = [];
  const blink = Math.floor(performance.now() / 250) % 2 === 0;
  if (plane.burning) lines.push(['ON FIRE!', blink ? RED : '#ffc0a0']);
  if (plane.hp / plane.def.hp < 0.3) lines.push(['AIRFRAME CRITICAL', RED]);
  if (plane.tailDamage >= 0.5) lines.push(['TAIL SHREDDED - STEERING WEAK', RED]);
  else if (plane.tailDamage > 0.05) lines.push(['TAIL DAMAGED', AMBER]);
  if (Math.abs(plane.wingPull) > 0.02) {
    // Positive pull drags the nose counter-clockwise, so hold clockwise against it.
    const counter = `HOLD ${keyOf(plane.wingPull > 0 ? 'turnCw' : 'turnCcw')}`;
    const torn = Math.abs(plane.wingPull) > 0.3;
    lines.push([`${torn ? 'WING TORN' : 'WING DAMAGED'} - PULLS, ${counter}`, torn ? RED : AMBER]);
  }
  if (plane.propBent) lines.push(['PROPELLER BENT', AMBER]);
  if (!plane.engineRunning && !plane.belly) lines.push([plane.fuel <= 0 ? 'OUT OF FUEL' : 'ENGINE DEAD', RED]);
  else if (plane.engineDamage > 0.5) lines.push(['ENGINE BADLY HIT', RED]);
  else if (plane.engineDamage > 0.1) lines.push(['ENGINE DAMAGED', AMBER]);
  if (plane.belly) lines.push(['ON ITS BELLY', AMBER]);
  return lines;
}

// A titled box of coloured lines. Returns the y just below it.
function report(ctx, title, titleColour, lines, x, y, back) {
  const L = lineHeight();
  const widest = Math.max(textWidth(title), ...lines.map(([t]) => textWidth(t)));
  ctx.fillStyle = back;
  ctx.fillRect(x - 2.5, y - 2.5, widest + 5, lines.length * L + L + 6);
  drawText(ctx, title, x, y, titleColour);
  y += L + 1.5;
  for (const [text, colour] of lines) {
    drawText(ctx, text, x, y, colour);
    y += L;
  }
  return y + L;
}

// Returns the y just below the panel (or y itself if nothing was drawn).
function damageReport(ctx, plane, x, y) {
  if (plane.state === 'dead') return y;
  const lines = damageLines(plane);
  if (!lines.length) return y;
  return report(ctx, 'DAMAGE REPORT', '#b8b098', lines, x, y, 'rgba(10,8,6,0.4)');
}

// The damage report frozen at the moment the plane was lost, with what brought it down.
function drawLastFlight(ctx, last, x, y) {
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * last.alpha;
  report(ctx, 'LAST FLIGHT', '#c8a898', [[last.cause, '#ff8a70'], ...last.lines], x, y, 'rgba(30,6,4,0.5)');
  ctx.globalAlpha = base;
}
