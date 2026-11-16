#!/usr/bin/env python3
"""Autodraft pose-library animations (DragonBones JSON, Neha-style rig: ARM_L, FOREARM_R, HEAD, TORSO3 ...) -> animations of the Dayan rig (wardrobe rig: left_upper_hand_circle ...).
Only the bones that exist on both rigs are carried over (arms, forearms, palms, head, torso); the leg IK controls, hand / mouth / brow pictures of the other rig have no match and are left out.
usage: autodraft-to-dayan.py <autodraft_animations dir> <dayan.zip in> <dayan.zip out> [--flip-arms] [ids...]"""
import json, sys, zipfile, re, os
args = [a for a in sys.argv[1:] if not a.startswith('--')]; flags = {a for a in sys.argv[1:] if a.startswith('--')}
root, zin_path, zout_path = args[:3]; only = {int(x) for x in args[3:]}
# animations that were played one by one on the Dayan rig and look right (the others, e.g. Pray / Clap / Folded hands, need the other rig's hand pictures to look right)
KEEP = {9019, 9020, 9021, 9022, 9023, 9025, 9026, 9027, 9028, 9045, 9046, 9048, 9051, 9055, 9062, 9300, 9301, 9302, 9303, 9305, 9308, 9309, 9311}
if not only and '--all' not in flags: only = KEEP
cat = json.load(open(f'{root}/catalog/pose_animations_catalog.json'))['poses']['front-side']
IK = {'bone', '4', 'bone5'}
# the arm pair of the source rig: ARM_L + FOREARM_R + L_Palm are one arm, ARM_R + FOREARM_L + R_Palm the other
A, B = ('left', 'right') if '--flip-arms' not in flags else ('right', 'left')
MAP = {'ARM_L': f'{A}_upper_hand_circle', 'FOREARM_R': f'{A}_lower_hand_circle', 'L_Palm': f'{A}_hand_palm_circle',
       'ARM_R': f'{B}_upper_hand_circle', 'FOREARM_L': f'{B}_lower_hand_circle', 'R_Palm': f'{B}_hand_palm_circle',
       'HEAD': 'head', 'TORSO3': 'upper_body2'}
SCALE = 0.5          # the source runs at 60 frames per second, the ZIP at 30
def convert(a):
    frames_total = a['duration']; bones = []
    for b in a.get('bone', []):
        tgt = MAP.get(b['name'])
        if not tgt or 'rotateFrame' not in b: continue
        fr = []; carry = 0.0
        for f in b['rotateFrame']:
            d = f.get('duration', 0) * SCALE + carry; n = int(round(d)); carry = d - n
            o = {k: v for k, v in f.items() if k not in ('duration',)}; o['duration'] = n; fr.append(o)
        bones.append({'name': tgt, 'rotateFrame': fr})
    return {'duration': max(1, int(round(frames_total * SCALE))), 'playTimes': 0, 'bone': bones, 'slot': [], 'zOrder': {'frame': []}, '_sourceFrameRate': 30}
zin = zipfile.ZipFile(zin_path); manifest = json.loads(zin.read('manifest.json')); view = manifest['views'][0]
have = {x['name'].lower() for x in view['animations']}
def uniq(name):
    base = re.sub(r'[^A-Za-z0-9]+', '_', name).strip('_'); n = base; i = 2
    while n.lower() in have: n = f'{base}_{i}'; i += 1
    have.add(n.lower()); return n
files = {}; added = []
LAYER = {'PRIMARY': 'body', 'HAND': 'hand', 'LEGS': 'legs', 'EXPRESSION': 'face'}
for track, lst in cat.items():
    for x in lst:
        if only and x['id'] not in only: continue
        src = next(iter(json.load(open(f"{root}/pose_animations/front-side/{x['id']}.json")).values()))
        if {b['name'] for b in src.get('bone', [])} & IK: continue          # legs run on IK controls the Dayan rig does not have
        conv = convert(src)
        if not conv['bone']: continue
        name = uniq(x['name']); conv['name'] = name
        files[f'views/f34/animations/{name.lower()}.json'] = json.dumps({name: conv}, separators=(',', ':'))
        layer = 'hand' if track == 'HAND' or {b['name'] for b in conv['bone']} <= {v for k, v in MAP.items() if 'hand' in v} else 'body'
        view['animations'].append({'name': name, 'label': x['name'].replace(' · ', ' ').strip(), 'group': x['name'].split(' · ')[0], 'layer': layer, 'length': x['length'], 'file': f'views/f34/animations/{name.lower()}.json', 'source': f"autodraft:{x['id']}"})
        added.append((x['id'], name, layer))
zout = zipfile.ZipFile(zout_path, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    zout.writestr(item, json.dumps(manifest, indent=1) if item.filename == 'manifest.json' else zin.read(item.filename))
for p, t in files.items(): zout.writestr(p, t)
zout.close(); print(len(added), 'animations added'); [print(' ', *a) for a in added]
