// World snapshots for online play. The host turns its world into plain data (encodeWorld), sends only
// what changed since its last snapshot (diff), and each guest patches its own copy of the world with
// it (applyPatch).
//
// Generic on purpose, so new sim features go online without touching this file: anything in the world
// is sent, as long as it is plain data (objects, arrays, numbers, strings, booleans, typed arrays).
// Rules for sim state:
// - Anything kept in a list carries a numeric `id` (from world.nextId), so lists are matched by id.
// - References to the shared data files (a plane's def, a gun's weapon) are fine: both sides load the
//   same files, so they travel as '@path'. Don't share other objects between two places in the world.
// - Host-only bookkeeping (AI memory, caches) goes in SKIP, so it isn't sent every snapshot.
// - No Maps or Sets in state a guest needs to see; they aren't sent.
// tests/net.test.mjs checks a busy world survives the trip.

// Loaded from the same files on both sides: never sent, references into them travel as '@path'.
export const STATIC = ['planeDefs', 'weapons', 'groundDefs', 'rules', 'servicing', 'collisions', 'fire', 'waves', 'runway', 'landing', 'decor', 'bots', 'radar', 'map'];
// Not sent: the shared data, the host's own bookkeeping and bot memory, and events (sent separately,
// tick by tick). Paths are world keys joined by dots; list elements don't add to the path.
const SKIP = new Set([...STATIC, 'rng', 'nextId', 'events', 'collisionGrace', 'botRadar', 'botSkyline', 'planes.bot']);
// Values worth smoothing between snapshots on a guest's screen; the angles go the short way round.
const POSE = ['x', 'y', 'angle', 'rollAngle', 'aim'];
const ANGLES = new Set(['angle', 'rollAngle', 'aim']);
// A jump further than this between two snapshots is a teleport (a respawn), not movement.
const TELEPORT = 300;

// Every object in the shared data, both ways: object -> '@path' and '@path' -> object.
export function staticRefs(world) {
  const toRef = new Map();
  const fromRef = new Map();
  const walk = (v, path) => {
    if (v === null || typeof v !== 'object' || toRef.has(v)) return;
    toRef.set(v, `@${path}`);
    fromRef.set(`@${path}`, v);
    for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
  };
  for (const k of STATIC) walk(world[k], k);
  return { toRef, fromRef };
}

// Floats are rounded to a thousandth: plenty for drawing, and fewer digits to send. Strings that look
// like our markers are escaped with '~'.
function encode(v, path, refs) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return `#${v}`;
    // + 0 turns -0 (which JSON can't carry) into 0.
    return (Number.isInteger(v) ? v : Math.round(v * 1000) / 1000) + 0;
  }
  if (typeof v === 'string') return /^[@#~]/.test(v) ? `~${v}` : v;
  if (typeof v === 'boolean' || v === null) return v;
  if (typeof v !== 'object' || v instanceof Map || v instanceof Set) return undefined;
  const ref = refs.toRef.get(v);
  if (ref) return ref;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = encode(v[i], path, refs) ?? null;
    return out;
  }
  const out = {};
  for (const k in v) {
    const p = path ? `${path}.${k}` : k;
    if (SKIP.has(p)) continue;
    const e = encode(v[k], p, refs);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

export const encodeWorld = (world, refs) => encode(world, '', refs);
// Events go with each snapshot, tick by tick (their own path, so SKIP doesn't apply to their keys).
export const encodeEvent = (e, refs) => encode(e, 'events', refs);
export const decodeEvent = (v, refs) => build(undefined, v, refs);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);
const isIdList = (a) => a.every((e) => isObj(e) && typeof e.id === 'number');

// What turns encoded tree a into b, or undefined if nothing changed. A patch is a plain value (a
// scalar to set), { $: value } (replace with an object or array), { o: { key: patch }, d: [deleted
// keys] } (an object), { a: { index: patch }, n: length } (a list) or { u: { id: patch }, i: [ids in
// order] } (a list of things with ids; i only when the order or members changed).
export function diff(a, b) {
  if (a === b) return undefined;
  if (b === null || typeof b !== 'object') return b;
  if (a === null || typeof a !== 'object' || Array.isArray(a) !== Array.isArray(b)) return { $: b };
  if (Array.isArray(b)) return isIdList(a) && isIdList(b) ? diffIds(a, b) : diffList(a, b);
  const o = {};
  let changed = false;
  let d;
  for (const k in b) {
    const x = diff(a[k], b[k]);
    if (x !== undefined) {
      o[k] = x;
      changed = true;
    }
  }
  for (const k in a) if (!(k in b)) (d ??= []).push(k);
  if (!changed && !d) return undefined;
  return d ? { o, d } : { o };
}

function diffList(a, b) {
  const changes = {};
  let changed = a.length !== b.length;
  for (let i = 0; i < b.length; i++) {
    const x = diff(a[i], b[i]);
    if (x !== undefined) {
      changes[i] = x;
      changed = true;
    }
  }
  if (!changed) return undefined;
  return a.length === b.length ? { a: changes } : { a: changes, n: b.length };
}

