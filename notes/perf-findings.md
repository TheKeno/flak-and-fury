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
