// The in-game hangar: a compact strip while your plane waits (dead, or behind the hangar doors), and a panel
// over the game (L) to choose plane and bombs. The rules are in hangar-logic.js (shared with hangar.html);
// this only draws and reports: on.choose({ defId, loadout }) goes to changeSeat (or the seat message online).
// All the look is in STYLE below, so it is easy to change.
import { hardpointChoices, buildLoadout, rowsOf, presetsOf, presetIndex, effects, describeEffects, planeIds, readSaved, writeSaved, loadKg, hasBombs } from './hangar-logic.js';
import { validateLoadout } from '../sim/weapons.js';

const STYLE = `
.hangar-strip, .hangar-panel { position: absolute; font: 13px/1.35 'Courier New', monospace; color: #c4c5bb; user-select: none; }
.hangar-strip { left: 50%; bottom: 4%; transform: translateX(-50%); background: rgba(16,18,20,.88); border: 1px solid #2c3135; padding: 5px 14px; cursor: pointer; white-space: nowrap; }
.hangar-strip b { color: #a8905c; font-weight: normal; }
.hangar-strip.locked { opacity: .6; cursor: default; }
.hangar-panel { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(92%, 620px); max-height: 92%; overflow: auto; background: rgba(16,18,20,.94); border: 1px solid #2c3135; padding: 12px 16px; }
.hangar-panel h2 { margin: 0 0 2px; font-size: 17px; color: #a8905c; font-weight: normal; }
.hangar-panel h3 { margin: 12px 0 4px; font-size: 12px; color: #a8905c; font-weight: normal; border-bottom: 1px solid #2c3135; }
.hangar-panel .dim { color: #7f837c; }
.hangar-panel .row { display: flex; align-items: center; gap: 6px; margin: 4px 0; flex-wrap: wrap; }
.hangar-panel .hp { display: grid; grid-template-columns: 110px 1fr 70px; gap: 6px; align-items: center; margin: 3px 0; }
.hangar-panel button, .hangar-panel select { font: inherit; color: #c4c5bb; background: #22262a; border: 1px solid #2c3135; border-radius: 2px; padding: 2px 8px; }
.hangar-panel button { cursor: pointer; }
.hangar-panel button:hover:not(:disabled) { border-color: #a8905c; }
.hangar-panel button:disabled, .hangar-panel select:disabled { opacity: .45; cursor: default; }
.hangar-panel button.on { background: #a8905c; color: #111; }
.hangar-panel .bar { height: 12px; background: #22262a; border: 1px solid #2c3135; position: relative; }
.hangar-panel .bar i { position: absolute; inset: 0 auto 0 0; background: #a8905c; }
.hangar-panel .bar i.full { background: #a8603f; }
.hangar-panel ul { margin: 4px 0; padding-left: 18px; }
.hangar-panel li.bad { color: #a8603f; }
.hangar-panel li.ok { color: #6f8560; }
.hangar-panel .note { color: #a8603f; margin-top: 6px; }
`;

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const num = (v) => (v < 10 ? v.toFixed(2) : Math.round(v)); // turn rate is in radians a second

