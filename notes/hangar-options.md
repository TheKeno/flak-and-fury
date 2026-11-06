# Hangar options per plane: engines, guns, bombs

Written 2026-11-06 for the hangar UI layout discussion. **Game columns are checked against `data/planes.json`
and `data/weapons.json`. The real-world options come from memory, not sources: items marked (?) are the ones to
verify before any go into data.** Not decided: which of these become choices, and which are only historical notes.

## In the game now

| Plane | Engine options (1943) | Gun options | Bomb options |
|---|---|---|---|
| **Bf 109 G-6** | DB 605A (standard), 605AS (big supercharger, high altitude), 605AM (MW 50 boost, 1944) | now 2x MG 131 + MG 151/20. Real: MK 108 30 mm hub instead of MG 151 (/U4); 2x MG 151/20 gondolas under the wings (/R6) (?) | ETC rack: 1x SC 250 (or 500 kg, ?), 4x SC 50; clean. Game: SC 250, SC 50, clean |
| **Bf 109 F-4** | DB 601E only (601N was the F-2) | now 2x MG 17 + MG 151/20; gondolas (/R6) rare (?) | as G-6, 1x SC 250 or 4x SC 50 |
| **Spitfire Mk IX** | Merlin 61 (F), Merlin 66 (LF, low altitude, most built), Merlin 70 (HF, high altitude) | wing types: A 8x .303; B/C 2x Hispano + 4x .303 (game); E 2x Hispano + 2x .50 | 1x 500 lb centre; later 1x 250/500 lb centre + 2x 250 lb wing racks. Game: 1-2x GP 250, clean |
| **P-47D** | R-2800-21 (early D), R-2800-59 (D-22 on, water injection) | 8x .50 (game); 6x .50 occasionally (?); rockets (M10 tubes, HVAR) mostly 1944 | centre up to 500 lb (1000 lb later), wing racks late 1943/44; game: 2x GP 500 / 2x GP 250, clean |
| **La-5FN** | M-82FN only (the La-5 had the M-82F) | 2x ShVAK 20 only; B-20 in later production (?) | 2x 50 kg (maybe 2x 100, ?), RS-82 rockets (?) ; game: 2x FAB-100 |
| **Ki-43-II** | Ha-115 only (Ha-25 was the -I) | 2x Ho-103 12.7 only | 2x 30 kg or 2x 250 kg (?) ; game: 2x Army 100 |
| **Brewster B-239** | Wright R-1820 only | 4 machine guns (game: 4x .50; real mix of .50 and .303 / Finnish changes, ?) | none (game: no hardpoint) |
| **Bf 110 G-2** | DB 605B only | now 4x MG 17 + 2x MG 151/20 + rear MG 81Z. Real: BK 37 (37 mm) under the nose (/R1), MK 108 packs, 21 cm rocket tubes (WGr.21) (?) | 2x SC 250 or 2x SC 500 on the fuselage rack, SC 50 under the wings (?) |
| **Mosquito FB.VI** | Merlin 21/23, later Merlin 25 (more boost) | 4x Hispano + 4x .303 only; Series 2 added 8x RP-3 rockets (1943-44) | bay 2x 250 lb (or 500 lb, ?), wings 2x 250 lb or 500 lb; game: bay + rack presets |
| **Ju 87 D-5** | Jumo 211J only | now 2x MG 151/20 + rear MG 81Z. Real: 2x BK 37 pods (the G-1 "gun bird", 1943) | 1x SC 500 crutch; 1x SC 250 + 4x SC 50; SC 1000 overload (?), clean. Game: Heavy/Medium/Light/Clean |

**Engine summary:** real choices only on the Bf 109 G-6 (3), Spitfire IX (3), Mosquito (2-3), P-47D (2). The rest have one.

## Planned (milestone 6 and later), engines first

| Plane | Engine | Guns / bombs worth a choice |
|---|---|---|
| **P-38J** | Allison V-1710-89/91 (twin), one choice | 4x .50 + 1x 20 mm fixed; 2x 1000 lb or 10x HVAR rockets (?) |
| **A-36A Apache** | Allison V-1710-87 | 6x .50; 2x 500 lb |
| **Hurricane IID** | Merlin XX | 2x 40 mm Vickers S + 2x .303; the IIC had 4x 20 mm (alternative) |
| **Pe-3** | M-105PF (twin) | 1x UB 12.7 + ShKAS; ShVAK variants (?) |
| **Il-2M3** | AM-38F | 2x ShVAK 20, or 2x VYa-23 23 mm, or 2x NS-37 37 mm (1943); bombs up to 4x 100 kg internal + RS-82 rockets or PTAB bomblets (?) |
| **Ki-45 KAI** | Ha-102 (twin) | 37 mm Ho-203 + 2x 12.7, or 20 mm Ho-5 (?) |
| **D3A2 Val** | Kinsei 54 (the D3A1 had Kinsei 43) | 250 kg centre + 2x 60 kg wing |
| **Blenheim IV** | Mercury XV (twin) | belly gun pack (the IF fighter) vs bombs 4x 250 lb internal |
| **Ju 88 A-4** | Jumo 211J (twin) | bombs 4x SC 500 external or many SC 50 internal |
| **Zero (backlog)** | Sakae 12 (A6M2) or Sakae 21 (A6M3/A6M5, 1943) | 2x 7.7 + 2x Type 99 (short or long barrel); A6M5b 1x 13.2 replaces one 7.7; 2x 60 kg or 1x 250 kg |
| **Heavies (milestone 12)** | Lancaster I Merlin / III Packard Merlin / II Hercules radial; B-17F R-1820 only; He 177 coupled DB 610; Pe-8 AM-35A or ACh-30B diesel | big bays: bomb mix per bay and turret guns; own layout work |

## What this means for the hangar UI

- Engine choice is real on only a handful of planes, so it must be a section that shows only when a plane has it.
- Guns are the richest list (cannon vs MG packs, wing types), bombs are lists per hardpoint (already built).
- Rockets and gun pods are a new weapon kind in the sim (not built).
- Altitude-rated engines (AS, HF, LF) need an altitude power model to mean anything; the sim has none.
