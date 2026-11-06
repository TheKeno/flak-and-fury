// The hangar layout, drawn once for both hangar.html and the in-game panel (hangar-panel.js) so they cannot drift.
// It only draws and reports; the rules are in hangar-logic.js. Sections: PLANES list (left, grouped by role, sorted by
// nation), then presets and BOMBS / GUNS / ENGINE on the right, and a footer with the weight bar and effect lines.
// All the look is in HANGAR_STYLE, so it is easy to change.
import {
  hardpointChoices, buildLoadout, rowsOf, presetsOf, presetIndex, effects, describeEffects, planeIds, loadKg, hasBombs,
  gunRows, buildGuns, gunKg, standardKg, hasGunOptions, standardGuns, gunsEqual, groupPlanes,
} from './hangar-logic.js';

export const HANGAR_STYLE = `
.hv { display: flex; flex-direction: column; min-height: 0; height: 100%; font: 13px/1.35 'Courier New', monospace; color: #c4c5bb; user-select: none; }
.hv .head { padding: 0 0 6px; }
.hv h2 { margin: 0 0 2px; font-size: 17px; color: #a8905c; font-weight: normal; }
.hv h3 { margin: 12px 0 4px; font-size: 12px; color: #a8905c; font-weight: normal; border-bottom: 1px solid #2c3135; }
.hv .dim { color: #7f837c; }
.hv .body { flex: 1; min-height: 0; display: flex; gap: 12px; }
.hv * { scrollbar-color: #3a4046 #181b1e; scrollbar-width: thin; }
.hv .planes { width: 230px; flex: none; overflow: auto; border-right: 1px solid #2c3135; padding-right: 8px; }
.hv .planes h4 { margin: 8px 0 3px; font-size: 11px; color: #7f837c; font-weight: normal; text-transform: uppercase; }
.hv .planes h4:first-child { margin-top: 0; }
.hv .card { display: flex; align-items: center; gap: 8px; width: 100%; margin: 0 0 3px; padding: 3px 6px; text-align: left; }
.hv .card canvas { width: 64px; height: 28px; flex: none; object-fit: contain; image-rendering: pixelated; }
.hv .card .sub { color: #7f837c; font-size: 11px; }
.hv .card.sel { border-color: #a8905c; }
.hv .opts { flex: 1; min-width: 0; overflow: auto; padding-right: 4px; }
.hv .row { display: flex; align-items: center; gap: 6px; margin: 4px 0; flex-wrap: wrap; }
.hv .hp { display: grid; grid-template-columns: 100px 1fr 64px 100px; gap: 6px; align-items: center; margin: 3px 0; }
.hv button, .hv select { font: inherit; color: #c4c5bb; background: #22262a; border: 1px solid #2c3135; border-radius: 2px; padding: 2px 8px; }
.hv button { cursor: pointer; }
.hv button:hover:not(:disabled) { border-color: #a8905c; }
.hv button:disabled, .hv select:disabled { opacity: .45; cursor: default; }
.hv button.on { background: #a8905c; color: #111; }
.hv .foot { border-top: 1px solid #2c3135; margin-top: 8px; padding-top: 6px; }
.hv .bar { height: 12px; background: #22262a; border: 1px solid #2c3135; position: relative; }
.hv .bar i { position: absolute; inset: 0 auto 0 0; background: #a8905c; }
.hv .bar i.full { background: #a8603f; }
.hv .fx { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; margin: 4px 0 0; padding: 0; list-style: none; }
.hv li.bad { color: #a8603f; }
.hv li.ok { color: #6f8560; }
.hv .note { color: #a8603f; margin-top: 4px; }
`;

export const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const num = (v) => (v < 10 ? v.toFixed(2) : Math.round(v)); // turn rate is in radians a second
const AMMO_STEPS = [1, 0.75, 0.5, 0.25];

