// The player's scroll-wheel zoom on top of the camera's own zoom (speed, dogfight, looking around).
// Pure numbers, so the rules can be tested headless. Zoom here is the view width relative to normal:
// bigger shows more world, smaller is closer in.
import { clamp } from '../sim/math.js';

// The range the wheel factor itself may take: from the closest in to the widest the dogfight camera goes.
export function wheelRange(cfg) {
  return [cfg.wheelMin, Math.max(cfg.wheelMin, cfg.fightZoomMax)];
}

// auto: the camera's own zoom this frame. wheel: the player's factor (1 = leave it as it is).
// fight: how far into dogfight framing the camera is (0..1).
// Out: the wheel can't take the view wider than fightZoomMax (the camera's own zoom is never cut).
// In: down to wheelMin with no fight; in a fight only wheelFightTighten tighter than the camera wants,
// so the planes it frames stay about where it put them. Blends with `fight`, so there's no jump.
export function playerZoom(auto, wheel, fight, cfg, maxZoom = Infinity) {
  let z = auto * wheel;
  z = Math.min(z, Math.max(auto, cfg.fightZoomMax));
  const inFight = Math.max(cfg.wheelMin, auto * (1 - cfg.wheelFightTighten));
  const floor = cfg.wheelMin + (inFight - cfg.wheelMin) * clamp(fight, 0, 1);
  return clamp(Math.max(z, Math.min(floor, auto)), 0.01, maxZoom);
}
