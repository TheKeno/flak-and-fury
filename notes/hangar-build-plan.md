# Hangar equipment: build plan (agreed in discussion 2026-11-06, nothing built yet)

Facts per plane: `hangar-options.md`, `hangar-options-verified.md`, `hangar-options-verified-planned.md`.
The ROADMAP Decisions entry "Hangar: plane, loadout and parking" has the owner's decisions.

## What the owner decided

- Layout: wider and taller panel; left list of all planes (sprite + name, grouped by category, nation sort);
  right column with whole-plane presets and stacked sections BOMBS, GUNS, ENGINE (a section only if the plane has real
  options); weight bar and effect lines pinned at the bottom. Current dark look kept for now.
- Equipment can be removed to save weight, **guns too** (a plane may fly with **no guns**); **ammunition has weight and
  counts**; **lighter than today flies better than today** (today's numbers are the zero point, not the best case);
  guns and pods add some drag.
- Engine choice only where the plane really had one; no altitude model yet, so such options start as plain
  power/weight trade-offs (separate decision later).

## Weight model (the one rule to build)

- Zero point = the plane **clean with its standard guns and full standard ammunition** (flies exactly as today).
- `equipKg = bombsKg + gunsKg + ammoKg - standardGunsKg - standardAmmoKg` (negative when guns or ammo are removed).
- `f = equipKg / refKg`, `refKg = maxLoad` (planes without `maxLoad`: `refKg = 0.15 x emptyWeight`, new optional field),
  clamped to `[-fMin, 1]`. `flyingDef` already applies `1 - share x f`, so a negative `f` is a bonus with no new formula.
  New tunable `weight.lightMax` (the most bonus, share of the full-load penalty, start 0.5).
- Drag: each external item (gondola, pod, bomb on a rack) has an optional `drag` in `weapons.json`; summed into a
  `dragCoef` add-on in `flyingDef` (top speed falls a little). Internal bays and guns have none. Start with pods and
  gondolas only; bombs already cost weight.
- Fewer guns means less firepower: the effect lines say so in words ("-2 guns: lighter, less firepower").

## Data to add

- `weapons.json` guns: `weight` (kg, gun alone) and `roundKg` (kg per round incl. link). Best-guess table below.
- `planes.json` `armament.guns` entries get a mount `id` (e.g. `nose`, `wing`) and `options` (the weapons that fit and
  the most they take); `armament.defaultAmmo` stays full. A pilot's gun choice is plain data `[{mount, weapon, count,
  ammo}]` beside `p.loadout`, validated like `validateLoadout` (the same untrusted-input rules for guests).
- Presets cover bombs and guns together (`loadoutPresets` entries gain `guns`).
- Engines later: `engines` options per plane `[{id, name, hp?, mass?}]`, only where the notes say there is a choice.

## Stages (each its own session, in order, they touch the same files)

1. **Sim and data:** gun and ammo weights, `refKg`, negative weight bonus, `p.guns` choice (set/validate/lock like
   `setLoadout`, in `changeSeat` and the seat message, snapshot rules, tests), the gun mount data for the planes already
   in the game using the verified options. Pods and gondolas as a new external gun hardpoint kind (with drag).
   TUNING.md and tuning panel for the new values.
2. **Hangar UI:** the new layout in `hangar.html` and the in-game panel from one shared drawing module (so they cannot
   drift), plane list grouped and sorted, sections, presets over bombs and guns, pinned effect footer.
3. **Planned planes' options:** as the planes get built (milestone 6, heavies milestone 12).
4. **Later, own decisions:** rockets (new weapon kind), engine options and an altitude power model.

## Best-guess weights (not sourced; look these up later)

Gun weight, kg (`weight`): .303 Browning 10 (Mk II about 22 lb, from memory); MG 17 10 (not found, memory); the rest
are sourced in `hangar-options-verified-planned.md` (.50 M2 28, Hispano 45, MG 151/20 43, MK 108 58, ShVAK 42, Ho-103 23,
Type 99 Mk 1 23 / Mk 2 36, MG 131 17, ShKAS 10, Vickers S 150, BK 3,7 295 with pod); MG 81Z about 13 (guess, twin);
Type 3 13.2 mm about 30 (guess); VYa-23 about 66 (guess); Ho-203 37 mm about 60 (guess); NS-37 about 150 (guess).

Ammunition, kg per round incl. link (`roundKg`), all guesses from calibre: 7.9 / .303 mm 0.025; 12.7 / .50 0.12;
13 mm MG 131 0.075; 20 mm (Hispano, MG 151, ShVAK, Type 99) 0.25; 23 mm 0.35; 30 mm MK 108 0.45; 37 mm 0.75;
40 mm 1.1.

## To look up later

- Gun weights: .303 Browning, MG 17 (page not found), MG 81Z, Type 3 13.2, VYa-23, Ho-203, NS-37 (all guesses above).
- Ammunition weight per round for every gun (all are guesses).
- Plane masses where missing: P-38J empty weight and engine hp, He 177 A-3 internal bomb capacity and empty weight,
  B-17F (only B-17G found), Hurricane IID engine, a Finnish Blenheim gun pack, plane empty weights for the nine in the
  game that have `emptyWeight` (check they match the verified list).
- Still-open claims from the first pass: Bf 110 G-2 bomb options and the WGr.21 kit, Mosquito Merlin 23 and RP-3 date,
  Bf 109 F-4 bomb variant.
- Primary sources (manuals, museum data); everything so far is Wikipedia.
