// The player's options menu (title screen and the in-game pause menu): key bindings, a few general
// choices and the gunsight and names on the HUD. The rest (camera, shake, mouse, units) are design
// decisions, set in data/settings.json and the tuning panel only. The choices are the player's own: kept in this
// browser (localStorage), applied over the values loaded from data/settings.json, which stay the
// defaults. They are written into the live settings objects, so the game (and the tuning panel)
// see them at once; the tuning panel's "Save to files" would save them as the new defaults.
import { drawSightShape } from '../render/sight.js';
import { ACTIONS, defaultBindings, codeName, wheelCode } from '../input/keyboard.js';

const STORE = 'flak-and-fury.options';

const pct = (v) => `${Math.round(v * 100)}%`;
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
    ['general', 'master', 'Master volume', 'slider', scaled('audio.master', 0, 2)],
    ['general', 'music', 'Music', 'slider', scaled('audio.music', 0, 2)],
    ['general', 'audio.muteInBackground', 'Mute when the game is in the background', 'toggle', {}],
    ['general', 'camera.fightOn', 'Dogfight camera', 'toggle', { help: 'With enemy planes near, the view moves and widens to keep them in frame.' }],
    ['general', 'markings.historicalSwastika', 'Historical markings', 'toggle', { help: 'The swastika on German tail fins, as painted in 1943. Off: the fin is left plain.' }],
    ['general', 'gore.mode', 'Gore', 'choice', { choices: [['off', 'OFF'], ['low', 'LOW'], ['full', 'FULL']], help: 'Low: blood, stains and bodies. Full: also limbs, thrown bodies and blood on the plane and screen.' }],

    ['hud', 'hud.crosshair', 'Show the gunsight', 'toggle', {}],
    ['hud', 'hud.crosshairStyle', 'Gunsight style', 'choice', { choices: [['ring', 'RING AND PIP'], ['circle', 'RING'], ['cross', 'CROSS'], ['dot', 'DOT']], needs: 'hud.crosshair' }],
    ['hud', 'hud.crosshairColour', 'Gunsight colour', 'choice', { choices: [['#c8d8b0', 'PALE GREEN'], ['#d8b050', 'AMBER'], ['#e4e0d0', 'WHITE'], ['#c85040', 'RED']], needs: 'hud.crosshair' }],
    ['hud', 'hud.crosshairAlpha', 'Gunsight opacity', 'slider', { min: 0.1, max: 1, step: 0.05, fmt: pct, needs: 'hud.crosshair' }],
    ['hud', 'hud.crosshairRange', 'Gunsight distance ahead', 'slider', { min: 40, max: 300, step: 5, fmt: plain, needs: 'hud.crosshair', help: 'How far ahead of the guns the sight sits (no lead, like a 1943 reflector sight).' }],
    ['hud', 'hud.showNames', 'Pilot names on planes', 'toggle', { help: "Other players' names along their planes." }],
    ['hud', 'hud.showOwnName', 'Your own name too', 'toggle', { needs: 'hud.showNames' }],
  ].map(([tab, id, label, kind, d]) => {
    const path = id.includes('.') ? id : null;
    return { tab, id, label, kind, ...d, initial: d.initial ?? def(path), set: d.set ?? ((v) => set(path, v)) };
  });
}

