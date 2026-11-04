// Reads data/outlines/<plane>.json for the sprite generator and the tests (Node only; the Outline
// Lab fetches the same files in the browser).
import { readFileSync } from 'node:fs';

export function loadOutline(name) {
  return JSON.parse(readFileSync(new URL(`../data/outlines/${name}.json`, import.meta.url), 'utf8'));
}
