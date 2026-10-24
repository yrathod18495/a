#!/usr/bin/env python3
"""Turns the downloaded Autodraft files (see README: sync steps) into the app's static data under public/autodraft/.
usage: python3 scripts/import-autodraft.py <download-dir> [catalog.json]
 <download-dir> holds  <char>__<pose>__json|atlas|webp|png  (characters), anims/<TRACK>__<id>.json?, thumbs/<TRACK>__<id>.gif, thumbnails
"""
import json, os, re, sys, shutil
from PIL import Image

def dump(obj, path):
    """compact JSON; big coordinates keep 2 decimals, values below 2 (uvs, weights, curves) keep 5 — rounding those tears the meshes"""
    txt = json.dumps(obj, separators=(',', ':'))
    def short(m):
        v = float(m.group(1)); r = round(v, 5 if abs(v) < 2 else 2)
        return repr(int(r)) if r == int(r) else repr(r)
    open(path, 'w').write(re.sub(r'(?<![\w.])(-?\d+\.\d{3,})', short, txt))

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ad'
CAT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/rs/rig-studio/docs/x/api/structure_530155_front-side_animation_catalog.json'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'autodraft')
POSES = [('front-side', '3/4 Front'), ('front', 'Front'), ('back', 'Back'), ('back-2', 'Back 2'), ('side', 'Side')]
CHARS = [('neha', 'Neha', 'webp', 'neha_thumb.webp'), ('mybaby', 'My Baby', 'png', 'mybaby_thumb')]
TRACKS = {'PRIMARY': 'Body', 'HAND': 'Hands', 'LEGS': 'Legs', 'EXPRESSION': 'Face'}
os.makedirs(f'{OUT}/chars', exist_ok=True)

def sniff(path):
    b = open(path, 'rb').read(12)
    return 'webp' if b[8:12] == b'WEBP' else 'png' if b[:4] == b'\x89PNG' else 'jpg'

def duration(anim):
    t = 0
    for sec in ('bones', 'slots'):
        for tl in (anim.get(sec) or {}).values():
            for keys in tl.values():
                if isinstance(keys, list):
                    for k in keys:
                        if isinstance(k, dict): t = max(t, k.get('time', 0))
    return round(t, 3)

def pretty(title):
    s = re.sub(r'_(Hand|Leg|Legs)_Part$|_Expression$|_Face_Expression$', '', title)
    return s.replace('_', ' ').strip()

poses_meta, anim_cat = {}, {}
neha_rigs = {}
# ---- characters ----
chars = []
for cid, cname, imgext, thumbname in CHARS:
    entry = {'id': cid, 'name': cname, 'poses': []}
    for pose, label in POSES:
        base = f'{SRC}/files/{cid}__{pose}__'
        if not os.path.exists(base + 'json'): continue
        rig = json.load(open(base + 'json'))
        if cid == 'neha': neha_rigs[pose] = rig.get('animations', {})
        rig['animations'] = {}
        d = f'{OUT}/chars/{cid}'; os.makedirs(d, exist_ok=True)
        dump(rig, f'{d}/{pose}.json')
        shutil.copy(base + 'atlas', f'{d}/{pose}.atlas')
        img = base + ('webp' if os.path.exists(base + 'webp') else 'png')
        ext = sniff(img); shutil.copy(img, f'{d}/{pose}.{ext}')
        page = open(base + 'atlas').read().split('\n')[0].strip()
        entry['poses'].append({'pose': pose, 'label': label, 'rig': f'autodraft/chars/{cid}/{pose}.json', 'atlas': f'autodraft/chars/{cid}/{pose}.atlas', 'image': f'autodraft/chars/{cid}/{pose}.{ext}', 'page': page, 'bones': len(rig['bones']), 'skins': [s['name'] for s in rig['skins']] if isinstance(rig['skins'], list) else list(rig['skins'])})
    t = f'{SRC}/files/{cid}__thumb'
    if os.path.exists(t):
        im = Image.open(t).convert('RGBA'); im.thumbnail((256, 256)); im.save(f'{OUT}/chars/{cid}/thumb.webp', quality=80)
        entry['thumb'] = f'autodraft/chars/{cid}/thumb.webp'
    chars.append(entry)
