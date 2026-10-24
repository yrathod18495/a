// Offline lip-sync from the audio alone (no network, no model).
//
// For every 20 ms of speech we measure
//   - loudness            -> how far the mouth opens
//   - voicing (pitch)     -> vowel / consonant
//   - formants F1, F2     -> which vowel: a, e/i, o, u  (LPC spectral envelope)
//   - high-frequency noise-> s / sh / f   (teeth showing)
//   - low-frequency murmur-> m / n        (lips closed)
//   - short dips inside speech -> p / b / t / d closures (lips close for a moment)
// and pick one of the character's mouth shapes. The result is smoothed, consonants borrow the shape of the vowel
// that follows (as real mouths do) and the whole track leads the sound by ~20 ms, because lips move before the voice.
export const HOP = 0.02;

const VIS = [
  'lip_idle', 'lip_a_e_i', 'lip_ee', 'lip_o', 'lip_u', 'lip_b_m_p',
  'lip_c_d_g_k_n_s_t_x_y_z', 'lip_ch_sh_j', 'lip_f_v', 'lip_l', 'lip_r',
];
const I = Object.fromEntries(VIS.map((n, i) => [n, i]));
const IDLE = I.lip_idle, A = I.lip_a_e_i, EE = I.lip_ee, O = I.lip_o, U = I.lip_u, BMP = I.lip_b_m_p, TEETH = I.lip_c_d_g_k_n_s_t_x_y_z, SH = I.lip_ch_sh_j, FV = I.lip_f_v;
export const visemeName = (i) => VIS[i];

const SR = 16000, WIN = 480, ORDER = 16, GRID = 128, F_LO = 140, F_HI = 3600;

/** mono signal at 16 kHz (box-filtered, so it is also a gentle anti-alias filter) */
function toMono16k(buffer) {
  const src = buffer.getChannelData(0), ratio = buffer.sampleRate / SR, n = Math.floor(src.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0; for (let k = a; k < b; k++) s += src[k];
    out[i] = s / (b - a);
  }
  return out;
}

// frequency grid + trig tables for evaluating the LPC envelope
const gridHz = Float32Array.from({ length: GRID }, (_, i) => F_LO + ((F_HI - F_LO) * i) / (GRID - 1));
const cosT = [], sinT = [];
for (let k = 1; k <= ORDER; k++) {
  cosT.push(Float32Array.from(gridHz, (f) => Math.cos((2 * Math.PI * f * k) / SR)));
  sinT.push(Float32Array.from(gridHz, (f) => Math.sin((2 * Math.PI * f * k) / SR)));
}
const hamming = Float32Array.from({ length: WIN }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (WIN - 1)));

/** LPC coefficients (Levinson-Durbin) */
function lpc(r) {
  const a = new Float64Array(ORDER + 1); a[0] = 1;
  let e = r[0] + 1e-9;
  for (let i = 1; i <= ORDER; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / e, tmp = a.slice();
    for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
    a[i] = k; e *= 1 - k * k;
    if (e <= 1e-12) break;
  }
  return a;
}

/** the two lowest resonances (F1, F2) and how much of the envelope sits below ~600 Hz */
function formants(a) {
  const env = new Float32Array(GRID);
  let total = 0, low = 0;
  for (let g = 0; g < GRID; g++) {
    let re = 1, im = 0;
    for (let k = 1; k <= ORDER; k++) { re += a[k] * cosT[k - 1][g]; im -= a[k] * sinT[k - 1][g]; }
    env[g] = 1 / (re * re + im * im + 1e-12);
    total += env[g]; if (gridHz[g] < 600) low += env[g];
  }
  const peaks = [];
  if (env[0] > env[1]) peaks.push([gridHz[0], env[0]]);          // a resonance right at the low edge (i, u)
  for (let g = 1; g < GRID - 1; g++) if (env[g] > env[g - 1] && env[g] >= env[g + 1]) peaks.push([gridHz[g], env[g]]);
  const strongest = Math.max(...peaks.map((p) => p[1]), 1e-12);
  const real = peaks.filter((p) => p[1] > strongest * 0.015);
  const f1 = (real.find((p) => p[0] <= 1100) || [500])[0];
  const f2 = (real.find((p) => p[0] >= Math.max(f1 + 250, 700) && p[0] <= 3200) || [1500])[0];
  return { f1, f2, lowRatio: low / (total + 1e-12) };
}