function diffIds(a, b) {
  const before = new Map(a.map((e) => [e.id, e]));
  const u = {};
  let changed = false;
  for (const e of b) {
    const prev = before.get(e.id);
    const x = prev ? diff(prev, e) : { $: e };
    if (x !== undefined) {
      u[e.id] = x;
      changed = true;
    }
  }
  const sameOrder = a.length === b.length && a.every((e, i) => e.id === b[i].id);
  if (sameOrder && !changed) return undefined;
  return sameOrder ? { u } : { u, i: b.map((e) => e.id) };
}

// refs: from staticRefs, to turn '@path' back into the guest's own copy of the shared data. Without
// refs the patch is applied as plain data (a guest's mirror of the host's encoded tree).
function decode(v, refs) {
  if (typeof v !== 'string' || !refs) return v;
  if (v[0] === '@') return refs.fromRef.get(v);
  if (v[0] === '#') return Number(v.slice(1));
  if (v[0] === '~') return v.slice(1);
  return v;
}

// Turns an encoded value into a live one, reusing cur's objects and arrays where it can, so things
// the renderer and sound hold on to (your plane, the terrain's height array) stay the same objects.
function build(cur, v, refs) {
  if (v === null || typeof v !== 'object') return decode(v, refs);
  // Never write into the shared data.
  if (refs?.toRef.has(cur)) cur = undefined;
  if (Array.isArray(v)) {
    if (ArrayBuffer.isView(cur) && cur.length === v.length) {
      for (let i = 0; i < v.length; i++) cur[i] = decode(v[i], refs);
      return cur;
    }
    const arr = Array.isArray(cur) ? cur : [];
    if (v.length && isIdList(v)) {
      const before = new Map(arr.map((e) => [e?.id, e]));
      const next = v.map((e) => build(before.get(e.id), e, refs));
      arr.length = 0;
      arr.push(...next);
      return arr;
    }
    arr.length = v.length;
    for (let i = 0; i < v.length; i++) arr[i] = build(arr[i], v[i], refs);
    return arr;
  }
  const obj = isObj(cur) ? cur : {};
  // Functions are the guest's own (the terrain's height lookup), not state.
  for (const k in obj) if (!(k in v) && typeof obj[k] !== 'function') delete obj[k];
  for (const k in v) obj[k] = build(obj[k], v[k], refs);
  return obj;
}

// Applies a patch to cur and returns the result (objects and arrays are patched in place).
export function applyPatch(cur, p, refs = null) {
  if (p === null || typeof p !== 'object') return decode(p, refs);
  if ('$' in p) return build(cur, p.$, refs);
  if (p.o) {
    const obj = isObj(cur) ? cur : {};
    for (const k in p.o) obj[k] = applyPatch(obj[k], p.o[k], refs);
    for (const k of p.d ?? []) delete obj[k];
    return obj;
  }
  if (p.a) {
    const arr = Array.isArray(cur) || ArrayBuffer.isView(cur) ? cur : [];
    if (p.n !== undefined && Array.isArray(arr)) arr.length = p.n;
    for (const i in p.a) arr[i] = applyPatch(arr[i], p.a[i], refs);
    return arr;
  }
  if (p.u) {
    const arr = Array.isArray(cur) ? cur : [];
    const before = new Map(arr.map((e) => [e?.id, e]));
    const ids = p.i ?? arr.map((e) => e.id);
    const next = ids.map((id) => (p.u[id] === undefined ? before.get(id) : applyPatch(before.get(id), p.u[id], refs)));
    arr.length = 0;
    arr.push(...next);
    return arr;
  }
  return cur;
}

// The pose of everything in the world's top-level lists (planes, ground, bullets, shells...): id ->
// [x, y, angle, rollAngle, aim], undefined where a thing doesn't have one.
export function takePoses(tree) {
  const poses = new Map();
  for (const k in tree) {
    const list = tree[k];
    if (!Array.isArray(list)) continue;
    for (const e of list) if (isObj(e) && typeof e.id === 'number') poses.set(e.id, POSE.map((f) => (typeof e[f] === 'number' ? e[f] : undefined)));
  }
  return poses;
}

const TAU = Math.PI * 2;
const lerpAngle = (a, b, t) => a + ((((b - a) % TAU) + TAU + Math.PI) % TAU - Math.PI) * t;

// Writes poses into the live world's lists: from, or between from and to (t: 0..1).
export function writePoses(world, from, to = null, t = 0) {
  for (const k in world) {
    const list = world[k];
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const a = isObj(e) && from.get(e.id);
      if (!a) continue;
      const b = to?.get(e.id);
      const jump = b && Math.abs((b[0] ?? 0) - (a[0] ?? 0)) + Math.abs((b[1] ?? 0) - (a[1] ?? 0)) > TELEPORT;
      for (let i = 0; i < POSE.length; i++) {
        if (a[i] === undefined) continue;
        const end = b && !jump ? b[i] : undefined;
        if (end === undefined) e[POSE[i]] = a[i];
        else e[POSE[i]] = ANGLES.has(POSE[i]) ? lerpAngle(a[i], end, t) : a[i] + (end - a[i]) * t;
      }
    }
  }
}
