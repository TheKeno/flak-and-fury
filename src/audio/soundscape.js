// Connects the simulation to the audio: one engine voice per plane, airflow and body sounds for
// the plane being listened from, and one-shot effects for simulation events.
import { createEngineVoice } from './engine-synth.js';
import { createAirflow } from './airflow.js';
import { createBody } from './body.js';
import { buildVoices } from './gun-voices.js';
import { createBombWhistle, createFire } from './loops.js';
import { createCrew } from './crew.js';
import { spatialize } from './spatial.js';
import * as sfx from './sfx.js';

const NEAR_MISS = 26; // px: rounds passing this close crack past your ears
const ME = { dist: 0, pan: 0, gain: 1, cutoff: 18000, delay: 0, doppler: 1 };

export function createSoundscape(mixer, world) {
  const engines = new Map();
  const fires = new Map();
  const whistles = new Map();
  const crews = new Map();
  const snapped = new Set();
  const airflow = createAirflow(mixer);
  const body = createBody(mixer);
  const voices = buildVoices(mixer.ctx);
  const listener = { x: 0, y: 0, vx: 0, vy: 0 };
  let focusId = null;
  let impactBudget = 0;

  const engineFor = (p) => {
    let v = engines.get(p.id);
    if (!v) {
      v = createEngineVoice(mixer, p.def.engine);
      engines.set(p.id, v);
      if (p.state !== 'dead') v.start();
    }
    return v;
  };
  const whereOf = (p) => (p && p.id === focusId ? ME : spatialize(listener, p.x, p.y, p.vx, p.vy));
  const whereAt = (x, y) => spatialize(listener, x, y);

  function updateEngines() {
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
        pan: where.pan,
        cutoff: where.cutoff,
        doppler: where.doppler,
      });
    }
  }

  // Ground crew sounds, placed beside the plane.
  function updateCrews() {
    for (const p of world.planes) {
      const job = p.service && p.service.wait <= 0 ? p.service.phase : null;
      let c = crews.get(p.id);
      if (job && job !== 'done') {
        if (!c) crews.set(p.id, (c = createCrew(mixer, voices)));
        const where = whereOf(p);
        c.update(job, where === ME ? { ...ME, pan: 0.3 * (Math.cos(p.angle) >= 0 ? 1 : -1), gain: 0.8 } : where);
      } else if (c) {
        c.stop();
        crews.delete(p.id);
      }
    }
  }

  function updateFires() {
    for (const p of world.planes) {
      const burning = p.burning && p.state !== 'dead';
      let f = fires.get(p.id);
      if (burning && !f) fires.set(p.id, (f = createFire(mixer)));
      if (!burning && f) {
        f.stop();
        fires.delete(p.id);
      }
      f?.update(whereOf(p), p.dying ? 1 : 0.7);
    }
  }

  function updateWhistles() {
    for (const b of world.bombsInFlight) {
      let w = whistles.get(b.id);
      if (!w) whistles.set(b.id, (w = createBombWhistle(mixer)));
      w.update(spatialize(listener, b.x, b.y, b.vx, b.vy), Math.max(0, -b.vy));
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

  return {
    listener,
    // Ears ride with the focused plane; while it's down they stay at the camera.
    update(focus, camCentre, dt = 1 / 60) {
      focusId = focus?.id ?? null;
      if (focus && focus.state !== 'dead') Object.assign(listener, { x: focus.x, y: focus.y, vx: focus.vx, vy: focus.vy });
      else Object.assign(listener, { x: camCentre.x, y: camCentre.y, vx: 0, vy: 0 });
      impactBudget = Math.min(4, impactBudget + dt * 14);

      updateEngines();
      updateFires();
      updateCrews();
      updateWhistles();
      updateNearMisses(focus);
      airflow.update(focus);
      body.update(focus);
    },
    onEvent(e) {
      const p = world.planes.find((pl) => pl.id === e.plane);
      const mine = e.plane != null && e.plane === focusId;
      const where = mine ? ME : whereAt(e.x ?? p?.x ?? listener.x, e.y ?? p?.y ?? listener.y);
      switch (e.type) {
        case 'spawn':
          engines.get(e.plane)?.start();
          break;
        case 'crash':
          engines.get(e.plane)?.stop();
          sfx.explosion(mixer, mine ? ME : whereAt(e.x, e.y), 1);
          break;
        case 'touchdown':
          sfx.touchdown(mixer, where, e.speed);
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
          sfx.play(mixer, voices[e.voice] ?? voices.rifle, where, { gain: gain * 0.45, rate: 0.93, offset: 0.007 });
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
        case 'bombRelease':
          sfx.play(mixer, voices.release, where, { gain: mine ? 0.7 : 0.5, rate: 0.8 });
          break;
        case 'bombExplode':
          whistles.get(e.bomb)?.stop();
          whistles.delete(e.bomb);
          break;
        case 'explosion':
          sfx.explosion(mixer, whereAt(e.x, e.y), 1.25);
          break;
        case 'fire':
          sfx.ignite(mixer, where);
          break;
        case 'shotDown':
          sfx.play(mixer, voices.thunk, where, { gain: mine ? 0.8 : 0.6, rate: 0.6, bus: mine ? 'body' : 'sfx' });
          break;
        case 'collision':
          sfx.explosion(mixer, whereAt(e.x, e.y), 0.9);
          break;
      }
    },
  };
}
