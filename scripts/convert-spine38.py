#!/usr/bin/env python3
"""Spine 3.8 JSON rig (+ legacy atlas) -> Spine 4.2 JSON rig (+ atlas) that the 12toons runtime can load.

python3 scripts/convert-spine38.py rig38.json atlas38.atlas out_dir [page.png]

What changes between the two JSON formats (everything else is identical):
  - bone "transform" -> "inherit" (capitalised enum)
  - rotate timelines: key "angle" -> "value"
  - linked mesh "deform" -> "timelines"
  - bezier curves: 3.8 "curve": cx1, "c2", "c3", "c4" (normalised 0..1, one curve for all channels) -> 4.x "curve": [cx1, cy1, cx2, cy2, ...] (absolute time / value control points, one curve per channel)
  - slot "color" timelines -> "rgba"
  - the skeleton version string (the 3.8.75 file is also relabelled so older runtimes do not refuse it)
The legacy atlas (xy / size / orig / offset / rotate: true) is rewritten as bounds: x,y,w,h and rotate: 90.
"""
import json, os, re, sys

INHERIT = {'normal': 'Normal', 'onlytranslation': 'OnlyTranslation', 'norotationorreflection': 'NoRotationOrReflection', 'noscale': 'NoScale', 'noscaleorreflection': 'NoScaleOrReflection'}

def _rgba(c):
    c = (c or 'ffffffff').ljust(8, 'f'); return [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4, 6)]

def fix_frames(frames, chans):
    """chans: [(key, default)], or 'color'. 3.8 bezier: normalised control points shared by all channels; 4.x: absolute (time, value) points per channel."""
    for i, fr in enumerate(frames):
        c = fr.get('curve')
        if isinstance(c, (int, float)) and i + 1 < len(frames):
            c1, c2, c3, c4 = c, fr.pop('c2', 0), fr.pop('c3', 1), fr.pop('c4', 1)
            nx = frames[i + 1]; t1 = fr.get('time', 0); dt = nx.get('time', 0) - t1; out = []
            if chans == 'color': v1, v2 = _rgba(fr.get('color')), _rgba(nx.get('color'))
            else: v1 = [fr.get(k, d) for k, d in chans]; v2 = [nx.get(k, d) for k, d in chans]
            for a, b in zip(v1, v2): out += [t1 + c1 * dt, a + c2 * (b - a), t1 + c3 * dt, a + c4 * (b - a)]
            fr['curve'] = out
        else:
            for k in ('c2', 'c3', 'c4'): fr.pop(k, None)
            if isinstance(c, (int, float)): fr.pop('curve')   # last frame

BONE_CH = {'rotate': [('value', 0)], 'translate': [('x', 0), ('y', 0)], 'scale': [('x', 1), ('y', 1)], 'shear': [('x', 0), ('y', 0)]}

def fix_timelines(tls, table):
    for name, frames in tls.items():
        if name in table and isinstance(frames, list): fix_frames(frames, table[name])

def convert_rig(rig):
    rig['skeleton']['spine'] = '4.2.43'
    for b in rig.get('bones', []):
        if 'transform' in b:
            t = b.pop('transform'); b['inherit'] = INHERIT.get(str(t).lower(), 'Normal')
    for skin in (rig['skins'] if isinstance(rig.get('skins'), list) else [{'attachments': v} for v in rig.get('skins', {}).values()]):
        for atts in skin.get('attachments', {}).values():
            for a in atts.values():
                if a.get('type') == 'linkedmesh' and 'deform' in a: a['timelines'] = a.pop('deform')
    for anim in rig.get('animations', {}).values():
        for tl in anim.get('bones', {}).values():
            for fr in tl.get('rotate', []):
                if 'angle' in fr: fr['value'] = fr.pop('angle')
            fix_timelines(tl, BONE_CH)
        for sl in anim.get('slots', {}).values():
            if 'color' in sl: sl['rgba'] = sl.pop('color')
            fix_timelines(sl, {'rgba': 'color'})
        for tl in anim.get('ik', {}).values():
            if isinstance(tl, list): fix_frames(tl, [('mix', 1), ('softness', 0)])
        for skin in anim.get('deform', {}).values():
            for sl in skin.values():
                for att in sl.values():
                    for i, fr in enumerate(att):
                        c = fr.get('curve')
                        if isinstance(c, (int, float)) and i + 1 < len(att):
                            t1 = fr.get('time', 0); dt = att[i + 1].get('time', 0) - t1
                            fr['curve'] = [t1 + c * dt, fr.pop('c2', 0), t1 + fr.pop('c3', 1) * dt, fr.pop('c4', 1)]
                        elif isinstance(c, (int, float)): fr.pop('curve')
    return rig

def convert_atlas(text, page=None):
    lines = text.split('\n'); out = []; i = 0
    while i < len(lines) and lines[i].strip() == '': i += 1
    out.append(page or lines[i].strip()); i += 1
    while i < len(lines) and lines[i].strip() and ':' in lines[i]:
        k, v = lines[i].split(':', 1)
        if k.strip() in ('size', 'format', 'filter', 'repeat'): out.append(f'{k.strip()}:{v.strip().replace(", ", ",")}' if k.strip() != 'format' else f'format:{v.strip()}')
        i += 1
    out = [out[0], ''] + out[1:] if False else out
    while i < len(lines):
        name = lines[i].strip()
        if not name: i += 1; continue
        d = {}; i += 1
        while i < len(lines) and lines[i][:1] in (' ', '\t') and ':' in lines[i]:
            k, v = lines[i].strip().split(':', 1); d[k] = v.strip(); i += 1
        x, y = [int(n) for n in d['xy'].split(',')]; w, h = [int(n) for n in d['size'].split(',')]
        out += [name, f'bounds:{x},{y},{w},{h}'] + (['rotate:90'] if d.get('rotate') in ('true', '90') else [])
        if 'orig' in d and d['orig'].replace(' ', '') != f'{w},{h}':
            ow, oh = [int(n) for n in d['orig'].split(',')]; ox, oy = [int(n) for n in d.get('offset', '0,0').split(',')]
            out.append(f'offsets:{ox},{oy},{ow},{oh}')
    return '\n'.join(out) + '\n'

if __name__ == '__main__':
    if len(sys.argv) < 4: sys.exit(__doc__)
    rig_p, atlas_p, out_dir = sys.argv[1:4]; page = sys.argv[4] if len(sys.argv) > 4 else None
    os.makedirs(out_dir, exist_ok=True)
    rig = convert_rig(json.load(open(rig_p)))
    base = os.path.splitext(os.path.basename(rig_p))[0]
    json.dump(rig, open(os.path.join(out_dir, base + '.json'), 'w'), separators=(',', ':'))
    open(os.path.join(out_dir, base + '.atlas'), 'w').write(convert_atlas(open(atlas_p).read(), page))
    print('written', out_dir)
