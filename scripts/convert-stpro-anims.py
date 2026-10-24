#!/usr/bin/env python3
"""
Builds the animation library of the Autodraft characters (Neha, My Baby) out of the bundled 3/4-front animation set
(public/animations/*.json + public/catalog/animations.json, pattern "2").

Those animations drive a differently named skeleton, so every timeline is re-targeted onto the Autodraft bones:
  - rotations are copied (both rigs use the same bone orientation, so the angle deltas carry over)
  - translations are re-sampled (30 fps) and turned into the other bone's parent frame
  - the legs of the Autodraft rigs are IK driven, so the feet are computed with forward kinematics of the source legs and
    written as movements of the IK targets
  - hand-shape / eyelid / lip attachment timelines are mapped onto the Autodraft pictures (palms, eyelids "EB", mouths)
  - hair / saree / earring / shadow bones are left to the Autodraft physics
The animations get their own names (NAMES below). Output:
  sources/spine/autodraft/anims/<pose>/<id>.json (Spine source files, then run scripts/build-db-data.py)  and  public/autodraft/animations.json  (PRIMARY / HAND / LEGS / EXPRESSION tracks)

usage:  python3 scripts/convert-stpro-anims.py
"""
import json, math, os, shutil, sys, zipfile, io
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / 'public'
SRC = ROOT / 'sources' / 'spine'        # Spine files are only sources; scripts/build-db-data.py turns them into the DragonBones data the app loads
CATALOG = json.load(open(PUB / 'catalog' / 'animations.json'))
SRC_PATTERN = '2'
FPS = 30
POSES = ['front-side', 'front', 'back', 'back-2', 'side']

