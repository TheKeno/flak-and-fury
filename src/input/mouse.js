// Mouse look: hold the right mouse button and point where you want to look. The direction is the
// pointer's offset from the centre of the game screen, as a vector of length 0..1.
// (Left click stays free for aiming turrets later.)
export function createMouseLook(canvas) {
  const look = { active: false, x: 0, y: 0 };

  const aim = (e) => {
    const r = canvas.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    let y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    look.x = x;
    look.y = y;
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 2) return;
    look.active = true;
    aim(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (look.active) aim(e);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 2) look.active = false;
  });
  addEventListener('blur', () => (look.active = false));

  return look;
}
