# Milestone 6 hand-over (paused 2026-10-29 for multiplayer work)

Text only. The blueprints and the unfinished model are in the **private** repo
`TheKeno/flak-and-fury-notes` (local clone `C:\Users\Simon\Documents\Claude\flak-and-fury-notes`),
folder `milestone6/`. They are kept out of this repo because GitHub Pages publishes it publicly.

## Done (pushed to main)

Spitfire IX, Bf 109 G-6 (the F-4 was removed 2026-11-07), P-47D, La-5FN, Ki-43-II, B-239
(hakaristi), Bf 110 G-2 (AI rear gunner `armament.turrets`, twin prop discs, frame cells sized per
plane), markings pass (optional German fin swastika setting).

## Ju 87 D-5 Stuka: done (2026-11-05)

Own model `ju87()` (`tools/plane-models.mjs`) reading `data/outlines/ju87.json` through `kit(o)` incl. radiators, spat and bump; rebuild sprites with `node tools/make-sprites.mjs ju87` after any outline edit. In `data/planes.json` with `fixedGear`, `sc_500` bomb, sound id `ju87` (was `ju87d3`). Estimated values (to check in flight): thrust 72, drag 0.0052 (level top about 103 with the gear drag), maxSpeed 108, turnRate 1.0, hp 110, toughness 1.2, stall 48, takeoff 52, roll about 114, runwayNeeded 130, `sc_500` blast 50 / 200 (extrapolated from sc_250). Wheel, tail leg, propOffset, exhaustOffset, bombOffset and gunner offset computed from the outline; look at them in a big view. Open: 4 x 50 kg wing bombs (one bomb slot per plane), visible bombs, the Ju 87 G-2 (two 37 mm pods) on the same airframe, dive brakes could animate.

## P-38J Lightning: done (2026-11-07)

Outline by the owner in the Outline Lab (`data/outlines/p38j.json`, drawn on the bf110 template parts: pod = fuselage, boom = nacelle at z 2.49, intercooler bulge = radiators, twin fins at z 2.24). Own model `p38j()`; USAAF 1943 star and bar on booms and wings. In `data/planes.json` (nation usa, heavy fighter, 4 .50 + 1 Hispano 20 mm, one `wing` rack with 2 GP 500, `emptyWeight` 5800, `maxLoad` 908). First nosewheel plane: `wheelGeometry` in `src/sim/plane.js` now uses `atan` so a `tail` wheel ahead of the mains gives a tiny nose-down stance. Estimated values to check in flight: thrust 86, drag 0.0034, maxSpeed 157, turnRate 1.25, hp 150, stall 60, takeoff 65, runwayNeeded 260. Leg tops, stowed wheel positions, exhaust and prop offsets are computed from the outline; look at them in a big view. Not done: bomb under the wing is a single rack (no 1000 lb bomb yet), no turbo-supercharger sound.

## Pe-3: done (2026-11-07)

Outline by the owner in the Outline Lab (`data/outlines/pe3.json`, frame lowered so the main wheel bottoms sit at -10, see the P-38J note). Own model `pe3()`: red stars on the rear fuselage and under the wings. In `data/planes.json` (ussr, heavy fighter): ShVAK 20 mm + 2 ShKAS in the nose, AI rear gunner (ShKAS, arc 95 to 200), wing rack of 4 FAB-100, `emptyWeight` 5900, `maxLoad` 400. Estimated: thrust 82, drag 0.0037, maxSpeed 145, turnRate 1.0, hp 150, stall 62, takeoff 66, runwayNeeded 340 (loaded roll about that). Leg tops, stowed wheels, exhaust and gunner offsets computed from the outline: check in a big view. Not done: visible bombs, the real Pe-3's second heavy MG (no UBS weapon in `weapons.json`).

## Mosquito FB.VI: sprite done (2026-11-05)

Own model `mosquito()` in `tools/plane-models.mjs` from `data/outlines/mosquito.json` (1943 RAF scheme, C1/B/C
roundels, fin flash, four .303 + two Hispano muzzles, underwing 250 lb bomb racks). Sprites built and approved.
In `data/planes.json` since 2026-11-05 (UK, fighter-bomber; thrust 88, maxSpeed 165, turnRate 1.2, hp 120, 4 Hispano + 4 .303, 2 GP 250 lb; owner approved). Headless test: lifts off after about 127 roll, level top speed about 161. Estimated by eye, still to check in a big view: leg tops, stowed wheel positions, propOffset and exhaustOffset. Visible undropped bombs on the racks stay a backlog item. Old WIP model below is superseded.

## (Superseded) Paused: Mosquito FB.VI

The owner wants it **redone from the latest blueprint**:
`milestone6/blueprints/mosquito-blueprint-czech-latest.png` in the notes repo (Czechoslovak B-36 /
FB.VI profiles; the bottom-left side view is nose right, about 28.2 px/m from spinner tip x 382 y 818
to tail x 30; it also has plan views). The first, less reliable reference was
`mosquito-blueprint-airfix-first.jpg` (1949 Airfix guide).

The work-in-progress model is `milestone6/mosquito-model-wip.mjs.txt` (taken out of
`tools/plane-models.mjs` so the sprite generator keeps working): fuselage, fin and nacelles matched the
Czech drawing; the canopy was last corrected to it (raked windscreen, flat roof about 1.05 m above the
nose line, rear down at 3.9 m). Use 1943 RAF markings, not the drawings' post-war ones.

## Resume order

0. First build the **Outline Lab** (ROADMAP Decisions, 2026-11-04) in its own session and move
   the seven finished planes onto outline files; the remaining planes are then outlined in it.
1. (Done) Mosquito FB.VI
2. (Done) P-38J
3. (Done) Pe-3
4. Ki-45 KAI
5. Blenheim Mk IV
6. Dive bombers
7. Tanks

Process: ask the owner for the 3-view first, overlay, outline approval, then frames/data/commit.

## Blueprints uploaded (2026-11-05)

All in the private notes repo `flak-and-fury-notes/milestone6/blueprints/` (not in this repo); pick them in the
Outline Lab with "Pick from library…". File names are the plane names. Not yet checked for which views each
sheet holds, or its scale and orientation: look when starting each plane.

- **Milestone 6 planes:** P-38J Lightning, Pe-3, Ki-45 KAI Toryu, Blenheim Mk IV with gun pack, Ju-87 D-5,
  Hurricane Mk IID, A-36A Apache, Il-2M3 Shturmovik (rear gunner position to place), D3A2 Val, Ju 88 A-4.
- **Backlog planes:** A6M5 Zero.
- **Heavy bombers (milestone 12):** B-17F, Lancaster B3, Heinkel 177 (`heinkel177_3v.jpg`), Pe-8, G4M1.
- ~~Bf 109 F-4~~ (removed 2026-11-07).
- **Tanks:** Panzer IV (`Panzer IV.jpeg`), Churchill, Sherman, T-34-76, Chi-Ha, BT-42.
- **Nothing missing now** (23 sheets in all, plus the two Mosquito ones).
- The new files are not yet committed in the notes repo.
