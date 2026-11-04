# Outline Lab: build status (2026-11-04)

Spec: ROADMAP.md, Decisions, "Outline Lab". Open `http://localhost:8080/outline-lab.html` (restart
`node tools/serve.mjs 8080` first: the server gained PUT for `data/outlines/*.json`, POST
`/build-sprites?plane=x` and GET `/api/outlines`).

## Done and committed
- `data/outlines/<plane>.json` for the 8 finished planes; `tools/plane-models.mjs` `kit(outline)` turns one
  into the helpers (`bodyOf`, `surfaceOf`, `gearOf`); model functions take the outline (`buildModel(name, o)`,
  `BUILDERS`). Sprites rebuilt byte-identical to before. Numbers are metres: d back from the reference nose
  point, h up; see `_notes` in each file. `tools/outlines.mjs` loads them in Node, `tools/outline-format.mjs`
  writes them, `tools/plane-palette.mjs` is the shared palette.
- `outline-lab.html` + `src/ui/outline-lab.js`: side view. Blueprint picture kept in IndexedDB (this browser
  only), calibrate by clicking nose tip and tail end (+ tail point height), tilt and mirrored drawings handled.
  Draggable points (fuselage, spinner, spine, canopy, nacelle, gun tray, radiators, fin edges, wing/tailplane
  root, wheels) on a pixel grid that matches the sprite (one step = one pixel), arrows nudge, double-click adds
  a point, Delete removes, undo/redo, live preview (game size and x4, also over the blueprint), Save, Build sprites.
  Saving writes changed wheels into `data/planes.json` `wheels` (centre and radius, 0.025 steps).
- Tests: `tests/outlines.test.mjs`.

## Not done yet
- Plan view (wingtip calibration, wing and tailplane edge tables `le`/`te` as [z, d], half widths).
- Auto pre-fill (type templates snapped to the drawing's lines, mask brush, snap-to-line for dragged points).
- Pixel touch-up layer (`touchups` in the outline file, applied after render of the side-view sprite only).
- TUNING.md / CLAUDE.md code layout notes; README line for `outline-lab.html`.
