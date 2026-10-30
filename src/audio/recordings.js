// Recordings on top of the synthesized sounds, all described by data/sound.json:
//   recordings[soundId] = { synth, groups: [...], clips: [...] }: a sound's synth level and its files
//   layers[id]: the owner's own sounds, attached to vehicles and driven by game values
// A group is one or more files (random variations) with one set of tweaks.
import { out } from './sfx.js';
import { spatialChain } from './loops.js';
import { mapRange, DRIVERS } from './sound-data.js';

const ME = { dist: 0, pan: 0, gain: 1, cutoff: 18000, delay: 0, doppler: 1 };
const setT = (param, v, ctx, tc = 0.04) => param.setTargetAtTime(v, ctx.currentTime, tc);

export function newGroup() {
  return { files: [], gain: 1, pitch: 0, fadeIn: 0, fadeOut: 0, reverse: false, lowpass: 20000, highpass: 20, drive: 0, pitchVar: 0.03, gainVar: 0.1, reverb: 0.15, delay: 0, xfade: 0.05, mapFrom: 0, mapTo: 1, gainLow: 1, gainHigh: 1, pitchLow: 1, pitchHigh: 1 };
}

// Every file a piece of sound data refers to.
function pathsIn(sound) {
  const paths = new Set();
  const add = (list) => list?.forEach((f) => f.path && paths.add(f.path));
  for (const r of Object.values(sound.recordings ?? {})) {
    r.groups?.forEach((g) => add(g.files));
    add(r.clips);
    add(r.startup?.files);
  }
  for (const l of Object.values(sound.layers ?? {})) add(l.group?.files);
  return paths;
}

