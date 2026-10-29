# Flak & Fury

A side-scrolling WWII dogfighting game for the browser, in the spirit of the 1990s classic *Triplane
Turmoil*: pixel art, take-off and landing from your own airfield, guns and bombs, stalls and blackouts,
and sound design built around a live-synthesized piston engine. Working title.

## Play it

**<https://thekeno.github.io/flak-and-fury/>**: the latest build, updated on every push to `main`.
Click the game to capture the mouse (Esc frees it). In the tuning panel (T), "Save to files" downloads
the data files there instead of saving them.

## Running it

The game needs a small local web server (browsers won't load the data files from disk directly).
With [Node.js](https://nodejs.org) installed:

```bash
node tools/serve.mjs 8080
```

Then open <http://localhost:8080> and click to start the engine. Headphones recommended.

## Controls

| Key | Action |
|---|---|
| W / S | Throttle up / down |
| A / D | Rotate counter-clockwise / clockwise |
| Left Shift | Roll (turn around when stopped on the ground) |
| Space or left mouse | Guns |
| E or right mouse | Bombs |
| G | Landing gear (overrides the automatic gear) |
| Mouse | Look around (sticky: stays put, eases back ahead after 10 s without moving). Click the game to capture the mouse, Esc frees it |
| Arrow keys | Look around while held |
| V | Free look: mouse or arrows move the camera, wheel zooms, 1/2/3 jump, W/S fast forward; an autopilot flies your plane |
| P | Pause |
| T | Tuning panel |
| M | Mute |
| H | Hide help |

## Project layout

| Folder | Contents |
|---|---|
| `src/sim/` | The simulation: flight model, weapons, damage, bots. Pure logic, no graphics or sound, deterministic (ready for online play). |
| `src/render/` | Pixel-art renderer, sprites, particles, HUD. |
| `src/audio/` | Web Audio: engine synthesizer, gun voices, spatial sound, mixer. |
| `src/ui/` | Tuning panel. |
| `data/` | Planes, weapons, nations, camera and sound settings (JSON). |
| `maps/` | Maps. |
| `assets/sprites/` | Sprite PNGs, drawn at 2 pixels per world unit. |
| `tools/` | Local dev server and the sprite generator. |

## Tuning

Press **T** in the game for live sliders, or edit the files in `data/`. See [TUNING.md](TUNING.md) for
what every value does.
