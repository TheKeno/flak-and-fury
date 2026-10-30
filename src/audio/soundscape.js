// Connects the simulation to the audio: one engine voice per plane, airflow and body sounds for
// the plane being listened from, and one-shot effects for simulation events.
import { createEngineVoice } from './engine-synth.js';
import { createAirflow } from './airflow.js';
import { createBody } from './body.js';
import { buildVoices, renderGun } from './gun-voices.js';
import { createBombWhistle, createFire, createScrape, createTankEngine, createRadarStatic } from './loops.js';
import { radarHealth } from '../sim/ground.js';
import { createCrew } from './crew.js';
import { spatialize } from './spatial.js';
import * as rawSfx from './sfx.js';
import { withRecordings, planeValues, tankValues } from './recordings.js';
import { engineSoundFor, syncInPlace } from './sound-data.js';

const sfx = withRecordings(rawSfx);
const NEAR_MISS = 26; // px: rounds passing this close crack past your ears
const ME = { dist: 0, pan: 0, gain: 1, cutoff: 18000, delay: 0, doppler: 1 };

// cfg: the audio settings (hearRange, bangRange: how far sounds carry), read live for the tuning panel.
// sound: data/sound.json; planeDefs: to find a plane's name in it.
export function createSoundscape(mixer, world, cfg = {}, sound, planeDefs) {
  const planeIds = new Map(Object.entries(planeDefs).map(([id, def]) => [def, id]));
  const engines = new Map();
  const fires = new Map();
  const whistles = new Map();
  const crews = new Map();
  const scrapes = new Map();
  let nextHorn = 0;
  let lookX = 0; // head turned: -1 looking left .. 1 looking right
  let looking = false;
  const snapped = new Set();
  const scope = (id) => mixer.recordings?.scoped(id) ?? mixer;
  const airflow = createAirflow(scope('loop:wind'));
  const body = createBody(scope('loop:heartbeat'));
  const layerHosts = new Map();
  const lastAngle = new Map();
  const voices = buildVoices(mixer.ctx, sound.guns);
  const listener = { x: 0, y: 0, vx: 0, vy: 0 };
  let focusId = null;
  let impactBudget = 0;
  let groundBudget = 0; // ground guns get their own share, so MG bursts don't starve bullet impacts
  const tanks = new Map();
  let radarStatic = null;
  let radarWasUp = true;
  const MATERIAL = { building: 'masonry', depot: 'masonry', hangar: 'metal', radar: 'metal', tower: 'wood', bridge: 'wood', tent: 'canvas' };

  // A synthesized loop with its recording beside it. fixed: for one that isn't placed in the world.
  const withLoop = (id, voice, fixed) => {
    const groups = mixer.recordings?.rec(`loop:${id}`)?.groups ?? [];
    const recorded = groups.map((g) => mixer.recordings.createLoop(g)).filter(Boolean);
    if (!recorded.length) return voice;
    return {
      update(a, b) {
        voice.update(a, b);
        for (const r of recorded) (fixed ? r.update(fixed, a) : r.update(a, b));
      },
      stop() {
        voice.stop();
        for (const r of recorded) r.stop();
      },
    };
  };

  const engineFor = (p) => {
    let v = engines.get(p.id);
    if (!v) {
      const { build, buildId, count } = engineSoundFor(sound, planeIds.get(p.def), p.def.engine.layout);
      v = createEngineVoice(mixer, p.def.engine, build, count, `build:${buildId}`);
      engines.set(p.id, v);
      if (p.state !== 'dead') v.start();
    }
    return v;
  };
  // Engines, tanks and most things carry about a screen; bangs and machine-gun fire twice as far.
  const hearing = () => cfg.hearRange ?? Infinity;
  const carrying = () => cfg.bangRange ?? Infinity;
  const whereOf = (p) => (p && p.id === focusId ? ME : spatialize(listener, p.x, p.y, p.vx, p.vy, hearing()));
  const whereAt = (x, y, range = hearing()) => spatialize(listener, x, y, 0, 0, range);
  const BANGS = new Set(['crash', 'shot', 'hit', 'flakFire', 'flakBurst', 'tankFire', 'tankShellBurst', 'groundDestroyed', 'explosion', 'bombExplode', 'groundShot']);

  function updateEngines(dt) {
    for (const p of world.planes) {
      const v = engineFor(p);
      const where = whereOf(p);
      const cruise = p.def.engine.cruiseRpm;
      // Damage makes the engine run rough and miss; a dying engine coughs itself to death.
      v.update({
        rpm: p.rpm,
        load: p.load,
        roughness: 0.08 + 0.25 * Math.max(0, 1 - p.rpm / cruise) + p.engineDamage * 0.5,
        // Out of fuel nothing fires (only the windmilling prop is heard); starving, it coughs.
        misfire: !p.engineRunning ? 1 : p.starved ? 0.95 : p.engineDamage * 0.22 + (p.dying ? 0.55 : 0),
        gain: where.gain,
        // Turning your head shifts your own engine slightly to the other ear.
        pan: p.id === focusId ? -lookX * 0.25 : where.pan,
        cutoff: where.cutoff,
        doppler: where.doppler,
      });
      updatePlaneLayers(p, where, dt);
    }
    // A plane taken out of the game (fewer bots set in the tuning panel) takes its engine with it.
    for (const [id, v] of engines) {
      if (world.planes.some((p) => p.id === id)) continue;
      v.dispose();
      engines.delete(id);
      layerHosts.get(id)?.stop();
      layerHosts.delete(id);
      lastAngle.delete(id);
    }
  }

  // The owner's own layers (wing creak and the like), attached in the Sound Lab.
  function updatePlaneLayers(p, where, dt) {
    if (!mixer.recordings) return;
    let host = layerHosts.get(p.id);
    if (!host) {
      const { buildId } = engineSoundFor(sound, planeIds.get(p.def), p.def.engine.layout);
      host = mixer.recordings.createLayerHost([`plane:${planeIds.get(p.def)}`, `build:${buildId}`, 'all:plane']);
      layerHosts.set(p.id, host);
    }
    const last = lastAngle.get(p.id) ?? p.angle;
    lastAngle.set(p.id, p.angle);
    const delta = Math.atan2(Math.sin(p.angle - last), Math.cos(p.angle - last));
    host.update(planeValues(p, world, Math.abs(delta) / Math.max(dt, 0.001)), where, p.id === focusId);
  }

  // Ground crew sounds, placed beside the plane.
  function updateCrews() {
    for (const p of world.planes) {
      const job = p.service && p.service.wait <= 0 ? p.service.phase : null;
      let c = crews.get(p.id);
      if (job && job !== 'done') {
        if (!c) crews.set(p.id, (c = createCrew(scope('loop:crew'), voices)));
        const where = whereOf(p);
        c.update(job, where === ME ? { ...ME, pan: 0.3 * (Math.cos(p.angle) >= 0 ? 1 : -1), gain: 0.8 } : where);
      } else if (c) {
        c.stop();
        crews.delete(p.id);
      }
    }
  }

  // Sliding on the belly, and the gear-up warning horn for the plane being listened from.
  function updateBellies(focus) {
    for (const p of world.planes) {
      const sliding = p.state === 'ground' && p.belly && p.speed > 1;
      let s = scrapes.get(p.id);
      if (sliding && !s) scrapes.set(p.id, (s = withLoop('scrape', createScrape(scope('loop:scrape')))));
      if (!sliding && s) {
        s.stop();
        scrapes.delete(p.id);
      }
      s?.update(whereOf(p), p.speed);
    }
    if (focus?.gearWarning && mixer.now >= nextHorn) {
      sfx.gearHorn(mixer);
      nextHorn = mixer.now + 0.5;
    }
  }

  function updateFires() {
    for (const p of world.planes) {
      const burning = p.burning && p.state !== 'dead';
      let f = fires.get(p.id);
      if (burning && !f) fires.set(p.id, (f = withLoop('fire', createFire(scope('loop:fire')))));
      if (!burning && f) {
        f.stop();
        fires.delete(p.id);
      }
      f?.update(whereOf(p), p.dying ? 1 : 0.7);
    }
  }

  // Engines of the nearest few tanks.
  function updateTanks() {
    const near = world.ground
      .filter((o) => o.type === 'tank' && o.alive && Math.abs(o.x - listener.x) < 900)
      .sort((a, b) => Math.abs(a.x - listener.x) - Math.abs(b.x - listener.x))
      .slice(0, 4);
    for (const [id, t] of tanks) {
      if (!near.some((o) => o.id === id)) {
        t.stop();
        t.layers?.stop();
        tanks.delete(id);
      }
    }
    for (const o of near) {
      let t = tanks.get(o.id);
      if (!t) {
        t = createTankEngine(mixer, sound.builds[sound.defaultTankBuild], `build:${sound.defaultTankBuild}`);
        t.layers = mixer.recordings?.createLayerHost([`build:${sound.defaultTankBuild}`, 'all:tank']);
        tanks.set(o.id, t);
      }
      const where = spatialize(listener, o.x, world.terrain.heightAt(o.x) + 5, o.moving ? o.dir * o.def.speed : 0, 0, hearing());
      t.update(where, o.moving);
      t.layers?.update(tankValues(o, world), where, false);
    }
  }

  // Your radar: static while it's damaged or gone, and a power-down whine when it fails.
  function updateRadar(focus) {
    const health = focus ? radarHealth(world, focus.team) : 1;
    if (radarWasUp && health <= 0) sfx.radarPowerDown(mixer);
    radarWasUp = health > 0;
    if (health < 1 && !radarStatic) radarStatic = withLoop('radarStatic', createRadarStatic(scope('loop:radarStatic')), ME);
    if (health >= 1 && radarStatic) {
      radarStatic.stop();
      radarStatic = null;
    }
    radarStatic?.update(health <= 0 ? 0.6 : (1 - health) * 0.8);
  }

  function updateWhistles() {
    for (const b of world.bombsInFlight) {
      let w = whistles.get(b.id);
      if (!w) whistles.set(b.id, (w = withLoop('bombWhistle', createBombWhistle(scope('loop:bombWhistle')))));
      w.update(spatialize(listener, b.x, b.y, b.vx, b.vy, hearing()), Math.max(0, -b.vy));
    }
  }

  // Enemy rounds that pass close crack past your head.
  function updateNearMisses(focus) {
    if (!focus || focus.state === 'dead') return;
    for (const b of world.bullets) {
      if (b.owner === focusId || snapped.has(b.id)) continue;
      const dx = b.x - focus.x;
      const dy = b.y - focus.y;
      if (dx * dx + dy * dy > NEAR_MISS * NEAR_MISS) continue;
      snapped.add(b.id);
      sfx.play(mixer, voices.snap, { ...ME, pan: Math.max(-0.8, Math.min(0.8, dx / 20)) }, { gain: 0.35, reverb: 0.05 });
    }
    if (snapped.size > 400) snapped.clear();
  }

  // What only needs redoing when a slider is let go, not on every step of its travel.
  const heavy = () => ({ guns: JSON.stringify(sound.guns), layers: JSON.stringify(sound.layers), clips: JSON.stringify(Object.values(sound.recordings).map((r) => r.clips)), space: JSON.stringify(sound.space) });
  let lastHeavy = heavy();

  return {
    listener,
    // The Sound Lab in another window changed something. final: a slider was let go or a file added.
    async liveUpdate(next, final) {
      syncInPlace(sound, next);
      mixer.recordings?.refreshScopes();
      for (const [id, v] of engines) {
        const p = world.planes.find((x) => x.id === id);
        if (p) v.setSynth(engineSoundFor(sound, planeIds.get(p.def), p.def.engine.layout).build.synth);
      }
      for (const t of tanks.values()) t.setSynth(sound.builds[sound.defaultTankBuild].synth);
      if (!final) return;
      await mixer.recordings?.load();
      const now = heavy();
      if (now.guns !== lastHeavy.guns) {
        for (const [name, recipe] of Object.entries(sound.guns)) voices[name] = renderGun(mixer.ctx, recipe, name);
      }
      if (now.space !== lastHeavy.space) mixer.applySpace();
      if (now.clips !== lastHeavy.clips) {
        for (const v of engines.values()) v.refreshClips();
        for (const t of tanks.values()) t.refreshClips();
      }
      if (now.layers !== lastHeavy.layers) {
        // Rebuilt on the next frame with the new attachments and filters.
        for (const host of layerHosts.values()) host.stop();
        layerHosts.clear();
        for (const t of tanks.values()) {
          t.layers?.stop();
          t.layers = mixer.recordings?.createLayerHost([`build:${sound.defaultTankBuild}`, 'all:tank']);
        }
      }
      lastHeavy = now;
    },
    // Mouse look: smoothed head direction, and a creak when you start craning round.
    setLook(x, active) {
      lookX = x;
      if (active && !looking) sfx.helmetCreak(mixer);
      looking = active;
    },
    // A soft tick as the radar beam starts a new sweep.
    radarTick() {
      sfx.play(mixer, voices.click, ME, { gain: 0.12, rate: 0.6, bus: 'ambience' });
    },
    // Ears ride with the focused plane; while it's down they stay at the camera.
    update(focus, camCentre, dt = 1 / 60) {
      focusId = focus?.id ?? null;
      if (focus && focus.state !== 'dead') Object.assign(listener, { x: focus.x, y: focus.y, vx: focus.vx, vy: focus.vy });
      else Object.assign(listener, { x: camCentre.x, y: camCentre.y, vx: 0, vy: 0 });
      impactBudget = Math.min(4, impactBudget + dt * 14);
      groundBudget = Math.min(6, groundBudget + dt * 18);
      updateTanks();
      updateRadar(focus);

      updateEngines(dt);
      updateFires();
      updateCrews();
      updateBellies(focus);
      updateWhistles();
      updateNearMisses(focus);
      airflow.update(focus);
      body.update(focus);
    },
    onEvent(e) {
      const p = world.planes.find((pl) => pl.id === e.plane);
      const mine = e.plane != null && e.plane === focusId;
      // Rifles are quiet; everything else on the bang list carries.
      const range = BANGS.has(e.type) && !(e.type === 'groundShot' && e.kind === 'infantry') ? carrying() : hearing();
      const where = mine ? ME : whereAt(e.x ?? p?.x ?? listener.x, e.y ?? p?.y ?? listener.y, range);
      switch (e.type) {
        case 'spawn':
          engines.get(e.plane)?.start();
          break;
        case 'crash':
          engines.get(e.plane)?.stop();
          sfx.explosion(mixer, mine ? ME : whereAt(e.x, e.y, range), 1);
          break;
        case 'touchdown':
          sfx.touchdown(mixer, where, e.speed);
          break;
        case 'hardLanding':
          // A jarring thump: the touchdown sound driven hard, and a crunch if the propeller bit.
          sfx.touchdown(mixer, where, 140 + 60 * e.severity);
          if (e.noseDown) sfx.bellyCrunch(mixer, where, 40);
          break;
        case 'roll':
          sfx.rollWhoosh(mixer, where);
          break;
        case 'gearMove': {
          // Run the pump for as long as the gear still has to travel.
          const travel = p ? (e.down ? 1 - p.gear : p.gear) * (p.def.gearTime ?? 1.6) : 1.6;
          sfx.gearMotor(mixer, where, Math.max(0.2, travel), e.down);
          break;
        }
        case 'bellyLanding':
          sfx.bellyCrunch(mixer, where, e.speed);
          break;
        case 'gearLocked':
          // Up: one solid clunk into the wing. Down: the lock pins snapping home.
          sfx.play(mixer, voices.thunk, where, { gain: mine ? 0.45 : 0.6, rate: 0.85 });
          if (e.down) sfx.play(mixer, voices.clank, where, { gain: 0.25, rate: 0.7, offset: 0.06 });
          break;
        case 'engineStart':
          engines.get(e.plane)?.start();
          break;
        case 'serviceDone':
          sfx.play(mixer, voices.thunk, where, { gain: 0.5, rate: 1.1 });
          sfx.play(mixer, voices.thunk, where, { gain: 0.5, rate: 1.1, offset: 0.18 });
          break;
        case 'fuelLow':
          if (mine) for (let i = 0; i < 3; i++) sfx.play(mixer, voices.click, ME, { gain: 0.5, rate: 0.8, offset: i * 0.25 });
          break;
        case 'wake':
          body.gasp();
          break;
        case 'shot': {
          // Two slightly offset layers make a battery of guns sound like several weapons.
          const gain = mine ? 0.42 : 0.8;
          sfx.play(mixer, voices[e.voice] ?? voices.rifle, where, { gain, reverb: mine ? 0.08 : 0.3 });
          sfx.play(mixer, voices[e.voice] ?? voices.rifle, where, { gain: gain * 0.45, rate: 0.93, offset: 0.007, echo: true });
          break;
        }
        case 'empty':
          if (mine) sfx.play(mixer, voices.click, ME, { gain: 0.5 });
          break;
        case 'hit':
          if (mine) {
            sfx.play(mixer, voices.thunk, ME, { gain: 0.6, bus: 'body' });
            sfx.play(mixer, voices.clank, { ...ME, pan: (Math.random() - 0.5) * 0.8 }, { gain: 0.5 });
            mixer.duck(0.25, 0.04, 0.3);
          } else {
            sfx.play(mixer, voices.clank, where, { gain: 0.7, reverb: 0.2 });
          }
          break;
        case 'impact':
          if (impactBudget >= 1) {
            impactBudget--;
            sfx.play(mixer, voices.thud, where, { gain: 0.5 });
          }
          break;
        // Stand-ins until the ground objects get their own sounds (collapses, debris).
        case 'groundHit':
          if (impactBudget >= 1) {
            impactBudget--;
            sfx.play(mixer, e.kind === 'flak' || e.kind === 'mgNest' || e.kind === 'radar' ? voices.clank : voices.thud, where, { gain: 0.5, reverb: 0.2 });
          }
          break;
        case 'flakFire':
          sfx.play(mixer, voices.flakGun, where, { gain: 1, reverb: 0.55 });
          break;
        case 'groundShot':
          if (groundBudget >= 1) {
            groundBudget--;
            if (e.kind === 'infantry') sfx.play(mixer, voices.infantryRifle, where, { gain: 0.45, reverb: 0.45 });
            else sfx.play(mixer, voices.rifle, where, { gain: 0.6, rate: e.kind === 'tank' ? 0.8 : 0.88, reverb: 0.35 });
          }
          break;
        case 'tankFire':
          sfx.play(mixer, voices.tankGun, where, { gain: 0.9, reverb: 0.45 });
          break;
        case 'tankShellBurst':
          sfx.explosion(mixer, whereAt(e.x, e.y, range), 0.5);
          break;
        case 'flakBurst':
          sfx.flakBurst(mixer, whereAt(e.x, e.y, range));
          break;
        case 'shrapnel':
          if (mine) sfx.shrapnel(mixer, voices, e.damage);
          else sfx.play(mixer, voices.patter, where, { gain: 0.4 });
          break;
        case 'groundDestroyed':
          if (MATERIAL[e.kind]) sfx.collapse(mixer, where, MATERIAL[e.kind], e.kind === 'building' || e.kind === 'depot' || e.kind === 'hangar' ? 1.2 : 0.8);
          else sfx.explosion(mixer, where, e.kind === 'tank' ? 0.9 : 0.6);
          if (e.kind === 'bridge') sfx.splash(mixer, where);
          break;
        case 'fireOut':
          sfx.fireOut(mixer, where);
          break;
        case 'bridgeRebuilt':
          sfx.hammering(mixer, where);
          break;
        case 'bombRelease':
          sfx.play(mixer, voices.release, where, { gain: mine ? 0.7 : 0.5, rate: 0.8 });
          break;
        case 'bombExplode':
          whistles.get(e.bomb)?.stop();
          whistles.delete(e.bomb);
          break;
        case 'explosion':
          sfx.explosion(mixer, whereAt(e.x, e.y, range), 1.25);
          break;
        case 'fire':
          sfx.ignite(mixer, where);
          break;
        case 'shotDown':
          sfx.play(mixer, voices.thunk, where, { gain: mine ? 0.8 : 0.6, rate: 0.6, bus: mine ? 'body' : 'sfx' });
          break;
        case 'collision': {
          const involved = e.a === focusId || e.b === focusId;
          const at = involved ? ME : whereAt(e.x, e.y, range);
          if (e.severity === 'fatal') sfx.explosion(mixer, at, 1.1);
          else sfx.midair(mixer, at, e.severity, e.taran);
          break;
        }
      }
    },
  };
}