const TABS = [
  ['general', 'GENERAL'],
  ['controls', 'KEYS'],
  ['hud', 'HUD'],
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
  // Choices saved for options that have since been taken out of the menu fall back to the files.
  for (const id of Object.keys(values)) if (!options.some((o) => o.id === id)) delete values[id];
  let name = cleanName(saved.name);
  let nameBox = null;

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
    // An action added after the save takes its default key from any older action that saved the same key
    // (H became the hangar, help moved to F1); that action goes back to its own default.
    const fresh = defaultBindings();
    for (const [id] of ACTIONS) {
      if (Array.isArray(saved.bindings[id])) continue;
      for (const [other] of ACTIONS) {
        if (other === id || !Array.isArray(saved.bindings[other])) continue;
        bindings[other] = bindings[other].map((c, i) => (c && fresh[id].includes(c) ? (fresh[other][i] !== c && !fresh[id].includes(fresh[other][i]) ? fresh[other][i] : null) : c));
      }
    }
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
  let tab = 'general';
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
    nameRow(),
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
    removeEventListener('wheel', onCaptureWheel, true);
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
  function onCaptureWheel(e) {
    if (!e.deltaY) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    bind(wheelCode(e.deltaY));
  }
  function listen(id, slot) {
    stopListening();
    listening = { id, slot };
    say('PRESS A KEY, MOUSE BUTTON OR TURN THE WHEEL. ESC CANCELS, BACKSPACE CLEARS THE SLOT.');
    refresh();
    // From the next press on: the click that opened the slot mustn't bind itself.
    setTimeout(() => {
      if (!listening) return;
      addEventListener('keydown', onCaptureKey, true);
      addEventListener('mousedown', onCaptureMouse, true);
      addEventListener('wheel', onCaptureWheel, { capture: true, passive: false });
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
    return [el('p', { class: 'fine' }, 'CLICK A SLOT, THEN PRESS A KEY, MOUSE BUTTON OR TURN THE WHEEL. EACH ACTION HAS TWO.'), grid];
  }

  // Your pilot name: above the tabs, always in view, the same name as the title screen's box.
  function nameRow() {
    nameBox = el('input', { class: 'name', maxlength: 12, autocomplete: 'off', spellcheck: 'false', placeholder: 'NO NAME' });
    nameBox.value = name;
    nameBox.addEventListener('input', () => setName(nameBox.value));
    return el('div', { class: 'opt-row', title: 'Shown along your plane to other players, and in SHOT DOWN BY messages.' }, el('span', {}, 'Pilot name'), nameBox);
  }
  function setName(text) {
    name = cleanName(text);
    store();
    onChange?.('name');
  }

  function viewExtras() {
    const b = el('button', { class: 'toggle', onclick: (e) => (e.preventDefault(), toggleFullscreen()) });
    refreshers.push(() => {
      b.textContent = document.fullscreenElement ? 'ON' : 'OFF';
      b.classList.toggle('on', Boolean(document.fullscreenElement));
    });
    return [row('Fullscreen', b, 'Hold Esc to leave fullscreen; a tap opens the menu (Chrome and Edge; elsewhere a tap leaves it).')];
  }

  // A dark strip with a nose marker and the gunsight at its set distance, redrawn on every change,
  // so the gunsight can be seen while it is edited (the game behind the menu is hidden).
  function sightPreview() {
    const cv = el('canvas', { class: 'sight-preview', width: 240, height: 80, title: 'Preview of your gunsight' });
    const g = cv.getContext('2d');
    refreshers.push(() => {
      const cfg = settings.hud;
      g.setTransform(4, 0, 0, 4, 0, 0);
      g.fillStyle = '#1c2024';
      g.fillRect(0, 0, 60, 20);
      g.fillStyle = '#2a2c24';
      g.fillRect(0, 14, 60, 6);
      // The plane's nose on the left; the sight sits ahead of it in proportion to the range.
      g.fillStyle = '#3c4038';
      g.fillRect(0, 8, 7, 3);
      if (!cfg.crosshair || cfg.crosshairAlpha <= 0) return;
      drawSightShape(g, 8 + (cfg.crosshairRange / 300) * 46, 9.5, cfg);
    });
    return cv;
  }

  function show(id) {
    stopListening();
    tab = id;
    say('');
    for (const b of tabButtons) b.classList.toggle('on', b.dataset.tab === id);
    refreshers = [];
    body.replaceChildren();
    if (id === 'controls') body.append(...controlsPage());
    else {
      if (id === 'general') body.append(...viewExtras());
      const rows = options.filter((o) => o.tab === id).map(optionRow);
      // The preview goes just above the first gunsight row.
      const at = options.filter((o) => o.tab === id).findIndex((o) => o.id === 'hud.crosshair');
      if (at >= 0) rows.splice(at, 0, sightPreview());
      body.append(...rows);
    }
    refresh();
  }

  function resetTab() {
    if (tab === 'controls') {
      Object.assign(bindings, defaultBindings());
      onChange?.('bindings');
    } else {
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
    setName(text) {
      setName(text);
      nameBox.value = name;
    },
    get isOpen() {
      return !screen.classList.contains('hidden');
    },
    // Opens the menu; Back (or Esc) calls onBack.
    open(onBack) {
      nameBox.value = name;
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

// Fullscreen through the game (not the browser's own F11) can claim Esc with the Keyboard Lock API
// (Chrome, Edge): a tap then reaches the game and opens the menu, and only holding Esc leaves
// fullscreen. Elsewhere (Firefox) Esc still leaves fullscreen and the menu opens as it ends; the game
// remembers it was wanted and goes back on the next click (Resume, or clicking the game).
let fullscreenWanted = false;
const enterFullscreen = () =>
  document.documentElement.requestFullscreen?.()
    .then(() => navigator.keyboard?.lock?.(['Escape']))
    .catch(() => {}) ?? Promise.resolve();

export function toggleFullscreen() {
  fullscreenWanted = !document.fullscreenElement;
  if (fullscreenWanted) return enterFullscreen();
  navigator.keyboard?.unlock?.();
  return document.exitFullscreen?.().catch(() => {});
}

// Back into fullscreen if it was turned on in the game and left without the player turning it off.
// Only works from a click or a key other than Esc (browsers ask for that). Null when there's nothing to do.
export function restoreFullscreen() {
  if (!fullscreenWanted || document.fullscreenElement) return null;
  return enterFullscreen();
}
