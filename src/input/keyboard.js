// Turns held keys into a simulation command.
// A/D rotate the plane on screen: A counter-clockwise, D clockwise, regardless of direction or roll.
export const DEFAULT_BINDINGS = {
  turnCcw: ['KeyA'],
  turnCw: ['KeyD'],
  throttleUp: ['KeyW'],
  throttleDown: ['KeyS'],
  roll: ['ShiftLeft'],
  fire: ['Space'],
  bomb: ['KeyE'],
  gear: ['KeyG'],
  lookUp: ['ArrowUp'],
  lookDown: ['ArrowDown'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
};

const NO_SCROLL = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const held = new Set();
let attached = false;

function attach() {
  if (attached) return;
  attached = true;
  addEventListener('keydown', (e) => {
    held.add(e.code);
    if (NO_SCROLL.has(e.code)) e.preventDefault(); // stop these keys scrolling the page
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());
}

export function createKeyboard(bindings = DEFAULT_BINDINGS) {
  attach();
  const any = (codes) => codes.some((c) => held.has(c));
  return {
    held: (code) => held.has(code),
    read() {
      return {
        turn: (any(bindings.turnCcw) ? 1 : 0) - (any(bindings.turnCw) ? 1 : 0),
        throttle: (any(bindings.throttleUp) ? 1 : 0) - (any(bindings.throttleDown) ? 1 : 0),
        roll: any(bindings.roll),
        fire: any(bindings.fire),
        bomb: any(bindings.bomb),
        gear: any(bindings.gear),
      };
    },
    // Arrow-key look, in the same form as mouse look: a vector of length 0..1, y down. Held keys
    // look all the way; the camera's spring eases the head round.
    readLook() {
      let x = (any(bindings.lookRight) ? 1 : 0) - (any(bindings.lookLeft) ? 1 : 0);
      let y = (any(bindings.lookDown) ? 1 : 0) - (any(bindings.lookUp) ? 1 : 0);
      if (x && y) {
        x *= Math.SQRT1_2;
        y *= Math.SQRT1_2;
      }
      return { active: x !== 0 || y !== 0, x, y };
    },
  };
}
