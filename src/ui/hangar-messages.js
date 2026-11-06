// What H says when the hangar cannot open or the crew cannot be called: in the air, rolling, away from home,
// no hangar left.
// Pure (tests pass `pick`); a message does not repeat until the others in its list have been shown.
const AIR = [
  'YOU NEED TO LAND FIRST',
  'THE HANGAR IS DOWN THERE. YOU ARE UP HERE',
  'THERE IS NO PARKING IN THE SKY',
  'THE CREW DO NOT MAKE HOUSE CALLS AT ALTITUDE',
  'NICE TRY. LAND FIRST',
  'THE GROUND CREW REFUSE TO CLIMB THE CLOUDS',
  'THE HANGAR DOORS DO NOT OPEN FOR PLANES THAT ARE STILL FLYING',
  'IT IS CALLED A HANGAR, NOT A CLOUD',
];
const MOVING = [
  'STOP FIRST. THE CREW ARE NOT SPRINTERS',
  'THE CREW WILL NOT CHASE A MOVING PLANE',
  'BRAKES, PILOT. THEN ASK',
  'CLOSE THE THROTTLE, THEN WE TALK',
  'THE CREW DO NOT STAND IN FRONT OF PROPELLERS',
  'WHOA. STAND STILL FIRST',
];
const NO_HANGAR = [
  'YOUR HANGAR IS A HOLE IN THE GROUND NOW',
  'NO HANGAR LEFT TO PARK IN. PARK IT IN THE FIELD',
  'THE CREW LOOKED FOR THE HANGAR. THEY FOUND SMOKE',
];
// Standing still, but not on your own airfield (the crew only work at home).
const FIELD = [
  'THE CREW ONLY PARK PLANES AT HOME',
  'THIS IS NOT YOUR AIRFIELD. THE CREW STAY PUT',
  'TOO FAR FROM HOME. THE CREW REFUSE TO WALK THAT FAR',
  'NO HANGAR OUT HERE. TRY YOUR OWN AIRFIELD',
];
// The plane is busy: already being parked, turning round, burning or on its belly.
const BUSY = [
  'THE CREW ARE ALREADY ON IT',
  'ONE THING AT A TIME, PILOT',
  'NOT NOW. SORT THE PLANE OUT FIRST',
];
export const CALLING = ['CALLING THE CREW', 'CREW ON THE WAY', 'THE CREW ARE COMING'];

const shown = new Map();
function next(list, pick) {
  const seen = shown.get(list) ?? new Set();
  const left = list.filter((m) => !seen.has(m));
  const pool = left.length ? left : list;
  if (!left.length) seen.clear();
  const m = pool[pick(pool.length)];
  seen.add(m);
  shown.set(list, seen);
  return m;
}

// reason: what parkInBlocker (src/sim/plane.js) said: air | busy | nohangar | field | moving.
export function hangarRefusal(reason, pick = (n) => Math.floor(Math.random() * n)) {
  const list = { nohangar: NO_HANGAR, field: FIELD, moving: MOVING, busy: BUSY }[reason] ?? AIR;
  return next(list, pick);
}

export const callingMessage = (pick = (n) => Math.floor(Math.random() * n)) => next(CALLING, pick);
