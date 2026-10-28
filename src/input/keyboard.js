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
};

const held = new Set();
let attached = false;

function attach() {
  if (attached) return;
  attached = true;
  addEventListener('keydown', (e) => {
    held.add(e.code);
    if (e.code === 'Space') e.preventDefault(); // stop Space scrolling the page
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());
}

export function createKeyboard(bindings = DEFAULT_BINDINGS) {
  attach();
  const any = (codes) => codes.some((c) => held.has(c));
  return {
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
  };
}