# ---------------------------------------------------------------- names, tracks, layers
# id -> (new name, track).  Tracks: PRIMARY = body, EXPRESSION = face layer.  (HAND / LEGS layers are cut out of these below.)
NAMES = {
    # walking
    1833: ('Walk · Angry', 'PRIMARY'), 1837: ('Walk · Prop in both hands', 'PRIMARY'), 1839: ('Walk · Carrying a pot', 'PRIMARY'), 1840: ('Walk · Carrying a pot 2', 'PRIMARY'),
    1841: ('Walk · Carrying a stick', 'PRIMARY'), 1842: ('Walk · Carrying a load', 'PRIMARY'), 1861: ('Walk · Happy', 'PRIMARY'), 1874: ('Walk · Prop in left hand', 'PRIMARY'),
    1878: ('Walk · Long march', 'PRIMARY'), 1885: ('Walk · Prop in right hand', 'PRIMARY'), 1887: ('Run · Fast', 'PRIMARY'), 1888: ('Run · Looking back', 'PRIMARY'),
    1889: ('Run · Looking front and back', 'PRIMARY'), 1895: ('Walk · Shocked', 'PRIMARY'), 1902: ('Walk · Suspense', 'PRIMARY'), 1910: ('Walk · Normal', 'PRIMARY'),
    1911: ('Walk · Looking around', 'PRIMARY'), 1912: ('Walk · With conversation', 'PRIMARY'), 1968: ('Walk · On the spot', 'PRIMARY'),
    # talking (names keep the word Talk: the speaker mode uses them)
    1904: ('Talk · Style 4', 'PRIMARY'), 1905: ('Talk · Style 1', 'PRIMARY'), 1906: ('Talk · Style 3', 'PRIMARY'), 1907: ('Talk · Style 2', 'PRIMARY'), 1963: ('Talk · Left palm', 'PRIMARY'),
    # hands and arms (the listener mode uses "folding" and "hip")
    1859: ('Arms folding', 'PRIMARY'), 1954: ('Hands on hip · both', 'PRIMARY'), 1961: ('Pointing · left hand', 'PRIMARY'), 1962: ('Hand on hip · left', 'PRIMARY'), 1964: ('Hand on hip · right', 'PRIMARY'),
    # idle
    1866: ('Idle · Calm', 'PRIMARY'), 2374: ('Idle · Relaxed', 'PRIMARY'),
    # sleeping
    1898: ('Sleep · Back', 'PRIMARY'), 1899: ('Sleep · Front', 'PRIMARY'), 1900: ('Sleep · Front 2', 'PRIMARY'), 1901: ('Sleep · Nightmare', 'PRIMARY'),
    # fear
    1855: ('Fear · Standing', 'PRIMARY'), 1856: ('Fear · Full body', 'PRIMARY'), 1864: ('Breathing · Heavy', 'PRIMARY'),
    # general
    1835: ('Action · Stab', 'PRIMARY'), 1836: ('Mood · Bored', 'PRIMARY'), 1843: ('Action · Clap', 'PRIMARY'), 1846: ('Action · Cough', 'PRIMARY'), 1847: ('Dance 1', 'PRIMARY'), 1848: ('Dance 2', 'PRIMARY'),
    1849: ('Action · Dig', 'PRIMARY'), 1850: ('Mood · Disappointed', 'PRIMARY'), 1851: ('Mood · Doubt', 'PRIMARY'), 1852: ('Action · Driving', 'PRIMARY'), 1857: ('Mood · Fed up', 'PRIMARY'),
    1858: ('Action · Fly', 'PRIMARY'), 1863: ('Action · Head flip', 'PRIMARY'), 1865: ('Greet · Hello', 'PRIMARY'), 1868: ('Action · Jump', 'PRIMARY'), 1869: ('Action · Kick', 'PRIMARY'),
    1870: ('Action · Kick a ball', 'PRIMARY'), 1872: ('Mood · Laugh at someone', 'PRIMARY'), 1873: ('Pose · Lean on a wall', 'PRIMARY'), 1879: ('Look · Around', 'PRIMARY'),
    1880: ('Action · Pick up', 'PRIMARY'), 1881: ('Greet · Pray', 'PRIMARY'), 1882: ('Greet · Pray 2', 'PRIMARY'), 1883: ('Action · Punch', 'PRIMARY'), 1884: ('Action · Read a paper', 'PRIMARY'),
    1891: ('Greet · Salute', 'PRIMARY'), 1903: ('Action · Swim', 'PRIMARY'), 1915: ('Action · Yawn', 'PRIMARY'),
    # face layers
    1953: ('Face · Angry blink', 'EXPRESSION'), 1955: ('Face · Shocked blink', 'EXPRESSION'), 1956: ('Face · Suspense blink', 'EXPRESSION'), 1958: ('Face · Happy blink', 'EXPRESSION'),
    1959: ('Face · Neutral blink', 'EXPRESSION'), 1965: ('Face · Sad blink', 'EXPRESSION'), 1966: ('Face · Scared blink', 'EXPRESSION'),
    1892: ('Face · Scared 1', 'EXPRESSION'), 1893: ('Face · Scared 2', 'EXPRESSION'),
    2200: ('Eyes · Look up (long)', 'EXPRESSION'), 2201: ('Eyes · Look down (long)', 'EXPRESSION'), 2202: ('Eyes · Look left (long)', 'EXPRESSION'), 2203: ('Eyes · Look right (long)', 'EXPRESSION'),
    2260: ('Eyes · Look down', 'EXPRESSION'), 2261: ('Eyes · Look left', 'EXPRESSION'), 2262: ('Eyes · Look right', 'EXPRESSION'), 2263: ('Eyes · Look up', 'EXPRESSION'),
}
# cut out as layers on top of a body animation: arms only (HAND) and legs only (LEGS)
HAND_LAYERS = {1905: 'Hands · Talk 1', 1907: 'Hands · Talk 2', 1906: 'Hands · Talk 3', 1904: 'Hands · Talk 4', 1843: 'Hands · Clap', 1865: 'Hands · Hello',
               1881: 'Hands · Pray', 1882: 'Hands · Pray 2', 1891: 'Hands · Salute', 1883: 'Hands · Punch', 1859: 'Hands · Folded', 1961: 'Hands · Pointing'}
LEG_LAYERS = {1910: 'Legs · Walk', 1861: 'Legs · Walk happy', 1833: 'Legs · Walk angry', 1895: 'Legs · Walk shocked', 1902: 'Legs · Walk suspense',
              1968: 'Legs · Walk on the spot', 1887: 'Legs · Run', 1888: 'Legs · Run looking back'}
NEW_ID = {}  # source id -> new id (stable): body 9000+, hand layers 9300+, leg layers 9400+
for i, sid in enumerate(NAMES): NEW_ID[sid] = 9000 + i
HAND_ID = {sid: 9300 + i for i, sid in enumerate(HAND_LAYERS)}
LEG_ID = {sid: 9400 + i for i, sid in enumerate(LEG_LAYERS)}

