// The mouse: its buttons are bindable like keys (Mouse0..Mouse4, see src/input/keyboard.js; left fires
// and right bombs by default), moving it turns your head.
// Clicking the game captures the cursor (pointer lock; Esc frees it), so the mouse moves freely.
// The look is sticky: where you leave it, the view stays, and with `cfg.lookReturnOn` it eases back to
// looking ahead after `cfg.lookReturn` seconds without moving the mouse. `cfg.lookSensitivity` is the
// mouse travel (CSS pixels) for a full look; `cfg.mouseLook` off leaves looking to the keys. The look
// is a vector of length 0..1, y down.
// In pan mode (free look) the mouse moves the camera instead: takePan() hands over the travel.
import { press, release } from './keyboard.js';

const BUTTONS = 5;

export function createMouse(canvas, cfg) {
  const mouse = { active: false, x: 0, y: 0, panMode: false, onLockLost: null };
  let idle = 0; // seconds since the mouse last moved
  let panX = 0;
  let panY = 0;
  let letGo = false; // the game freed the cursor itself (not the player's Esc)

  const locked = () => document.pointerLockElement === canvas;
  mouse.locked = locked;
  mouse.capture = () => {
    if (!locked()) canvas.requestPointerLock?.()?.catch?.(() => {});
  };
  mouse.release = () => {
    if (!locked()) return;
    letGo = true;
    document.exitPointerLock();
  };
  const releaseAll = () => {
    for (let b = 0; b < BUTTONS; b++) release(`Mouse${b}`);
  };

  // No browser right-click menu anywhere in the game (right is the bomb button), and the side buttons
  // mustn't go back a page anywhere (they may be bound, or being bound in the options), nor the middle
  // one start scrolling over the game.
  addEventListener('contextmenu', (e) => e.preventDefault());
  const keepButton = (e) => (e.button === 3 || e.button === 4 || (e.button === 1 && e.target === canvas)) && e.preventDefault();
  addEventListener('auxclick', keepButton);
  canvas.addEventListener('mousedown', (e) => {
    keepButton(e);
    if (!locked()) {
      mouse.capture(); // the first click only grabs the mouse
      return;
    }
    press(`Mouse${e.button}`, e);
  });
  addEventListener('mouseup', (e) => {
    keepButton(e);
    release(`Mouse${e.button}`);
  });
  document.addEventListener('pointerlockchange', () => {
    if (locked()) return;
    releaseAll();
    if (!letGo) mouse.onLockLost?.();
    letGo = false;
  });
  addEventListener('mousemove', (e) => {
    if (!locked()) return;
    if (mouse.panMode) {
      panX += e.movementX;
      panY += e.movementY;
      return;
    }
    if (cfg.mouseLook === false) return;
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
  addEventListener('blur', releaseAll);

  // Once a frame: after a while without moving, the head eases back to the front (or at once, with
  // mouse look switched off).
  mouse.update = (dt) => {
    idle += dt;
    const back = cfg.mouseLook === false || (cfg.lookReturnOn !== false && idle > (cfg.lookReturn ?? 10));
    if (back) {
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
