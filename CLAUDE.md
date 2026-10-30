# Flak & Fury — notes for Claude

Side-scrolling WWII dogfighter for the browser. Read [ROADMAP.md](ROADMAP.md) for the design, what's
done and what's next; [TUNING.md](TUNING.md) for every data value.

## Working with the owner

- **Before every build, recommend a model as its own step and wait for "go":**
  `🟣 **Model: Sonnet.** <reason>` (or Opus). Say whether switching is worth it right now — each switch
  re-reads the whole session, so in a long session small tweaks are cheaper on the current model.
  Opus for new systems, AI, physics, netcode, audio DSP, rendering techniques, subtle bugs; Sonnet for
  pattern-following work, data, UI, docs, small clear fixes. Pure discussion needs no recommendation.
- **Test muted:** open the game as `http://localhost:8080/?mute` in the browser pane, never the plain
  URL — the owner hears test audio through their speakers.
- **GitHub:** the repo is `TheKeno/flak-and-fury` (private). Use the **TheKeno** account, never the
  machine's other active account. Don't run `gh auth switch`; for gh commands use
  `GH_TOKEN="$(gh auth token --user TheKeno)" gh ...`. A repo-local git credential helper already
  makes `git push` use TheKeno. Commit to `main` and push after each finished change.
- The owner discusses ideas before building; when they ask for suggestions, give them and wait.
- **Look: grim.** It's war: dark, muted, desaturated colours for anything visual (sprites, terrain,
  sky, effects, UI). When unsure, go darker. **Setting: 1943** for planes, tanks and weapons.
- **Historically accurate looks:** planes, tanks and vehicles are built from the real type's
  dimensions, all to one scale; the outline shape matters most (canopy, nose, fin, gear, wing shape).
  Compare against 3-view references and show the owner the outlines before animation or data work.

## Running

```bash
node tools/serve.mjs 8080
```

Then open <http://localhost:8080>. The server also accepts PUT for existing `data/*.json` files (the
tuning panel's "Save to files"). The browser pane's preview tool may still point at an old temporary
copy of the project; if `curl http://127.0.0.1:8080/README.md` fails, start the server from this folder
yourself instead.

## Code layout and conventions

- `src/sim/` — the simulation: pure, deterministic (use `world.rng`, never `Math.random`), no DOM or
  audio. One command per controller per tick (`p1`, `bot:<skill>`). Events in `world.events` drive
  sound and effects.
- `src/net/` — online play: the host runs the world, guests send commands and get snapshots. Snapshots
  are generic, so **new sim state goes online by itself if it follows the rules** at the top of
  `src/net/snapshot.js`: plain data only (no Maps/Sets/class instances a guest needs), an `id` from
  `world.nextId` on anything kept in a list, no object shared between two places except references
  to the data files, host-only bookkeeping added to `SKIP`. `tests/net.test.mjs` catches mistakes.
  The guest never steps the sim: its screen, HUD and sound read the patched world and the events.
- Drawing is blended between the last two ticks (`src/render/interpolate.js`; guests: between
  snapshots) for x, y, angle, rollAngle and aim of anything in a top-level world list. `main.js`
  writes the blended values before rendering and puts the true ones back after sound, so code run
  from the tick loop always sees true values. A new value that moves every tick and judders on a fast
  screen goes in `POSE` there.
- `src/sim/seats.js` holds who flies where (players replace bots; `MAX_PER_SIDE`, `MAX_PLAYERS`) and
  `src/sim/bailout.js` leaving a plane (wreck, parachute, soldier). `src/ui/setup.js` only draws the table.
- `src/render/` — scenery, ground sprites and effects at `SCALE` = 2 pixels per world unit, planes at
  `PLANE_SCALE` = 4 (the buffer has `DETAIL` = 2× finer pixels; all else draws through a ×2 transform). World units are what all
  gameplay numbers use. HUD on its own 480×270 layer. Radar is a soft CRT canvas.
- `src/audio/` — Web Audio: AudioWorklet piston-engine synth, pre-rendered gun voices, spatial sound
  (pan, Doppler, speed-of-sound delay), mixer with buses and ducking.
- `src/ui/tuning.js` — live tuning panel (T); edits the loaded data objects directly.
- `sound-lab.html` + `src/ui/sound-lab.js` — the Sound Lab: audition and tune sounds, done ticks and notes, the vehicle list. Writes `data/sound.json` (vehicle → real engine → shared sound build, gun recipes, reverb and ducking; `src/audio/sound-data.js` looks it up). A new plane or tank should reuse its planned id there. The Lab tunes a running game over a BroadcastChannel (`liveUpdate` in `src/audio/soundscape.js`). The Sound Design tab is a slot view of the same data: engine clips and `startup` under `recordings`, shared airframe sounds as `layers` named `slot_*`. Recordings go through `src/audio/recordings.js`: per-sound `recordings` (synth level, groups, engine clips) and the owner's `layers`, with files in `assets/audio/`. Respect sounds ticked done and read the owner's notes in `status` before changing sounds. Open with `?mute` when testing.
- `src/ui/options.js` — the player's options menu (title, Esc): key bindings (`ACTIONS` in
  `src/input/keyboard.js`), kept in localStorage and written over the loaded settings. On-screen key
  hints use `keyName()`, never a hard-coded key.
- `data/*.json` — planes, weapons, nations, ground objects, settings (camera, audio, servicing,
  collisions, radar, hud, rules). `maps/*.ldtk` — LDtk projects, read by `src/content/ldtk.js`; the
  owner may edit them in LDtk, so change them with care (never regenerate with `tools/make-map.mjs`). `assets/sprites/` — PNGs generated by `tools/make-sprites.mjs`; planes come from 3D models in `tools/plane-models.mjs` (side view, plus a `-frames.png` sheet and `.json` for the roll and ground animations).
- New tunable values: add to the data file, the tuning panel and TUNING.md.
- Match the surrounding style: short comments explaining *why*, 2-space indent, single quotes.
- Headless sim tests: `node --test tests/`. They import `src/sim/world.js`, build a world from the data
  files and the LDtk map, and step it.
