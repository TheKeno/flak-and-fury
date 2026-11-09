// The in-game hangar: a panel over the game (H) to choose plane, bombs and guns. The layout is hangar-view.js (shared
// with hangar.html), the rules hangar-logic.js; this only holds the game state and reports:
// on.choose({ defId, loadout, guns }) goes to changeSeat (or the seat message online).
import { loadImage, paintSprite } from '../render/sprites.js';
import { buildLoadout, rowsOf, presetsOf, presetIndex, planeIds, readSaved, writeSaved, hasBombs, gunChoiceFor, standardGuns, gunsEqual, LOADOUT_EDITING } from './hangar-logic.js';
import { validateLoadout } from '../sim/weapons.js';
import { createHangarView, HANGAR_STYLE, el } from './hangar-view.js';

const STYLE = `
.hangar-panel[hidden] { display: none; }
.hangar-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(96%, 820px); height: min(94%, 640px); background: rgba(16,18,20,.94); border: 2px solid #4a4a36; box-shadow: 6px 6px 0 #000; padding: 12px 16px; display: flex; flex-direction: column; }
` + HANGAR_STYLE;

// opts: parent, planeDefs, weapons, nations, settings (the weight shares), keyName(action), on: { choose(req),
// opened(), closed() }.
export function createHangarPanel({ parent, planeDefs, weapons, nations, settings, keyName, on }) {
  parent.append(el('style', {}, STYLE));
  const panel = el('div', { className: 'hangar-panel' });
  panel.hidden = true;
  parent.append(panel);

  let storage;
  try {
    storage = window.localStorage;
    storage.getItem('flak-hangar');
  } catch {
    const mem = new Map();
    storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  }
  let saved = readSaved(storage);

  const sprites = new Map();
  function spriteOf(id) {
    if (!sprites.has(id)) {
      const def = planeDefs[id];
      sprites.set(id, loadImage(`assets/sprites/${def.sprite}.png`)
        .then((img) => paintSprite(img, nations[def.nation].paint, { swastika: Boolean(settings.markings?.historicalSwastika) }))
        .catch(() => null));
    }
    return sprites.get(id);
  }
  const view = createHangarView({ planeDefs, weapons, nations, settings, spriteOf });

  let plane = null; // the player's plane (read only)
  let note = '';
  let lastKey = '';
  let wasEditable = false;
  const idOf = (def) => Object.keys(planeDefs).find((k) => planeDefs[k] === def);

  // Choosable: the plane is down, or standing behind the doors. Once it is pushed out the load is locked.
  const editable = () => Boolean(plane) && (plane.state === 'dead' || (plane.state === 'ground' && plane.exitPhase === 'wait'));
  const load = () => (hasBombs(plane.def) ? (plane.loadout ?? plane.def.loadout ?? []) : null);
  // The guns the plane has now as an explicit choice (null for a plane with no gun mounts).
  const gunsNow = (p) => gunChoiceFor(p.def, weapons, p.gunChoice);

  // The player's own pick for this plane, if one was saved and is allowed.
  function savedFor(id) {
    const def = planeDefs[id];
    const mine = saved.loads?.[id];
    return { loadout: hasBombs(def) && mine ? validateLoadout(def, mine, weapons) : null, guns: gunChoiceFor(def, weapons, saved.guns?.[id]) };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function choose(req) {
    note = '';
    on.choose(req);
  }
  function remember(defId, loadout, guns) {
    saved = writeSaved(storage, saved, { defId, loadout, guns: guns ?? undefined });
  }
  // A change on the plane the player has (bombs and/or guns).
  function change(c) {
    const id = idOf(plane.def);
    const loadout = c.loadout ?? load();
    const guns = LOADOUT_EDITING ? c.guns ?? gunsNow(plane) : null;
    remember(id, loadout, guns);
    choose({ defId: id, ...(loadout ? { loadout } : {}), ...(guns ? { guns } : {}) });
  }
  function pickPlane(id) {
    if (id === idOf(plane.def) || !editable()) return;
    if (!LOADOUT_EDITING) {
      // Only the plane's presets (Air-to-air first): the saved one if it is a preset, else the first.
      const d = planeDefs[id];
      const mine = savedFor(id).loadout;
      const loadout = hasBombs(d) ? (mine && presetIndex(d, mine) >= 0 ? mine : validateLoadout(d, presetsOf(d)[0].loadout, weapons) ?? []) : null;
      saved = writeSaved(storage, saved, { defId: id, loadout });
      return choose({ defId: id, ...(loadout ? { loadout } : {}) });
    }
    const def = planeDefs[id];
    const mine = savedFor(id);
    const loadout = hasBombs(def) ? mine.loadout ?? validateLoadout(def, presetsOf(def)[0].loadout, weapons) ?? [] : null;
    remember(id, loadout, mine.guns);
    choose({ defId: id, loadout, ...(mine.guns ? { guns: mine.guns } : {}) });
  }
  const step = (dir) => {
    if (!editable()) return;
    const ids = planeIds(planeDefs);
    const at = ids.indexOf(idOf(plane.def));
    pickPlane(ids[(at + dir + ids.length) % ids.length] ?? ids[0]);
  };

  function drawPanel() {
    const can = editable();
    const state = { defId: idOf(plane.def), loadout: load(), guns: gunsNow(plane), editable: can, note: can ? note : 'TOO LATE: THE PLANE IS ALREADY OUT OF THE HANGAR' };
    panel.replaceChildren(view.draw(state, {
      pickPlane, change,
      close: () => api.close(),
      closeLabel: LOADOUT_EDITING ? `${plane.hold ? 'START ENGINE' : 'CLOSE'} (${keyName('hangar')})` : plane.hold ? 'START ENGINE' : 'CLOSE',
      hint: `◀ ▶ choose plane · ${keyName('hangar')} ${plane.hold ? 'start engine' : 'close'}${LOADOUT_EDITING ? ' · 1-4 presets' : ''}`,
    }));
  }

  // Redraws only when what it shows has changed (it is asked every frame).
  function render(force = false) {
    if (!plane) return;
    const key = JSON.stringify([idOf(plane.def), load(), plane.gunChoice, editable(), panel.hidden, note, keyName('hangar'), plane.hold]);
    if (!force && key === lastKey) return;
    lastKey = key;
    if (!panel.hidden) drawPanel();
  }

  const api = {
    get isOpen() {
      return !panel.hidden;
    },
    open() {
      if (!plane || !panel.hidden) return;
      panel.hidden = false;
      on.opened?.();
      render(true);
    },
    close() {
      if (panel.hidden) return;
      panel.hidden = true;
      on.closed?.();
      render(true);
    },
    // Can the panel open now (the plane is down or behind the doors)?
    canOpen: () => editable(),
    toggle() {
      return api.isOpen ? api.close() : api.open();
    },
    // Keys while the panel is open (as KeyboardEvent.code). Returns true if it took the key.
    key(code) {
      if (panel.hidden) return false;
      if (code === 'ArrowLeft') step(-1);
      else if (code === 'ArrowRight') step(1);
      else if (LOADOUT_EDITING && /^Digit[1-4]$/.test(code) && editable()) {
        const p = presetsOf(plane.def)[Number(code.slice(5)) - 1];
        if (p) change(view.presetChange(plane.def, p));
      } else return false;
      return true;
    },
    // Once a frame: the player's plane (null when not in a game that has one).
    update(p, { started = true, blocked = false } = {}) {
      plane = p;
      const show = Boolean(p) && started && !blocked && (editable() || !panel.hidden);
      if (!p) return;
      // A new wait behind the doors (or the first one): the load saved for this plane goes on it.
      const can = editable();
      if (LOADOUT_EDITING && can && !wasEditable) {
        const id = idOf(p.def);
        const mine = savedFor(id);
        const loadoutDiffers = mine.loadout && !same(mine.loadout, p.loadout ?? p.def.loadout);
        const gunsDiffer = mine.guns && !same(mine.guns, gunsNow(p));
        if (loadoutDiffers || gunsDiffer) on.choose({ defId: id, ...(loadoutDiffers ? { loadout: mine.loadout } : {}), ...(gunsDiffer ? { guns: mine.guns } : {}) });
      }
      wasEditable = can;
      if (!show) {
        if (!panel.hidden) api.close();
        return;
      }
      render();
    },
    say(text) {
      note = text;
      render(true);
    },
  };
  return api;
}
