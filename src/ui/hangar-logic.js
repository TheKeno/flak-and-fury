// The hangar's rules, kept apart from the page so tests can run them. Everything funnels through the sim's
// validateLoadout, so a load built here is one the game (and the host online) accepts.
import { validateLoadout, validateGuns, flyingDef, gunsOf, standardGunKg, mountsOf, DEFAULT_WEIGHT } from '../sim/weapons.js';

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

// Gun mounts of a plane for the hangar: one row per mount, from a gun choice (null: the standard fit).
// { mount, weapon (null = nothing), count, ammo (rounds per gun), standard, options: [{weapon, name, max, mountKg, drag}] }
export function gunRows(def, weapons, choice = null) {
  return mountsOf(def).map((m) => {
    const c = choice ? choice.find((e) => e.mount === m.id) : m.count > 0 ? { weapon: m.weapon, count: m.count, ammo: weapons[m.weapon].ammo } : null;
    const options = (m.options ?? [{ weapon: m.weapon, max: m.count }]).map((o) => ({ weapon: o.weapon, name: weapons[o.weapon]?.name ?? o.weapon, max: o.max, mountKg: o.mountKg ?? 0, drag: o.drag ?? 0 }));
    return { mount: m.id, weapon: c?.weapon ?? null, count: c?.count ?? 0, ammo: c?.ammo ?? 0, standard: { weapon: m.weapon, count: m.count }, options };
  });
}
// Rows -> a gun choice for the game (validated; rows with no weapon or count 0 are left out, so all rows empty is no guns).
export const buildGuns = (def, rows, weapons) =>
  validateGuns(def, rows.filter((r) => r.weapon && r.count > 0).map((r) => ({ mount: r.mount, weapon: r.weapon, count: r.count, ammo: r.ammo })), weapons);
// Does the plane have any gun choice to offer (more than just fewer rounds)?
export const hasGunOptions = (def) => mountsOf(def).some((m) => m.count === 0 || (m.options?.length ?? 0) > 1);
// Guns, ammunition and pods in kg now / in the standard fit.
export function gunKg(def, guns, weapons) {
  const p = { def, gunChoice: guns ?? null };
  return gunsOf(p, weapons).reduce((n, g) => n + g.count * (weapons[g.weapon].weight ?? 0) + g.count * g.ammoPer * (weapons[g.weapon].roundKg ?? 0) + (g.count > 0 ? g.mountKg : 0), 0);
}
export const standardKg = standardGunKg;

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
export function effects(def, list, weapons, weight = DEFAULT_WEIGHT, guns = null) {
  const p = { def, gunChoice: guns, stations: list.map((l) => ({ hp: l.hardpoint, def: weapons[l.weapon], loaded: l.count ?? 1 })) };
  p.guns = gunsOf(p, weapons).map((g) => ({ def: weapons[g.weapon], count: g.count, ammo: g.ammoPer * g.count, mountKg: g.mountKg, drag: g.drag }));
  p.stdGunKg = standardGunKg(def, weapons);
  const f = flyingDef(p, { weight });
  const e = (key, label, goodWhenHigher) => ({ key, label, goodWhenHigher, base: def[key], now: f[key], change: def[key] ? f[key] / def[key] - 1 : 0 });
  const out = [e('takeoffSpeed', 'Take-off speed', false), e('stallSpeed', 'Stall speed', false), e('turnRate', 'Turn rate', true), e('thrust', 'Engine pull', true)];
  // Pods and gondolas add drag: the top speed (about the square root of thrust over drag) falls a little.
  const topNow = Math.sqrt(f.thrust / f.dragCoef);
  const topBase = Math.sqrt(def.thrust / def.dragCoef);
  out.push({ key: 'topSpeed', label: 'Top speed', goodWhenHigher: true, base: topBase, now: topNow, change: topNow / topBase - 1 });
  return out;
}

// Plain words for the effects ("Take-off run longer: speed needed +4 %").
export function describeEffects(fx) {
  const pct = (c) => `${c > 0 ? '+' : '\u2212'}${Math.abs(c * 100).toFixed(1)} %`;
  const lines = fx.filter((x) => Math.abs(x.change) >= 0.0005).map((x) => {
    const worse = x.goodWhenHigher ? x.change < 0 : x.change > 0;
    const word = {
      takeoffSpeed: worse ? 'Longer take-off run' : 'Shorter take-off run',
      stallSpeed: worse ? 'Stalls at a higher speed' : 'Stalls at a lower speed',
      turnRate: worse ? 'Turns slower' : 'Turns tighter',
      thrust: worse ? 'Climbs and accelerates worse' : 'Climbs and accelerates better',
      topSpeed: worse ? 'Lower top speed' : 'Higher top speed',
    }[x.key];
    return `${word} (${pct(x.change)})`;
  });
  return lines.length ? lines : ['Flies as it does empty'];
}

// The choice the game sends: { defId, loadout } and, when the pilot has changed the guns, guns. Saved per plane, with the last plane remembered.
export function sanitizeChoice(planeDefs, weapons, saved, fallbackId) {
  const ids = planeIds(planeDefs);
  const defId = ids.includes(saved?.defId) ? saved.defId : ids.includes(fallbackId) ? fallbackId : ids[0];
  const def = planeDefs[defId];
  const mine = saved?.loads?.[defId];
  const guns = saved?.guns?.[defId] ? validateGuns(def, saved.guns[defId], weapons) : null;
  const extra = guns ? { guns } : {};
  if (!hasBombs(def)) return { defId, loadout: null, ...extra };
  const loadout = (mine && validateLoadout(def, mine, weapons)) || validateLoadout(def, presetsOf(def)[0].loadout, weapons) || [];
  return { defId, loadout, ...extra };
}

export function readSaved(storage) {
  try {
    const s = JSON.parse(storage.getItem(STORAGE_KEY));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

export function writeSaved(storage, saved, { defId, loadout, guns }) {
  const next = { ...saved, defId, loads: { ...(saved.loads ?? {}), [defId]: loadout } };
  if (guns !== undefined) next.guns = { ...(saved.guns ?? {}), [defId]: guns };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage refused: the choice just does not persist
  }
  return next;
}
