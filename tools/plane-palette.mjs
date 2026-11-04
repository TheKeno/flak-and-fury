// Palette keys of the generated sprites (shared by tools/make-sprites.mjs and the Outline Lab preview).
// Paint key colours: the game swaps these for the player's paint scheme at load time (src/render/sprites.js).
export const PALETTE = {
  '.': [0, 0, 0, 0],
  o: [28, 26, 24, 255], // outline
  B: [255, 0, 255, 255], // KEY paint: base
  S: [192, 0, 192, 255], // KEY paint: base shade
  U: [0, 255, 255, 255], // KEY paint: underside
  N: [255, 255, 0, 255], // KEY paint: nose / spinner
  M: [255, 0, 0, 255], // KEY paint: national marking
  W: [128, 0, 128, 255], // KEY paint: wing (darker base)
  1: [0, 192, 192, 255], // KEY paint: underside shade
  2: [192, 192, 0, 255], // KEY paint: nose shade
  4: [176, 176, 168, 255], // white in shadow
  C: [96, 136, 160, 255], // canopy glass
  c: [200, 228, 240, 255], // canopy highlight
  p: [92, 64, 44, 255], // pilot's leather helmet
  P: [140, 104, 74, 255], // helmet highlight
  e: [50, 46, 44, 255], // exhaust stacks, intakes
  x: [236, 236, 226, 255], // white (marking borders)
  g: [96, 102, 90, 255], // hangar wall
  h: [66, 70, 62, 255], // hangar wall shade / door frame
  r: [132, 96, 70, 255], // hangar roof
  R: [100, 72, 52, 255], // hangar roof corrugation
  d: [22, 20, 18, 255], // door opening
  w: [150, 170, 176, 255], // hangar window
  b: [84, 90, 70, 255], // bomb casing
  l: [118, 124, 100, 255], // bomb highlight
  k: [56, 60, 46, 255], // bomb fins
  v: [86, 94, 64, 255], // olive drab steel (guns)
  V: [62, 70, 46, 255], // olive shade
  i: [96, 98, 92, 255], // iron grey
  I: [60, 62, 60, 255], // iron dark
  s: [170, 152, 112, 255], // sandbag
  z: [134, 118, 86, 255], // sandbag shade
  K: [156, 144, 100, 255], // tent canvas
  q: [120, 110, 76, 255], // canvas shade
  t: [128, 94, 62, 255], // timber
  T: [88, 64, 42, 255], // timber dark
  y: [140, 132, 116, 255], // plaster wall (grimy: the look is grim)
  Y: [112, 106, 94, 255], // plaster shade
  f: [96, 58, 46, 255], // roof tiles (dull, sooty brick)
  F: [70, 44, 36, 255], // roof tile shade
  n: [44, 56, 64, 255], // dark window glass
  G: [54, 64, 42, 255], // leaves (drab, late-summer dark)
  H: [38, 46, 32, 255], // leaf shade
  L: [70, 80, 52, 255], // leaf light
  X: [48, 58, 38, 255], // hedge
  Z: [32, 40, 28, 255], // hedge shade
  a: [70, 58, 44, 255], // bark
  A: [48, 40, 32, 255], // bark shade
  j: [104, 102, 94, 255], // field stone
  J: [76, 74, 68, 255], // stone shade
  u: [56, 54, 50, 255], // mortar / gaps
  E: [82, 64, 46, 255], // weathered barn planks
  D: [60, 46, 34, 255], // plank shade
  Q: [66, 62, 56, 255], // barn roof (old slate)
  m: [122, 40, 36, 255], // roundel red (dull)
  5: [168, 146, 64, 255], // roundel yellow (dull)
  6: [0, 128, 255, 255], // KEY optional marking, dark (black, or the fin's paint with the setting off)
  7: [128, 255, 0, 255], // KEY optional marking, light (white, or the fin's paint)
};
