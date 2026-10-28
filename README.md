# Flak & Fury

A side-scrolling WWII dogfighting game for the browser, in the spirit of the 1990s classic *Triplane
Turmoil*: pixel art, take-off and landing from your own airfield, guns and bombs, stalls and blackouts,
and sound design built around a live-synthesized piston engine. Working title.

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
| Space | Guns |
| E | Bombs |
| G | Landing gear (overrides the automatic gear) |
| Arrow keys, or right mouse (hold + drag) | Look around: ahead, up, down or back over your tail |
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
