// Turns held keys and mouse buttons into a simulation command.
// A/D rotate the plane on screen: A counter-clockwise, D clockwise, regardless of direction or roll.
// Each action has two slots (primary, secondary); null is an empty slot. Mouse buttons are the codes
// Mouse0 (left), Mouse1 (middle), Mouse2 (right), Mouse3 and Mouse4 (the side buttons): src/input/mouse.js
// presses them here while the mouse is captured. The options menu rebinds them (src/ui/options.js).
export const ACTIONS = [
  ['turnCcw', 'Rotate counter-clockwise', ['KeyA', null]],
  ['turnCw', 'Rotate clockwise', ['KeyD', null]],
  ['throttleUp', 'Throttle up', ['KeyW', null]],
  ['throttleDown', 'Throttle down', ['KeyS', null]],
  ['roll', 'Roll / turn on the ground', ['ShiftLeft', null]],
  ['fire', 'Guns', ['Space', 'Mouse0']],
  ['bomb', 'Bombs', ['KeyE', 'Mouse2']],
  ['gear', 'Landing gear', ['KeyG', null]],
  ['abandon', 'Abandon the plane', ['KeyB', null]],
  ['lookUp', 'Look up', ['ArrowUp', null]],
  ['lookDown', 'Look down', ['ArrowDown', null]],
  ['lookLeft', 'Look left', ['ArrowLeft', null]],
  ['lookRight', 'Look right', ['ArrowRight', null]],
  ['menu', 'Pause / menu', ['Escape', null]],
  ['help', 'Show / hide help', ['KeyH', null]],
  ['mute', 'Mute', ['KeyM', null]],
  ['freeLook', 'Free look (debug)', ['KeyV', null]],
  ['tuning', 'Tuning panel (debug)', ['KeyT', null]],
];

export const defaultBindings = () => Object.fromEntries(ACTIONS.map(([id, , codes]) => [id, [...codes]]));

const NO_SCROLL = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const held = new Set();
const pressListeners = [];
let attached = false;

// A key or mouse button went down (not a key repeat): held, and told to whoever listens.
export function press(code, e) {
  held.add(code);
  for (const fn of pressListeners) fn(code, e);
}
export function release(code) {
  held.delete(code);
}

function attach() {
  if (attached) return;
  attached = true;
  addEventListener('keydown', (e) => {
    if (NO_SCROLL.has(e.code)) e.preventDefault(); // stop these keys scrolling the page
    if (e.repeat) held.add(e.code);
    else press(e.code, e);
  });
  addEventListener('keyup', (e) => release(e.code));
  addEventListener('blur', () => held.clear());
}

// Names shown for codes: letters as the keyboard's own layout prints them where the browser can say
// (so a Swedish board shows Ö, not ;), the rest spelt out.
const NAMES = {
  Space: 'SPACE', ShiftLeft: 'L.SHIFT', ShiftRight: 'R.SHIFT', ControlLeft: 'L.CTRL', ControlRight: 'R.CTRL',
  AltLeft: 'L.ALT', AltRight: 'R.ALT', MetaLeft: 'L.WIN', MetaRight: 'R.WIN', Enter: 'ENTER', Tab: 'TAB',
  Escape: 'ESC', Backspace: 'BACKSPACE', CapsLock: 'CAPS', ArrowUp: 'UP', ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Mouse0: 'L.MOUSE', Mouse1: 'M.MOUSE', Mouse2: 'R.MOUSE',
  Mouse3: 'MOUSE 4', Mouse4: 'MOUSE 5',
};
let layout = null;
navigator.keyboard?.getLayoutMap?.().then((m) => (layout = m)).catch(() => {});
export function codeName(code) {
  if (!code) return '';
  if (NAMES[code]) return NAMES[code];
  const printed = layout?.get(code);
  if (printed && printed.trim()) return printed.toUpperCase();
  return code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'NUM ').toUpperCase();
}

export function createKeyboard(bindings = defaultBindings()) {
  attach();
  const any = (codes) => codes.some((c) => c && held.has(c));
  return {
    bindings,
    held: (code) => held.has(code),
    // Which actions a code is bound to.
    actionsOf: (code) => Object.keys(bindings).filter((id) => bindings[id].includes(code)),
    onPress: (fn) => pressListeners.push(fn),
    // The keys of an action for on-screen hints: 'G', or 'SPACE/L.MOUSE'.
    keyName: (id) => (bindings[id] ?? []).filter(Boolean).map(codeName).join('/') || '(UNBOUND)',
    read() {
      return {
        turn: (any(bindings.turnCcw) ? 1 : 0) - (any(bindings.turnCw) ? 1 : 0),
        throttle: (any(bindings.throttleUp) ? 1 : 0) - (any(bindings.throttleDown) ? 1 : 0),
        roll: any(bindings.roll),
        fire: any(bindings.fire),
        bomb: any(bindings.bomb),
        gear: any(bindings.gear),
        abandon: any(bindings.abandon),
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
