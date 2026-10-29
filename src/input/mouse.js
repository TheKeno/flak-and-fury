// The mouse: left button fires the guns, right button drops bombs, moving it turns your head.
// Clicking the game captures the cursor (pointer lock; Esc frees it), so the mouse moves freely.
// The look is sticky: where you leave it, the view stays, and after `cfg.lookReturn` seconds without
// moving the mouse it eases back to looking ahead. `cfg.lookSensitivity` is the mouse travel (CSS
// pixels) for a full look. The look is a vector of length 0..1, y down.
// In pan mode (free look) the mouse moves the camera instead: takePan() hands over the travel.
export function createMouse(canvas, cfg) {
  const mouse = { active: false, x: 0, y: 0, fire: false, bomb: false, panMode: false };
  let idle = 0; // seconds since the mouse last moved
  let panX = 0;
  let panY = 0;

  const locked = () => document.pointerLockElement === canvas;
  mouse.capture = () => {
    if (!locked()) canvas.requestPointerLock?.()?.catch?.(() => {});
  };
  mouse.release = () => {
    if (locked()) document.exitPointerLock();
  };

  // No browser right-click menu anywhere in the game (right is the bomb button).
  addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (!locked()) {
      mouse.capture(); // the first click only grabs the mouse
      return;
    }
    if (e.button === 0) mouse.fire = true;
    if (e.button === 2) mouse.bomb = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.fire = false;
    if (e.button === 2) mouse.bomb = false;
  });
  document.addEventListener('pointerlockchange', () => {
    if (!locked()) mouse.fire = mouse.bomb = false;
  });
  addEventListener('mousemove', (e) => {
    if (!locked()) return;
    if (mouse.panMode) {
      panX += e.movementX;
      panY += e.movementY;
      return;
    }
    const reach = Math.max(20, cfg.lookSensitivity);
    let x = mouse.x + e.movementX / reach;
    let y = mouse.y + e.movementY / reach;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    mouse.x = x;
    mouse.y = y;
    idle = 0;
  });
  addEventListener('blur', () => (mouse.fire = mouse.bomb = false));

  // Once a frame: after a while without moving, the head eases back to the front.
  mouse.update = (dt) => {
    idle += dt;
    if (idle > (cfg.lookReturn ?? 10)) {
      const k = Math.exp(-dt * 3);
      mouse.x *= k;
      mouse.y *= k;
      if (Math.hypot(mouse.x, mouse.y) < 0.01) mouse.x = mouse.y = 0;
    }
    mouse.active = mouse.x !== 0 || mouse.y !== 0;
  };
  // Mouse travel since the last call, in CSS pixels (pan mode).
  mouse.takePan = () => {
    const d = [panX, panY];
    panX = panY = 0;
    return d;
  };
  return mouse;
}