/** @returns {Uint8Array} one mouth-shape index (see visemeName) per HOP seconds */
export function analyse(buffer) {
  const x = toMono16k(buffer), hop = Math.round(SR * HOP), frames = Math.ceil(x.length / hop);
  const f = {
    rms: new Float32Array(frames), diff: new Float32Array(frames), voiced: new Float32Array(frames),
    f1: new Float32Array(frames), f2: new Float32Array(frames), low: new Float32Array(frames),
  };
  const seg = new Float32Array(WIN), r = new Float64Array(ORDER + 1), down = new Float32Array(WIN / 2);
  for (let fr = 0; fr < frames; fr++) {
    const s0 = fr * hop - (WIN >> 1);
    let e0 = 0, ed = 0, prev = 0;
    for (let i = 0; i < WIN; i++) {
      const v = x[s0 + i] || 0;
      e0 += v * v; ed += (v - prev) * (v - prev); prev = v;
      seg[i] = (v - 0.97 * (i ? x[s0 + i - 1] || 0 : 0)) * hamming[i];   // pre-emphasis + window
    }
    f.rms[fr] = Math.sqrt(e0 / WIN); f.diff[fr] = ed / (e0 + 1e-9);
    if (f.rms[fr] < 1e-4) continue;
    for (let k = 0; k <= ORDER; k++) { let s = 0; for (let i = k; i < WIN; i++) s += seg[i] * seg[i - k]; r[k] = s; }
    const fm = formants(lpc(r));
    f.f1[fr] = fm.f1; f.f2[fr] = fm.f2; f.low[fr] = fm.lowRatio;
    // voicing: normalised autocorrelation at pitch lags (60-400 Hz) on an 8 kHz copy
    for (let i = 0; i < down.length; i++) down[i] = ((x[s0 + 2 * i] || 0) + (x[s0 + 2 * i + 1] || 0)) * 0.5;
    let d0 = 0; for (let i = 0; i < down.length; i++) d0 += down[i] * down[i];
    let best = 0;
    for (let lag = 20; lag <= 133; lag++) { let s = 0; for (let i = lag; i < down.length; i++) s += down[i] * down[i - lag]; best = Math.max(best, s / (d0 + 1e-9)); }
    f.voiced[fr] = best;
  }

  // loudness relative to this recording's own level, with a noise floor
  const sorted = Array.from(f.rms).sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.95)] || 1e-6, floor = Math.max(sorted[Math.floor(sorted.length * 0.1)] * 1.6, ref * 0.045);
  const L = Float32Array.from(f.rms, (v) => Math.max(0, (v - floor) / (ref - floor)));

  // ---- first guess per frame ----
  const pick = new Uint8Array(frames), kind = new Uint8Array(frames); // kind: 0 silence, 1 vowel, 2 consonant, 3 closure
  for (let fr = 0; fr < frames; fr++) {
    const l = L[fr];
    if (l < 0.07) { pick[fr] = IDLE; kind[fr] = 0; continue; }
    const voiced = f.voiced[fr] > 0.42, noisy = f.diff[fr] > 1.0;
    if (!voiced && noisy) {                                   // s, sh, f, th ...
      kind[fr] = 2;
      pick[fr] = f.diff[fr] > 1.7 ? TEETH : f.f2[fr] < 1800 ? FV : SH;   // s/t: teeth, f/th: lip on teeth, sh/ch: rounded
    } else if (voiced && l < 0.3 && f.low[fr] > 0.72) {       // m, n: low murmur, lips shut
      kind[fr] = 3; pick[fr] = BMP;
    } else if (voiced || l >= 0.16) {                          // vowels
      kind[fr] = 1;
      const f1 = f.f1[fr], f2 = f.f2[fr];
      let v;
      if (f1 >= 680) v = A;                                   // aa
      else if (f2 >= 2000 && f1 < 560) v = EE;                // ee / i
      else if (f2 >= 1750 && f1 < 700) v = f1 < 520 ? EE : A; // e / ae
      else if (f2 < 1000 && f1 < 430) v = U;                  // u / oo
      else if (f2 < 1300 && f1 < 680) v = O;                  // o / aw
      else v = l > 0.55 ? A : EE;
      // loudness decides how far the mouth opens for that vowel
      if (v === A) v = l < 0.35 ? SH : l < 0.8 ? O : A;      // the widest mouth only for really loud 'aa'
      else if (v === EE) v = l < 0.3 ? SH : EE;
      else if (v === O) v = l < 0.26 ? U : O;
      else if (v === U) v = l > 0.8 ? O : U;
            pick[fr] = v;
    } else { kind[fr] = 2; pick[fr] = EE; }                    // weak breathy sounds
  }

  // ---- closures: a short dip between two stretches of speech = lips touch (p, b, t, d, k ...) ----
  const speechAround = (a, b) => { let n = 0; for (let k = a; k < b; k++) if (kind[k] === 1 || (kind[k] === 2 && L[k] > 0.25)) n++; return n; };
  for (let fr = 1; fr < frames - 1; fr++) {
    if (kind[fr] !== 0) continue;
    let end = fr; while (end < frames && kind[end] === 0) end++;
    const len = end - fr;
    if (len >= 1 && len <= 6 && speechAround(Math.max(0, fr - 4), fr) >= 2 && speechAround(end, Math.min(frames, end + 4)) >= 2) { for (let k = fr; k < end; k++) { pick[k] = BMP; kind[k] = 3; } }
    fr = end;
  }

  // ---- syllables: a dip in loudness inside a vowel stretch = the mouth narrows between two syllables ----
  const Ls = Float32Array.from(L, (v, i) => (v + (L[i - 1] ?? v) + (L[i + 1] ?? v)) / 3);
  for (let fr = 4; fr < frames - 4; fr++) {
    if (kind[fr] !== 1 || !(Ls[fr] <= Ls[fr - 1] && Ls[fr] <= Ls[fr + 1])) continue;
    let left = 0, right = 0;
    for (let k = 1; k <= 4; k++) { left = Math.max(left, Ls[fr - k]); right = Math.max(right, Ls[fr + k]); }
    const peak = Math.min(left, right);
    if (Ls[fr] < 0.28 * peak && peak > 0.4) { for (let k = fr; k <= fr + 1; k++) { if (kind[k] === 1) pick[k] = BMP; } }   // only a clear closing between syllables
  }

  // ---- consonants without a shape of their own take the vowel that follows (coarticulation) ----
  for (let fr = frames - 2; fr >= 0; fr--) {
    if (kind[fr] === 2 && pick[fr] === EE && f.voiced[fr] < 0.42) { const nxt = pick[fr + 1]; if (kind[fr + 1] === 1) pick[fr] = nxt; }
  }

  // ---- calm it down: wider majority vote, then every shape is held long enough to be seen ----
  const sm = new Uint8Array(frames);
  for (let fr = 0; fr < frames; fr++) {
    const cnt = new Map();
    for (let k = -2; k <= 2; k++) { const v = pick[Math.min(frames - 1, Math.max(0, fr + k))]; cnt.set(v, (cnt.get(v) || 0) + (k === 0 ? 1.5 : 1)); }
    let bestV = pick[fr], bestC = 0; for (const [v, c] of cnt) if (c > bestC) { bestC = c; bestV = v; }
    sm[fr] = bestV;
  }
  const minHold = (v) => (v === IDLE || v === BMP ? 2 : 3);       // 40 ms closed, 60 ms open
  for (let pass = 0; pass < 400; pass++) {
    const runs = []; for (let i = 0; i < frames;) { let j = i; while (j < frames && sm[j] === sm[i]) j++; runs.push([i, j, sm[i]]); i = j; }
    let changed = false;
    for (let r = 0; r < runs.length; r++) {
      const [a0, b0, v] = runs[r];
      if (b0 - a0 >= minHold(v)) continue;
      const prev = runs[r - 1], next = runs[r + 1];
      if (!prev && !next) continue;
      const take = !prev ? next : !next ? prev : ((prev[1] - prev[0]) >= (next[1] - next[0]) ? prev : next);
      sm.fill(take[2], a0, b0); changed = true; break;
    }
    if (!changed) break;
  }
  // lips move a little before the sound: lead by 1 frame (20 ms)
  const out = new Uint8Array(frames);
  for (let fr = 0; fr < frames; fr++) out[fr] = sm[Math.min(frames - 1, fr + 1)];
  return out;
}
