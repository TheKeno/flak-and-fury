// The gunsight shape, shared by the game's HUD and the options menu's preview. Draws at (x, y) in
// whatever pixels `hud` uses; cfg is settings.hud. Style: ring (ring and pip), circle, cross, dot.
export function drawSightShape(hud, x, y, cfg) {
  const r = cfg.crosshairSize;
  const style = cfg.crosshairStyle ?? 'ring';
  hud.save();
  hud.globalAlpha = cfg.crosshairAlpha;
  hud.strokeStyle = hud.fillStyle = cfg.crosshairColour ?? '#c8d8b0';
  hud.lineWidth = 0.75;
  hud.beginPath();
  if (style === 'ring' || style === 'circle') hud.arc(x, y, r, 0, Math.PI * 2);
  if (style === 'cross') {
    // Four ticks with a gap in the middle, so the target stays visible.
    const gap = r * 0.35;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      hud.moveTo(x + dx * gap, y + dy * gap);
      hud.lineTo(x + dx * r, y + dy * r);
    }
  }
  hud.stroke();
  if (style === 'ring' || style === 'dot') {
    const d = style === 'dot' ? Math.max(1, r * 0.35) : 1;
    hud.beginPath();
    hud.arc(x, y, d, 0, Math.PI * 2);
    hud.fill();
  }
  hud.restore();
}
