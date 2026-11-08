// War emergency power. A key toggles it (bots too); it is always available, with no lockout and no
// grace period. The engine runs at its max rpm with extra power (`boost`), and every second costs wear
// at once: `baseWear` per second, rising with heat to `peakWear`. Heat builds while it is on
// (`heatTime` seconds to full) and drains after (`coolTime`), so switching on again while hot starts at a
// higher wear rate. Wear is plain `engineDamage`, so it stays until the ground crew repair it, and a
// worn engine has less power to boost (see updateEngine in plane.js).

export const DEFAULT_EMERGENCY = {
  boost: 0.2, // extra engine power (share of full) at no wear
  baseWear: 0.005, // engine damage per second at once (0..1 scale)
  peakWear: 0.02, // ...and when the engine is fully heated
  heatTime: 15, // seconds to full heat
  coolTime: 10, // seconds to cool fully once off
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
  } else {
    p.heat = Math.max(0, p.heat - dt / cfg.coolTime);
  }
}
