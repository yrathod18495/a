"""Keyframe -> DragonBones animation maker for the Dayan 3/4 rig, with hands placed by inverse kinematics (see dayan_rig.py).
A key says where each hand's picture must be (its centre, in the chest's own frame: u = up along the spine, v = sideways, negative v = in front of her),
which way the fingers point, which hand picture to show, and how much the chest and head turn. Every frame between two keys is solved on its own, so hands that have to
meet, hold a handle or rest on the ground really do, whatever the body does around them. Frames come out as one linear keyframe per frame.
Angles: degrees; the chest / head turn like the rig's own rotate values (negative = lean forward); a hand's `ang` is the direction of its fingers in the chest frame
(0 = along the spine, up; negative = turning toward the front)."""
import json, math, os, sys

sys.path.insert(0, os.path.dirname(__file__))
from dayan_rig import Rig

FPS = 30
SHAPES = json.load(open(os.path.join(os.path.dirname(__file__), 'dayan_hand_shapes.json')))
FRONT = {'big_prop': '_front', 'eating': '_front', 'waist_pose': '_front'}
NATURAL_ELBOW = {'left': 'down', 'right': 'down'}
TORSO, HEAD = 'upper_body2', 'head'

def ease(kind, u):
    if kind == 'hold': return 0.0
    if kind == 'lin': return u
    if kind == 'in': return u * u
    if kind == 'out': return 1 - (1 - u) * (1 - u)
    return u * u * (3 - 2 * u)                                    # smooth

def lerp(a, b, u): return a + (b - a) * u

