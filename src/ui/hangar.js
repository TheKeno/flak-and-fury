// The hangar page: choose a plane, its bombs and guns. Output is { defId, loadout, guns } (what changeSeat takes; also
// window.hangarChoice and a 'hangar-choice' event). The layout is hangar-view.js (shared with the in-game panel), the
// rules hangar-logic.js.
import { loadImage, paintSprite } from '../render/sprites.js';
import { planeIds, sanitizeChoice, readSaved, writeSaved, hasBombs, gunChoiceFor, LOADOUT_EDITING } from './hangar-logic.js';
import { createHangarView, HANGAR_STYLE } from './hangar-view.js';

const $ = (id) => document.getElementById(id);
const json = async (p) => (await fetch(p, { cache: 'no-store' })).json();
const [planeDefs, weapons, nations, settings, cards] = await Promise.all([json('data/planes.json'), json('data/weapons.json'), json('data/nations.json'), json('data/settings.json'), json('data/plane-cards.json').catch(() => ({}))]);

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

document.head.append(Object.assign(document.createElement('style'), { textContent: HANGAR_STYLE }));
const view = createHangarView({ planeDefs, weapons, nations, settings, spriteOf, cards: cards.planes ?? null });

// Without loadout editing every plane gets its standard load (saved loads are ignored).
const first = sanitizeChoice(planeDefs, weapons, LOADOUT_EDITING ? saved : { defId: saved.defId }, planeIds(planeDefs)[0]);
let state = { defId: first.defId, loadout: first.loadout, guns: LOADOUT_EDITING ? gunChoiceFor(planeDefs[first.defId], weapons, first.guns) : null, editable: true, note: '' };

function commit(change = {}) {
  state = { ...state, ...change };
  const choice = { defId: state.defId, loadout: state.loadout };
  if (state.guns) choice.guns = state.guns;
  saved = writeSaved(storage, saved, choice);
  window.hangarChoice = choice;
  window.dispatchEvent(new CustomEvent('hangar-choice', { detail: choice }));
  $('hv').replaceChildren(view.draw(state, h));
  $('out').textContent = JSON.stringify(choice);
  $('status').textContent = 'saved in this browser';
}
const h = {
  pickPlane(id) {
    const c = sanitizeChoice(planeDefs, weapons, LOADOUT_EDITING ? saved : {}, id);
    commit({ defId: id, loadout: hasBombs(planeDefs[id]) ? c.loadout : null, guns: LOADOUT_EDITING ? gunChoiceFor(planeDefs[id], weapons, c.guns) : null });
  },
  change: (c) => commit(c),
};
commit();
