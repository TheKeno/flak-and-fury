// The player's options menu (title screen and the in-game pause menu): key bindings, mouse, sound,
// gunsight, HUD, view, content and online name. The choices are the player's own: kept in this
// browser (localStorage), applied over the values loaded from data/settings.json, which stay the
// defaults. They are written into the live settings objects, so the game (and the tuning panel)
// see them at once; the tuning panel's "Save to files" would save them as the new defaults.
import { ACTIONS, defaultBindings, codeName } from '../input/keyboard.js';

const STORE = 'flak-and-fury.options';

const pct = (v) => `${Math.round(v * 100)}%`;
const secs = (v) => `${v} S`;
const plain = (v) => String(v);

// Each option: [tab, id, label, kind, details]. An id with a dot is a settings path (settings.hud.x);
// 'scale' options multiply the file's value (100% = as designed). Others have their own get/set.
function optionList(settings, defaults) {
  const def = (path) => path.split('.').reduce((o, k) => o[k], defaults);
  const set = (path, v) => {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], settings)[last] = v;
  };
  const scaled = (path, min, max) => ({ kind: 'slider', min, max, step: 0.05, fmt: pct, initial: 1, set: (m) => set(path, def(path) * m) });
  return [
    ['mouse', 'camera.mouseLook', 'Mouse look', 'toggle', { help: 'Moving the mouse turns your head. Off: only the look keys do.' }],
    ['mouse', 'lookSensitivity', 'Look sensitivity', 'slider', {
      min: 0.25, max: 3, step: 0.05, fmt: pct, initial: 1,
      set: (m) => set('camera.lookSensitivity', def('camera.lookSensitivity') / m), // less travel = more sensitive
    }],
    ['mouse', 'camera.lookReturnOn', 'Look returns to the front', 'toggle', { help: 'After a while without moving the mouse, the view eases back ahead. Off: it stays where you left it.' }],
    ['mouse', 'camera.lookReturn', 'Return after', 'slider', { min: 1, max: 30, step: 1, fmt: secs, needs: 'camera.lookReturnOn' }],

    ['sound', 'master', 'Master volume', 'slider', scaled('audio.master', 0, 2)],
    ['sound', 'engine', 'Engines and wind', 'slider', scaled('audio.engine', 0, 2)],
    ['sound', 'sfx', 'Guns and explosions', 'slider', scaled('audio.sfx', 0, 2)],
    ['sound', 'ambience', 'Ambience', 'slider', scaled('audio.ambience', 0, 2)],
    ['sound', 'music', 'Music', 'slider', scaled('audio.music', 0, 2)],
    ['sound', 'audio.muteInBackground', 'Mute when the game is in the background', 'toggle', {}],

    ['sight', 'hud.crosshair', 'Show the gunsight', 'toggle', {}],
    ['sight', 'hud.crosshairStyle', 'Style', 'choice', { choices: [['ring', 'RING AND PIP'], ['circle', 'RING'], ['cross', 'CROSS'], ['dot', 'DOT']] }],
    ['sight', 'hud.crosshairSize', 'Size', 'slider', { min: 2, max: 14, step: 0.5, fmt: plain }],
    ['sight', 'hud.crosshairAlpha', 'Opacity', 'slider', { min: 0.1, max: 1, step: 0.05, fmt: pct }],
    ['sight', 'hud.crosshairColour', 'Colour', 'choice', { choices: [['#c8d8b0', 'PALE GREEN'], ['#d8b050', 'AMBER'], ['#e4e0d0', 'WHITE'], ['#c85040', 'RED']] }],
    ['sight', 'hud.crosshairRange', 'Distance ahead', 'slider', { min: 40, max: 300, step: 5, fmt: plain, help: 'How far ahead of the guns the sight sits (no lead, like a 1943 reflector sight).' }],

    ['hud', 'hud.textSize', 'Text size', 'choice', { choices: [[0.85, 'SMALL'], [1, 'NORMAL'], [1.2, 'LARGE'], [1.45, 'HUGE']] }],
    ['hud', 'hud.opacity', 'HUD opacity', 'slider', { min: 0.3, max: 1, step: 0.05, fmt: pct, help: 'Read-outs, messages and warnings. The gunsight has its own.' }],
    ['hud', 'hud.units', 'Units', 'choice', { choices: [['metric', 'KM/H, M'], ['imperial', 'MPH, FT'], ['nautical', 'KNOTS, FT']] }],
    ['hud', 'hud.showHelp', 'Show the key help at start', 'toggle', {}],
    ['hud', 'radar.outline', 'Radar outline on enemy planes', 'toggle', { help: 'Planes your radar has plotted flare green as the beam sweeps them.' }],
    ['hud', 'radar.outlineAlpha', 'Radar outline strength', 'slider', { min: 0.1, max: 1, step: 0.05, fmt: pct, needs: 'radar.outline' }],

    ['view', 'camera.shake', 'Screen shake', 'choice', { choices: [[0, 'OFF'], [0.5, 'LOW'], [1, 'NORMAL'], [1.5, 'STRONG']] }],
    ['view', 'lead', 'Camera lead', 'choice', {
      choices: [[0.5, 'LOW'], [1, 'NORMAL'], [1.5, 'HIGH']], initial: 1,
      help: 'How far the view looks ahead of the plane.',
      set: (m) => {
        set('camera.leadX', def('camera.leadX') * m);
        set('camera.leadY', def('camera.leadY') * m);
      },
    }],
    ['view', 'zoom', 'Zoom out at speed', 'choice', {
      choices: [[0, 'OFF'], [0.5, 'LOW'], [1, 'NORMAL'], [1.5, 'HIGH']], initial: 1,
      set: (m) => set('camera.zoomMax', 1 + (def('camera.zoomMax') - 1) * m),
    }],
    ['view', 'display.smooth', 'Pixel scaling', 'choice', { choices: [[false, 'SHARP'], [true, 'SMOOTH']] }],

    ['content', 'markings.historicalSwastika', 'Historical markings', 'toggle', { help: 'The swastika on German tail fins, as painted in 1943. Off: the fin is left plain.' }],
    ['content', 'gore.mode', 'Gore', 'choice', { choices: [['off', 'OFF'], ['low', 'LOW'], ['full', 'FULL']], help: 'Low: blood, stains and bodies. Full: also limbs, thrown bodies and blood on the plane and screen.' }],
  ].map(([tab, id, label, kind, d]) => {
    const path = id.includes('.') ? id : null;
    return { tab, id, label, kind, ...d, initial: d.initial ?? def(path), set: d.set ?? ((v) => set(path, v)) };
  });
}

