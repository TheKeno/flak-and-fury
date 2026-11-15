// Where the band-test fights happen: planes shot down by world y, started at 300.
import { loadContent } from '../content.mjs';
import { runMatch } from '../../src/balance/runner.js';
const content = loadContent();
const pairs = [['spitfire', 'b239'], ['p47d', 'a6m5'], ['bf109g6', 'la5fn']];
const h = new Array(13).fill(0);
for (const [a, b] of pairs) for (const seed of [1, 2]) {
  const r = runMatch(content, { a, b, seed, minutes: 8, arena: true, airStart: 300 });
  for (const s of r.stats) s.shotDownAt.forEach((n, i) => (h[i] += n));
}
const tot = h.reduce((a, b) => a + b, 0);
let cum = 0;
h.forEach((n, i) => { cum += n; console.log(`${i * 100}-${i * 100 + 99}: ${n} (${Math.round((100 * cum) / tot)}% so far)`); });
