// HUD text: a plain monospace font drawn at the display's full resolution (the HUD is laid out in
// 480x270 units and scaled up), so it stays small and crisp instead of blocky. setTextSize() scales
// it (settings.hud.textSize); lineHeight() is the spacing between stacked lines at that size.
const FAMILY = "Consolas, 'Lucida Console', 'DejaVu Sans Mono', monospace";
const BASE = 4.6; // font size in HUD units at text size 1
const LINE = 5.6;

let scale = 1;
let font = `600 ${BASE}px ${FAMILY}`;
const measure = document.createElement('canvas').getContext('2d');
const widths = new Map();

export function setTextSize(s) {
  s = Math.max(0.5, Math.min(2, s || 1));
  if (s === scale) return;
  scale = s;
  font = `600 ${BASE * s}px ${FAMILY}`;
  widths.clear();
}
export const lineHeight = () => LINE * scale;

export function textWidth(str) {
  str = String(str).toUpperCase();
  let w = widths.get(str);
  if (w === undefined) {
    if (widths.size > 400) widths.clear(); // numbers change every frame
    measure.font = font;
    w = measure.measureText(str).width;
    widths.set(str, w);
  }
  return w;
}

export function drawText(ctx, str, x, y, color, shadow = 'rgba(0,0,0,0.55)') {
  str = String(str).toUpperCase();
  ctx.font = font;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillText(str, x + 0.45, y + 0.45);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}
