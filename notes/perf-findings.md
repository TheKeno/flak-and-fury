# Performance findings (2026-11-03, after milestone 7)

Awaiting the owner's approval of the fix list. **Nothing has been optimised yet.**

## Tool

F3 shows the overlay (off by default; rebindable under Options): fps, average and worst frame gap over
the last second, and CPU ms per part of a frame (`src/ui/perfstats.js`, `prof.mark` calls in
`renderer.js`/`main.js`). Canvas drawing is queued for the GPU, so the ms are the cost of issuing the
calls; the frame gap is the real measure. The numbers are also in `window.__perf` in the console.

## (b) Stutter of terrain and ground at 120-144 Hz

Interpolation is built and correct on paper (`interpolate.js`, wired in `frame()`; tests pass). I could
not confirm "stutter gone" by eye: the browser pane is capped at 60 Hz, so a 144 Hz display is needed.
**The owner should press F3 on their 144 Hz screen** (the overlay is pushed, so it is also on the
Pages site once it deploys) and report fps/gap, and whether the scenery still jerks.

A leftover cause is visible in the code, though. `updateCamera` rounds the camera to `SCALE` steps
(`cam.x = Math.round(cam.x * SCALE) / SCALE`, `renderer.js:273`), i.e. whole scenery pixels = 2
buffer pixels, while planes are placed at buffer-pixel precision (`planeX`, `PLANE_SCALE` 4). So at
144 Hz scenery moves in 2-px steps, the plane in 1-px steps, and the plane wobbles against the
screen. Interpolating the world does not fix that; the camera quantisation does.

## (a) Low FPS: measurements (localhost, ?mute, single player, flying, browser pane, dpr 1.25)

| Window | fps | frame gap | CPU ms / frame |
|---|---|---|---|
| 1024x768 (canvas 1280x960) | 59 | 16.8 ms | ~3.6 |
| 1280x720 emulated (canvas 1600x900) | 40 | 25 ms | ~3 |
| 1920x1080 emulated (canvas 2400x1350) | 40 | 25 ms | ~2.9 |

CPU split (1024x768): terrain 1.45, present (buffer to screen) 0.64, sky 0.38, sim 0.29, hud 0.18,
radar 0.15, audio 0.15, planes 0.13, rest <0.05 each (ground, gore, particles, shots near zero in a
quiet scene).

- The JS side is cheap (~3 ms, 18% of a 60 Hz frame). Low fps is therefore **GPU/compositor bound**,
  not a script problem. The 25 ms gaps are exact vsync divisors (40 Hz), the sign of a GPU that
  just misses 16.7 ms.
- Caveat: the pane may run on a software renderer, and its resize emulation behaves oddly, so the
  GPU numbers are indicative only. The owner's machine decides.
- Not yet measured: a busy fight (gore, smoke, flak bursts), online as host/guest, the Pages site (its
  build has no overlay until this commit deploys).

## Ranked fixes (proposed, for approval)