export function createRecordings(mixer, sound) {
  const { ctx } = mixer;
  const buffers = new Map();
  const derived = new Map(); // reversed and seamless versions
  const scopes = new Map();
  const playing = new Map(); // recordings of one-shots under way, by sound
  const heads = new Map(); // where each file is being heard, for the Sound Lab's play marker
  // A one-shot's position is worked out when asked for, from when it started.
  const headFrom = (file, begin, at, speed, length, backwards) => heads.set(file, { begin, at, speed, length, backwards });

  async function ensure(path) {
    if (buffers.has(path)) return buffers.get(path);
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(res.status);
      const raw = await ctx.decodeAudioData(await res.arrayBuffer());
      // The game places each sound itself as it moves, so everything is mono.
      const mono = ctx.createBuffer(1, raw.length, raw.sampleRate);
      const d = mono.getChannelData(0);
      for (let c = 0; c < raw.numberOfChannels; c++) {
        const s = raw.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] += s[i] / raw.numberOfChannels;
      }
      buffers.set(path, mono);
      return mono;
    } catch (e) {
      console.warn(`Recording not loaded: ${path} (${e.message})`);
      return null;
    }
  }

  const reversed = (path, buf) => {
    const key = `r|${path}`;
    if (!derived.has(key)) {
      const r = ctx.createBuffer(1, buf.length, buf.sampleRate);
      r.getChannelData(0).set(buf.getChannelData(0).slice().reverse());
      derived.set(key, r);
    }
    return derived.get(key);
  };

  // A loop's seam is hidden by fading what follows its end into its start, so it still runs right
  // to the end marker. Only when the file has too little after the marker is the loop cut shorter.
  function seamless(file, xfade) {
    const buf = buffers.get(file.path);
    if (!buf) return null;
    const a = Math.floor((file.start ?? 0) * buf.sampleRate);
    const b = Math.floor((file.end ?? buf.duration) * buf.sampleRate);
    const key = `${file.path}|${a}|${b}|${xfade}`;
    if (derived.has(key)) return derived.get(key);
    const fade = Math.min(Math.floor(xfade * buf.sampleRate), Math.floor((b - a) / 2));
    const past = Math.min(fade, buf.length - b);
    const len = Math.max(1, b - a - (fade - past));
    const loop = ctx.createBuffer(1, len, buf.sampleRate);
    const d = loop.getChannelData(0);
    const s = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = s[a + i];
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[i] = d[i] * Math.sqrt(t) + s[a + len + i] * Math.sqrt(1 - t);
    }
    derived.set(key, loop);
    return loop;
  }

  // A loop that follows its file's trim: moved markers are heard from the next time round.
  function liveSource(file, xfadeOf, dest) {
    let src = null;
    let g = null;
    let key = '';
    let pos = 0;
    let last = ctx.currentTime;
    let rate = 1;
    let seam = xfadeOf();
    let hearSeamAt = Infinity;
    const keyNow = () => `${file.start}|${file.end}|${xfadeOf()}`;
    const open = (offset, at) => {
      key = keyNow();
      const buffer = seamless(file, xfadeOf());
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.playbackRate.value = rate;
      const fade = ctx.createGain();
      fade.gain.setValueAtTime(0, at);
      fade.gain.linearRampToValueAtTime(1, at + 0.015);
      s.connect(fade).connect(dest);
      s.start(at, offset);
      src = s;
      g = fade;
      pos = offset;
    };
    open(Math.random() * seamless(file, xfadeOf()).duration, ctx.currentTime);
    return {
      // Called every frame. r: how fast it plays now.
      setRate(r, audible = true, tc = 0.04) {
        const now = ctx.currentTime;
        const length = src.buffer.duration;
        pos += (now - last) * rate;
        last = now;
        rate = r;
        src.playbackRate.setTargetAtTime(r, now, tc);
        if (pos >= length) pos %= length;
        if (audible) heads.set(file, { loop: (file.start ?? 0) + Math.max(0, pos), seen: now });
        // A very short crossfade covers the join, since the two are cut from different places.
        const swap = (at, offset) => {
          const oldSrc = src;
          const oldG = g;
          oldG.gain.setValueAtTime(1, at);
          oldG.gain.linearRampToValueAtTime(0, at + 0.015);
          oldSrc.stop(at + 0.03);
          open(offset, at);
        };
        // The seam slider jumps to just before the seam, or nothing would be heard until the
        // loop came round. It waits for a pause in the dragging.
        if (xfadeOf() !== seam) {
          seam = xfadeOf();
          hearSeamAt = now + 0.15;
        }
        if (now >= hearSeamAt) {
          hearSeamAt = Infinity;
          swap(now, Math.max(0, seamless(file, seam).duration - 1.2 * r));
          return;
        }
        const left = (length - pos) / Math.max(0.05, r);
        if (left > 0.12 || keyNow() === key) return;
        swap(now + left, 0);
        pos = -left * r;
      },
      stop() {
        src.stop();
        g.disconnect();
      },
    };
  }

  // Filters and distortion of a group, ending in dest. Returns where to connect the source.
  function tweaks(group, dest) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = group.highpass;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = group.lowpass;
    hp.connect(lp);
    if (group.drive > 0) {
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      const k = 1 + group.drive * 8;
      for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(((i / 511.5) - 1) * k) / Math.tanh(k);
      shaper.curve = curve;
      lp.connect(shaper).connect(dest);
    } else lp.connect(dest);
    return hp;
  }

  function playGroup(group, where, { gain = 1, rate = 1, offset = 0, reverb, bus = 'sfx', pitch = 0 } = {}) {
    const files = group.files.filter((f) => buffers.has(f.path));
    if (!files.length) return;
    const file = files[Math.floor(Math.random() * files.length)];
    const raw = buffers.get(file.path);
    const buf = group.reverse ? reversed(file.path, raw) : raw;
    const start = group.reverse ? raw.duration - (file.end ?? raw.duration) : file.start ?? 0;
    const length = Math.max(0.005, (file.end ?? raw.duration) - (file.start ?? 0));
    const at = mixer.now + where.delay + group.delay + offset;
    const speed = 2 ** ((group.pitch + pitch) / 12) * rate * (1 + (Math.random() * 2 - 1) * group.pitchVar) * (where.doppler ?? 1);
    const level = group.gain * gain * (1 + (Math.random() * 2 - 1) * group.gainVar);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed;
    const env = ctx.createGain();
    const heard = length / speed;
    const fadeIn = Math.min(group.fadeIn, heard / 2);
    const fadeOut = Math.min(group.fadeOut, heard / 2);
    env.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, at);
    if (fadeIn > 0) env.gain.linearRampToValueAtTime(1, at + fadeIn);
    if (fadeOut > 0) {
      env.gain.setValueAtTime(1, at + heard - fadeOut);
      env.gain.linearRampToValueAtTime(0, at + heard);
    }
    const dest = bus === 'sfx'
      ? out(mixer, { ...where, gain: where.gain * level }, at, reverb ?? group.reverb)
      : (() => {
          const g = ctx.createGain();
          g.gain.value = level;
          g.connect(mixer.buses[bus]);
          return g;
        })();
    src.connect(env).connect(tweaks(group, dest));
    src.start(at, start, length);
    headFrom(file, group.reverse ? file.end ?? raw.duration : start, at, speed, length, group.reverse);
    src.addEventListener('ended', () => heads.delete(file));
    return src;
  }

  // One looping group that follows a value: a recorded fire, a wing rattle.
  function createLoop(group, chainMixer = mixer) {
    const file = group.files.find((f) => buffers.has(f.path));
    if (!file) return null;
    const chain = spatialChain(chainMixer, group.reverb);
    const src = liveSource(file, () => group.xfade, tweaks(group, chain.input));
    return {
      update(where, value = 1, { gain = 1, pitch = 0 } = {}) {
        const m = mapRange(value, group);
        src.setRate(2 ** ((group.pitch + pitch) / 12) * m.pitch * (where.doppler ?? 1), group.gain * gain * m.gain * where.gain > 0.001);
        chain.place(where, group.gain * gain * m.gain);
      },
      stop() {
        chain.fade(() => src.stop());
      },
    };
  }

  // Recorded engine clips, each at a known rpm: pitched to the engine and crossfaded between each other.
  function createClips(recId, count, detune, dest) {
    const rec = sound.recordings?.[recId];
    const clips = (rec?.clips ?? []).filter((c) => buffers.has(c.path) && c.role !== 'tracks' && c.rpm > 0).sort((a, b) => a.rpm - b.rpm);
    if (!clips.length) return null;
    const engines = Math.min(4, count);
    const voices = clips.map((clip) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(dest);
      const srcs = Array.from({ length: engines }, () => liveSource(clip, () => clip.xfade ?? 0.05, g));
      return { clip, g, srcs };
    });
    return {
      update({ rpm, load, misfire, doppler = 1 }) {
        // Between the two nearest clips, equal-power so the level doesn't sag midway.
        let hi = clips.findIndex((c) => c.rpm >= rpm);
        if (hi < 0) hi = clips.length - 1;
        const lo = Math.max(0, hi - 1);
        const span = clips[hi].rpm - clips[lo].rpm;
        const t = span > 0 ? Math.max(0, Math.min(1, (rpm - clips[lo].rpm) / span)) : 1;
        const loaded = (rec.loadLow ?? 0.6) + (1 - (rec.loadLow ?? 0.6)) * load;
        const level = (rec.clipLevel ?? 1) * loaded * (1 - misfire * 0.85) / Math.sqrt(engines);
        voices.forEach((v, i) => {
          const mix = i === hi ? Math.sqrt(t) : i === lo ? Math.sqrt(1 - t) : 0;
          setT(v.g.gain, mix * (v.clip.gain ?? 1) * level, ctx, 0.06);
          v.srcs.forEach((s, n) => s.setRate((rpm / v.clip.rpm) * doppler * (1 + detune * (n - (engines - 1) / 2)), mix > 0.02 && level > 0.001));
        });
      },
      stop() {
        for (const v of voices) {
          v.srcs.forEach((s) => s.stop());
          v.g.disconnect();
        }
      },
    };
  }

  // A tank's recorded engine (standing and moving) and tracks, following whether it moves.
  function createTankClips(recId, dest) {
    const rec = sound.recordings?.[recId];
    const voices = (rec?.clips ?? []).filter((c) => buffers.has(c.path)).map((clip) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(dest);
      return { clip, g, s: liveSource(clip, () => clip.xfade ?? 0.05, g) };
    });
    if (!voices.length) return null;
    return {
      update(moving) {
        for (const v of voices) {
          const on = v.clip.role === 'idle' ? !moving : moving;
          setT(v.g.gain, on ? (v.clip.gain ?? 1) * (rec.clipLevel ?? 1) : 0, ctx, 0.3);
          v.s.setRate(1, on);
        }
      },
      stop() {
        for (const v of voices) {
          v.s.stop();
          v.g.disconnect();
        }
      },
    };
  }

  // A recorded engine start: plays from its start point, and at its caught point fades away as the
  // running engine fades in. Returns the seconds until caught, or null if there is no recording.
  function playStartup(recId, dest) {
    const startup = sound.recordings?.[recId]?.startup;
    const files = (startup?.files ?? []).filter((f) => buffers.has(f.path));
    if (!files.length) return null;
    const file = files[Math.floor(Math.random() * files.length)];
    const buf = buffers.get(file.path);
    const begin = file.start ?? 0;
    const end = file.end ?? buf.duration;
    const caught = Math.max(0, Math.min(end, file.caught ?? end) - begin);
    const fade = Math.min(startup.fade ?? 0.6, end - begin - caught + 0.001);
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const level = startup.gain ?? 1;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.01);
    g.gain.setValueAtTime(level, at + caught);
    g.gain.linearRampToValueAtTime(0, at + caught + fade);
    src.connect(g).connect(dest);
    src.start(at, begin, Math.min(end - begin, caught + fade));
    headFrom(file, begin, at, 1, Math.min(end - begin, caught + fade), false);
    src.addEventListener('ended', () => heads.delete(file));
    return { caught, fade, stop() { try { src.stop(); } catch { /* already over */ } g.disconnect(); } };
  }

  // A view of the mixer whose buses pass through the sound's synth level, so any synthesized
  // sound can be turned down beside its recordings without knowing about them.
  function scoped(id) {
    if (scopes.has(id)) {
      scopes.get(id).level.gain.value = synthLevel(id);
      return scopes.get(id).view;
    }
    const view = Object.create(mixer);
    view.buses = {};
    const gains = [];
    const through = (dest) => {
      const g = ctx.createGain();
      g.gain.value = synthLevel(id);
      g.connect(dest);
      gains.push(g);
      return g;
    };
    for (const [name, bus] of Object.entries(mixer.buses)) view.buses[name] = through(bus);
    view.reverbSend = through(mixer.reverbSend);
    scopes.set(id, { view, gains, level: { gain: { set value(v) { for (const g of gains) g.gain.value = v; } } } });
    return view;
  }

  // Cuts a sound off mid-way, for the Sound Lab's stop buttons: its recordings stop, and everything
  // synthesized is unhooked with its way out, so the next play gets a fresh one.
  function stopSound(id) {
    for (const src of playing.get(id) ?? []) src.stop();
    playing.delete(id);
    const scope = scopes.get(id);
    if (!scope) return;
    for (const g of scope.gains) g.disconnect();
    scopes.delete(id);
  }

  const synthLevel = (id) => sound.recordings?.[id]?.synth ?? 1;

  function trigger(id, where, opts) {
    for (const g of sound.recordings?.[id]?.groups ?? []) {
      const src = playGroup(g, where, opts);
      if (!src) continue;
      if (!playing.has(id)) playing.set(id, new Set());
      playing.get(id).add(src);
      src.addEventListener('ended', () => playing.get(id)?.delete(src));
    }
  }

  // The owner's own layers on one vehicle. keys: what it can be attached through ('plane:bf110', ...).
  function createLayerHost(keys) {
    const attached = [];
    for (const [id, layer] of Object.entries(sound.layers ?? {})) {
      for (const key of keys) {
        if (layer.attach?.[key]) {
          attached.push({ id, layer, a: layer.attach[key], loop: null, next: 0 });
          break;
        }
      }
    }
    return {
      update(values, where, isMe) {
        for (const item of attached) {
          const { layer, a } = item;
          const allowed = layer.hearing !== 'cockpit' || isMe;
          const place = allowed ? (isMe ? ME : where) : null;
          const value = values[layer.driver] ?? 0;
          if (layer.type === 'triggered') {
            if (!place || mixer.now < item.next || value < (a.threshold ?? layer.threshold)) continue;
            item.next = mixer.now + layer.cooldown;
            if (Math.random() < layer.chance) playGroup(layer.group, place, { gain: a.gain ?? 1, pitch: a.pitch ?? 0 });
            continue;
          }
          const audible = place && place.gain > 0.001;
          if (audible && !item.loop) item.loop = createLoop(layer.group);
          if (!audible && item.loop) {
            item.loop.stop();
            item.loop = null;
          }
          item.loop?.update(place, value, { gain: a.gain ?? 1, pitch: a.pitch ?? 0 });
        }
      },
      stop() {
        for (const item of attached) item.loop?.stop();
      },
    };
  }

  return {
    buffers,
    ensure,
    // Seconds into the file being heard now, or null.
    headOf(file) {
      const h = heads.get(file);
      if (!h) return null;
      const now = ctx.currentTime;
      if (h.loop !== undefined) return now - h.seen < 0.25 ? h.loop : null;
      const done = (now - h.at) * h.speed;
      if (done < 0 || done > h.length) return null;
      return h.backwards ? h.begin - done : h.begin + done;
    },
    load: () => Promise.all([...pathsIn(sound)].map(ensure)),
    trigger,
    stopSound,
    playGroup,
    createLoop,
    createClips,
    createTankClips,
    playStartup,
    createLayerHost,
    scoped,
    synthLevel,
    // A live change from the Sound Lab reaches the synth levels of loops already playing.
    refreshScopes() {
      for (const [id, scope] of scopes) scope.level.gain.value = synthLevel(id);
    },
    rec: (id) => sound.recordings?.[id],
  };
}