// deps: planeDefs, weapons, nations, settings, spriteOf(id) -> Promise<canvas|null>.
// view.draw(state, h) returns the element to put in the page.
//   state: { defId, loadout (list or null), guns (explicit choice or null = standard), editable, note, title? , footer? }
//   h: { pickPlane(id), change({ loadout?, guns? }), close? , closeLabel? }
export function createHangarView({ planeDefs, weapons, nations, settings, spriteOf }) {
  const cards = new Map(); // one canvas per plane, drawn when its sprite is ready, reused between redraws

  function card(id, sel, can, h) {
    const def = planeDefs[id];
    let canvas = cards.get(id);
    if (!canvas) {
      canvas = el('canvas');
      cards.set(id, canvas);
      spriteOf?.(id).then((src) => {
        if (!src) return;
        canvas.width = src.width;
        canvas.height = src.height;
        canvas.getContext('2d').drawImage(src, 0, 0);
      });
    }
    return el('button', { className: `card${sel ? ' sel' : ''}`, disabled: !can, onclick: () => h.pickPlane(id) }, canvas,
      el('span', {}, def.name, el('div', { className: 'sub' }, nations[def.nation]?.name ?? def.nation)));
  }

  function planeList(state, h) {
    const list = el('div', { className: 'planes' });
    for (const g of groupPlanes(planeDefs)) {
      list.append(el('h4', {}, g.group), ...g.ids.map((id) => card(id, id === state.defId, state.editable, h)));
    }
    return list;
  }

  function presetsRow(def, state, h, idxBombs, idxGuns) {
    const presets = presetsOf(def);
    return el('div', { className: 'row' }, ...presets.map((p, i) =>
      el('button', {
        disabled: !state.editable,
        className: i === state.presetIndex ? 'on' : '',
        title: `key ${i + 1}`,
        onclick: () => h.change(presetChange(def, p)),
      }, `${i + 1} ${p.name}`)));
  }

  function bombsSection(def, state, h) {
    const l = state.loadout;
    const rows = rowsOf(def, l);
    const out = [el('h3', {}, 'BOMBS')];
    for (const hp of def.hardpoints) {
      const { cap, bombs } = hardpointChoices(def, hp, weapons);
      const row = rows.find((r) => r.hardpoint === hp.id);
      const commit = (keep) => h.change({ loadout: buildLoadout(def, rows, weapons, keep) ?? [] });
      const weapon = el('select', { disabled: !state.editable, onchange: (e) => { row.weapon = e.target.value || null; row.count = row.weapon ? Math.max(1, row.count || cap) : 0; commit(hp.id); } },
        el('option', { value: '' }, '(empty)'),
        ...bombs.map((b) => el('option', { value: b.id, selected: b.id === row.weapon }, `${b.name} · ${b.weight} kg`)));
      const count = el('select', { disabled: !state.editable || !row.weapon, onchange: (e) => { row.count = Number(e.target.value); commit(hp.id); } },
        ...Array.from({ length: cap }, (_, i) => el('option', { value: i + 1, selected: i + 1 === row.count }, `x ${i + 1}`)));
      out.push(el('div', { className: 'hp' }, el('span', {}, hp.id, el('div', { className: 'dim' }, `max ${hp.maxKg} kg`)), weapon, count, el('span')));
    }
    return out;
  }

  function gunsSection(def, state, h) {
    const rows = gunRows(def, weapons, state.guns);
    const out = [el('h3', {}, 'GUNS')];
    const commit = () => h.change({ guns: buildGuns(def, rows, weapons) ?? [] });
    for (const r of rows) {
      const full = (w) => weapons[w]?.ammo ?? 0;
      const opt = r.options.find((o) => o.weapon === r.weapon) ?? r.options[0];
      const weapon = el('select', { disabled: !state.editable, onchange: (e) => {
        const w = e.target.value;
        r.weapon = w || null;
        const o = r.options.find((x) => x.weapon === w);
        r.count = o ? Math.min(Math.max(1, r.count || o.max), o.max) : 0;
        r.ammo = o ? full(w) : 0;
        commit();
      } },
      el('option', { value: '' }, '(none)'),
      ...r.options.map((o) => el('option', { value: o.weapon, selected: o.weapon === r.weapon }, `${o.name}${o.mountKg ? ` (+pod ${o.mountKg} kg)` : ''}`)));
      const count = el('select', { disabled: !state.editable || !r.weapon, onchange: (e) => { r.count = Number(e.target.value); commit(); } },
        ...Array.from({ length: opt.max }, (_, i) => el('option', { value: i + 1, selected: i + 1 === r.count }, `x ${i + 1}`)));
      const have = r.weapon ? r.ammo / full(r.weapon) : 1;
      const pct = AMMO_STEPS.reduce((best, x) => (Math.abs(x - have) < Math.abs(best - have) ? x : best), 1);
      const ammo = el('select', { disabled: !state.editable || !r.weapon, title: 'ammunition', onchange: (e) => { r.ammo = Math.max(1, Math.round(full(r.weapon) * Number(e.target.value))); commit(); } },
        ...AMMO_STEPS.map((s) => el('option', { value: s, selected: s === pct }, `ammo ${Math.round(s * 100)}%`)));
      out.push(el('div', { className: 'hp' }, el('span', {}, r.mount, el('div', { className: 'dim' }, r.standard.count ? `standard ${r.standard.count}` : 'extra')), weapon, count, ammo));
    }
    return out;
  }

  function footer(def, state) {
    const kids = [];
    const l = state.loadout ?? [];
    const kg = loadKg(l, weapons);
    const max = def.maxLoad ?? 0;
    const gunDelta = gunKg(def, state.guns, weapons) - standardKg(def, weapons);
    const sign = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;
    const parts = [];
    if (hasBombs(def)) parts.push(max ? `bombs ${Math.round(kg)} of ${max} kg` : `bombs ${Math.round(kg)} kg`);
    if (Math.abs(gunDelta) >= 0.5) parts.push(`guns and ammo ${sign(gunDelta)} kg`);
    kids.push(el('div', { className: 'row dim' }, parts.join(' · ') || 'Standard fit'));
    if (max) kids.push(el('div', { className: 'bar' }, el('i', { className: kg >= max ? 'full' : '', style: `width:${Math.min(100, (kg / max) * 100)}%` })));
    const fx = effects(def, l, weapons, settings.weight, state.guns).filter((x) => Math.abs(x.change) >= 0.0005);
    const words = describeEffects(fx);
    const lines = fx.map((x, i) => el('li', { className: (x.goodWhenHigher ? x.change < 0 : x.change > 0) ? 'bad' : 'ok' }, `${words[i]}: ${num(x.base)} → ${num(x.now)}`));
    const fewer = gunsLess(def, state.guns, weapons);
    if (fewer) lines.push(el('li', { className: 'bad' }, fewer));
    kids.push(el('ul', { className: 'fx' }, ...(lines.length ? lines : [el('li', { className: 'ok' }, words[0])])));
    return kids;
  }

  // Rebuilds the layout from the state. Cheap enough to call on every change.
  function draw(state, h) {
    const def = planeDefs[state.defId];
    const withBombs = hasBombs(def) && state.loadout;
    const s = { ...state, presetIndex: presetState(def, state) };
    const opts = el('div', { className: 'opts' });
    opts.append(el('h3', {}, 'PRESETS'), presetsRow(def, s, h));
    if (withBombs) opts.append(...bombsSection(def, s, h));
    if (gunRows(def, weapons, null).length) opts.append(...gunsSection(def, s, h));
    // ENGINE: shown only where the plane really had a choice; none have data yet.
    if (!withBombs && !gunRows(def, weapons, null).length) opts.append(el('div', { className: 'dim' }, 'Nothing to change on this plane.'));
    const foot = el('div', { className: 'foot' }, ...footer(def, s));
    if (state.note) foot.append(el('div', { className: 'note' }, state.note));
    if (h.close) foot.append(el('div', { className: 'row' }, el('button', { onclick: h.close }, h.closeLabel ?? 'CLOSE'), el('span', { className: 'dim' }, h.hint ?? '')));
    const head = el('div', { className: 'head' }, el('h2', {}, def.name),
      el('div', { className: 'dim' }, `${nations[def.nation]?.name ?? def.nation} · ${def.role ?? ''}${def.emptyWeight ? ` · empty ${def.emptyWeight} kg` : ''}`));
    return el('div', { className: 'hv' }, head, el('div', { className: 'body' }, planeList(s, h), opts), foot);
  }

  // A preset is both bombs and guns: its `guns` (default: the standard fit).
  function presetChange(def, p) {
    const change = {};
    if (hasBombs(def)) change.loadout = buildLoadout(def, rowsOf(def, p.loadout), weapons, null) ?? [];
    const g = buildGuns(def, gunRows(def, weapons, p.guns ?? null), weapons);
    if (g) change.guns = g;
    return change;
  }
  function presetState(def, state) {
    const presets = presetsOf(def);
    const idx = presets.findIndex((p) => {
      if (hasBombs(def) && state.loadout && presetIndex({ ...def, loadoutPresets: [p] }, state.loadout) !== 0) return false;
      const want = buildGuns(def, gunRows(def, weapons, p.guns ?? null), weapons) ?? [];
      return gunsEqual(want, state.guns ?? standardGuns(def, weapons));
    });
    return idx;
  }

  return { draw, presetChange };
}

// Words for fewer guns than the standard fit (firepower is not in the flight numbers).
function gunsLess(def, guns, weapons) {
  if (!guns) return '';
  const std = standardGuns(def, weapons);
  const n = (list) => list.reduce((t, g) => t + g.count, 0);
  const rounds = (list) => list.reduce((t, g) => t + g.count * (g.ammo ?? 0), 0);
  const d = n(guns) - n(std);
  if (!guns.length) return 'No guns: lighter, but no firepower';
  if (d < 0) return `${d} gun${d === -1 ? '' : 's'}: lighter, less firepower`;
  if (rounds(guns) < rounds(std)) return 'Less ammunition: lighter, fewer rounds';
  return '';
}
