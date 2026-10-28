// AudioWorklet: a physically-inspired piston engine.
// Every cylinder firing is an exhaust pulse (a click plus a burst of noise) that rings through
// exhaust-stack resonances; the propeller adds a blade-rate "whomp" and prop-wash noise.
// Inline V12s sound smooth and crackly; radials are lumpier and deeper.

class Resonator {
  constructor(sr) {
    this.sr = sr;
    this.y1 = 0;
    this.y2 = 0;
  }
  set(freq, q) {
    const r = Math.exp((-Math.PI * (freq / q)) / this.sr);
    this.a1 = 2 * r * Math.cos((2 * Math.PI * freq) / this.sr);
    this.a2 = -r * r;
    this.g = 1 - r;
  }
  tick(x) {
    const y = x * this.g + this.a1 * this.y1 + this.a2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const VOICES = {
  inline: {
    cylSpread: 0.07,
    res: [
      [105, 5, 1.0],
      [420, 7, 0.55],
      [1500, 4, 0.22],
    ],
    noise: 0.55,
    crackle: 0.35,
    drive: 2.2,
    prop: 0.22,
  },
  radial: {
    cylSpread: 0.32,
    res: [
      [72, 4, 1.25],
      [260, 5, 0.6],
      [900, 3, 0.18],
    ],
    noise: 0.4,
    crackle: 0.1,
    drive: 2.8,
    prop: 0.3,
  },
};

class PistonEngine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 6000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'roughness', defaultValue: 0.1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'misfire', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 0.5, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.cylinders = o.cylinders || 12;
    this.voice = VOICES[o.layout] || VOICES.inline;
    this.bladeRatio = (o.gearRatio || 0.5) * (o.propBlades || 3);
    this.cylGain = Array.from({ length: this.cylinders }, () => 1 + (Math.random() * 2 - 1) * this.voice.cylSpread);
    this.res = this.voice.res.map(([f, q]) => {
      const r = new Resonator(sampleRate);
      r.set(f, q);
      return r;
    });
    this.phase = 0; // crankshaft revolutions
    this.lastSlot = -1;
    this.pulse = 0;
    this.noiseEnv = 0;
    this.pulseDecay = Math.exp(-1 / (0.0011 * sampleRate));
    this.noiseDecay = Math.exp(-1 / (0.0035 * sampleRate));
    this.propPhase = 0;
    this.wash = 0;
    this.dcIn = 0;
    this.dcOut = 0;
    this.crackle = 0;
  }

  process(_inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const rpm = params.rpm[0];
    const load = params.load[0];
    const rough = params.roughness[0];
    const misfire = params.misfire[0];
    const level = params.level[0];
    const v = this.voice;

    const revPerSample = rpm / 60 / sampleRate;
    const slotsPerRev = this.cylinders / 2; // four-stroke: each cylinder fires every second revolution
    const bladePerSample = revPerSample * this.bladeRatio;
    const strength = 0.35 + 0.65 * load;
    const washLevel = (0.05 + 0.2 * load) * Math.min(1, rpm / 2500);

    for (let i = 0; i < out.length; i++) {
      this.phase += revPerSample * (1 + (Math.random() - 0.5) * rough * 0.08);
      const slot = Math.floor(this.phase * slotsPerRev);
      if (slot !== this.lastSlot) {
        this.lastSlot = slot;
        const cyl = slot % this.cylinders;
        if (Math.random() >= misfire) {
          const a = strength * this.cylGain[cyl] * (1 + (Math.random() - 0.5) * rough);
          this.pulse += a;
          this.noiseEnv += a * v.noise;
          // Occasional exhaust crackle when the throttle is closed at speed.
          if (load < 0.3 && Math.random() < v.crackle * (0.3 - load)) this.crackle = 0.6 + Math.random() * 0.6;
        }
        if (this.phase > 1e6) this.phase -= 1e6;
      }

      const n = Math.random() * 2 - 1;
      const x = this.pulse + n * this.noiseEnv;
      this.pulse *= this.pulseDecay;
      this.noiseEnv *= this.noiseDecay;

      let y = x * 0.25;
      for (let k = 0; k < this.res.length; k++) y += this.res[k].tick(x) * v.res[k][2] * 6;

      if (this.crackle > 0.001) {
        y += (Math.random() * 2 - 1) * this.crackle * (Math.random() < 0.04 ? 3 : 0.3);
        this.crackle *= 0.9985;
      }

      this.propPhase += bladePerSample;
      if (this.propPhase > 1) this.propPhase -= 1;
      const blade = 0.5 + 0.5 * Math.cos(2 * Math.PI * this.propPhase);
      this.wash += (n - this.wash) * 0.08;
      y = y * (1 - v.prop * 0.5 + v.prop * blade) + this.wash * washLevel * (0.5 + blade) * 3;

      const s = Math.tanh(y * v.drive) * level;
      // DC blocker
      const dc = s - this.dcIn + 0.995 * this.dcOut;
      this.dcIn = s;
      this.dcOut = dc;
      out[i] = dc;
    }
    return true;
  }
}

registerProcessor('piston-engine', PistonEngine);