// opts: parent, planeDefs, weapons, nations, settings (the weight shares), keyName(action), on: { choose(req),
// opened(), closed() }.
export function createHangarPanel({ parent, planeDefs, weapons, nations, settings, keyName, on }) {
  parent.append(el('style', {}, STYLE));
  const strip = el('div', { className: 'hangar-strip' });
  const panel = el('div', { className: 'hangar-panel' });
  strip.hidden = panel.hidden = true;
  parent.append(strip, panel);

  let storage;
  try {
    storage = window.localStorage;
    storage.getItem('flak-hangar');
  } catch {
    const mem = new Map();
    storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  }
  let saved = readSaved(storage);

  let plane = null; // the player's plane (read only)
  let nation = '';
  let note = '';
  let lastKey = '';
  let wasEditable = false;
  const idOf = (def) => Object.keys(planeDefs).find((k) => planeDefs[k] === def);

  // Choosable: the plane is down, or standing behind the doors. Once it is pushed out the load is locked.
  const editable = () => Boolean(plane) && (plane.state === 'dead' || (plane.state === 'ground' && plane.exitPhase === 'wait'));
  const load = () => (hasBombs(plane.def) ? (plane.loadout ?? plane.def.loadout ?? []) : null);

  // The player's own pick for this plane, if one was saved and is allowed.
  function savedLoadFor(id) {
    const def = planeDefs[id];
    const mine = saved.loads?.[id];
    return hasBombs(def) && mine ? validateLoadout(def, mine, weapons) : null;
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function choose(req) {
    note = '';
    on.choose(req);
  }
  function remember(defId, loadout) {
    saved = writeSaved(storage, saved, { defId, loadout });
  }
  function pickLoad(rows, keep) {
    const def = plane.def;
    const loadout = buildLoadout(def, rows, weapons, keep) ?? [];
    remember(idOf(def), loadout);
    choose({ defId: idOf(def), loadout });
  }
  function pickPlane(id) {
    if (id === idOf(plane.def)) return;
    const def = planeDefs[id];
    const loadout = hasBombs(def) ? savedLoadFor(id) ?? validateLoadout(def, presetsOf(def)[0].loadout, weapons) ?? [] : null;
    remember(id, loadout);
    choose({ defId: id, loadout });
  }
  const step = (dir) => {
    if (!editable()) return;
    const ids = planeIds(planeDefs, nation);
    const at = ids.indexOf(idOf(plane.def));
    pickPlane(ids[(at + dir + ids.length) % ids.length] ?? ids[0]);
  };

  function drawStrip() {
    const can = editable();
    strip.className = `hangar-strip${can ? '' : ' locked'}`;
    const l = load();
    const kg = l ? Math.round(loadKg(l, weapons)) : 0;
    strip.replaceChildren(el('b', {}, `${keyName('hangar')} `), `HANGAR: ${plane.def.name}${l ? ` · ${kg} kg` : ''}`);
  }

  function drawPanel() {
    const def = plane.def;
    const id = idOf(def);
    const can = editable();
    const l = load();
    const kids = [];
    kids.push(el('h2', {}, def.name), el('div', { className: 'dim' }, `${nations[def.nation]?.name ?? def.nation} · ${def.role ?? ''}`));

    // Plane: previous / next, the full list, a nation filter.
    const ids = planeIds(planeDefs, nation);
    if (!ids.includes(id)) ids.unshift(id);
    kids.push(el('h3', {}, 'PLANE'));
    kids.push(el('div', { className: 'row' },
      el('button', { disabled: !can, onclick: () => step(-1) }, '◀'),
      el('select', { disabled: !can, onchange: (e) => pickPlane(e.target.value) }, ...ids.map((p) => el('option', { value: p, selected: p === id }, planeDefs[p].name))),
      el('button', { disabled: !can, onclick: () => step(1) }, '▶'),
      el('select', { disabled: !can, onchange: (e) => { nation = e.target.value; render(true); } },
        el('option', { value: '' }, 'ALL NATIONS'),
        ...[...new Set(planeIds(planeDefs).map((p) => planeDefs[p].nation))].map((n) => el('option', { value: n, selected: n === nation }, nations[n]?.name ?? n)))));

    if (l) {
      const rows = rowsOf(def, l);
      const idx = presetIndex(def, l);
      kids.push(el('h3', {}, 'BOMB LOAD'));
      kids.push(el('div', { className: 'row' }, ...presetsOf(def).map((p, i) => el('button', { disabled: !can, className: i === idx ? 'on' : '', onclick: () => pickLoad(rowsOf(def, p.loadout), null) }, `${i + 1} ${p.name}`))));
      for (const hp of def.hardpoints) {
        const { cap, bombs } = hardpointChoices(def, hp, weapons);
        const row = rows.find((r) => r.hardpoint === hp.id);
        const weapon = el('select', { disabled: !can, onchange: (e) => { row.weapon = e.target.value || null; row.count = row.weapon ? Math.max(1, row.count || cap) : 0; pickLoad(rows, hp.id); } },
          el('option', { value: '' }, '(empty)'),
          ...bombs.map((b) => el('option', { value: b.id, selected: b.id === row.weapon }, `${b.name} · ${b.weight} kg`)));
        const count = el('select', { disabled: !can || !row.weapon, onchange: (e) => { row.count = Number(e.target.value); pickLoad(rows, hp.id); } },
          ...Array.from({ length: cap }, (_, i) => el('option', { value: i + 1, selected: i + 1 === row.count }, `x ${i + 1}`)));
        kids.push(el('div', { className: 'hp' }, el('span', {}, hp.id, el('div', { className: 'dim' }, `max ${hp.maxKg} kg`)), weapon, count));
      }
      const kg = loadKg(l, weapons);
      const max = def.maxLoad ?? 0;
      kids.push(el('div', { className: 'row dim' }, max ? `${Math.round(kg)} kg of ${max} kg` : `${Math.round(kg)} kg`));
      if (max) kids.push(el('div', { className: 'bar' }, el('i', { className: kg >= max ? 'full' : '', style: `width:${Math.min(100, (kg / max) * 100)}%` })));
      const fx = effects(def, l, weapons, settings.weight).filter((x) => Math.abs(x.change) >= 0.0005);
      const words = describeEffects(fx);
      kids.push(el('h3', {}, 'EFFECT'));
      kids.push(el('ul', {}, ...(fx.length
        ? fx.map((x, i) => el('li', { className: (x.goodWhenHigher ? x.change < 0 : x.change > 0) ? 'bad' : 'ok' }, `${words[i]}: ${num(x.base)} → ${num(x.now)}`))
        : [el('li', { className: 'ok' }, words[0])])));
    } else {
      kids.push(el('div', { className: 'dim' }, 'This plane carries no bombs.'));
    }
    if (!can) note = 'TOO LATE: THE PLANE IS ALREADY OUT OF THE HANGAR';
    if (note) kids.push(el('div', { className: 'note' }, note));
    kids.push(el('div', { className: 'row' }, el('button', { onclick: () => api.close() }, `${plane.hold ? 'ROLL OUT' : 'CLOSE'} (${keyName('hangar')})`),
      el('span', { className: 'dim' }, '◀ ▶ plane · 1-4 presets')));
    panel.replaceChildren(...kids);
  }

  // Redraws only when what it shows has changed (it is asked every frame).
  function render(force = false) {
    if (!plane) return;
    const l = load();
    const key = JSON.stringify([idOf(plane.def), l, editable(), panel.hidden, nation, note, keyName('hangar'), plane.hold]);
    if (!force && key === lastKey) return;
    lastKey = key;
    drawStrip();
    if (!panel.hidden) drawPanel();
  }

  strip.addEventListener('click', () => api.open());

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
      else if (/^Digit[1-4]$/.test(code) && editable()) {
        const p = presetsOf(plane.def)[Number(code.slice(5)) - 1];
        if (p && hasBombs(plane.def)) pickLoad(rowsOf(plane.def, p.loadout), null);
      } else return false;
      return true;
    },
    // Once a frame: the player's plane (null when not in a game that has one).
    update(p, { started = true, blocked = false } = {}) {
      plane = p;
      const show = Boolean(p) && started && !blocked && (editable() || !panel.hidden);
      strip.hidden = !show || !panel.hidden;
      if (!p) return;
      // A new wait behind the doors (or the first one): the load saved for this plane goes on it.
      const can = editable();
      if (can && !wasEditable) {
        const id = idOf(p.def);
        const mine = savedLoadFor(id);
        if (mine && !same(mine, p.loadout ?? p.def.loadout)) on.choose({ defId: id, loadout: mine });
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
