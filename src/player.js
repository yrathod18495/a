export const GAP = 0.4, LEAD = 0.3, TAIL = 0.7;

/** Turns decoded audio lines into a sequential timeline. */
export function buildTimeline(lines) {
  let t = LEAD;
  const clips = lines.map((l) => {
    const c = { ...l, start: t, end: t + l.buffer.duration };
    t = c.end + GAP;
    return c;
  });
  return { clips, total: (clips.at(-1)?.end ?? 0) + TAIL };
}

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.speaker = ctx.createGain();
    this.speaker.connect(ctx.destination);
    this.rec = ctx.createMediaStreamDestination();
    this.clips = []; this.total = 0;
    this.pos = 0; this.playing = false; this.sources = [];
  }
  setTimeline({ clips, total }) { this.stop(); this.clips = clips; this.total = total; this.pos = 0; }
  /** timeline position the listener is hearing right now (the audio device adds a little output delay) */
  get time() {
    if (!this.playing) return this.pos;
    const lag = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return Math.min(Math.max(this.pos, this.pos + (this.ctx.currentTime - this.t0) - lag), this.total);
  }
  muteSpeakers(m) { this.speaker.gain.value = m ? 0 : 1; }

  async play() {
    if (this.playing) return;
    await this.ctx.resume();
    if (this.pos >= this.total) this.pos = 0;
    this.t0 = this.ctx.currentTime + 0.05;
    for (const c of this.clips) {
      if (c.end <= this.pos) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = c.buffer; src.connect(this.speaker); src.connect(this.rec);
      const off = Math.max(0, this.pos - c.start), when = this.t0 + Math.max(0, c.start - this.pos);
      src.start(when, off);
      this.sources.push(src);
    }
    this.playing = true;
  }
  pause() {
    if (!this.playing) return;
    this.pos = this.time; this.playing = false; this.killSources();
  }
  stop() { this.playing = false; this.pos = 0; this.killSources(); }
  seek(t) {
    const was = this.playing;
    if (was) this.pause();
    this.pos = Math.max(0, Math.min(t, this.total));
    if (was) this.play();
  }
  killSources() { this.sources.forEach((s) => { try { s.stop(); } catch { /* already ended */ } }); this.sources = []; }
}
