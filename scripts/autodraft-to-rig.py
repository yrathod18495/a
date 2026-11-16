#!/usr/bin/env python3
"""Autodraft animation pack (DragonBones JSON for the Autodraft rigs: ARM_L, FOREARM_R, HEAD, TORSO3 ...) -> animations of a wardrobe-rig character ZIP (Dayan, William ...).
Only bones that exist on both rigs are carried over (arms, forearms, palms, head, torso); leg IK controls and the hand / mouth / brow pictures of the other rig have no match.
Pose by pose: the ZIP's view f34 / fr / sd / bk takes the pack's front-side / front / side / back library.
usage: autodraft-to-rig.py <pack dir> <in.zip> <out.zip> [--own] [--all-pose-library] [--min-degrees 4]"""
import json, sys, zipfile, re, glob, os
args = [a for a in sys.argv[1:] if not a.startswith('--')]; flags = sys.argv[1:]
root, zin_path, zout_path = args[:3]
opt = lambda n, d: (flags[flags.index(f'--{n}') + 1] if f'--{n}' in flags else d)
MIN_DEG = float(opt('min-degrees', 4)); OWN = '--own' in flags; ALL_POSE = '--all-pose-library' in flags
POSE_DIR = {'f34': 'front-side', 'fr': 'front', 'sd': 'side', 'bk': 'back'}
# the pose library animations that were played one by one on the rig and look right (the others need the other rig's hand pictures: Pray, Clap, Folded hands ...)
KEEP = {9019, 9020, 9021, 9022, 9023, 9025, 9026, 9027, 9028, 9045, 9046, 9048, 9051, 9055, 9062, 9300, 9301, 9302, 9303, 9305, 9308, 9309, 9311}
# arm pairs of the source rig: ARM_L + FOREARM_R + L_Palm are one arm, ARM_R + FOREARM_L + R_Palm the other
def bone_map(view_bones, pose_dir):
    n = set(view_bones)
    if 'left_arm_up_jt' in n:          # William / Maya: wardrobe rig, renamed bones
        L, R, up, dn, pm, head, torso = 'left', 'right', '{}_arm_up_jt', '{}_arm_dn_jt', '{}_palm_jt', 'head', 'torso2'
    else:                              # Dayan (older names)
        L, R, up, dn, pm, head, torso = 'left', 'right', '{}_upper_hand_circle', '{}_lower_hand_circle', '{}_hand_palm_circle', 'head', 'upper_body2'
    m = {}
    if pose_dir == 'side':
        m.update({'Arm_L': up.format(L), 'Forarm_L': dn.format(L), 'Palm_L': pm.format(L), 'Arm_L2': up.format(R), 'Forarm_L2': dn.format(R), 'Palm_R': pm.format(R), 'HEAD': head})
    else:
        m.update({'ARM_L': up.format(L), 'FOREARM_R': dn.format(L), 'L_Palm': pm.format(L), 'ARM_R': up.format(R), 'FOREARM_L': dn.format(R), 'R_Palm': pm.format(R), 'HEAD': head})
        if torso in n and pose_dir == 'front-side': m['TORSO3'] = torso
    return {k: v for k, v in m.items() if v in n}
SKIP = re.compile(r'expression|face|lip|eye|blink|mouth|leg_part|_leg|namaskar|namaste|pray|clap|claping|crossed|fold|hug|salaam', re.I)          # face / leg tracks, and gestures where the two hands must meet (their hand pictures are missing)
LEGS = re.compile(r'climb|stair|jump|kick|dance|fall|faint|sit|seat|sleep|swim|cycl|ride|riding|drive|boat|horse|crawl|squat|skat|paddl|stand_to|get_up|lying|lie_|hang|fly|flying|beaten|slip|pick|bend|lift', re.I)          # whole-body moves: the legs must move too, and the rig has no way to do it here
WALKISH = re.compile(r'walk|jog|march|limp|run', re.I)          # these get the legs of the rig's own walk / run
def retime(frames, total_cycles, factor):
    out = []; carry = 0.0
    for c in range(total_cycles):
        last = c == total_cycles - 1
        for f in (frames if last else frames[:-1]):
            d = f.get('duration', 0) * factor + carry; n = int(round(d)) if f.get('duration', 0) else 0; carry = d - n if f.get('duration', 0) else carry
            o = dict(f); o['duration'] = n; out.append(o)
    return out
