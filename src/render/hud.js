import { drawText, textWidth } from './font.js';
import { ownAirfieldAt, serviceProgress } from '../sim/airfield.js';
import { hangarHealth } from '../sim/ground.js';

const JOBS = { repair: 'REPAIRING', refuel: 'REFUELLING', rearm: 'REARMING' };

function bar(ctx, x, y, w, value, colour) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y, w + 2, 4);
  ctx.fillStyle = colour;
  ctx.fillRect(x + 1, y + 1, Math.round(w * value), 2);
}

export function drawHud(ctx, world, plane, W, H, { showHelp, lastFlight, freeLook = false }) {
  if (!plane) return;

  const x = 6;
  let y = 6;
  const speedKmh = Math.round(plane.speed * 3.6 * 0.4 * 3.2); // display scale, not physics
  drawText(ctx, `SPD ${speedKmh}`, x, y, '#e8f0e0');
  y += 7;
  drawText(ctx, `ALT ${Math.max(0, Math.round((plane.y - world.terrain.heightAt(plane.x)) * 4))}`, x, y, '#e8f0e0');
  y += 7;
  drawText(ctx, `RPM ${Math.round(plane.rpm / 10) * 10}`, x, y, '#e8f0e0');
  y += 8;
  drawText(ctx, 'THR', x, y, '#c8d0c0');
  bar(ctx, x + 14, y + 1, 30, plane.throttle, '#e8c860');
  y += 7;
  const lowFuel = plane.fuel < 0.15;
  drawText(ctx, 'FUL', x, y, '#c8d0c0');
  bar(ctx, x + 14, y + 1, 30, plane.fuel, lowFuel ? '#e05040' : '#c0a070');
  if (lowFuel && plane.engineRunning && Math.floor(performance.now() / 250) % 2) drawText(ctx, 'LOW', x + 48, y, '#ff7040');
  y += 7;
  const hp = Math.max(0, plane.hp / plane.def.hp);
  drawText(ctx, 'DMG', x, y, '#c8d0c0');
  bar(ctx, x + 14, y + 1, 30, hp, hp < 0.35 ? '#e05040' : hp < 0.6 ? '#e0a040' : '#80d070');
  y += 7;
  if (plane.burning && !plane.dying) {
    // Time left before the fire finishes the plane.
    const flicker = Math.floor(performance.now() / 150) % 2 === 0;
    drawText(ctx, 'FIR', x, y, flicker ? '#ff6a50' : '#ffc0a0');
    bar(ctx, x + 14, y + 1, 30, Math.max(0, plane.fireLeft) / world.fire.burnTime, '#ff6a50');
    drawText(ctx, `${Math.max(0, Math.ceil(plane.fireLeft))}S`, x + 48, y, '#ffc0a0');
    y += 7;
  }
  const rounds = plane.guns.reduce((n, g) => n + g.ammo, 0);
  drawText(ctx, `GUN ${Math.floor(rounds)}`, x, y, rounds > 0 ? '#e8f0e0' : '#e05040');
  y += 7;
  if (plane.bombs) {
    drawText(ctx, `BMB ${plane.bombs.count}`, x, y, plane.bombs.count > 0 ? '#e8f0e0' : '#808880');
    y += 7;
  }
  // Gear lamp: green down and locked, amber moving, red up.
  const gearText = plane.belly ? 'BELLY' : plane.gear >= 1 ? 'DOWN' : plane.gear <= 0 ? 'UP' : 'MOVING';
  const gearColour = plane.belly ? '#e05040' : plane.gear >= 1 ? '#80d070' : plane.gear <= 0 ? '#d06050' : '#e0b040';
  drawText(ctx, 'GEAR', x, y, '#c8d0c0');
  ctx.fillStyle = gearColour;
  ctx.fillRect(x + 18, y + 1, 3, 3);
  drawText(ctx, gearText + (plane.gearManual ? ' (MAN)' : ''), x + 24, y, gearColour);
  y += 7;
  drawText(ctx, `KILLS ${plane.kills}  LOST ${plane.deaths}  SCORE ${plane.score}`, x, y, '#e8c860');
  y += 8;
  if (plane.consciousness < 1) {
    drawText(ctx, 'PLT', x, y, '#c8d0c0');
    bar(ctx, x + 14, y + 1, 30, plane.consciousness, plane.consciousness < 0.4 ? '#e05040' : '#80c0e0');
    y += 7;
  }

  const blink = Math.floor(performance.now() / 300) % 2 === 0;
  // In free look the camera is elsewhere: your plane's calls and bars would only cover the view.
  const centre = (str, cy, colour) => !freeLook && drawText(ctx, str, Math.round((W - textWidth(str)) / 2), cy, colour);
  if (plane.state === 'dead') centre('CRASHED - BACK TO THE HANGAR', 60, '#ff9070');
  else if (plane.dying) centre('GOING DOWN!', 60, blink ? '#ff6050' : '#ffb0a0');
  else if (plane.burning && plane.state === 'air') centre('ON FIRE - LAND NOW!', 60, blink ? '#ff6050' : '#ffc0a0');
  else if (plane.burning && plane.speed >= 2) centre('ON FIRE - STOP THE PLANE!', 60, blink ? '#ff6050' : '#ffc0a0');
  else if (plane.blackout) centre('BLACKOUT - TAP A/D!', 60, blink ? '#ff6050' : '#ffb0a0');
  else if (plane.tumble > 0) centre('OUT OF CONTROL!', 60, blink ? '#ff8050' : '#ffd0b0');
  else if (plane.y > world.map.ceiling) centre('TOO HIGH', 60, blink ? '#ffd060' : '#fff0c0');
  else if (plane.stalled && plane.state === 'air') centre('STALL', 60, blink ? '#ff6050' : '#ffc0b0');
  else if (plane.gearWarning) centre('GEAR UP!  (G)', 60, blink ? '#ff5040' : '#ffd0b0');
  else if (!plane.engineRunning && plane.state === 'air') centre('ENGINE OUT - GLIDE HOME!', 60, blink ? '#ff9050' : '#ffd0b0');
  else if (plane.state === 'ground' && !plane.burning) groundMessage(ctx, world, plane, centre); // the fire bar shows instead

  if (!freeLook) {
    serviceBar(ctx, world, plane, W);
    fireBar(ctx, world, plane, W);
  }
  const below = damageReport(ctx, plane, x, y + 4); // under the plane stats
  if (lastFlight) drawLastFlight(ctx, lastFlight, x, below);

  if (showHelp) {
    // Top right, beside the radar scope (short lines: there's little room).
    const lines = [
      'A/D    ROTATE',
      'W/S    THROTTLE',
      'SHIFT  ROLL / TURN ON GROUND',
      'SPACE GUNS  E BOMBS  G GEAR',
      'ARROWS / RIGHT DRAG  LOOK',
      'V FREE LOOK  P PAUSE',
      'M MUTE  T TUNING  H HIDE HELP',
    ];
    const left = W - 6 - Math.max(...lines.map((l) => textWidth(l)));
    lines.forEach((l, i) => drawText(ctx, l, left, 4 + i * 7, '#f0f0e0'));
  }
}