class Maker:
    def __init__(self, rig, name, dur, group='Action', layer='body'):
        self.rig, self.name, self.dur, self.group, self.layer = rig, name, dur, group, layer
        self.keys = []; self.front = None; self.warn = []; self.events = []

    # --- authoring -------------------------------------------------------------------------------------------------
    def key(self, t, ease='smooth', torso=None, head=None, L=None, R=None, shape=None, far_front=None):
        """L / R: dict(p=(u, v) | ('w', x, y), ang=degrees, shape='namaste', elbow=+1|-1, free=(upper, lower, palm) absolute offsets instead of a target)"""
        self.keys.append(dict(t=t, ease=ease, torso=torso, head=head, L=L, R=R))
        for sd, h in (('left', L), ('right', R)):
            if h and h.get('shape'): self.events.append((t, sd, h['shape']))

    def shape(self, t, side, name):
        """show hand picture `name` on `side` ('left' | 'right' | 'both') from frame t on (a key's own shape= does the same at the key's frame)"""
        for sd in (('left', 'right') if side == 'both' else (side,)): self.events.append((t, sd, name))

    def rest(self, side, shape='default'):
        """the hand as it hangs in the rig's rest pose, as a target (so every move can be a straight path in space)"""
        R = self.rig; up, lo, pa = R.arm_names(side); g = SHAPES[shape][side]
        x, y, a = R.world(pa); tw = R.world(TORSO)[2]; ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        c = (x + ca * g['cx'] - sa * g['cy'], y + sa * g['cx'] + ca * g['cy'])
        u, v = R.to_local(TORSO, c)
        return dict(p=(u, v), ang=(a - tw + 540) % 360 - 180, shape=shape)

    # --- evaluation ----------------------------------------------------------------------------------------------------
    def _series(self, get):
        """per-frame values of one attribute; a key that leaves it out keeps the previous value (the first key must give it or 0)."""
        ks = self.keys; vals = []
        prev = None
        pts = []
        for k in ks:
            v = get(k)
            if v is None: v = prev if prev is not None else 0.0
            prev = v; pts.append((k['t'], v, k['ease']))
        out = []
        for f in range(self.dur + 1):
            if f <= pts[0][0]: out.append(pts[0][1]); continue
            if f >= pts[-1][0]: out.append(pts[-1][1]); continue
            i = max(j for j, p in enumerate(pts) if p[0] <= f)
            a, b = pts[i], pts[i + 1]; u = (f - a[0]) / (b[0] - a[0])
            e = ease(b[2], u)
            out.append(tuple(lerp(x, y, e) for x, y in zip(a[1], b[1])) if isinstance(a[1], tuple) else lerp(a[1], b[1], e))
        return out

    def _hand_series(self, side):
        """per frame: dict(p, ang, shape, elbow, free)"""
        ks = self.keys; cur = None; recs = []
        for k in ks:
            h = k[side[0].upper()]
            if h is not None:
                base = dict(cur or {})
                if 'free' in h: base.pop('p', None); base.pop('ang', None)       # a rest key replaces the old target
                elif 'p' in h or 'ang' in h: base.pop('free', None)
                cur = {**base, **h}
            recs.append(dict(cur) if cur else None)
        # interpolate p and ang between keys that have a hand record; shapes hold from the key that sets them
        frames = []
        first = next((i for i, r in enumerate(recs) if r), None)
        if first is None: return [None] * (self.dur + 1)
        for f in range(self.dur + 1):
            i = max((j for j, k in enumerate(ks) if k['t'] <= f), default=0)
            i = max(i, first); j = min(i + 1, len(ks) - 1)
            a, b = recs[i], recs[j]; ta, tb = ks[i]['t'], ks[j]['t']
            u = 0.0 if tb == ta or f >= tb else max(0.0, min(1.0, (f - ta) / (tb - ta))); e = ease(ks[j]['ease'], u) if j != i else 0.0
            h = dict(a)
            fa, fb = 'free' in a, 'free' in b
            if j == i or (fa and fb):
                if fa and fb: h['free'] = tuple(lerp(x, y, e) for x, y in zip(a['free'], b['free']))
                if not fa and 'p' in a: h['p'] = a['p']
            elif fa != fb:
                # a hand that comes from / goes back to the rest pose turns in the joints (no path in space)
                h['mix'] = dict(free=(a if fa else b)['free'], rec=(b if fa else a), key=(j if fa else i), w=(e if fa else 1 - e))
                h.pop('free', None); h.pop('p', None)
            else:
                if 'p' in a and 'p' in b:
                    if (a['p'][0] == 'w') != (b['p'][0] == 'w'): raise SystemExit(f'{self.name}: hand target changes between chest frame and world frame at frame {f}')
                    h['p'] = ('w', lerp(a['p'][1], b['p'][1], e), lerp(a['p'][2], b['p'][2], e)) if a['p'][0] == 'w' else (lerp(a['p'][0], b['p'][0], e), lerp(a['p'][1], b['p'][1], e))
                if 'ang' in a and 'ang' in b: h['ang'] = lerp(a['ang'], b['ang'], e)
            h['ik_shape'] = b.get('shape', 'default') if j != i else a.get('shape', 'default')
            ev = [e for e in self.events if e[1] == side and e[0] <= f]
            h['shape'] = max(ev, key=lambda e: e[0])[2] if ev else 'default'
            frames.append(h)
        return frames

    def _ik(self, side, h, off):
        R = self.rig; up, lo, pa = R.arm_names(side); g = SHAPES[h.get('ik_shape', h['shape'])][side]; ang = h.get('ang', 0.0)
        tw = R.world(TORSO, off)[2]; wa = tw + ang
        c = (h['p'][1], h['p'][2]) if h['p'][0] == 'w' else R.from_local(TORSO, h['p'], off)
        ca, sa = math.cos(math.radians(wa)), math.sin(math.radians(wa))
        wrist = (c[0] - (ca * g['cx'] - sa * g['cy']), c[1] - (sa * g['cx'] + ca * g['cy']))
        u, l, short = R.solve_arm(side, wrist, off, h.get('elbow', NATURAL_ELBOW[side]))
        if short > 0: self.short = max(getattr(self, 'short', 0), short); self.warn.append(f'{self.name}: {side} hand falls {short:.0f} units short of {tuple(round(x) for x in h["p"][-2:])}')
        pw0 = R.world(pa, {**off, up: u, lo: l, pa: 0.0})[2]
        return u, l, (wa - pw0 + 540) % 360 - 180

    def solve(self):
        R = self.rig; n = self.dur + 1
        torso = self._series(lambda k: k['torso']); head = self._series(lambda k: k['head'])
        hands = {s: self._hand_series(s) for s in ('left', 'right')}
        tracks = {b: [] for b in (TORSO, HEAD, *[f'{s}_{p}' for s in ('left', 'right') for p in ('upper_hand_circle', 'lower_hand_circle', 'hand_palm_circle')])}
        shapes = {'left': [], 'right': []}
        for f in range(n):
            off = {TORSO: torso[f], HEAD: head[f]}
            tracks[TORSO].append(torso[f]); tracks[HEAD].append(head[f])
            for side in ('left', 'right'):
                up, lo, pa = R.arm_names(side); h = hands[side][f]
                if h is None:
                    for b in (up, lo, pa): tracks[b].append(0.0)
                    shapes[side].append('default'); continue
                shapes[side].append(h['shape'])
                if 'free' in h:
                    u, l, p = h['free']
                elif 'mix' in h:
                    mx = h['mix']; kf = self.keys[mx['key']]['t']; offk = {TORSO: torso[kf], HEAD: head[kf]}
                    su, sl, sp = self._ik(side, {**mx['rec'], 'ik_shape': mx['rec'].get('shape', 'default')}, offk)
                    fu, fl, fp = mx['free']; su, sl, sp = (fu + (su - fu + 540) % 360 - 180, fl + (sl - fl + 540) % 360 - 180, fp + (sp - fp + 540) % 360 - 180)
                    # w = how far the hand has gone from the rest pose toward the target
                    w = mx['w']
                    u, l, p = fu + (su - fu) * w, fl + (sl - fl) * w, fp + (sp - fp) * w
                else:
                    u, l, p = self._ik(side, h, off)
                for b, v in ((up, u), (lo, l), (pa, p)): tracks[b].append(v)
        # unwrap angles so a linear blend never spins the long way round
        for b, vs in tracks.items():
            for i in range(1, len(vs)):
                while vs[i] - vs[i - 1] > 180: vs[i] -= 360
                while vs[i] - vs[i - 1] < -180: vs[i] += 360
        return tracks, shapes

    # --- output -------------------------------------------------------------------------------------------------------
    def build(self, only=None, far_front=None):
        """DragonBones animation json. only: bones to write (a hand-layer animation touches the arms only). far_front: (first, last) frames where the far hand is drawn in front."""
        tracks, shapes = self.solve(); bones = []
        for b, vs in tracks.items():
            if only is not None and b not in only: continue
            if all(abs(v) < 1e-9 for v in vs) and b in (TORSO, HEAD): continue
            fr = [{'duration': 1, 'rotate': round(v, 3), 'tweenEasing': 0} for v in vs[:-1]] + [{'duration': 0, 'rotate': round(vs[-1], 3), 'tweenEasing': 0}]
            bones.append({'name': b, 'rotateFrame': fr})
        slots = []
        for side in ('left', 'right'):
            seq = shapes[side]
            if all(s == 'default' for s in seq): continue
            runs = []
            for s in seq[:-1]:
                if runs and runs[-1][0] == s: runs[-1][1] += 1
                else: runs.append([s, 1])
            # the last frame closes the track (duration 0): it keeps the last shape
            fr = [{'displayName': f'{side}_hand_{s}{FRONT.get(s, "")}', 'duration': n} for s, n in runs] + [{'displayName': f'{side}_hand_{seq[-1]}{FRONT.get(seq[-1], "")}', 'duration': 0}]
            slots.append({'name': f'{side}_hand_front_slot', 'displayFrame': fr})
        an = {'name': self.name, 'duration': self.dur, 'playTimes': 0, 'bone': bones, 'slot': slots, '_sourceFrameRate': FPS}
        if far_front: an['zOrder'] = {'frame': zorder_frames(self.rig, self.dur, far_front)}
        return an

