// The hangar's rules, kept apart from the page so tests can run them. Everything funnels through the sim's
// validateLoadout, so a load built here is one the game (and the host online) accepts.
import { validateLoadout, flyingDef, DEFAULT_WEIGHT } from '../sim/weapons.js';

export const STORAGE_KEY = 'flak-hangar';

// A plane without hardpoints carries nothing and sends no loadout (null).
export const hasBombs = (def) => (def.hardpoints?.length ?? 0) > 0;

const bombs = (weapons) => Object.entries(weapons).filter(([, w]) => w.type === 'bomb' && w.weight > 0);

// Planes the hangar lists: named ones, optionally of one nation. Returns ids in file order.
export const planeIds = (planeDefs, nation = '') =>
  Object.keys(planeDefs).filter((id) => planeDefs[id]?.name && (!nation || planeDefs[id].nation === nation));

// What a hardpoint takes: bombs it can carry (and the plane can lift), lightest first, and most bombs.
export function hardpointChoices(def, hp, weapons) {
  const cap = (def.loadout ?? []).find((d) => d.hardpoint === hp.id)?.count ?? 1;
  const list = bombs(weapons)
    .filter(([, w]) => w.weight <= hp.maxKg && (!def.maxLoad || w.weight <= def.maxLoad))
    .sort((a, b) => a[1].weight - b[1].weight)
    .map(([id, w]) => ({ id, name: w.name ?? id, weight: w.weight }));
  return { cap, bombs: list };
}

export const loadKg = (list, weapons) => list.reduce((n, l) => n + (weapons[l.weapon]?.weight ?? 0) * (l.count ?? 1), 0);

// Rows -> a list for the game: [{hardpoint, weapon|null, count}] in hardpoint order. Empty rows drop out. If
// the total is over maxLoad, bombs come off the rows other than `keep` first (last row first), then `keep`.
// Returns the validated list, or null if even that cannot be made valid (a plane without hardpoints).
export function buildLoadout(def, rows, weapons, keep = null) {
  let rs = rows.filter((r) => r.weapon && r.count > 0).map((r) => ({ hardpoint: r.hardpoint, weapon: r.weapon, count: r.count }));
  if (def.maxLoad) {
    const others = rs.map((r, i) => i).filter((i) => rs[i].hardpoint !== keep).reverse();
    const sequence = [...others, ...rs.map((r, i) => i).filter((i) => rs[i].hardpoint === keep)];
    for (const i of sequence) {
      while (rs[i].count > 0 && loadKg(rs, weapons) > def.maxLoad) rs[i].count--;
    }
    rs = rs.filter((r) => r.count > 0);
  }
  return validateLoadout(def, rs, weapons);
}

// A list -> one row per hardpoint (weapon null / count 0 where nothing is carried).
export function rowsOf(def, list) {
  return (def.hardpoints ?? []).map((hp) => {
    const l = (list ?? []).find((e) => e.hardpoint === hp.id);
    return { hardpoint: hp.id, weapon: l?.weapon ?? null, count: l?.count ?? 0 };
  });
}

export const presetsOf = (def) => def.loadoutPresets ?? [{ name: 'Default', loadout: def.loadout ?? [] }];

// The index of the preset a list equals, or -1.
export function presetIndex(def, list) {
  const key = (l) => JSON.stringify([...l].sort((a, b) => a.hardpoint.localeCompare(b.hardpoint)).map((e) => [e.hardpoint, e.weapon, e.count ?? 1]));
  return presetsOf(def).findIndex((p) => key(p.loadout) === key(list));
}

// How the plane flies with this load, read from flyingDef (the sim's own function). Each entry:
// { key, label, base, now, change } with change as a fraction (+0.04 = 4 % more).
export function effects(def, list, weapons, weight = DEFAULT_WEIGHT) {
  const p = { def, stations: list.map((l) => ({ hp: l.hardpoint, def: weapons[l.weapon], loaded: l.count ?? 1 })) };
  const f = flyingDef(p, { weight });
  const e = (key, label, goodWhenHigher) => ({ key, label, goodWhenHigher, base: def[key], now: f[key], change: def[key] ? f[key] / def[key] - 1 : 0 });
  return [e('takeoffSpeed', 'Take-off speed', false), e('stallSpeed', 'Stall speed', false), e('turnRate', 'Turn rate', true), e('thrust', 'Engine pull', true)];
}

// Plain words for the effects ("Take-off run longer: speed needed +4 %").
export function describeEffects(fx) {
  const pct = (c) => `${c > 0 ? '+' : '\u2212'}${Math.abs(c * 100).toFixed(1)} %`;
  const lines = fx.filter((x) => Math.abs(x.change) >= 0.0005).map((x) => {
    const worse = x.goodWhenHigher ? x.change < 0 : x.change > 0;
    const word = { takeoffSpeed: worse ? 'Longer take-off run' : 'Shorter take-off run', stallSpeed: 'Stalls at a higher speed', turnRate: 'Turns slower', thrust: 'Climbs and accelerates worse' }[x.key];
    return `${word} (${pct(x.change)})`;
  });
  return lines.length ? lines : ['Flies as it does empty'];
}

// The choice the game sends: { defId, loadout }. Saved per plane, with the last plane remembered.
export function sanitizeChoice(planeDefs, weapons, saved, fallbackId) {
  const ids = planeIds(planeDefs);
  const defId = ids.includes(saved?.defId) ? saved.defId : ids.includes(fallbackId) ? fallbackId : ids[0];
  const def = planeDefs[defId];
  const mine = saved?.loads?.[defId];
  if (!hasBombs(def)) return { defId, loadout: null };
  const loadout = (mine && validateLoadout(def, mine, weapons)) || validateLoadout(def, presetsOf(def)[0].loadout, weapons) || [];
  return { defId, loadout };
}

export function readSaved(storage) {
  try {
    const s = JSON.parse(storage.getItem(STORAGE_KEY));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

export function writeSaved(storage, saved, { defId, loadout }) {
  const next = { ...saved, defId, loads: { ...(saved.loads ?? {}), [defId]: loadout } };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage refused: the choice just does not persist
  }
  return next;
}
