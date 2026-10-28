// Wind rushing past the airframe, the dive scream, stall buffeting and wheels rumbling on the grass.
export function createAirflow(mixer) {
  const { ctx } = mixer;
  const loop = () => {
    const s = ctx.createBufferSource();
    s.buffer = mixer.noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 1.5);
    return s;
  };
  const chain = (src, ...nodes) => nodes.reduce((a, b) => a.connect(b), src);
  const filter = (type, freq, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };
  const gain = (v = 0) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };

  const windBand = filter('bandpass', 400, 0.6);
  const windGain = gain();
  chain(loop(), windBand, windGain, mixer.buses.engine);

  const whistleBand = filter('bandpass', 1400, 22);
  const whistleGain = gain();
  chain(loop(), whistleBand, whistleGain, mixer.buses.engine);

  // Stall buffet: low rumble chopped by a 9-14 Hz flutter.
  const buffetLp = filter('lowpass', 110, 1);
  const buffetChop = gain(0.5);
  const flutter = ctx.createOscillator();
  flutter.frequency.value = 11;
  const flutterDepth = gain(0.5);
  flutter.connect(flutterDepth).connect(buffetChop.gain);
  flutter.start();
  const buffetGain = gain();
  chain(loop(), buffetLp, buffetChop, buffetGain, mixer.buses.engine);

  // Air whistling through bullet holes in the airframe.
  const holesBand = filter('bandpass', 2300, 9);
  const holesGain = gain();
  chain(loop(), holesBand, holesGain, mixer.buses.engine);

  const rumbleLp = filter('lowpass', 150, 1.2);
  const rumbleGain = gain();
  chain(loop(), rumbleLp, rumbleGain, mixer.buses.engine);

  const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, ctx.currentTime, tc);

  return {
    update(p) {
      if (!p || p.state === 'dead') {
        for (const g of [windGain, whistleGain, buffetGain, rumbleGain, holesGain]) set(g.gain, 0, 0.05);
        return;
      }
      const airborne = p.state === 'air';
      const v = p.speed / p.def.maxSpeed;
      set(windBand.frequency, 250 + v * 900);
      set(windGain.gain, airborne ? 0.05 + v * v * 0.35 : v * v * 0.15);
      const scream = Math.max(0, v - 1.05);
      set(whistleBand.frequency, 1100 + scream * 3000);
      set(whistleGain.gain, airborne ? Math.min(0.5, scream * 1.6) : 0);
      // Light shudder when turning on the edge of the stall: the warning before the wings let go.
      const edge = airborne && !p.stalled && p.turnDir !== 0 && p.speed < p.def.stallSpeed * 1.15;
      set(buffetGain.gain, airborne && p.stalled ? 0.9 : edge ? 0.3 : 0, 0.12);
      set(flutter.frequency, 9 + Math.random() * 5, 0.2);
      const holes = Math.max(0, 1 - p.hp / p.def.hp - 0.2);
      set(holesBand.frequency, 1800 + v * 1400 + Math.random() * 200, 0.1);
      set(holesGain.gain, airborne ? holes * v * 0.5 : 0);
      const rolling = p.state === 'ground' ? Math.min(1, p.speed / 50) : 0;
      set(rumbleGain.gain, rolling * (0.5 + Math.random() * 0.4), 0.03);
    },
  };
}