# ---- draw order ---------------------------------------------------------------------------------------------------
FAR_FRONT = ['right_lower_hand', 'right_hand_palm_circle', 'right_hand_back_slot', 'right_hand_prop', 'right_hand_front_slot']

FRONT_SEGMENT = ['left_lower_hand_circle', 'right_upper_hand', 'left_upper_hand', 'body_front_prop', 'left_hand_back_slot', 'left_hand_prop',
                 'right_lower_hand', 'right_hand_palm_circle',                        # far forearm and the base of the far palm
                 'left_hand_palm_circle', 'left_lower_hand',                          # near forearm and the base of the near palm
                 'right_hand_back_slot', 'right_hand_prop', 'right_hand_front_slot',  # far hand
                 'left_hand_front_slot']                                              # near hand on top

def order_front(rig):
    """the order the original page really uses when both hands work in front of the body: both forearms and hands above the chest, near hand on top"""
    L = [s for s in rig.slots if s not in FRONT_SEGMENT]
    i = L.index('dayan_pendant') + 1; L[i:i] = FRONT_SEGMENT
    assert sorted(L) == sorted(rig.slots), 'draw order is not a permutation'
    return L

def apply_pairs(slots, pairs):
    """what DragonBones does with a zOrder key (used here to prove the pairs give the order we want)"""
    idx = {s: i for i, s in enumerate(slots)}; n = len(slots)
    P = sorted((idx[s], o) for s, o in pairs); order = [-1] * n; rest = []; oi = 0
    for si, off in P:
        while oi != si: rest.append(oi); oi += 1
        order[oi + off] = oi; oi += 1
    while oi < n: rest.append(oi); oi += 1
    k = len(rest)
    for i in range(n - 1, -1, -1):
        if order[i] == -1: k -= 1; order[i] = rest[k]
    return [slots[i] for i in order]

def pairs_for(rig, target):
    """only the slots that really change place are listed, the others keep their order and fill the rest (this is how DragonBones reads a draw-order key)"""
    idx = {s: i for i, s in enumerate(rig.slots)}; pos = {s: p for p, s in enumerate(target)}
    pairs = [[s, pos[s] - idx[s]] for s in FRONT_SEGMENT]
    assert apply_pairs(rig.slots, pairs) == target, 'the draw-order pairs do not give the wanted order'
    return pairs

def zorder_frames(rig, dur, span):
    a, b = span; tgt = pairs_for(rig, order_front(rig)); frames = []
    if a > 0: frames.append({'zOrderByName': [], 'duration': a})
    frames.append({'zOrderByName': tgt, 'duration': b - a})
    if b < dur: frames.append({'zOrderByName': [], 'duration': dur - b})
    return frames
