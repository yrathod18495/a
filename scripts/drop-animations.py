#!/usr/bin/env python3
"""Removes animations (by name, every view) from a character ZIP.  usage: drop-animations.py in.zip out.zip names.txt   (one name per line)"""
import json, sys, zipfile
src, dst, names = sys.argv[1:4]; drop = {n.strip().lower() for n in open(names) if n.strip()}
zin = zipfile.ZipFile(src); m = json.loads(zin.read('manifest.json')); gone = set(); n = 0
for v in m['views']:
    keep = []
    for a in v['animations']:
        if a['name'].lower() in drop: gone.add(a['file']); n += 1
        else: keep.append(a)
    v['animations'] = keep
zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    if it.filename in gone: continue
    zout.writestr(it, json.dumps(m, indent=1) if it.filename == 'manifest.json' else zin.read(it.filename))
zout.close(); print('removed', n, 'animations')