const TABS = [
  ['controls', 'KEYS'],
  ['mouse', 'MOUSE'],
  ['sound', 'SOUND'],
  ['sight', 'GUNSIGHT'],
  ['hud', 'HUD'],
  ['view', 'VIEW'],
  ['content', 'CONTENT'],
  ['online', 'ONLINE'],
];

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

const readStore = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE)) ?? {};
  } catch {
    return {};
  }
};

// Callsigns: short, plain capitals (they're drawn in the HUD font and sent to the host).
export const cleanName = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 .'-]/g, '').slice(0, 12).trim();

export function createOptions({ settings, bindings, parent, onChange }) {
  const defaults = structuredClone(settings);
  const options = optionList(settings, defaults);
  const saved = readStore();
  const values = { ...(saved.values ?? {}) };
  let name = cleanName(saved.name);

  const valueOf = (o) => (o.id in values ? values[o.id] : o.initial);
  function store() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ values, bindings, name }));
    } catch {
      // Private window or blocked storage: the options still apply for this visit.
    }
  }
  // Older saves may hold actions that no longer exist, or miss new ones.
  if (saved.bindings) {
    for (const [id] of ACTIONS) if (Array.isArray(saved.bindings[id])) bindings[id] = [saved.bindings[id][0] ?? null, saved.bindings[id][1] ?? null];
  }
  for (const o of options) if (o.id in values) o.set(values[o.id]);

  function change(o, v) {
    if (v === o.initial) delete values[o.id];
    else values[o.id] = v;
    o.set(v);
    store();
    onChange?.(o.id);
    refresh();
  }

  // --- The menu ---
  const status = el('p', { class: 'status' });
  const body = el('div', { class: 'opt-body' });
  const tabBar = el('div', { class: 'opt-tabs' });
  let tab = 'controls';
  const tabButtons = TABS.map(([id, label]) => {
    const b = el('button', { onclick: () => show(id) }, label);
    b.dataset.tab = id;
    tabBar.append(b);
    return b;
  });
  const backBtn = el('button', { class: 'go' }, 'BACK');
  const screen = el(
    'div',
    { id: 'options', class: 'screen hidden' },
    el('h2', {}, 'OPTIONS'),
    tabBar,
    body,
    status,
    el('div', { class: 'row' },
      el('button', { onclick: () => resetTab() }, 'RESET THIS PAGE'),
      el('button', { onclick: () => resetAll() }, 'RESET ALL'),
      backBtn,
    ),
  );
  parent.append(screen);
  // Keys typed in the menu (sliders, the name box) mustn't fly the plane; the menu key still goes
  // through, to close it.
  screen.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.target instanceof HTMLInputElement) e.stopPropagation();
  });

  const say = (text, bad = false) => {
    status.textContent = text;
    status.classList.toggle('bad', bad);
  };

  let refreshers = [];
  function refresh() {
    for (const r of refreshers) r();
  }

  function row(label, control, help) {
    // A div, not a label: a click on the text would press the row's first button.
    return el('div', { class: 'opt-row', title: help ?? '' }, el('span', {}, label), control);
  }

  function optionRow(o) {
    let control;
    let update;
    if (o.kind === 'toggle') {
      control = el('button', { class: 'toggle', onclick: (e) => (e.preventDefault(), change(o, !valueOf(o))) });
      update = () => {
        control.textContent = valueOf(o) ? 'ON' : 'OFF';
        control.classList.toggle('on', Boolean(valueOf(o)));
      };
    } else if (o.kind === 'choice') {
      control = el('div', { class: 'choices' });
      const buttons = o.choices.map(([v, label]) => {
        const b = el('button', { class: 'toggle', onclick: (e) => (e.preventDefault(), change(o, v)) }, label);
        control.append(b);
        return [v, b];
      });
      update = () => {
        for (const [v, b] of buttons) b.classList.toggle('on', v === valueOf(o));
      };
    } else {
      const range = el('input', { type: 'range', min: o.min, max: o.max, step: o.step });
      const shown = el('span', { class: 'value' });
      range.addEventListener('input', () => change(o, Number(range.value)));
      control = el('div', { class: 'slider' }, range, shown);
      update = () => {
        range.value = valueOf(o);
        shown.textContent = o.fmt(valueOf(o));
      };
    }
    const r = row(o.label, control, o.help);
    refreshers.push(() => {
      update();
      // An option that only matters while another is on fades out with it off.
      if (o.needs) r.classList.toggle('off', !valueOf(options.find((n) => n.id === o.needs)));
    });
    return r;
  }

  // --- Key bindings: two slots an action. Click a slot, then press a key or mouse button. ---
  let listening = null; // { id, slot, button }
  function stopListening() {
    if (!listening) return;
    listening = null;
    removeEventListener('keydown', onCaptureKey, true);
    removeEventListener('mousedown', onCaptureMouse, true);
    refresh();
  }
  function bind(code) {
    const { id, slot } = listening;
    const old = bindings[id][slot];
    stopListening();
    if (code === old) return;
    // A key does one job: whatever had it takes this slot's old key instead (a swap).
    const moved = [];
    for (const [other] of ACTIONS) {
      bindings[other].forEach((c, i) => {
        if (c !== code || (other === id && i === slot)) return;
        bindings[other][i] = other === id ? null : old;
        if (other !== id) moved.push(other);
      });
    }
    bindings[id][slot] = code;
    store();
    onChange?.('bindings');
    const label = (a) => ACTIONS.find(([i]) => i === a)[1].toUpperCase();
    if (moved.length) say(old ? `${codeName(code)} WAS ON ${moved.map(label).join(', ')}: SWAPPED, IT HAS ${codeName(old)} NOW` : `${codeName(code)} TAKEN FROM ${moved.map(label).join(', ')}`);
    else say('');
    refresh();
  }
  function onCaptureKey(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') return stopListening();
    if (e.code === 'Backspace' || e.code === 'Delete') {
      bindings[listening.id][listening.slot] = null;
      stopListening();
      store();
      onChange?.('bindings');
      return;
    }
    bind(e.code);
  }
  function onCaptureMouse(e) {
    if (e.button > 4) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    bind(`Mouse${e.button}`);
  }
  function listen(id, slot) {
    stopListening();
    listening = { id, slot };
    say('PRESS A KEY OR MOUSE BUTTON. ESC CANCELS, BACKSPACE CLEARS THE SLOT.');
    refresh();
    // From the next press on: the click that opened the slot mustn't bind itself.
    setTimeout(() => {
      if (!listening) return;
      addEventListener('keydown', onCaptureKey, true);
      addEventListener('mousedown', onCaptureMouse, true);
    }, 0);
  }

  function controlsPage() {
    const grid = el('div', { class: 'keys' });
    for (const [id, label] of ACTIONS) {
      const slots = [0, 1].map((slot) => {
        const b = el('button', { class: 'key', onclick: (e) => (e.preventDefault(), listen(id, slot)) });
        refreshers.push(() => {
          const on = listening?.id === id && listening.slot === slot;
          b.textContent = on ? 'PRESS...' : codeName(bindings[id][slot]) || '-';
          b.classList.toggle('on', on);
          b.classList.toggle('empty', !bindings[id][slot]);
        });
        return b;
      });
      grid.append(el('span', {}, label), ...slots);
    }
    return [el('p', { class: 'fine' }, 'CLICK A SLOT, THEN PRESS A KEY OR MOUSE BUTTON. EACH ACTION HAS TWO.'), grid];
  }

  function onlinePage() {
    const box = el('input', { class: 'name', maxlength: 12, autocomplete: 'off', spellcheck: 'false', placeholder: 'NO NAME' });
    box.addEventListener('input', () => {
      const clean = cleanName(box.value);
      if (box.value.toUpperCase() !== clean) box.value = clean;
      name = clean;
      store();
      onChange?.('name');
    });
    refreshers.push(() => (box.value = name));
    return [row('Callsign', box, 'Shown to the other side online, e.g. SHOT DOWN BY <CALLSIGN>.'), el('p', { class: 'fine' }, 'TAKES EFFECT IN THE NEXT ONLINE GAME YOU JOIN OR HOST.')];
  }

  function viewExtras() {
    const b = el('button', { class: 'toggle', onclick: (e) => (e.preventDefault(), toggleFullscreen()) });
    refreshers.push(() => {
      b.textContent = document.fullscreenElement ? 'ON' : 'OFF';
      b.classList.toggle('on', Boolean(document.fullscreenElement));
    });
    return [row('Fullscreen', b, 'Esc also leaves fullscreen: the browser takes that press.')];
  }

  function show(id) {
    stopListening();
    tab = id;
    say('');
    for (const b of tabButtons) b.classList.toggle('on', b.dataset.tab === id);
    refreshers = [];
    body.replaceChildren();
    if (id === 'controls') body.append(...controlsPage());
    else if (id === 'online') body.append(...onlinePage());
    else {
      if (id === 'view') body.append(...viewExtras());
      body.append(...options.filter((o) => o.tab === id).map(optionRow));
    }
    refresh();
  }

  function resetTab() {
    if (tab === 'controls') {
      Object.assign(bindings, defaultBindings());
      onChange?.('bindings');
    } else if (tab === 'online') name = '';
    else {
      for (const o of options) {
        if (o.tab !== tab) continue;
        delete values[o.id];
        o.set(o.initial);
        onChange?.(o.id);
      }
    }
    store();
    say('THIS PAGE IS BACK TO THE DEFAULTS');
    show(tab);
  }
  function resetAll() {
    Object.assign(bindings, defaultBindings());
    for (const o of options) {
      delete values[o.id];
      o.set(o.initial);
      onChange?.(o.id);
    }
    onChange?.('bindings');
    store();
    show(tab);
    say('EVERYTHING IS BACK TO THE DEFAULTS');
  }

  document.addEventListener('fullscreenchange', refresh);

  return {
    get name() {
      return name;
    },
    get isOpen() {
      return !screen.classList.contains('hidden');
    },
    // Opens the menu; Back (or Esc) calls onBack.
    open(onBack) {
      backBtn.onclick = () => {
        close();
        onBack?.();
      };
      screen.classList.remove('hidden');
      show(tab);
    },
    close,
    back: () => backBtn.click(),
  };

  function close() {
    stopListening();
    screen.classList.add('hidden');
  }
}

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
