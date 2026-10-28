import { drawText, textWidth } from './font.js';
import { ownAirfieldAt, serviceProgress } from '../sim/airfield.js';

const JOBS = { repair: 'REPAIRING', refuel: 'REFUELLING', rearm: 'REARMING' };

function bar(ctx, x, y, w, value, colour) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y, w + 2, 4);
  ctx.fillStyle = colour;
  ctx.fillRect(x + 1, y + 1, Math.round(w * value), 2);
}

export function drawHud(ctx, world, plane, W, H, { showHelp }) {
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
  if (plane.burning && Math.floor(performance.now() / 200) % 2) drawText(ctx, 'FIRE', x + 48, y, '#ff7040');
  else if (plane.tailDamage > 0.05 || Math.abs(plane.wingPull) > 0.02) {
    const parts = [plane.tailDamage > 0.05 ? 'TAIL' : '', Math.abs(plane.wingPull) > 0.02 ? (plane.wingPull > 0 ? 'WING<' : 'WING>') : ''];
    drawText(ctx, parts.filter(Boolean).join(' '), x + 48, y, '#e0b040');
  }
  y += 7;
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
  drawText(ctx, `KILLS ${plane.kills}  LOST ${plane.deaths}`, x, y, '#e8c860');
  y += 8;
  if (plane.consciousness < 1) {
    drawText(ctx, 'PLT', x, y, '#c8d0c0');
    bar(ctx, x + 14, y + 1, 30, plane.consciousness, plane.consciousness < 0.4 ? '#e05040' : '#80c0e0');
  }

  const blink = Math.floor(performance.now() / 300) % 2 === 0;
  const centre = (str, cy, colour) => drawText(ctx, str, Math.round((W - textWidth(str)) / 2), cy, colour);
  if (plane.state === 'dead') centre('CRASHED - BACK TO THE HANGAR', 60, '#ff9070');
  else if (plane.dying) centre('GOING DOWN!', 60, blink ? '#ff6050' : '#ffb0a0');
  else if (plane.blackout) centre('BLACKOUT - TAP A/D!', 60, blink ? '#ff6050' : '#ffb0a0');
  else if (plane.tumble > 0) centre('OUT OF CONTROL!', 60, blink ? '#ff8050' : '#ffd0b0');
  else if (plane.y > world.map.ceiling) centre('TOO HIGH', 60, blink ? '#ffd060' : '#fff0c0');
  else if (plane.stalled && plane.state === 'air') centre('STALL', 60, blink ? '#ff6050' : '#ffc0b0');
  else if (plane.gearWarning) centre('GEAR UP!  (G)', 60, blink ? '#ff5040' : '#ffd0b0');
  else if (!plane.engineRunning && plane.state === 'air') centre('ENGINE OUT - GLIDE HOME!', 60, blink ? '#ff9050' : '#ffd0b0');
  else if (plane.state === 'ground') groundMessage(ctx, world, plane, centre);

  serviceBar(ctx, world, plane, W);

  if (showHelp) {
    const lines = [
      'A/D  ROTATE LEFT / RIGHT',
      'W/S  THROTTLE',
      'L.SHIFT  ROLL / TURN ON GROUND',
      'SPACE  GUNS   E  BOMBS   G  GEAR',
      'M  MUTE   T  TUNING   H  HIDE HELP',
    ];
    lines.forEach((l, i) => drawText(ctx, l, 6, H - 8 - (lines.length - 1 - i) * 7, '#f0f0e0'));
  }
}

function groundMessage(ctx, world, plane, centre) {
  const home = ownAirfieldAt(world, plane);
  if (plane.service) return; // the service bar says what's happening
  if (plane.strandedTimer > 0) {
    const left = Math.max(1, Math.ceil(5 - plane.strandedTimer));
    centre(`${plane.belly ? 'ON YOUR BELLY' : 'OUT OF FUEL'} - STRANDED. RECOVERY IN ${left}`, 60, '#ffb090');
  } else if (plane.belly && !home) centre('BELLY LANDING!', 60, '#ff9070');
  else if (!plane.engineRunning) centre(home ? 'ENGINE STOPPED - THROTTLE TO IDLE FOR THE CREW' : 'OUT OF FUEL', 60, '#ffb090');
  else if (home && plane.speed < 2 && plane.throttle >= 0.05) centre('THROTTLE TO IDLE (S) FOR GROUND CREW', 60, '#f0f0e0');
  else if (plane.speed < 1 && plane.throttle < 0.05) centre('HOLD W TO OPEN THROTTLE', 60, '#f0f0e0');
}

// Ground crew progress at the bottom of the screen.
function serviceBar(ctx, world, plane, W) {
  const s = plane.service;
  if (!s) return;
  const y = 236;
  const label = s.wait > 0 ? 'GROUND CREW COMING' : s.phase === 'done' ? 'READY - OPEN THROTTLE (W)' : JOBS[s.phase] ?? '';
  const colour = s.phase === 'done' ? '#a8e090' : '#f0e8c0';
  drawText(ctx, label, Math.round((W - textWidth(label)) / 2), y, colour);
  if (s.wait > 0 || s.phase === 'done') return;
  const w = 80;
  bar(ctx, Math.round((W - w) / 2) - 1, y + 8, w, serviceProgress(plane, world), '#e8c860');
}
