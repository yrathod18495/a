#!/usr/bin/env python3
"""Bakes the draw order the original page really uses (after its saree / hair / ear fix-ups) into the zOrder keyframes of a character ZIP.
The page applies the raw offsets of an animation and THEN moves the arm caps, the belt, the horns ... back into place; the ZIP only has the offsets, so a
second palm (Praying, Clapping ...) stayed behind the saree. Here every zOrder key becomes the final order, written as offsets against the ZIP's own slot order.
usage: dayan-fix-draworder.py in.zip out.zip runtime.json orders.json   (runtime.json: scripts/wardrobe-extract.cjs, orders.json: the page's real order at every key)"""
import json, sys, zipfile
src, dst, runtime_path, orders_path = sys.argv[1:5]
rt = json.load(open(runtime_path)); od = json.load(open(orders_path))
order0 = []; seen = set()
for i in rt['order']:
    if i >= 0 and i not in seen: seen.add(i); order0.append(i)
zip_idx = {orig: z for z, orig in enumerate(order0)}          # the page's slot number -> the ZIP's slot number
FPS = 30
zin = zipfile.ZipFile(src); zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
skel = json.loads(zin.read('views/f34/skeleton.json')); slot_names = [s['name'] for s in skel['armature'][0]['slot']]
page_names = [rt['P']['slots'][i][0] for i in order0]
assert slot_names == page_names, 'the ZIP slot order is not the one of the page'
fixed = 0
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename.startswith('views/f34/animations/') and item.filename.endswith('.json'):
        doc = json.loads(data); name = next(iter(doc)); anim = doc[name]
        hit = next((v for k, v in od['res'].items() if k.lower() == name.lower()), None)
        if hit:
            total = anim['duration']; frames = []
            keys = hit['frames']
            if keys[0][0] > 1e-6: frames.append({'zOrderByName': [], 'duration': round(keys[0][0] * FPS)})
            for n, (t, order) in enumerate(keys):
                target = []; s2 = set()
                for i in order:
                    if i >= 0 and i in zip_idx and i not in s2: s2.add(i); target.append(zip_idx[i])
                pos = {z: p for p, z in enumerate(target)}
                pairs = [[slot_names[z], pos[z] - z] for z in range(len(slot_names)) if z in pos and pos[z] != z]
                end = keys[n + 1][0] * FPS if n + 1 < len(keys) else total
                frames.append({'zOrderByName': pairs, 'duration': max(1, round(end - t * FPS))})
            anim['zOrder'] = {'frame': frames}; fixed += 1
            data = json.dumps(doc, separators=(',', ':')).encode()
    zout.writestr(item, data)
zout.close(); print('draw order baked into', fixed, 'animations')