def cut(frames, t0, t1):
    """the keys of a bone between frame t0 and t1, with the values at the two ends worked out (straight lines between keys)"""
    keys = []; t = 0
    for f in frames: keys.append((t, f)); t += f.get('duration', 0)
    VAL = ('rotate', 'x', 'y')
    def at(x):
        for (ta, fa), (tb, fb) in zip(keys, keys[1:]):
            if ta <= x <= tb and tb > ta:
                k = (x - ta) / (tb - ta); o = dict(fa)
                for v in VAL:
                    if v in fa and v in fb: o[v] = fa[v] + (fb[v] - fa[v]) * k
                return o
        return dict(keys[-1][1])
    pts = [t0] + [tt for tt, _ in keys if t0 < tt < t1] + [t1]; out = []
    for i, tt in enumerate(pts):
        o = at(tt) if tt in (t0, t1) else dict(next(f for k, f in keys if k == tt))
        o['duration'] = (pts[i + 1] - tt) if i + 1 < len(pts) else 0; out.append(o)
    return out
def compose(conv, base, length, arm_names, gait):
    """the legs, hips and body bounce of the rig's own walk / run (one stride, repeated to fill the length) with the arms of the pack"""
    T = conv['duration']; n = max(1, round(T / gait)); factor = T / (n * gait)
    bones = [b for b in base['bone'] if b['name'] not in arm_names]
    for b in bones:
        for k in list(b):
            if k.endswith('Frame'): b[k] = retime(cut(b[k], 0, gait), n, factor)
    return {'duration': T, 'playTimes': 0, 'bone': bones + conv['bone'], 'slot': [], 'zOrder': {'frame': []}, '_sourceFrameRate': 30}
def convert(a, length, bmap):
    scale = 30.0 * length / a['duration'] if a['duration'] and length else 0.5
    bones = []
    for b in a.get('bone', []):
        tgt = bmap.get(b['name'])
        if not tgt or 'rotateFrame' not in b: continue
        vals = [f.get('rotate', 0) for f in b['rotateFrame']]
        if not vals or max(vals) - min(vals) < MIN_DEG: continue          # a bone that hardly moves is left out
        fr = []; carry = 0.0
        for f in b['rotateFrame']:
            d = f.get('duration', 0) * scale + carry; n = int(round(d)); carry = d - n
            o = {k: v for k, v in f.items() if k != 'duration'}; o['duration'] = n; fr.append(o)
        bones.append({'name': tgt, 'rotateFrame': fr})
    return {'duration': max(1, int(round(a['duration'] * scale))), 'playTimes': 0, 'bone': bones, 'slot': [], 'zOrder': {'frame': []}, '_sourceFrameRate': 30}