function groundMessage(ctx, world, plane, centre) {
  const home = ownAirfieldAt(world, plane);
  if (plane.service) return; // the service bar says what's happening
  if (home && hangarHealth(world, plane.team) <= 0) {
    centre('HANGAR DESTROYED - NO GROUND CREW', 60, '#ff9070');
    return;
  }
  if (plane.strandedTimer > 0) {
    const left = Math.max(1, Math.ceil(5 - plane.strandedTimer));
    centre(`${plane.belly ? 'ON YOUR BELLY' : 'OUT OF FUEL'} - STRANDED. RECOVERY IN ${left}`, 60, '#ffb090');
  } else if (plane.belly && !home) centre('BELLY LANDING!', 60, '#ff9070');
  else if (!plane.engineRunning) centre(home ? 'ENGINE STOPPED - THROTTLE TO IDLE FOR THE CREW' : 'OUT OF FUEL', 60, '#ffb090');
  else if (home && plane.speed < 2 && plane.throttle >= 0.05) centre('THROTTLE TO IDLE (S) FOR GROUND CREW', 60, '#f0f0e0');
  else if (plane.speed < 1 && plane.throttle < 0.05) centre('HOLD W TO OPEN THROTTLE', 60, '#f0f0e0');
}

// Putting a fire out, once the plane has stopped: the pilot alone in a field, the crew at home.
function fireBar(ctx, world, plane, W) {
  if (!plane.burning || plane.dying || plane.state !== 'ground' || plane.speed >= 2) return;
  const crew = Boolean(ownAirfieldAt(world, plane));
  const label = crew ? 'GROUND CREW PUTTING OUT THE FIRE' : 'PUTTING OUT THE FIRE';
  const y = 72;
  drawText(ctx, label, Math.round((W - textWidth(label)) / 2), y, '#ffc0a0');
  const w = 80;
  const need = crew ? world.fire.crewTime : world.fire.pilotTime;
  bar(ctx, Math.round((W - w) / 2) - 1, y + 8, w, Math.min(1, plane.fireOut / need), '#ff9050');
}

