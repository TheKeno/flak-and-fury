// Frame-rate and frame-time overlay (F3, debug, off by default). Shows frames a second, the frame gap
// (average and worst of the last second), and the CPU milliseconds each part of a frame took:
// sim ticks, then the renderer's sections (src/render/renderer.js calls prof.mark). Canvas drawing is
// queued for the GPU, so a section's time is the cost of issuing it; the gap between frames is the truth.
export const prof = {
  on: false,
  sections: new Map(), // name -> ms this frame
  t: 0,
  counts: new Map(), // name -> how many times this frame
  count(name, n = 1) {
    if (this.on) this.counts.set(name, (this.counts.get(name) ?? 0) + n);
  },
  begin() {
    if (this.on) this.t = performance.now();
  },
  // Ends the section running since the last mark (or begin) and starts the next.
  mark(name) {
    if (!this.on) return;
    const now = performance.now();
    this.sections.set(name, (this.sections.get(name) ?? 0) + now - this.t);
    this.t = now;
  },
};

export function createPerfStats() {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;left:6px;top:6px;margin:0;padding:4px 6px;background:rgba(0,0,0,.65);color:#c8d0b0;font:11px/1.25 monospace;z-index:20;pointer-events:none;display:none';
  document.body.appendChild(el);
  let lastFrame = 0;
  let gaps = [];
  let acc = new Map();
  // Always listed, so a 0 reads as "none" rather than "not working".
  const fresh = () => new Map([['rollbuild', 0], ['cacheclr', 0]]);
  let counted = fresh();
  let frames = 0;
  let since = 0;
  return {
    toggle() {
      prof.on = !prof.on;
      el.style.display = prof.on ? 'block' : 'none';
      gaps = [];
      acc = new Map();
      frames = 0;
      since = 0;
    },
    // Once a frame, after drawing.
    frame(now) {
      if (!prof.on) return;
      if (lastFrame) gaps.push(now - lastFrame);
      lastFrame = now;
      for (const [k, v] of prof.sections) acc.set(k, (acc.get(k) ?? 0) + v);
      prof.sections.clear();
      for (const [k, v] of prof.counts) counted.set(k, (counted.get(k) ?? 0) + v);
      prof.counts.clear();
      frames++;
      if (!since) since = now;
      if (now - since < 1000) return;
      const avg = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
      const worst = Math.max(0, ...gaps);
      const lines = [`${(frames * 1000 / (now - since)).toFixed(0)} fps  gap ${avg.toFixed(1)} ms  worst ${worst.toFixed(1)} ms`];
      let sum = 0;
      for (const [k, v] of acc) {
        lines.push(`${k.padEnd(9)} ${(v / frames).toFixed(2)} ms`);
        sum += v / frames;
      }
      lines.push(`cpu total ${sum.toFixed(2)} ms`);
      for (const [k, v] of counted) lines.push(`${k.padEnd(9)} ${(v * 1000 / (now - since)).toFixed(0)} /s`);
      el.textContent = lines.join('\n');
      window.__perf = { fps: frames * 1000 / (now - since), avg, worst, gaps: gaps.slice(), sections: Object.fromEntries([...acc].map(([k, v]) => [k, v / frames])) };
      gaps = [];
      acc = new Map();
      counted = fresh();
      frames = 0;
      since = now;
    },
  };
}