# ---------------------------------------------------------------- bone maps
ARM_MAP = {'left_upper_hand_circle': 'ARM_L', 'left_lower_hand_circle': 'FOREARM_R', 'left_hand_palm_circle': 'L_Palm',
           'right_upper_hand_circle': 'ARM_R', 'right_lower_hand_circle': 'FOREARM_L', 'right_hand_palm_circle': 'R_Palm'}
ARM_MAP_SIDE = {'left_upper_hand_circle': 'Arm_L', 'left_lower_hand_circle': 'Forarm_L', 'left_hand_palm_circle': 'Palm_L',
                'right_upper_hand_circle': 'Arm_L2', 'right_lower_hand_circle': 'Forarm_L2', 'right_hand_palm_circle': 'Palm_R'}
BODY_MAP = {'pelvis': 'bone', 'upper_body2': 'TORSO3', 'head_rotate': 'HEAD', 'head': 'NECK'}
BODY_MAP_SIDE = {'pelvis': 'bone', 'upper_body2': 'TORSO3', 'head_rotate': 'HEAD', 'head': 'TORSO6'}
EYE_MAP = {'eye_ball_both': ['Eyeball_R', 'Eyeball_L']}
EYE_MAP_SIDE = {'eye_ball_both': ['Eyeball_L']}
# legs: source (upper, lower, foot) -> target bone that the IK chain follows (rotation of the target = the foot)
LEG_SRC = {'left': ('left_upper_leg_circle', 'left_lower_leg_circle', 'left_foot_circle'), 'right': ('right_upper_leg_circle', 'right_lower_leg_circle', 'right_foot_circle')}
LEG_TARGET = {'left': '4', 'right': 'bone5'}
LEG_TARGET_SIDE = {'left': 'Calf_L2', 'right': 'Calf_L6'}
HAND_SLOT = {'left': 'L_Palm', 'right': 'R_Palm'}
HAND_SHAPE = {   # STPro hand picture -> closest Autodraft palm (checked side by side on a contact sheet of both rigs)
    'close': 'Palm_24', 'big_prop_front': 'Palm_16', 'full_open': 'Palm_5', 'talking': 'Palm_4',
    'pointing_finger': 'Palm_Point', 'pointing_finger_two': 'Palm_Think', 'namaste': 'Palm_31', 'blessing': 'Palm_30',
    'waist_pose_front': 'Palm_8', 'nice': 'Palm_14', 'small_prop': 'Palm_22', 'eating_front': 'Palm_Mobile',
    'victory': 'Palm_5', 'all_the_best': 'Palm_24'}
EYELID = {'open': None, 'half_close': 'EB3', 'close': 'EB4'}
LIPS_EMOTION = {'lip_idle': 'Mouth/X', 'lip_happy': 'Mouth/A', 'lip_sad': 'Mouth/A_X', 'lip_angry': 'Mouth/A_F', 'lip_scared': 'Mouth/C', 'lip_shocked': 'Mouth/E'}
BROWS = {'angry': 14, 'sad': -12, 'scared': -10, 'shocked': -6, 'happy': 4, 'Suspense': 8}   # tilt (deg) of the brow bones; the inner side goes down for angry
EYE_SCALE = 1.4

# ---------------------------------------------------------------- spine helpers
def keytime(k): return k.get('time', 0)

def bez(p0, p1, p2, p3, u):
    v = 1 - u
    return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3

def seg_value(k0, k1, t, chan, nch, key):
    """value of one channel between two keys (key = 'value' / 'x' / 'y')"""
    t0, t1 = keytime(k0), keytime(k1)
    v0, v1 = k0.get(key, 0), k1.get(key, 0)
    c = k0.get('curve')
    if c == 'stepped': return v0
    u = (t - t0) / max(1e-9, t1 - t0)
    if isinstance(c, list) and len(c) >= 4 * (chan + 1):
        cx1, cy1, cx2, cy2 = c[chan * 4: chan * 4 + 4]
        lo, hi = 0.0, 1.0
        for _ in range(30):
            mid = (lo + hi) / 2
            if bez(t0, cx1, cx2, t1, mid) < t: lo = mid
            else: hi = mid
        return bez(v0, cy1, cy2, v1, (lo + hi) / 2)
    return v0 + (v1 - v0) * u

def sample(keys, t, key='value', chan=0, nch=1):
    if not keys: return 0
    if t <= keytime(keys[0]): return keys[0].get(key, 0)
    if t >= keytime(keys[-1]): return keys[-1].get(key, 0)
    for a, b in zip(keys, keys[1:]):
        if keytime(a) <= t < keytime(b): return seg_value(a, b, t, chan, nch, key)
    return keys[-1].get(key, 0)