print('characters', [(c['id'], len(c['poses'])) for c in chars])

# ---- animation library ----
# NOTE: the animation library of the Autodraft characters is no longer imported: it was replaced by animations built with
# scripts/convert-stpro-anims.py (own names, own tracks). Running this part again would overwrite them, so it is skipped.
if '--with-old-animations' not in sys.argv:
    print('skipping the animation library (use scripts/convert-stpro-anims.py)')
    sys.exit(0)
cat = json.load(open(CAT))['data']['animations']
emb = neha_rigs['front-side']
os.makedirs(f'{OUT}/anims/front-side', exist_ok=True); os.makedirs(f'{OUT}/thumbs', exist_ok=True)
tracks = {t: [] for t in TRACKS}
n_thumb = 0
for t, items in cat.items():
    for a in items:
        if a['title'] not in emb: continue
        aid = a['id']; anim = emb[a['title']]
        dump(anim, f'{OUT}/anims/front-side/{aid}.json')
        e = {'id': aid, 'name': pretty(a['title']), 'file': f'autodraft/anims/front-side/{aid}.json', 'length': duration(anim)}
        g = f'{SRC}/thumbs/{t}__{aid}.gif'
        if os.path.exists(g) and open(g, 'rb').read(3) == b'GIF':
            im = Image.open(g); frames, durs = [], []
            for i in range(0, im.n_frames, 2):
                im.seek(i); fr = im.convert('RGBA'); w, h = fr.size; k = 96 / max(w, h) if max(w, h) > 96 else 1
                frames.append(fr.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)); durs.append(max(20, (im.info.get('duration', 40) or 40) * 2))
            frames[0].save(f'{OUT}/thumbs/{aid}.webp', save_all=True, append_images=frames[1:], duration=durs, loop=0, quality=50, method=5)
            e['poster'] = f'autodraft/thumbs/{aid}.webp'; n_thumb += 1
        tracks[t].append(e)
anim_cat['front-side'] = tracks
print('front-side animations', {t: len(v) for t, v in tracks.items()}, 'thumbs', n_thumb)

nid = 900000
for pose, label in POSES[1:]:
    an = neha_rigs.get(pose, {})
    os.makedirs(f'{OUT}/anims/{pose}', exist_ok=True)
    tr = {t: [] for t in TRACKS}
    for name, anim in sorted(an.items()):
        t = 'HAND' if re.search(r'_Hand_Part$', name) else 'LEGS' if re.search(r'_Legs?_Part$', name) else 'EXPRESSION' if re.search(r'Expression$', name) else 'PRIMARY'
        nid += 1
        dump(anim, f'{OUT}/anims/{pose}/{nid}.json')
        tr[t].append({'id': nid, 'name': pretty(name), 'file': f'autodraft/anims/{pose}/{nid}.json', 'length': duration(anim)})
    anim_cat[pose] = tr
    print(pose, {t: len(v) for t, v in tr.items()})

json.dump({'tracks': TRACKS, 'characters': chars}, open(f'{OUT}/characters.json', 'w'), indent=1)
json.dump({'tracks': TRACKS, 'poses': anim_cat}, open(f'{OUT}/animations.json', 'w'), separators=(',', ':'))
# part groups (Head / Eyes / Lips ... ) of the Neha template, for the Character Studio
for src, name in [('/tmp/rs/rig-studio/docs/x/api/character_977283_NehaSVG.json', 'groups.json')]:
    g = json.load(open(src))['data']['metadata']['attachment_groups']
    json.dump(g, open(f'{OUT}/{name}', 'w'), indent=1)
