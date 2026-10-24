// Motion paths: the user draws a line with the pen tool and the character walks along it.
// A path is turned into ordinary movement keyframes (the stage already knows how to play those), so playback and export need nothing new.
// Points are fractions of the canvas: x from the left, y from the bottom (like movement keyframes).

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const pathLength = (pts) => pts.reduce((sum, p, i) => (i ? sum + dist(pts[i - 1], p) : 0), 0);

/** thin out a freehand line: points closer than `gap` to the last kept point are dropped; the end is always kept */
export function thin(pts, gap = 0.006) {
  if (pts.length < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length - 1; i++) if (dist(out[out.length - 1], pts[i]) >= gap) out.push({ x: pts[i].x, y: pts[i].y });
  out.push({ x: pts.at(-1).x, y: pts.at(-1).y });
  return out;
}

/** the point at `s` (0..1) of the line's length */
export function pointAt(pts, s) {
  const total = pathLength(pts);
  if (!pts.length) return { x: 0.5, y: 0.5 };
  if (pts.length === 1 || total <= 0) return { ...pts[0] };
  let want = Math.min(1, Math.max(0, s)) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (want <= seg || i === pts.length - 1) { const u = seg > 0 ? Math.min(1, want / seg) : 0; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u }; }
    want -= seg;
  }
  return { ...pts.at(-1) };
}

/**
 * Movement keyframes for a path: {pts, start, dur, face (turn to the walking direction), smooth (slow start / end instead of even speed), flipBase}.
 * `mul` keeps the character's current size. Keys use even easing between them, so the speed along the line stays steady.
 */
export function pathKeys(path, mul = 1, idPrefix = 'p') {
  const pts = path.pts || [];
  if (pts.length < 2 || !(path.dur > 0)) return [];
  const count = Math.min(60, Math.max(4, Math.ceil(path.dur * 6))), keys = [];
  const ease = (u) => (path.smooth ? u * u * (3 - 2 * u) : u);
  let flip = !!path.flipBase;
  for (let i = 0; i <= count; i++) {
    const u = i / count, p = pointAt(pts, ease(u));
    if (path.face) {
      const a = pointAt(pts, Math.max(0, ease(u) - 0.02)), b = pointAt(pts, Math.min(1, ease(u) + 0.02)), dx = b.x - a.x;
      if (Math.abs(dx) > 0.004) flip = path.faceLeft ? dx > 0 : dx < 0;
    }
    keys.push({ id: `${idPrefix}${i}`, pathKey: true, t: +(path.start + path.dur * u).toFixed(3), x: +p.x.toFixed(4), y: +p.y.toFixed(4), mul, flip, ease: 'linear' });
  }
  return keys;
}
