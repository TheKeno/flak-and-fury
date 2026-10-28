// Mouse look: hold the right mouse button and drag to turn your head (up, down or back).
// Relative, not absolute: where the mouse is when you press becomes the anchor, and only moving away
// from it turns your head. `cfg.lookSensitivity` is the drag distance (CSS pixels) for a full look.
// The result is a vector of length 0..1. (Left click stays free for aiming turrets later.)
export function createMouseLook(canvas, cfg) {
  const look = { active: false, x: 0, y: 0 };
  let ax = 0;
  let ay = 0;

  const drag = (e) => {
    const reach = Math.max(20, cfg.lookSensitivity);
    let x = (e.clientX - ax) / reach;
    let y = (e.clientY - ay) / reach;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    look.x = x;
    look.y = y;
  };

  // No browser right-click menu anywhere in the game (it would pop up when releasing off the canvas).
  addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 2) return;
    look.active = true;
    ax = e.clientX;
    ay = e.clientY;
    look.x = look.y = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (look.active) drag(e);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 2) look.active = false;
  });
  addEventListener('blur', () => (look.active = false));

  return look;
}
