# Flak & Fury

A side-scrolling WWII dogfighting game for the browser, in the spirit of the 1990s classic *Triplane
Turmoil*: pixel art, take-off and landing from your own airfield, guns and bombs, stalls and blackouts,
and sound design built around a live-synthesized piston engine. Working title.

## Play it

**<https://thekeno.github.io/flak-and-fury/>**: the latest build, updated on every push to `main`.
Click the game to capture the mouse so its buttons work (Esc frees it). In the tuning panel (T), "Save to files" downloads
the data files there instead of saving them.

## Running it

The game needs a small local web server (browsers won't load the data files from disk directly).
With [Node.js](https://nodejs.org) installed:

```bash
node tools/serve.mjs 8080
```

Then open <http://localhost:8080> and pick Single player. Headphones recommended.

## Playing online

One player picks **Host online game** and reads out the 4-letter room code; the other picks **Join
online game** and types it in. The setup screen shows both sides: the host sets the planes per side
and the bots, and each player picks their own side and plane. Up to 4 players, 2 a side, taking bots' places. It runs browser to
browser (WebRTC), so both just open the game page; no server needed. Free look and the tuning panel are
the host's. Esc online opens the menu without pausing: an autopilot flies your plane until you resume.

## Controls

These are the defaults; **Options** (title screen, or Esc in game) rebinds every action to two keys or
mouse buttons each, and holds volume, fullscreen, gore, markings, the gunsight and pilot names. They are
kept in the browser.

| Key | Action |
|---|---|
| W / S | Throttle up / down |
| A / D | Rotate counter-clockwise / clockwise |
| Left Shift | Roll (turn around when stopped on the ground) |
| Space or left mouse | Guns |
| E or right mouse | Bombs |
| G | Landing gear (overrides the automatic gear) |
| B | Bail out, at once, anywhere. After 3 s, fire gets you a new plane |
| Mouse | Look around, off by default (switch on **Mouse look** in Options; sticky: stays put, eases back ahead after 3 s without moving). Click the game to capture the mouse so the left and right buttons fire and bomb |
| Arrow keys | Look around while held |
| Esc | Menu: pause (single player), options, quit |
| F11 | Fullscreen (the game's own: in Chrome and Edge a tap of Esc then opens the menu, holding Esc leaves fullscreen; in Firefox Esc leaves it, and Resume or a click on the game goes back) |
| V | Free look: mouse or arrows move the camera, wheel zooms, 1/2/3 jump, W/S fast forward; an autopilot flies your plane |
| F3 | Frame rate and timing overlay (debug): fps, frame gap, CPU ms per part of a frame |
| T | Tuning panel |
| M | Mute |
| H | Hide help |

## Project layout

| Folder | Contents |
|---|---|
| `src/sim/` | The simulation: flight model, weapons, damage, bots, seats, bailing out. Pure logic, no graphics or sound, deterministic (ready for online play). |
| `src/render/` | Pixel-art renderer, sprites, particles, HUD, radar, fight camera. |
| `src/audio/` | Web Audio: engine synthesizer, gun voices, recordings, spatial sound, mixer. |
| `src/input/` | Keyboard and mouse: the bindable actions and their default keys. |
| `src/content/` | Loads the data files and reads the LDtk maps. |
| `src/net/` | Online play: snapshots of the world, the guest's smoothed view, PeerJS connections. |
| `src/ui/` | Options menu (`options.js`), setup screen (`setup.js`), tuning panel (`tuning.js`) and the Sound Lab page (`sound-lab.js`). |
| `data/` | Planes, weapons, nations, ground objects, settings and sound (`sound.json`, written by the Sound Lab), all JSON. |
| `maps/` | Maps (LDtk projects). |
| `assets/sprites/` | Sprite PNGs, drawn at 2 pixels per world unit (planes at 4). |
| `assets/audio/` | Sound recordings, sorted by use into `engines/`, `guns/`, `impacts/`, `destruction/`, `airframe/`, `crew/`, `ambience/`, `voice/`, `ui/` (and `inbox/` for unsorted uploads). |
| `tests/` | Headless tests of the simulation, online snapshots and sound data: `node --test tests/`. |
| `tools/` | Local dev server (`serve.mjs`); sprite generator (`make-sprites.mjs`) with the 3D plane models (`plane-models.mjs`) and PNG writer (`png.mjs`); map tools (`make-map.mjs`, `map-guide.mjs`). |
| `sound-lab.html` | The Sound Lab: audition and tune sounds, engines and recordings. Open <http://localhost:8080/sound-lab.html>. |

## Tuning

Press **T** in the game for live sliders, or edit the files in `data/`. See [TUNING.md](TUNING.md) for
what every value does.
