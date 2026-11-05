# Milestone 6 hand-over (paused 2026-10-29 for multiplayer work)

Text only. The blueprints and the unfinished model are in the **private** repo
`TheKeno/flak-and-fury-notes` (local clone `C:\Users\Simon\Documents\Claude\flak-and-fury-notes`),
folder `milestone6/`. They are kept out of this repo because GitHub Pages publishes it publicly.

## Done (pushed to main)

Spitfire IX, Bf 109 G-6 (F-4 kept, to be rebuilt later from a 3-view), P-47D, La-5FN, Ki-43-II, B-239
(hakaristi), Bf 110 G-2 (AI rear gunner `armament.turrets`, twin prop discs, frame cells sized per
plane), markings pass (optional German fin swastika setting).

## Ju 87 D-5 Stuka: done (2026-11-05)

Own model `ju87()` (`tools/plane-models.mjs`) reading `data/outlines/ju87.json` through `kit(o)` incl. radiators, spat and bump; rebuild sprites with `node tools/make-sprites.mjs ju87` after any outline edit. In `data/planes.json` with `fixedGear`, `sc_500` bomb, sound id `ju87` (was `ju87d3`). Estimated values (to check in flight): thrust 72, drag 0.0052 (level top about 103 with the gear drag), maxSpeed 108, turnRate 1.0, hp 110, toughness 1.2, stall 48, takeoff 52, roll about 114, runwayNeeded 130, `sc_500` blast 50 / 200 (extrapolated from sc_250). Wheel, tail leg, propOffset, exhaustOffset, bombOffset and gunner offset computed from the outline; look at them in a big view. Open: 4 x 50 kg wing bombs (one bomb slot per plane), visible bombs, the Ju 87 G-2 (two 37 mm pods) on the same airframe, dive brakes could animate.

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
2. P-38J (owner changed from H)
3. Pe-3
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
- **Bf 109 F-4** (backlog rebuild): `Bf 109 F-4.jpg`.
- **Tanks:** Panzer IV (`Panzer IV.jpeg`), Churchill, Sherman, T-34-76, Chi-Ha, BT-42.
- **Nothing missing now** (23 sheets in all, plus the two Mosquito ones).
- The new files are not yet committed in the notes repo.