// The one-shots with their recordings beside them. Each function keeps its signature.
const ONE_SHOT_IDS = {
  explosion: () => 'explosion', flakBurst: () => 'flakBurst', touchdown: () => 'touchdown', gearMotor: () => 'gearDown', bellyCrunch: () => 'bellyCrunch',
  midair: () => 'midair', helmetCreak: () => 'helmetCreak', gearHorn: () => 'gearHorn', ignite: () => 'ignite', rollWhoosh: () => 'rollWhoosh', shrapnel: () => 'shrapnel',
  collapse: (args) => `collapse${String(args[1])[0].toUpperCase()}${String(args[1]).slice(1)}`, splash: () => 'splash', fireOut: () => 'fireOut', hammering: () => 'hammering', radarPowerDown: () => 'radarPowerDown',
};

export function withRecordings(raw) {
  const wrapped = { ...raw };
  for (const [name, idOf] of Object.entries(ONE_SHOT_IDS)) {
    wrapped[name] = (m, ...args) => {
      const rec = m.recordings;
      if (!rec) return raw[name](m, ...args);
      const id = `sfx:${idOf(args)}`;
      rec.trigger(id, typeof args[0]?.gain === 'number' ? args[0] : ME, {});
      return raw[name](rec.scoped(id), ...args);
    };
  }
  return wrapped;
}

// What a plane or tank offers to the layers driven by game values.
export function planeValues(p, world, turn) {
  return Object.fromEntries(DRIVERS.plane.map((d) => [d.key, d.read(p, world, turn)]));
}
export function tankValues(o, world) {
  return Object.fromEntries(DRIVERS.tank.map((d) => [d.key, d.read(o, world)]));
}