def duration(j):
    t = 0
    for tl in j.get('bones', {}).values():
        for arr in tl.values(): t = max(t, keytime(arr[-1]))
    for tl in j.get('slots', {}).values():
        for arr in tl.values(): t = max(t, keytime(arr[-1]))
    return t

def grid(length):
    n = max(2, int(math.ceil(length * FPS)))
    return [min(length, i / FPS) for i in range(n + 1)]

# ---------------------------------------------------------------- forward kinematics (rotation + translation + scale)
def load_bones(rig):
    return {b['name']: b for b in rig['bones']}

def world_rot(bones, name):
    r = 0.0
    while name:
        b = bones[name]; r += b.get('rotation', 0); name = b.get('parent')
    return r

def fk(bones, chain_to, over):
    """world matrix [[a,b,tx],[c,d,ty]] of bone `chain_to` with the overrides applied"""
    path = []
    n = chain_to
    while n: path.append(n); n = bones[n].get('parent')
    path.reverse()
    M = [[1, 0, 0], [0, 1, 0]]
    for nm in path:
        bb = bones[nm]; o = over.get(nm, {})
        rot = bb.get('rotation', 0) + o.get('rot', 0)
        x = bb.get('x', 0) + o.get('dx', 0); y = bb.get('y', 0) + o.get('dy', 0)
        sx, sy = bb.get('scaleX', 1), bb.get('scaleY', 1)
        ra, rb = math.radians(rot), math.radians(rot + 90)
        L = [[math.cos(ra) * sx, math.cos(rb) * sy, x], [math.sin(ra) * sx, math.sin(rb) * sy, y]]
        M = [[M[0][0] * L[0][0] + M[0][1] * L[1][0], M[0][0] * L[0][1] + M[0][1] * L[1][1], M[0][0] * x + M[0][1] * y + M[0][2]],
             [M[1][0] * L[0][0] + M[1][1] * L[1][0], M[1][0] * L[0][1] + M[1][1] * L[1][1], M[1][0] * x + M[1][1] * y + M[1][2]]]
    return M

def rot2(vx, vy, deg):
    r = math.radians(deg); c, s = math.cos(r), math.sin(r)
    return vx * c - vy * s, vx * s + vy * c

# ---------------------------------------------------------------- loading
def load_source_rig():
    z = zipfile.ZipFile(SRC / 'characters' / 'Blazer_3-4_Front.zip')
    return load_bones(json.loads(z.read('rig.json')))

def load_pose_rig(pose):
    r = json.load(open(SRC / 'autodraft' / 'chars' / 'neha' / f'{pose}.json'))
    attach = {}
    for sk in r['skins']:
        if sk['name'] == 'default':
            for slot, atts in sk['attachments'].items(): attach[slot] = set(atts)
    return r, load_bones(r), attach

# ---------------------------------------------------------------- converting one animation
def dense(keys_fn, length, extra=None):
    out = []
    for t in grid(length):
        k = {'time': round(t, 4)}; k.update(keys_fn(t)); out.append(k)
    return out