// Ground crew progress, under the radar scope.
function serviceBar(ctx, world, plane, W) {
  const s = plane.service;
  if (!s) return;
  const y = 44;
  const label = s.wait > 0 ? 'GROUND CREW COMING' : s.phase === 'done' ? 'READY - OPEN THROTTLE (W)' : JOBS[s.phase] ?? '';
  const colour = s.phase === 'done' ? '#a8e090' : '#f0e8c0';
  drawText(ctx, label, Math.round((W - textWidth(label)) / 2), y, colour);
  if (s.wait > 0 || s.phase === 'done') return;
  const w = 80;
  bar(ctx, Math.round((W - w) / 2) - 1, y + 8, w, serviceProgress(plane, world), '#e8c860');
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
    // Positive pull drags the nose counter-clockwise, so hold D (clockwise) against it.
    const counter = plane.wingPull > 0 ? 'HOLD D' : 'HOLD A';
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

// Returns the y just below the panel (or y itself if nothing was drawn).
function damageReport(ctx, plane, x, y) {
  if (plane.state === 'dead') return y;
  const lines = damageLines(plane);
  if (!lines.length) return y;
  const widest = Math.max(textWidth('DAMAGE REPORT'), ...lines.map(([t]) => textWidth(t)));
  ctx.fillStyle = 'rgba(10,8,6,0.45)';
  ctx.fillRect(x - 3, y - 3, widest + 6, lines.length * 7 + 13);
  drawText(ctx, 'DAMAGE REPORT', x, y, '#c8c0a8');
  y += 9;
  for (const [text, colour] of lines) {
    drawText(ctx, text, x, y, colour);
    y += 7;
  }
  return y + 8;
}

// The damage report frozen at the moment the plane was lost, with what brought it down.
function drawLastFlight(ctx, report, x, y) {
  const lines = [[report.cause, '#ff8a70'], ...report.lines];
  const widest = Math.max(textWidth('LAST FLIGHT'), ...lines.map(([t]) => textWidth(t)));
  ctx.globalAlpha = report.alpha;
  ctx.fillStyle = 'rgba(30,6,4,0.55)';
  ctx.fillRect(x - 3, y - 3, widest + 6, lines.length * 7 + 13);
  drawText(ctx, 'LAST FLIGHT', x, y, '#d8b8a8');
  y += 9;
  for (const [text, colour] of lines) {
    drawText(ctx, text, x, y, colour);
    y += 7;
  }
  ctx.globalAlpha = 1;
}
