#!/usr/bin/env python3
"""Add a hand-made "Action_Bite" body animation to a character ZIP (or write just the animation JSON for a preview).
   usage: add-bite-animation.py in.zip out.zip --rig dayan|william
          add-bite-animation.py --json out.json --rig dayan|william [--view f34|fr|sd|bk]
   The bite: wind-up (head and chest go back, arms rise like claws, mouth opens wide) -> lunge forward -> snap (mouth shuts)
   -> hold and shake the head like worrying a bite -> let go and return to the rest pose. 40 frames at 30 fps; first and last pose
   are the rest pose, so it loops and joins other clips cleanly. Positive arm turns go forward / up, negative torso and head turns lean forward.
   DragonBones data only: bone rotateFrame tracks plus a `lips` slot displayFrame track.
"""
import sys, json, zipfile, argparse

FPS = 30
DUR = 40
NAME, LABEL, GROUP = 'Action_Bite', 'Action Bite', 'Action'

# per rig: the bones that matter, the mouth shapes (open with teeth / closed / rest) and, per view, how strongly it leans, which bones
# share the lean (a chain of torso bones), and how much the head "comes at the camera" (a head scale-up, for the views that look at us)
RIGS = {
    'dayan': dict(head='head', lips='lips', armL=('left_upper_hand_circle', 'left_lower_hand_circle'), armR=('right_upper_hand_circle', 'right_lower_hand_circle'),
                  mouth=dict(rest='lip_idle', clench='lip_angry', half='lip_a_e_i', wide='lip_shocked', shut='lip_b_m_p'),
                  views={'f34': dict(k=1.0, torso=['upper_body2'], pop=0.0)}),
    'william': dict(head='head', lips='lips', armL=('left_arm_up_jt', 'left_arm_dn_jt'), armR=('right_arm_up_jt', 'right_arm_dn_jt'),
                    mouth=dict(rest='mo_idle', clench='mo_angry', half='mo_a_e_i', wide='mo_shocked', shut='mo_b_m_p'),
                    views={'f34': dict(k=0.8, torso=['torso2', 'torso3', 'torso4'], pop=0.18), 'sd': dict(k=1.0, torso=['hips_jt', 'hips_jt2'], pop=0.0)}),
}

# (frame, value) keys, linear between them. Rest pose = 0 at frame 0 and frame DUR.
TORSO = [(0, 0), (6, 12), (10, 14), (14, -28), (16, -33), (20, -29), (24, -33), (28, -29), (34, -10), (40, 0)]
HEAD = [(0, 0), (6, 8), (10, 10), (14, 12), (16, 3), (18, 12), (20, 2), (22, 12), (24, 2), (26, 11), (28, 3), (31, 7), (35, 3), (40, 0)]   # relative to the chest: the face leads forward, then chomps
ARM_UP = [(0, 0), (8, 22), (12, 30), (16, 14), (30, 10), (40, 0)]
ARM_LO = [(0, 0), (8, 34), (14, 42), (16, 22), (30, 16), (40, 0)]
POP = [(0, 0), (10, 0), (14, 1), (16, 1), (28, 1), (35, 0.2), (40, 0)]      # 0..1: the head comes toward the camera during the lunge and the hold

def scale_track(keys, amount):
    out = []
    for i, (f, v) in enumerate(keys):
        d = keys[i + 1][0] - f if i + 1 < len(keys) else 0
        out.append({'duration': d, 'x': round(1 + v * amount, 4), 'y': round(1 + v * amount, 4), 'tweenEasing': 0})
    return {'scaleFrame': out}

def track(keys, scale=1.0, shift=0):
    out = []
    for i, (f, v) in enumerate(keys):
        d = keys[i + 1][0] - f if i + 1 < len(keys) else 0
        out.append({'duration': d, 'rotate': round(v * scale, 3), 'tweenEasing': 0})
    assert sum(k['duration'] for k in out) == DUR, 'a track must end exactly at the last frame'
    return {'rotateFrame': out}

def mouth_frames(m):
    seq = [(m['rest'], 4), (m['clench'], 2), (m['half'], 3), (m['wide'], 5), (m['half'], 1), (m['shut'], 1),   # opens (0-14), snaps shut (15)
           (m['clench'], 3), (m['shut'], 2), (m['clench'], 3), (m['shut'], 2), (m['clench'], 3), (m['shut'], 2), (m['clench'], 3),   # chews while holding (16-33)
           (m['clench'], 2), (m['rest'], 4)]
    assert sum(n for _, n in seq) == DUR, sum(n for _, n in seq)
    fr = [{'displayName': s, 'duration': n} for s, n in seq]
    fr.append({'displayName': seq[-1][0], 'duration': 0})
    return fr

def build(rig, view):
    c = RIGS[rig]; cfg = c['views'][view]; k = cfg['k']; bones = []      # (the legs hang from the hips and are left alone: the feet stay planted)
    for t in cfg['torso']:      # a chain of torso bones shares the lean
        bones.append({'name': t, **track(TORSO, k / len(cfg['torso']))})
    head = {'name': c['head'], **track(HEAD, k)}
    if cfg['pop']: head.update(scale_track(POP, cfg['pop']))
    bones.append(head)
    for (up, lo), a in ((c['armL'], 1.0), (c['armR'], 0.9)):
        bones.append({'name': up, **track(ARM_UP, a * k)}); bones.append({'name': lo, **track(ARM_LO, a * k)})
    return {'name': NAME, 'duration': DUR, 'playTimes': 0, 'bone': bones,
            'slot': [{'name': c['lips'], 'displayFrame': mouth_frames(c['mouth'])}], '_sourceFrameRate': FPS}

def add_to_zip(src, dst, rig):
    zin = zipfile.ZipFile(src); m = json.loads(zin.read('manifest.json')); added = []
    for v in m['views']:
        if v['id'] not in RIGS[rig]['views']: continue      # a view with no face, or where a lunge makes no sense, is left alone
        body = json.dumps({NAME: build(rig, v['id'])})
        sk = json.loads(zin.read(v['skeleton']))['armature'][0]
        slots = {s['name'] for s in sk['slot']}; bones = {b['name'] for b in sk['bone']}
        c = RIGS[rig]
        need = [c['head'], *c['views'][v['id']]['torso'], *c['armL'], *c['armR']]
        missing = [n for n in need if n not in bones]
        if missing: raise SystemExit(f"view {v['id']}: missing bones {missing}")
        v['animations'] = [a for a in v['animations'] if a['name'] != NAME]
        f = f"views/{v['id']}/animations/action_bite.json"
        v['animations'].append({'name': NAME, 'label': LABEL, 'group': GROUP, 'layer': 'body', 'length': round(DUR / FPS, 3), 'file': f, 'source': 'handmade:bite'})
        added.append((v['id'], 'lips' if c['lips'] in slots else 'NO lips slot', f, body))
    out = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
    files = {f for _, _, f, _ in added}
    for n in zin.namelist():
        if n in files: continue
        out.writestr(n, json.dumps(m) if n == 'manifest.json' else zin.read(n))
    for _, _, f, b in added: out.writestr(f, b)
    out.close(); print('added', [a[:3] for a in added])

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('src', nargs='?'); ap.add_argument('dst', nargs='?'); ap.add_argument('--rig', required=True); ap.add_argument('--json'); ap.add_argument('--view', default='f34')
    a = ap.parse_args()
    if a.json: json.dump(build(a.rig, a.view), open(a.json, 'w')); print('wrote', a.json)
    else: add_to_zip(a.src, a.dst, a.rig)