def convert(src, pose, rig, bones, attach, st_bones, only=None, emotion=None):
    """src: source animation json. only: 'hand' / 'legs' / None. returns an animation json for this pose"""
    side = pose == 'side'
    length = max(duration(src), 0.5)
    sb = src.get('bones', {}); out_b = {}; out_s = {}
    arms = ARM_MAP_SIDE if side else ARM_MAP
    body = BODY_MAP_SIDE if side else BODY_MAP
    eyes = EYE_MAP_SIDE if side else EYE_MAP
    def put(target, kind, arr):
        if target in bones: out_b.setdefault(target, {})[kind] = arr
    def parent_rot(name): return world_rot(bones, bones[name]['parent']) if bones[name].get('parent') else 0
    # --- arms (rotations)
    if only in (None, 'hand'):
        for s, t in arms.items():
            if s in sb and 'rotate' in sb[s]: put(t, 'rotate', json.loads(json.dumps(sb[s]['rotate'])))
    # --- body / head (not for the hand layer)
    if only is None:
        for s, t in body.items():
            if s not in sb or t not in bones: continue
            tl = sb[s]
            if 'rotate' in tl and not (s == 'head' and False): put(t, 'rotate', json.loads(json.dumps(tl['rotate'])))
            if 'translate' in tl:
                pr_src = world_rot(st_bones, st_bones[s]['parent']) if st_bones[s].get('parent') else 0
                pr_dst = parent_rot(t)
                k = 1.0 if s == 'pelvis' else 1.0
                def f(tt, tl=tl, pr_src=pr_src, pr_dst=pr_dst, k=k):
                    x = sample(tl['translate'], tt, 'x', 0, 2); y = sample(tl['translate'], tt, 'y', 1, 2)
                    wx, wy = rot2(x, y, pr_src)            # into world axes
                    vx, vy = rot2(wx, wy, -pr_dst)         # into the other parent's axes
                    return {'x': round(vx * k, 3), 'y': round(vy * k, 3)}
                put(t, 'translate', dense(f, length))
        for s, ts in eyes.items():
            if s in sb and 'translate' in sb[s]:
                pr_src = world_rot(st_bones, st_bones[s]['parent'])
                for t in ts:
                    if t not in bones: continue
                    pr_dst = parent_rot(t)
                    def f(tt, s=s, pr_src=pr_src, pr_dst=pr_dst):
                        x = sample(sb[s]['translate'], tt, 'x', 0, 2); y = sample(sb[s]['translate'], tt, 'y', 1, 2)
                        wx, wy = rot2(x, y, pr_src); vx, vy = rot2(wx, wy, -pr_dst)
                        return {'x': round(vx * EYE_SCALE, 3), 'y': round(vy * EYE_SCALE, 3)}
                    put(t, 'translate', dense(f, length))
    # --- legs: the Autodraft legs are IK driven -> move the IK targets (feet) and the pelvis
    if only in (None, 'legs'):
        used = any(b in sb for names in LEG_SRC.values() for b in names) or 'pelvis' in sb
        targets = LEG_TARGET_SIDE if side else LEG_TARGET
        if used and all(t in bones for t in targets.values()):
            ts = grid(length)
            def over_at(t):
                o = {}
                if 'pelvis' in sb:
                    if 'rotate' in sb['pelvis']: o.setdefault('pelvis', {})['rot'] = sample(sb['pelvis']['rotate'], t)
                    if 'translate' in sb['pelvis']: o.setdefault('pelvis', {}).update(dx=sample(sb['pelvis']['translate'], t, 'x', 0, 2), dy=sample(sb['pelvis']['translate'], t, 'y', 1, 2))
                for names in LEG_SRC.values():
                    for nm in names:
                        if nm in sb and 'rotate' in sb[nm]: o.setdefault(nm, {})['rot'] = sample(sb[nm]['rotate'], t)
                return o
            for leg, (up, lo, foot) in LEG_SRC.items():
                tgt = targets[leg]
                base = fk(st_bones, foot, {}); bx, by = base[0][2], base[1][2]
                pr_dst = parent_rot(tgt)
                def fpos(t, foot=foot, bx=bx, by=by, pr_dst=pr_dst):
                    M = fk(st_bones, foot, over_at(t))
                    vx, vy = rot2(M[0][2] - bx, M[1][2] - by, -pr_dst)
                    return {'x': round(vx, 3), 'y': round(vy, 3)}
                put(tgt, 'translate', dense(fpos, length))
                if foot in sb and 'rotate' in sb[foot]: put(tgt, 'rotate', json.loads(json.dumps(sb[foot]['rotate'])))
        if only == 'legs' and 'pelvis' in sb and 'bone' in bones:
            pass
        if 'pelvis' in sb and 'bone' in bones and only == 'legs':
            tl = sb['pelvis']
            pr_dst = parent_rot('bone')
            def f(tt):
                x = sample(tl['translate'], tt, 'x', 0, 2) if 'translate' in tl else 0; y = sample(tl['translate'], tt, 'y', 1, 2) if 'translate' in tl else 0
                vx, vy = rot2(x, y, -pr_dst); return {'x': round(vx, 3), 'y': round(vy, 3)}
            if 'translate' in tl: put('bone', 'translate', dense(f, length))
            if 'rotate' in tl: put('bone', 'rotate', json.loads(json.dumps(tl['rotate'])))
    # --- slots
    ss = src.get('slots', {})
    if only in (None, 'hand'):
        for sd, slot in HAND_SLOT.items():
            if slot not in attach: continue
            tl = ss.get(f'{sd}_hand_front_slot', {}).get('attachment')
            if not tl: continue
            rest = next((s.get('attachment') for s in rig['slots'] if s['name'] == slot), None)
            arr = []
            for k in tl:
                nm = k.get('name') or ''
                shape = nm.replace(f'{sd}_hand_', '')
                pic = HAND_SHAPE.get(shape)
                if pic is None or pic not in attach[slot]: pic = rest
                e = {'time': keytime(k)}
                if pic: e['name'] = pic
                arr.append(e)
            if arr: out_s[slot] = {'attachment': arr}
    if only is None:
        if 'EB' in attach and 'eye_lid' in ss:
            arr = []; emo = None
            for k in ss['eye_lid'].get('attachment', []):
                nm = k.get('name') or ''
                state = next((s for s in ('half_close', 'close', 'open') if nm.endswith(s)), 'open')
                emo = emo or (nm.split('_')[2] if nm.count('_') >= 3 else None)
                e = {'time': keytime(k)}
                if EYELID[state]: e['name'] = EYELID[state]
                arr.append(e)
            if arr: out_s['EB'] = {'attachment': arr}
            emotion = emotion or emo
        if 'Mouth-X' in attach and 'lips' in ss:
            arr = []
            for k in ss['lips'].get('attachment', []):
                nm = k.get('name') or ''
                if nm in LIPS_EMOTION and nm != 'lip_idle': arr.append({'time': keytime(k), 'name': LIPS_EMOTION[nm]})
            if arr and len(arr) <= 6: out_s['Mouth-X'] = {'attachment': [{'time': 0, 'name': arr[0]['name']}] + [a for a in arr[1:]]}
        # a face expression also tilts the eyebrows
        if emotion in BROWS and all(b in bones for b in ('Eyebrow_R_N', 'Eyebrow_L_N')):
            a = BROWS[emotion]
            L = max(length, 0.5)
            put('Eyebrow_R_N', 'rotate', [{'time': 0, 'value': -a}, {'time': round(L, 3), 'value': -a}])
            put('Eyebrow_L_N', 'rotate', [{'time': 0, 'value': a}, {'time': round(L, 3), 'value': a}])
    out = {}
    if out_s: out['slots'] = out_s
    out['bones'] = out_b
    return out

