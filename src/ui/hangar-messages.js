// What H says when the hangar cannot open: the player is in the air, rolling, or has no hangar left.
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
// Until the crew can fetch a stopped plane (build step 4 of the hangar decision).
const STILL = ['THE PARK-IN CREW IS STILL IN TRAINING'];

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

// p: the player's plane; hasHangar: own hangar still standing.
export function hangarRefusal(p, hasHangar, pick = (n) => Math.floor(Math.random() * n)) {
  if (!hasHangar) return next(NO_HANGAR, pick);
  if (p.state === 'ground') return Math.abs(p.speed) > 2 ? next(MOVING, pick) : next(STILL, pick);
  return next(AIR, pick);
}
