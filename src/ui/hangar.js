// The hangar page: choose a plane and its bomb load. Output is { defId, loadout } (what changeSeat takes; also
// window.hangarChoice and a 'hangar-choice' event for step 3 to wire in). The rules live in hangar-logic.js.
// Not connected to the game flow yet.
import { loadImage, paintSprite } from '../render/sprites.js';
import { hardpointChoices, buildLoadout, rowsOf, presetsOf, presetIndex, effects, describeEffects, planeIds, sanitizeChoice, readSaved, writeSaved, loadKg, hasBombs } from './hangar-logic.js';

const $ = (id) => document.getElementById(id);
const json = async (p) => (await fetch(p, { cache: 'no-store' })).json();
const [planeDefs, weapons, nations, settings] = await Promise.all([json('data/planes.json'), json('data/weapons.json'), json('data/nations.json'), json('data/settings.json')]);

// localStorage can be missing or refuse; the page then just forgets between visits.
let storage;
try {
  storage = window.localStorage;
  storage.getItem('flak-hangar');
} catch {
  const mem = new Map();
  storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
}
let saved = readSaved(storage);
const first = sanitizeChoice(planeDefs, weapons, saved, planeIds(planeDefs)[0]);
let defId = first.defId;
let rows = rowsOf(planeDefs[defId], first.loadout ?? []);
let nation = '';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// Painted side sprites, built once per plane.
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

function drawStrip() {
  $('strip').replaceChildren(...planeIds(planeDefs, nation).map((id) => {
    const def = planeDefs[id];
    const canvas = el('canvas');
    spriteOf(id).then((src) => {
      if (!src) return;
      canvas.width = src.width;
      canvas.height = src.height;
      canvas.getContext('2d').drawImage(src, 0, 0);
    });
    return el('button', { className: `card${id === defId ? ' sel' : ''}`, onclick: () => pick(id) }, canvas,
      el('div', {}, def.name), el('div', { className: 'sub' }, `${nations[def.nation]?.name ?? def.nation} · ${def.role ?? ''}`));
  }));
}

function pick(id) {
  defId = id;
  rows = rowsOf(planeDefs[id], sanitizeChoice(planeDefs, weapons, saved, id).loadout ?? []);
  commit();
  drawStrip();
}

// Trims the rows to what is allowed (maxLoad; `keep` is the row the player just changed), saves, draws.
function commit(keep = null) {
  const def = planeDefs[defId];
  let loadout = null;
  if (hasBombs(def)) {
    loadout = buildLoadout(def, rows, weapons, keep) ?? [];
    rows = rowsOf(def, loadout);
  }
  const choice = { defId, loadout };
  saved = writeSaved(storage, saved, choice);
  window.hangarChoice = choice;
  window.dispatchEvent(new CustomEvent('hangar-choice', { detail: choice }));
  draw(choice);
}

const num = (v) => (v < 10 ? v.toFixed(2) : Math.round(v)); // turn rate is in radians a second

function draw(choice) {
  const def = planeDefs[defId];
  $('name').textContent = def.name;
  $('meta').textContent = `${nations[def.nation]?.name ?? def.nation} · ${def.role ?? ''}${def.emptyWeight ? ` · empty ${def.emptyWeight} kg` : ''}`;

  const idx = choice.loadout ? presetIndex(def, choice.loadout) : -1;
  $('presets').replaceChildren(...(hasBombs(def)
    ? presetsOf(def).map((p, i) => el('button', { className: i === idx ? 'on' : '', onclick: () => { rows = rowsOf(def, p.loadout); commit(); } }, p.name))
    : [el('span', { className: 'dim' }, 'This plane carries no bombs.')]));

  $('hps').replaceChildren(...(def.hardpoints ?? []).map((hp) => {
    const { cap, bombs } = hardpointChoices(def, hp, weapons);
    const row = rows.find((r) => r.hardpoint === hp.id);
    const weapon = el('select', { onchange: (e) => { row.weapon = e.target.value || null; row.count = row.weapon ? Math.max(1, row.count || cap) : 0; commit(hp.id); } },
      el('option', { value: '' }, '(empty)'),
      ...bombs.map((b) => el('option', { value: b.id, selected: b.id === row.weapon }, `${b.name} · ${b.weight} kg`)));
    const count = el('select', { disabled: !row.weapon, onchange: (e) => { row.count = Number(e.target.value); commit(hp.id); } },
      ...Array.from({ length: cap }, (_, i) => el('option', { value: i + 1, selected: i + 1 === row.count }, `x ${i + 1}`)));
    return el('div', { className: 'hp' }, el('span', {}, hp.id, el('div', { className: 'dim' }, `${hp.kind} · max ${hp.maxKg} kg`)), weapon, count);
  }));

  const kg = choice.loadout ? loadKg(choice.loadout, weapons) : 0;
  const max = def.maxLoad ?? 0;
  $('kg').textContent = max ? `${Math.round(kg)} kg of ${max} kg` : 'No bomb weight limit';
  $('bar').hidden = !max;
  const fill = $('bar').firstElementChild;
  fill.style.width = `${max ? Math.min(100, (kg / max) * 100) : 0}%`;
  fill.className = max && kg >= max ? 'full' : '';

  // Effects come from flyingDef via effects(); one line per number that changes.
  const fx = choice.loadout ? effects(def, choice.loadout, weapons, settings.weight).filter((x) => Math.abs(x.change) >= 0.0005) : [];
  const words = describeEffects(fx);
  $('fx').replaceChildren(...(fx.length
    ? fx.map((x, i) => el('li', { className: (x.goodWhenHigher ? x.change < 0 : x.change > 0) ? 'bad' : 'ok' }, `${words[i]}: ${num(x.base)} → ${num(x.now)}`))
    : [el('li', { className: 'ok' }, words[0])]));

  $('out').textContent = JSON.stringify(choice);
  $('status').textContent = 'saved in this browser';
}

$('nation').replaceChildren(el('option', { value: '' }, 'All'),
  ...[...new Set(planeIds(planeDefs).map((id) => planeDefs[id].nation))].map((n) => el('option', { value: n }, nations[n]?.name ?? n)));
$('nation').onchange = (e) => { nation = e.target.value; drawStrip(); };
drawStrip();
commit();
