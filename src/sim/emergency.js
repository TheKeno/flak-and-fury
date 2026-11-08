// War emergency power. A key toggles it (bots too); it is always available, with no lockout and no
// grace period. The engine runs at its max rpm with extra power (`boost`), and every second costs wear
// at once: `baseWear` per second, rising with heat to `peakWear`. Heat builds while it is on
// (`heatTime` seconds to full) and drains after (`coolTime`), so switching on again while hot starts at a
// higher wear rate. Wear is plain `engineDamage`, so it stays until the ground crew repair it, and a
// worn engine has less power to boost (see updateEngine in plane.js). At full heat the engine seizes: it
// stops at once (with `seizeDamage` more wear) and starts again by itself once heat is down to
// `restartHeat`, unless it is burning, out of fuel or the plane is on its belly.

export const DEFAULT_EMERGENCY = {
  boost: 0.2, // extra engine power (share of full) at no wear
  baseWear: 0.015, // engine damage per second at once (0..1 scale); 5 s of use costs about 15%
  peakWear: 0.06, // ...and when the engine is fully heated
  heatTime: 8, // seconds to full heat
  coolTime: 12, // seconds to cool fully once off
  seizeDamage: 0.2, // extra engine damage when full heat stops the engine
  restartHeat: 0.3, // the seized engine starts again once heat has dropped to this
};

// One tick: take the key press (a toggle), update heat and wear. p.emergency says whether it is on.
export function updateEmergency(p, cmd, world, dt) {
  const cfg = world.emergency;
  const pressed = !!cmd.emergency && !p.prevEmergency;
  p.prevEmergency = !!cmd.emergency;
  const canRun = p.engineRunning && !p.dying && p.state !== 'dead';
  if (pressed && canRun) {
    p.emergency = !p.emergency;
    world.events.push({ type: p.emergency ? 'emergencyOn' : 'emergencyOff', plane: p.id, x: p.x, y: p.y });
  }
  if (p.emergency && !canRun) {
    p.emergency = false;
    world.events.push({ type: 'emergencyOff', plane: p.id, x: p.x, y: p.y });
  }
  if (p.emergency) {
    p.heat = Math.min(1, p.heat + dt / cfg.heatTime);
    const wear = cfg.baseWear + (cfg.peakWear - cfg.baseWear) * p.heat;
    p.engineDamage = Math.min(1, p.engineDamage + wear * dt);
    if (p.heat >= 1) {
      // Full heat: the engine seizes. Emergency power goes off and the engine cools while the plane glides.
      p.emergency = false;
      p.engineRunning = false;
      p.heatStopped = true;
      p.engineDamage = Math.min(1, p.engineDamage + cfg.seizeDamage);
      world.events.push({ type: 'engineSeized', plane: p.id, x: p.x, y: p.y });
    }
  } else {
    p.heat = Math.max(0, p.heat - dt / cfg.coolTime);
  }
  if (p.heatStopped && (p.belly || p.dying || p.state === 'dead' || p.fuel <= 0)) p.heatStopped = false;
  if (p.heatStopped && !p.engineRunning && !p.burning && p.heat <= cfg.restartHeat) {
    p.heatStopped = false;
    p.engineRunning = true;
    world.events.push({ type: 'engineStart', plane: p.id, x: p.x, y: p.y });
  }
}
