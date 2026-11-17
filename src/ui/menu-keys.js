// Keyboard control of the menu screens (title, setup, options, pause): the arrow keys move between the
// buttons, lists, sliders and boxes by where they sit on screen, Enter presses, Esc goes back (src/main.js).
// The first key only shows where you are (the screen's main button), so a stray press never starts a game.
// Left and right change a list's pick and a slider's value; in a text box they move the caret.

const FOCUSABLE = 'button, select, input';

// The next control from `from` in `dir` ('up', 'down', 'left', 'right'), out of `cands`; each is
// { rect: { left, top, right, bottom }, ... }. Left and right stay on the same row; up and down take the
// nearest row that way, then the control most nearly in line. Returns null if there is none.
export function pickNext(from, cands, dir) {
  const r = from.rect;
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  let best = null;
  let bestScore = Infinity;
  // Up and down: only the nearest row that way counts (anything starting within a few pixels of it).
  if (dir === 'up' || dir === 'down') {
    const gap = (q) => (dir === 'down' ? q.top - r.bottom : r.top - q.bottom);
    const ahead = cands.filter((c) => c !== from && (dir === 'down' ? (c.rect.top + c.rect.bottom) / 2 > cy : (c.rect.top + c.rect.bottom) / 2 < cy) && gap(c.rect) >= -2);
    if (!ahead.length) return null;
    const near = Math.min(...ahead.map((c) => Math.max(0, gap(c.rect))));
    cands = ahead.filter((c) => Math.max(0, gap(c.rect)) <= near + 6);
  }
  for (const c of cands) {
    if (c === from) continue;
    const q = c.rect;
    const x = (q.left + q.right) / 2;
    const y = (q.top + q.bottom) / 2;
    let score;
    if (dir === 'left' || dir === 'right') {
      // On the same row: the two overlap up and down.
      if (q.bottom <= r.top + 1 || q.top >= r.bottom - 1) continue;
      const dx = dir === 'right' ? q.left - r.right : r.left - q.right;
      if ((dir === 'right' ? x <= cx : x >= cx) || dx < -2) continue;
      score = Math.max(0, dx) + Math.abs(y - cy) * 2;
    } else {
      // In that row, the control most nearly in line.
      const gapX = Math.max(0, q.left - r.right, r.left - q.right);
      score = gapX + Math.abs(x - cx) * 0.25;
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// The menu screen in front: the visible `.screen` with the highest z-index (the last one on a tie).
function frontScreen() {
  let best = null;
  let bestZ = -Infinity;
  for (const s of document.querySelectorAll('.screen')) {
    if (s.classList.contains('hidden') || !s.getClientRects().length) continue;
    const z = Number(getComputedStyle(s).zIndex) || 0;
    if (z >= bestZ) {
      bestZ = z;
      best = s;
    }
  }
  return best;
}

// The box an element scrolls in, if any (the options page's body).
function scroller(e, screen) {
  for (let p = e.parentElement; p && p !== screen; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}

function controls(screen, current) {
  const here = current && scroller(current, screen);
  const out = [];
  for (const e of screen.querySelectorAll(FOCUSABLE)) {
    if (e.disabled || e.type === 'hidden' || !e.getClientRects().length) continue;
    if (e.closest('.hidden')) continue;
    const rect = e.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    // Something scrolled out of its box counts only from inside the same box (down the options list,
    // the next row even if it is out of view; from outside it, only what shows).
    const box = scroller(e, screen);
    if (box && box !== here) {
      const b = box.getBoundingClientRect();
      if (rect.bottom <= b.top || rect.top >= b.bottom) continue;
    }
    out.push({ e, rect, box });
  }
  return out;
}

// The screen's main button: its pulsing one if it can be pressed, else the first control.
function home(screen) {
  const all = controls(screen, null);
  return (all.find((c) => c.e.classList.contains('go')) ?? all[0])?.e ?? null;
}

// A press can redraw the screen (the setup table is drawn afresh on every change) or move to another one:
// keep the place, on the control now nearest where the old one was, if a screen is still up.
function keepPlace(old, was) {
  const screen = frontScreen();
  // Back in the game: let go of the hidden button, so flying keys (Space) can't press it.
  if (!screen) return void old.blur();
  if (screen.contains(old) && old.getClientRects().length && document.activeElement === old) return;
  if (old.isConnected) {
    // Moved on to another screen: start from its main button.
    if (!screen.contains(old)) home(screen)?.focus({ focusVisible: true });
    return;
  }
  // Redrawn: the control now where the old one was.
  const cx = (was.left + was.right) / 2;
  const cy = (was.top + was.bottom) / 2;
  let best = null;
  let bestD = Infinity;
  for (const c of controls(screen, null)) {
    const d = Math.hypot((c.rect.left + c.rect.right) / 2 - cx, (c.rect.top + c.rect.bottom) / 2 - cy);
    if (d < bestD) {
      bestD = d;
      best = c.e;
    }
  }
  (best ?? home(screen))?.focus({ focusVisible: true });
}

const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

// skip(): true while the menus must not take keys (a key being rebound in the options).
export function attachMenuKeys({ skip = () => false } = {}) {
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || skip()) return;
    const dir = DIRS[e.code];
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    if (!dir && !enter) return;
    const screen = frontScreen();
    if (!screen) return;
    const at = document.activeElement;
    const inside = at instanceof HTMLElement && screen.contains(at) && at.matches(FOCUSABLE) && !at.disabled;
    const text = inside && at instanceof HTMLInputElement && at.type !== 'range';
    const range = inside && at instanceof HTMLInputElement && at.type === 'range';

    if (!inside) {
      // The first press shows where you are.
      const h = home(screen);
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      h.focus({ focusVisible: true });
      h.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (enter) {
      // Boxes keep their own Enter (the room code's joins).
      if (text) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat && at instanceof HTMLButtonElement) {
        const was = at.getBoundingClientRect();
        at.click();
        keepPlace(at, was);
      }
      return;
    }
    // Sideways in a text box or on a slider: the box's own caret, the slider's own step.
    if ((dir === 'left' || dir === 'right') && (text || range)) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if ((dir === 'left' || dir === 'right') && at instanceof HTMLSelectElement) {
      // A list's pick steps along, as if picked with the mouse.
      const i = at.selectedIndex + (dir === 'right' ? 1 : -1);
      if (i >= 0 && i < at.options.length) {
        const was = at.getBoundingClientRect();
        at.selectedIndex = i;
        at.dispatchEvent(new Event('change', { bubbles: true }));
        keepPlace(at, was);
      }
      return;
    }
    const all = controls(screen, at);
    const from = all.find((c) => c.e === at);
    if (!from) return;
    // Inside a scrolling list, stay in it while it goes on; then leave it.
    const same = from.box ? all.filter((c) => c.box === from.box) : all;
    const next = pickNext(from, same, dir) ?? (from.box ? pickNext(from, all.filter((c) => c.box !== from.box), dir) : null);
    if (!next) return;
    next.e.focus({ focusVisible: true });
    next.e.scrollIntoView({ block: 'nearest' });
  }, true);
}
