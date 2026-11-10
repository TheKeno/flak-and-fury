// The plain-numbers sheet per plane (turn time, climb, dive gain, top speed, toughness, firepower),
// measured by flying the real flight model. The duel tool's expected winners come from these numbers.
//
//   node tools/plane-sheet.mjs [planes a,b,..] [--json]    default: the fighters with an air role
import { loadContent } from './content.mjs';
import { planeSheet } from '../src/balance/sheet.js';

const args = process.argv.slice(2);
const content = loadContent();
const list = args.find((a) => !a.startsWith('--'))?.split(',')
  ?? Object.keys(content.planeDefs).filter((id) => content.planeDefs[id].airRole && content.planeDefs[id].role === 'fighter');
const sheets = list.map((id) => planeSheet(content, id));
if (args.includes('--json')) {
  console.log(JSON.stringify(sheets, null, 1));
  process.exit(0);
}
const cols = [
  ['plane', 'id', 9], ['role', 'role', 15], ['top', 'topSpeed', 5], ['stall', 'stallSpeed', 6], ['turn s', 'turnTime', 7], ['speed after', 'turnSpeedLeft', 11],
  ['slow turn s', 'slowTurnTime', 12], ['climb/s', 'climbRate', 8], ['rated', 'ratedHeight', 6], ['top hi', 'topSpeedHigh', 7], ['climb hi', 'climbRateHigh', 9], ['dive to', 'diveSpeed', 8], ['dive turn', 'diveTurn', 10], ['zoom', 'zoomHeight', 5], ['hp', 'hp', 4], ['dmg/s', 'firepower', 6], ['burst s', 'burstSeconds', 8],
];
console.log(cols.map(([h, , w]) => h.padEnd(w)).join(''));
for (const s of sheets) console.log(cols.map(([, k, w]) => String(s[k]).padEnd(w)).join(''));
console.log('\nturn s: seconds for a full circle at full pull and throttle from 80% of top speed; speed after: speed at the end of it ("dive turn": rad/s it still turns at the dive speed).');
console.log('Flown at y 300 (the ground war); rated: full power up to this height; top hi, climb hi: at y 1000 (the high band, thin air).');
console.log('slow turn s: the same from 1.4x stall. dive to: speed after a 60 degree dive losing 300 units from top speed; zoom: height that buys back.');
