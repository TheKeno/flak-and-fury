# Milestone 6 hand-over (paused 2026-10-29 for multiplayer work)

Text only. The blueprints and the unfinished model are in the **private** repo
`TheKeno/flak-and-fury-notes` (local clone `C:\Users\Simon\Documents\Claude\flak-and-fury-notes`),
folder `milestone6/`. They are kept out of this repo because GitHub Pages publishes it publicly.

## Done (pushed to main)

Spitfire IX, Bf 109 G-6 (F-4 kept, to be rebuilt later from a 3-view), P-47D, La-5FN, Ki-43-II, B-239
(hakaristi), Bf 110 G-2 (AI rear gunner `armament.turrets`, twin prop discs, frame cells sized per
plane), markings pass (optional German fin swastika setting).

## Paused: Mosquito FB.VI

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
1. Mosquito FB.VI
2. P-38J (owner changed from H)
3. Pe-3
4. Ki-45 KAI
5. Blenheim Mk IV
6. Dive bombers
7. Tanks

Process: ask the owner for the 3-view first, overlay, outline approval, then frames/data/commit.