1. **Cap the screen canvas size** (`fitDisplay`: backing store = clientWidth x devicePixelRatio, so a
   4K or high-dpi window gives up to 8M pixels filled several times per frame: buffer blit, HUD,
   radar). Cap at e.g. 1920 wide (or the buffer's own size x1-2) and let CSS scale it. Biggest
   expected win on big screens. Cheap.
2. **Camera without scenery-pixel quantisation**: snap to buffer pixels (1/4 unit) instead of 1/2, or
   draw terrain with a sub-pixel offset. Fixes the plane-vs-scenery wobble at high refresh. Cheap.
3. **Cache terrain columns**: `drawTerrain` runs ~960 columns x ~5 `fillRect` + `airfields.find` +
   `heightAt` every frame (the biggest CPU item). Pre-render the terrain to an offscreen strip (redraw
   only columns changed by craters or scorch) and blit. Saves ~1 ms CPU and GPU draw calls.
4. **Skip the extra copy**: `present` copies the 2x-detail buffer to the screen; if DETAIL 2 is not
   needed outside planes, draw scenery into a half-size buffer. Test visual impact first (owner's call).
5. **Radar and HUD**: radar scope is upscaled with smoothing every frame; draw it at 20-30 Hz into its
   own canvas. Small.
6. **Measure the busy case first** (gore, particles, smoke) before touching them: near zero at idle.

## Questions for the owner

- What fps/gap does F3 show on your 144 Hz screen, in the title-to-flight scene and in a fight? Is it
  a laptop or a desktop GPU, and which browser?

## Update (owner's own measurements, 2026-11-03)

Owner's setup: ROG PG278QE 2560x1440 at 120 Hz (not 144), second display 1920x1080 at 60 Hz on HDMI,
RTX 5070, Windows 10, Edge, 125% scaling.

- Uncapped, parked: 93 fps (gap 10.8 ms). Flying: flat 60. Dropped to 40 when the screen-grab overlay
  opened (120/2 and 120/3: frames land on whole refresh steps).
- `?cap=1080` (canvas limited to 1920x1080): no change (60 fps). **Fix 1 (canvas cap) is dropped.**
- `?skip=` switch (leaves parts out): terrain, sky+terrain, radar, hud, planes each: still 60. With
  everything left out (cpu 0.5 ms, nearly empty screen): **still 60.** So the game's drawing is not what
  limits the frame rate; something in the browser or system holds it to 60.
- Suspects, not yet confirmed: the 60 Hz second display (Windows 10 mixed refresh rates), browser
  hardware acceleration or power saving. Next: Win+P "PC screen only", testufo.com/refreshrate,
  `edge://gpu`, another browser.
- Fix 2 (camera snap) and fix 3 (terrain cache, ~1.3 ms CPU) remain as cheap improvements; the
  stutter question can only be judged once the frame rate is steady.

## Resolved: the 60 fps cap was the NVIDIA driver (2026-11-03)

Owner's NVIDIA Control Panel had a 60 fps limit set. After clearing it Firefox shows 99 fps, gap 10.1 ms,
worst 16.7 ms, CPU 2.7 ms a frame (terrain 1.24, planes 0.41, sky 0.28, hud 0.28). The game was never
the limit. Open: owner to say whether scenery still stutters against the plane at ~100 Hz; if so, build
fix 2 (camera snap to buffer pixels). Terrain cache stays an optional saving for weak 1080p machines.

## Built: terrain cache (2026-11-03)

`drawTerrain` now paints the ground once into 512-column chunks (world pixels) and blits the visible
chunks each frame; a chunk repaints when its heights or scorch change (craters). Only the river glint is
drawn live. F3 shows `chunkbuild /s` (0 at rest). Pane: terrain 1.4 ms -> 0.02 ms; a crater dug with
`__game.world.terrain.crater` showed up at once; the cached and direct frames differ by 26 pixels (river
glint timing). `?skip=terraincache` goes back to the old per-column drawing for comparison. Owner to
re-measure low flying in a fight (before: terrain 2.3-2.7 ms, 60-74 fps on a 120 Hz screen).

## Result on the owner's PC (2026-11-03)

Low-flying fight (plane on fire, tanks, flak, smoke), 2560x1440 at 120 Hz, Firefox: **120 fps, gap 8.3 ms,
worst 10.3 ms**, CPU 2.0 ms (terrain 0.01, planes 0.46, sky 0.43, sim 0.30), rollbuild 3/s, cacheclr 0,
chunkbuild 0. Before the cache and the driver fix: 60-74 fps, CPU 4-7 ms. Performance task done; left
open only if the owner still sees ground stutter: camera snap to buffer pixels, prebuilt roll frames.

## Clouds, rain, night: measured and cached (2026-11-17)

**Why the browser pane showed 1-30 fps:** the pane was hidden (no window showed the session), so Chrome ran the
game as a background page: frames came every 66.8 ms (15 fps) whatever was drawn. That is the browser
throttling, not the game. Real frame rates must be read on a visible screen (F3).

**How it was measured:** `tools/perf-bench.js` (load in the console during a match: `await
import('/tools/perf-bench.js'); __scenes()`) renders a fixed free-look scene 120 times and gives, per profiler
section, the CPU ms and the draw calls and painted pixels (the GPU's share, which a hidden pane cannot time).
The renderer now marks `clouds`, `rain` and `night` separately (they were inside `planes`). `__shot` and
`__diff` compare two renders pixel by pixel; the caches can be switched off live with
`__game.renderer.skip.add('cloudcache')` / `'ridgecache'` (or `?skip=cloudcache,ridgecache`).
Pane 1280x720, dpr 1.25, RTX 5070 (hardware, ANGLE D3D11).

### Before and after (CPU ms a frame, draw calls)

| Scene | before | after |
|---|---|---|
| ground war, quiet (total) | 2.52 ms | 0.70 ms |
| in the cloud layer | 1.42 ms | 0.56 ms |
| rain under the layer | 1.49 ms | 0.59 ms |
| night | 2.55 ms | 0.55 ms |
| night + rain + cloud | 1.54 ms | 0.56 ms |
| busy front (after 150 s of bots), total | 1.49 ms | ~1.0-1.3 ms (radar and present vary) |

Per area:

| Area | before | after |
|---|---|---|
| sky (two hill ridges) | 0.15-0.32 ms, **1923 calls** | 0.02 ms, 3-5 calls |
| cloud layer | 0.17-0.28 ms, **955 calls** | 0.01 ms, 4-6 calls |
| present (where the queued calls are flushed) | 0.64-1.48 ms | 0.16-0.19 ms (quiet scenes) |
| planes (4-8 planes, most off screen) | 0.13 ms, **318 calls** | 0.03 ms, 25 calls |
| particles (~500 alive) | 0.11-0.14 ms, **540-630 calls** | 0.01-0.03 ms, 18-50 calls |
| rain | 0.06-0.08 ms, 26-94 calls | unchanged |
| night (dark fill + beams) | < 0.01 ms | unchanged |

### What changed (`src/render/renderer.js`, `src/render/particles.js`)

- **Hill ridges:** painted once into a strip per ridge and copied in one call, instead of one rectangle per
  pixel column every frame. A ridge's top may land one pixel off in a column (rounded in two steps).
- **Cloud layer:** painted once into 510-pixel chunks laid along the drifting layer (it only drifts, its shape
  never changes in a match), back and veil, and copied each frame, like the terrain cache. A tuning change or
  new match starts the chunks again. The columns now sit on the layer instead of on the screen.
- **Planes off the screen are not drawn** (their cloud fade and muzzle flash still count down).
- **Gear tyres:** each tyre size painted once (it was up to ~40 one-pixel rectangles per wheel per frame).
- **Particles off the screen are not drawn.**
- Pixel compare, old drawing vs cached, same scene: differs in ~1250 of 921600 pixels, the same as two renders
  of the old drawing (the radar's random noise). The look is unchanged.

### The sim (bots on, 4 a side)

`node tools/sim-bench.mjs [minutes] [seed] [perSide]`: 0.22-0.31 ms a tick on average, p99 0.6-0.8 ms, worst
~5-6 ms (JIT warm-up at the start). It prints a digest of the final world: the same seed gives the same digest,
so a later sim speed-up can be checked not to change outcomes. **Not changed:** the sim is ~0.3 ms of a frame.
Profile (`node --cpu-prof`): the ground war takes most of it: `stepArmy` 18%, `holdUp` 13% (`army.js`),
`pickTarget` 6%, `stepMg` 5%, `stepInfantry` 3% (`defences.js`); bot flying (`ai.js`) ~10% in all.

### Left (small, not done)

- Ground objects are culled sideways only: ~470 calls when the camera is high above them (0.12 ms). A height
  cull must keep searchlight beams (they reach up from below) and ground muzzle flashes ticking.
- `holdUp`/`stepArmy` in `army.js` could find neighbours faster (they were being changed by the anti-tank
  session at the same time, so left alone). Worth it only if bigger armies come.
- Radar: ~260 small calls a frame (0.15 ms); its noise is random every frame by design.
- Owner: check fps with F3 on your own screen with `?rain&night` in a fight.

## Firefox at 30 fps after the map stretch (2026-11-24)

The owner's Firefox ran 30 fps (gap 33 ms) on the 10,000-wide Kursk map, Edge 120. Firefox can be run from a
script with a throwaway profile (`firefox -no-remote -profile <scratch dir> --kiosk http://localhost:8080/?mute&bench`),
and `?bench` puts its result in the tab title, which PowerShell reads (`(Get-Process firefox).MainWindowTitle`).
Result at 2560x1440 (fps, one part left out per run): all 109, ridges as one long strip 25, everything else 120.
The near ridge strip was 10,728 px wide (map width x 0.45 parallax), past Firefox's GPU canvas size, so each frame's
copy from it was slow. Fix: ridges cut into 2048-px tiles. Edge (same bench): 110-120 with tiles or the strip.
Rule for later: keep any cached canvas under ~4096 px a side (terrain and cloud chunks are 512 wide; the sky strip
is 2 x ~4400 tall, fine so far).