zin = zipfile.ZipFile(zin_path); manifest = json.loads(zin.read('manifest.json')); files = {}; report = {}
cat = json.load(open(f'{root}/catalog/pose_animations_catalog.json'))['poses']
for view in manifest['views']:
    vid = view['id']; pose = POSE_DIR.get(vid)
    if not pose: continue
    sk = json.loads(zin.read(view['skeleton'])); vb = [b['name'] for b in sk['armature'][0]['bone']]
    have = {x['name'].lower() for x in view['animations']}
    def uniq(name):
        base = re.sub(r'[^A-Za-z0-9]+', '_', name).strip('_'); n = base; i = 2
        while n.lower() in have: n = f'{base}_{i}'; i += 1
        have.add(n.lower()); return n
    bmap = bone_map(vb, pose); added = []; seen = set(); own_seen = set()
    bases = {}
    for key in ('walk', 'run'):
        ent = next((x for x in view['animations'] if x['name'].lower() == key and not x.get('source')), None)
        if ent: bases[key] = next(iter(json.loads(zin.read(ent['file'])).values()))
    def add(label, group, src, length, source):
        if source.split(':')[1] in ('villageboy', 'svgmulti') and SKIP.search(label): return
        conv = convert(src, length, bmap)
        if not conv['bone']: return
        if source.split(':')[1] == 'svgmulti' and re.sub(r'[^a-z0-9]','',label.lower()) in own_seen: return          # the Village Boy set already has this one (the SVG Multi copy differs only a little)
        walkish = source.split(':')[1] in ('villageboy', 'svgmulti') and WALKISH.search(label) and not re.search(r'part', label, re.I)
        if source.split(':')[1] in ('villageboy', 'svgmulti') and LEGS.search(label): return
        if walkish:
            base = bases.get('run' if re.search(r'jog|run', label, re.I) else 'walk')
            if not base: return
            arms = {v for v in bmap.values() if 'arm' in v or 'palm' in v or 'hand' in v}
            conv = compose(conv, json.loads(json.dumps(base)), length, arms, 22 if re.search(r'jog|run', label, re.I) else 44)
        key = json.dumps(conv['bone'], sort_keys=True)
        if key in seen: return          # the same movement already added (the Village Boy and the SVG Multi sets share many)
        seen.add(key)
        if conv['bone'] and max((max(f.get('rotate', 0) for f in b['rotateFrame']) - min(f.get('rotate', 0) for f in b['rotateFrame'])) for b in conv['bone'] if 'rotateFrame' in b) < 15: return          # nothing you can see moves
        if source.split(':')[1] == 'villageboy': own_seen.add(re.sub(r'[^a-z0-9]','',label.lower()))
        name = uniq(label); conv['name'] = name; path = f'views/{vid}/animations/{name.lower()}.json'
        files[path] = json.dumps({name: conv}, separators=(',', ':'))
        arms = {v for k, v in bmap.items() if 'arm' in v or 'palm' in v or 'hand' in v}
        layer = 'hand' if {b['name'] for b in conv['bone']} <= arms else 'body'
        view['animations'].append({'name': name, 'label': label.replace(' · ', ' ').replace('_', ' ').strip(), 'group': group, 'layer': layer, 'length': length, 'file': path, 'source': source}); added.append(name)
    for t, lst in ({} if '--own-only' in flags else cat.get(pose, {})).items():
        for x in lst:
            if not ALL_POSE and x['id'] not in KEEP: continue
            src = next(iter(json.load(open(f"{root}/pose_animations/{pose}/{x['id']}.json")).values()))
            add(x['name'], x['name'].split(' · ')[0], src, x['length'], f"autodraft:{pose}:{x['id']}")
    if OWN and vid == 'f34':
        for d in ('villageboy', 'svgmulti'):
            for x in json.load(open(f'{root}/own_animations/{d}/_index.json')):
                src = next(iter(json.load(open(f"{root}/own_animations/{d}/{x['file']}.json")).values()))
                add(x['name'], 'Village Boy' if d == 'villageboy' else 'SVG Multi', src, x['length'], f"autodraft:{d}:{x['file']}")
    report[vid] = (len(vb), len(bmap), len(added))
zout = zipfile.ZipFile(zout_path, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist(): zout.writestr(item, json.dumps(manifest, indent=1) if item.filename == 'manifest.json' else zin.read(item.filename))
for p, t in files.items(): zout.writestr(p, t)
zout.close(); print({k: {'bones': a, 'mapped': b, 'added': c} for k, (a, b, c) in report.items()})
