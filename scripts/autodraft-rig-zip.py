#!/usr/bin/env python3
"""Packs one pose of an Autodraft rig (skeleton + textures from git history: public/12toons, commit 910a99f^) with its pose library animations into a ZIP that the viewer / retarget test can open.
usage: autodraft-rig-zip.py <pack dir> <rig dir> <pose: front-side|front|side|back|back-2> <out.zip>   (the rig is used only as a SOURCE for retargeting, it is never uploaded)"""
import json, sys, zipfile, re
root, rig, pose, out = sys.argv[1:5]
cat = json.load(open(f'{root}/catalog/pose_animations_catalog.json'))['poses'][pose]
LAYER = {'PRIMARY': 'body', 'HAND': 'hand', 'LEGS': 'legs', 'EXPRESSION': 'face'}
z = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED); anims = []
for t, l in cat.items():
    for x in l:
        name = re.sub(r'[^A-Za-z0-9]+', '_', x['name']).strip('_'); d = json.load(open(f"{root}/pose_animations/{pose}/{x['id']}.json")); a = next(iter(d.values())); a['name'] = name
        path = f'views/f34/animations/{name.lower()}.json'; z.writestr(path, json.dumps({name: a}))
        anims.append({'name': name, 'label': x['name'], 'group': x['name'].split(' · ')[0], 'layer': LAYER[t], 'length': x['length'], 'file': path, 'id': x['id']})
z.writestr('views/f34/skeleton.json', open(f'{rig}/{pose}_ske.json').read()); tex = []
for i in range(3):
    try: j = open(f'{rig}/{pose}_tex_{i}.json').read()
    except FileNotFoundError: break
    z.writestr(f'views/f34/texture_{i}.json', j); z.writestr('views/f34/' + json.loads(j)['imagePath'], open(f'{rig}/{pose}_tex_{i}.webp', 'rb').read()); tex.append(f'views/f34/texture_{i}.json')
z.writestr('manifest.json', json.dumps({'format': '12toons-character', 'version': 1, 'character': {'id': 'source', 'name': 'Source'}, 'category': {'id': 'source', 'name': 'Source'}, 'frameRate': 30, 'views': [{'id': 'f34', 'label': pose, 'skeleton': 'views/f34/skeleton.json', 'textures': tex, 'animations': anims}]}))
z.close(); print(len(anims), 'animations,', len(tex), 'texture pages')