# ---------------------------------------------------------------- main
def main():
    st_bones = load_source_rig()
    src_anims = {a['id']: (c['name'], a) for c in CATALOG['patterns'][SRC_PATTERN]['categories'] for a in c['animations']}
    # remove everything of the old Autodraft animation library (animations + previews)
    for d in ('anims', 'thumbs'):
        shutil.rmtree(SRC / 'autodraft' / d, ignore_errors=True)
    catalog = {'tracks': {'PRIMARY': 'Body', 'HAND': 'Hands', 'LEGS': 'Legs', 'EXPRESSION': 'Face'}, 'poses': {}}
    report = {}
    for pose in POSES:
        rig, bones, attach = load_pose_rig(pose)
        outdir = SRC / 'autodraft' / 'anims' / pose
        outdir.mkdir(parents=True, exist_ok=True)
        tracks = {'PRIMARY': [], 'HAND': [], 'LEGS': [], 'EXPRESSION': []}
        def write(nid, name, track, j, length):
            if not j.get('bones') and not j.get('slots'): return False
            json.dump(j, open(outdir / f'{nid}.json', 'w'), separators=(',', ':'))
            tracks[track].append({'id': nid, 'name': name, 'file': f'autodraft/anims/{pose}/{nid}.json', 'length': round(length, 2)})
            return True
        for sid, (name, track) in NAMES.items():
            src = json.load(open(SRC / 'animations' / f'{sid}.json'))
            j = convert(src, pose, rig, bones, attach, st_bones)
            write(NEW_ID[sid], name, track, j, max(duration(src), src_anims[sid][1].get('length') or 0, 0.5))
        for sid, name in HAND_LAYERS.items():
            src = json.load(open(SRC / 'animations' / f'{sid}.json'))
            write(HAND_ID[sid], name, 'HAND', convert(src, pose, rig, bones, attach, st_bones, only='hand'), max(duration(src), 0.5))
        for sid, name in LEG_LAYERS.items():
            src = json.load(open(SRC / 'animations' / f'{sid}.json'))
            write(LEG_ID[sid], name, 'LEGS', convert(src, pose, rig, bones, attach, st_bones, only='legs'), max(duration(src), 0.5))
        catalog['poses'][pose] = tracks
        report[pose] = {k: len(v) for k, v in tracks.items()}
    json.dump(catalog, open(PUB / 'autodraft' / 'animations.json', 'w'), indent=1)
    print(json.dumps(report))

if __name__ == '__main__':
    main()
