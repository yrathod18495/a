#!/usr/bin/env python3
"""Packs the joint-by-joint retarget (tests/browser/tmp-retarget.spec.js output, one JSON per animation) into a character ZIP as DragonBones animations, with the hand pictures.
The palms of the source rig (Palm_4, Palm_31 ...) are matched to the pictures the target rig has (default, namaste, close, pointing_finger ...) by what the picture shows.
usage: retarget-pack.py in.zip out.zip <retarget dir> <view id> <source rig zip> <pose: front-side|front|side|back|back-2> [--min-degrees 1.5]"""
import json, sys, zipfile, math, os, re
args = [a for a in sys.argv[1:] if not a.startswith('--')]
src, dst, rdir, view_id, srczip, pose = args[:6]
ROOT = '/tmp/autodraft_in/autodraft_animations'
FIST = {'L_Plam', 'Palm_16', 'Palm_18', 'Palm_20', 'Palm_21', 'Palm_22', 'Palm_23', 'Palm_24', 'Palm_6', 'Palm_12', 'R_Palm_Strong'}
POINT = {'Palm_17', 'Palm_Point', 'Palm_Think'}; NAMASTE = {'Palm_29', 'Palm_30', 'Palm_31'}; OPEN = {'Palm_5', 'Palm_13', 'Palm_1', 'Palm_14', 'Palm_15'}; TALK = {'Palm_4', 'Palm_9', 'Palm_19', 'Palm_25'}
def shape(n):
    if n in FIST: return 'close'
    if n in POINT: return 'pointing_finger'
    if n in NAMASTE: return 'namaste'
    if n in OPEN: return 'full_open'
    if n == 'Palm_28': return 'blessing'
    if n in TALK: return 'talking'
    if n == 'Palm_Mobile': return 'small'
    return 'default'
def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]; idx, dmax = 0, 0
    for i in range(1, len(pts) - 1):
        t = (pts[i][0] - x0) / (x1 - x0) if x1 != x0 else 0; d = abs(pts[i][1] - (y0 + (y1 - y0) * t))
        if d > dmax: idx, dmax = i, d
    return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps) if dmax > eps else [pts[0], pts[-1]]
def curve(vals, eps, key='rotate'):
    pts = rdp([(i, v) for i, v in enumerate(vals)], eps); out = []
    for k, (i, v) in enumerate(pts):
        j = pts[k + 1][0] if k + 1 < len(pts) else i
        out.append({key: round(v, 3), 'tweenEasing': 0, 'duration': j - i})
    out[-1]['duration'] = 0; return out
MIN = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--min-degrees=')), 1.5))
zin = zipfile.ZipFile(src); manifest = json.loads(zin.read('manifest.json')); view = next(v for v in manifest['views'] if v['id'] == view_id)
sk = json.loads(zin.read(view['skeleton']))['armature'][0]; slots = {s['name']: [d['name'] for d in s['display']] for s in sk['skin'][0]['slot']}
hand_slot = {'left': next((n for n in ('left_hand_fx', 'left_hand_front_slot') if n in slots), None), 'right': next((n for n in ('right_hand_fx', 'right_hand_front_slot') if n in slots), None)}
def attach(side, sh):
    names = slots.get(hand_slot[side], []); want = {'small': ['small_acc_front', 'small_prop'], 'big': ['big_acc_front', 'big_prop_front']}.get(sh, [sh])
    for w in want:
        if f'{side}_hand_{w}' in names: return f'{side}_hand_{w}'
    return f'{side}_hand_default' if f'{side}_hand_default' in names else None
szip = zipfile.ZipFile(srczip); smeta = {a['name']: a for a in json.loads(szip.read('manifest.json'))['views'][0]['animations']}
have = {a['name'].lower() for a in view['animations']}
def uniq(name):
    base = re.sub(r'[^A-Za-z0-9]+', '_', name).strip('_'); n = base; i = 2
    while n.lower() in have: n = f'{base}_{i}'; i += 1
    have.add(n.lower()); return n
files = {}; added = []; skipped = []
for f in sorted(os.listdir(rdir)):
    if not f.endswith('.json'): continue
    d = json.load(open(os.path.join(rdir, f))); bones = []
    for nm, tr in d['track'].items():
        b = {'name': nm}
        if 'r' in tr:
            vals = [math.degrees(v) for v in tr['r']]
            if max(vals) - min(vals) >= MIN or abs(vals[0]) >= MIN: b['rotateFrame'] = curve(vals, 0.5)
        if 'tx' in tr and max(max(tr['tx']) - min(tr['tx']), max(tr['ty']) - min(tr['ty'])) >= 3:
            tf = [{'x': round(a, 2), 'y': round(c, 2), 'tweenEasing': 0, 'duration': 1} for a, c in zip(tr['tx'], tr['ty'])]; tf[-1]['duration'] = 0
            b['translateFrame'] = tf
        if len(b) > 1: bones.append(b)
    meta = smeta.get(d['n'], {}); layer_src = meta.get('layer')
    if layer_src == 'face' or not bones: skipped.append(d['n']); continue
    # hand pictures
    slot = []
    sm = None
    if meta.get('id') is not None:
        sm = next(iter(json.load(open(f"{ROOT}/pose_animations/{pose}/{meta['id']}.json")).values())).get('slot', [])
    sideOf = {'L_Palm': d['pair']['A'], 'R_Palm': 'right' if d['pair']['A'] == 'left' else 'left', 'Palm_L': d['pair']['A'], 'Palm_R': 'right' if d['pair']['A'] == 'left' else 'left'}
    for s in sm or []:
        side = sideOf.get(s['name'])
        if not side or not hand_slot[side]: continue
        fr = []
        for x in s.get('displayFrame', []):
            a = attach(side, shape(x.get('displayName', 'L_Palm'))); dur = int(round(x.get('duration', 0) * 0.5))
            if fr and fr[-1]['displayName'] == a: fr[-1]['duration'] += dur
            else: fr.append({'displayName': a, 'duration': dur})
        if fr and len({x['displayName'] for x in fr}) > 1: fr[-1]['duration'] = 0; slot.append({'name': hand_slot[side], 'displayFrame': fr})
    name = uniq(meta.get('label') or d['n']); N = d['N']
    anim = {'name': name, 'duration': N, 'playTimes': 0, 'bone': bones, 'slot': slot, 'zOrder': {'frame': []}, '_sourceFrameRate': 30}
    layer = 'body' if (d['useLegs'] or d['useTorso'] or d['useHead']) else 'hand'
    path = f'views/{view_id}/animations/{name.lower()}.json'; files[path] = json.dumps({name: anim}, separators=(',', ':'))
    view['animations'].append({'name': name, 'label': name.replace('_', ' '), 'group': meta.get('group', 'Autodraft'), 'layer': layer, 'length': d['length'], 'file': path, 'source': f"autodraft:{pose}:{meta.get('id')}"}); added.append(name)
zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist(): zout.writestr(it, json.dumps(manifest, indent=1) if it.filename == 'manifest.json' else zin.read(it.filename))
for p, t in files.items(): zout.writestr(p, t)
zout.close(); print('added', len(added), 'skipped', len(skipped))
