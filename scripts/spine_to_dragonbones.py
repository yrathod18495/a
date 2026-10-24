#!/usr/bin/env python3
"""
Spine 4.2 data  ->  DragonBones 5.5 data.   (OFFLINE conversion only: the app never loads Spine files.)

  rig   : python3 scripts/spine_to_dragonbones.py rig  --rig R.json --atlas A.atlas --pages P1.webp [P2.webp ...] --out DIR --name NAME [--bend 0]
          -> DIR/NAME_ske.json   armature: bones, slots, all skins, IK (animations are NOT inside unless --embed)
             DIR/NAME_tex_<n>.json + NAME_tex_<n>.webp   un-rotated, re-packed texture pages (<= 4096 x 4096)
  anims : python3 scripts/spine_to_dragonbones.py anims --rig R.json --anims a.json b.json ... --out DIR/anims.json [--fps 60]
          (each file = one Spine animation {bones, slots, ik, deform, drawOrder}, or a rig json holding "animations")
          -> a JSON object {animationName: dbAnimation}. Slot pictures / deform / draw order are stored by NAME
             (displayName / slot name); src/db/anim.js turns them into indices for the armature that plays them.

Coordinate change: Spine is y-up / counter-clockwise, DragonBones is y-down / clockwise, so every y and every angle is negated.
Spine curves are sampled into linear frames (60 fps by default), so every channel keeps its own easing.
"""
import json, math, os, sys, argparse
from PIL import Image

# --------------------------------------------------------------------------------------------- atlas
def parse_atlas(path):
    pages = []; cur = None; reg = None
    for raw in open(path, encoding='utf-8').read().split('\n'):
        l = raw.rstrip()
        if not l.strip():
            cur = None; reg = None; continue
        if not raw[0].isspace() and ':' not in l:
            if cur is None:
                cur = {'file': l.strip(), 'regions': {}, 'size': None}; pages.append(cur); reg = None
            else:
                reg = {}; cur['regions'][l.strip()] = reg
        else:
            k, v = l.strip().split(':', 1); (reg if reg is not None else cur)[k.strip()] = v.strip()
    return pages

def region_image(page_img, d):
    """the picture of an atlas region, un-rotated and NOT padded to its original size, plus (offsetX, offsetY from the bottom, originalW, originalH)"""
    if 'bounds' in d: x, y, w, h = map(int, d['bounds'].split(','))
    else:
        x, y = map(int, d['xy'].split(',')); w, h = map(int, d['size'].split(','))
    rot = d.get('rotate', 'false') in ('true', '90')
    cw, ch = (h, w) if rot else (w, h)
    im = page_img.crop((x, y, x + cw, y + ch))
    if rot: im = im.rotate(-90, expand=True)
    ow, oh, ox, oy = im.width, im.height, 0, 0
    if 'offsets' in d:
        ox, oy, ow, oh = map(int, d['offsets'].split(','))
    elif 'orig' in d:
        ow, oh = map(int, d['orig'].split(',')); ox, oy = map(int, d.get('offset', '0,0').split(','))
    return im, (ox, oy, ow, oh)

# --------------------------------------------------------------------------------------------- helpers
def skins_of(rig):
    s = rig.get('skins', [])
    return {k['name']: k['attachments'] for k in s} if isinstance(s, list) else s

def merged_skins(rig, order=None):
    SK = skins_of(rig)
    order = order or list(SK)          # rig order, later skins win (same as the Spine runtime merged them)
    return SK, order

def r5(v, n=5): return round(v, n)

CANON = {'normal': 'normal', 'onlytranslation': 'onlyTranslation', 'norotationorreflection': 'noRotationOrReflection', 'noscale': 'noScale', 'noscaleorreflection': 'noScaleOrReflection'}
def inherit_of(b): return CANON.get(str(b.get('inherit', 'normal')).lower(), 'normal')      # Spine 4.2 writes noScale, converted 3.8 files NoScale

def world_matrices(rig):
    B = {b['name']: b for b in rig['bones']}; W = {}
    for b in rig['bones']:
        n = b['name']; r = math.radians(b.get('rotation', 0)); sx = b.get('scaleX', 1); sy = b.get('scaleY', 1)
        shx = math.radians(b.get('shearX', 0)); shy = math.radians(b.get('shearY', 0))
        a, bb, c, d = math.cos(r + shx) * sx, math.cos(r + math.pi / 2 + shy) * sy, math.sin(r + shx) * sx, math.sin(r + math.pi / 2 + shy) * sy
        x, y, p = b.get('x', 0), b.get('y', 0), b.get('parent')
        if p is None: W[n] = (a, bb, c, d, x, y); continue
        pa, pb, pc, pd, px, py = W[p]; inh = inherit_of(b)
        wx = pa * x + pb * y + px; wy = pc * x + pd * y + py
        if inh == 'normal': W[n] = (pa * a + pb * c, pa * bb + pb * d, pc * a + pd * c, pc * bb + pd * d, wx, wy)
        elif inh == 'onlyTranslation': W[n] = (a, bb, c, d, wx, wy)
        else:
            cs, sn = math.cos(r), math.sin(r)
            za = pa * cs + pb * sn; zc = pc * cs + pd * sn
            s = math.hypot(za, zc); s = 1 / s if s > 1e-5 else 0; za *= s; zc *= s; s = math.hypot(za, zc)
            rr = math.pi / 2 + math.atan2(zc, za); zb = math.cos(rr) * s; zd = math.sin(rr) * s
            la = math.cos(math.radians(b.get('shearX', 0))) * sx; lb = math.cos(math.radians(90 + b.get('shearY', 0))) * sy
            lc = math.sin(math.radians(b.get('shearX', 0))) * sx; ld = math.sin(math.radians(90 + b.get('shearY', 0))) * sy
            W[n] = (za * la + zb * lc, za * lb + zb * ld, zc * la + zd * lc, zc * lb + zd * ld, wx, wy)
    return W

def resolve_linked(SK, slot, key, skin, att):
    p = att['parent']; psk = att.get('skin', skin); pa = SK[psk][slot][p]
    return resolve_linked(SK, slot, p, psk, pa) if pa.get('type') == 'linkedmesh' else pa

def tex_name(att, key): return att.get('path', att.get('name', key))

# --------------------------------------------------------------------------------------------- rig
def convert_rig(a):
    rig = json.load(open(a.rig)); pages = parse_atlas(a.atlas)
    imgs_by_page = [Image.open(p).convert('RGBA') for p in a.pages]
    reg = {}
    for pg, im in zip(pages, imgs_by_page):
        for n, d in pg['regions'].items(): reg[n] = (pg, d, im)
    SK, order_sk = merged_skins(rig, a.skins)
    used = {}
    for sk in SK:
        for slot, atts in SK[sk].items():
            for k, at in atts.items():
                if at.get('type', 'region') in ('region', 'mesh', 'linkedmesh'): used[tex_name(at, k)] = 1
    names = sorted(n for n in used if n in reg)
    miss = [n for n in used if n not in reg]
    if miss: print('WARNING: textures not in the atlas:', miss[:5], '...' if len(miss) > 5 else '')
    imgs = {}; meta = {}
    for n in names: imgs[n], meta[n] = region_image(reg[n][2], reg[n][1])
    # pack into <=4096 x 4096 pages, tallest first, shelf algorithm
    PAD = 2; LIM = 4096; sheets = []; cur = None
    for n in sorted(names, key=lambda p: -imgs[p].height):
        w, h = imgs[n].size
        placed = False
        if cur is not None:
            if cur['x'] + w + PAD > LIM: cur['x'] = 0; cur['y'] += cur['rowh'] + PAD; cur['rowh'] = 0
            if cur['y'] + h + PAD <= LIM:
                cur['pos'][n] = (cur['x'], cur['y']); cur['x'] += w + PAD; cur['rowh'] = max(cur['rowh'], h); placed = True
        if not placed:
            cur = {'x': 0, 'y': 0, 'rowh': 0, 'pos': {}}; sheets.append(cur)
            cur['pos'][n] = (0, 0); cur['x'] = w + PAD; cur['rowh'] = h
    os.makedirs(a.out, exist_ok=True); texfiles = []
    for i, s in enumerate(sheets):
        H = (s['y'] + s['rowh'] + PAD + 3) // 4 * 4; sheet = Image.new('RGBA', (LIM, H), (0, 0, 0, 0))
        for n, (px, py) in s['pos'].items(): sheet.alpha_composite(imgs[n], (px, py))
        fn = f'{a.name}_tex_{i}.webp'; sheet.save(os.path.join(a.out, fn), quality=95, alpha_quality=100, method=4)     # lossy like the source pictures, alpha stays exact
        tj = {'name': f'{a.name}_{i}', 'imagePath': fn, 'width': LIM, 'height': H,
              'SubTexture': [{'name': n, 'x': px, 'y': py, 'width': imgs[n].width, 'height': imgs[n].height} for n, (px, py) in s['pos'].items()]}
        json.dump(tj, open(os.path.join(a.out, f'{a.name}_tex_{i}.json'), 'w'), separators=(',', ':')); texfiles.append(f'{a.name}_tex_{i}.json')
    print('textures', len(names), 'pages', len(sheets))

    B = {b['name']: b for b in rig['bones']}; order = [b['name'] for b in rig['bones']]; W = world_matrices(rig)
    def dbmat(n):
        A, Bm, C, D, X, Y = W[n]; return [A, -C, -Bm, D, X, -Y]
    bones = []
    for n in order:
        b = B[n]; t = {'x': r5(b.get('x', 0), 4), 'y': r5(-b.get('y', 0), 4)}
        r = b.get('rotation', 0); shx = b.get('shearX', 0); shy = b.get('shearY', 0)
        t['skY'] = r5(-(r + shx)); t['skX'] = r5(-(r + shy))
        if b.get('scaleX', 1) != 1: t['scX'] = b['scaleX']
        if b.get('scaleY', 1) != 1: t['scY'] = b['scaleY']
        o = {'name': n, 'transform': t}
        if b.get('parent'): o['parent'] = b['parent']
        if b.get('length'): o['length'] = b['length']
        inh = inherit_of(b)
        if inh in ('noScale', 'noScaleOrReflection'): o['inheritScale'] = False
        if inh == 'noScaleOrReflection': o['inheritReflection'] = False
        if inh == 'noRotationOrReflection': o['inheritRotation'] = False; o['inheritReflection'] = False
        if inh == 'onlyTranslation': o['inheritRotation'] = False; o['inheritScale'] = False
        bones.append(o)

    BLEND = {'additive': 1, 'multiply': 10, 'screen': 12}
    def parse_color(c):
        if not c: return None
        c = c.lstrip('#'); c = c + 'ff' if len(c) == 6 else c
        return [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4, 6)]
    slots = []; skin_slots = {sk: [] for sk in SK}; slot_displays = {}
    for s in rig['slots']:
        name = s['name']; o = {'name': name, 'parent': s['bone']}
        cur = s.get('attachment'); o['_cur'] = cur
        col = parse_color(s.get('color'))
        if col and col != [1, 1, 1, 1]: o['color'] = {'rM': round(col[0] * 100), 'gM': round(col[1] * 100), 'bM': round(col[2] * 100), 'aM': round(col[3] * 100)}
        if s.get('blend') in BLEND: o['blendMode'] = BLEND[s['blend']]
        slots.append(o)
    for sk in SK:
        for slot_name, atts in SK[sk].items():
            disp = []
            for k, at in atts.items():
                t = at.get('type', 'region'); path = tex_name(at, k)
                if path not in imgs and t in ('region', 'mesh', 'linkedmesh'): continue
                if t == 'region':
                    tw, th = imgs[path].size; ox, oy, ow, oh = meta[path]
                    fx, fy = at['width'] / ow, at['height'] / oh; sX, sY = at.get('scaleX', 1), at.get('scaleY', 1); th_ = math.radians(at.get('rotation', 0))
                    # a trimmed picture sits off-centre inside the quad of its original size: move the picture's centre by that much (in the attachment's own axes)
                    ux = ((ox + tw / 2) - ow / 2) * fx * sX; uy = -((oh - oy - th / 2) - oh / 2) * fy * sY
                    cx = at.get('x', 0) + ux * math.cos(th_) - uy * math.sin(th_); cy = at.get('y', 0) + ux * math.sin(th_) + uy * math.cos(th_)
                    d = {'type': 'image', 'name': k, 'path': path, 'transform': {'x': r5(cx, 4), 'y': r5(-cy, 4), 'skX': r5(-at.get('rotation', 0)), 'skY': r5(-at.get('rotation', 0)),
                         'scX': r5(sX * fx, 6), 'scY': r5(sY * fy, 6)}}
                    # Spine region attachments are centred on their x,y; DragonBones images are centred on the texture too (pivot 0.5)
                elif t in ('mesh', 'linkedmesh'):
                    g = resolve_linked(SK, slot_name, k, sk, at) if t == 'linkedmesh' else at
                    uvs = g['uvs']; tri = g['triangles']; vs = g['vertices']; nv = len(uvs) // 2
                    tw, th = imgs[path].size; ox, oy, ow, oh = meta[path]
                    if (ow, oh) != (tw, th):      # uvs are measured on the original-size picture; the stored picture is the trimmed part of it
                        top = oh - oy - th; uvs = [((u * ow - ox) / tw) if i % 2 == 0 else ((u * oh - top) / th) for i, u in enumerate(uvs)]
                    d = {'type': 'mesh', 'name': k, 'path': path, 'width': tw, 'height': th, 'uvs': [r5(u) for u in uvs], 'triangles': tri}
                    if len(vs) == nv * 2: d['vertices'] = [round(v, 3) if i % 2 == 0 else round(-v, 3) for i, v in enumerate(vs)]
                    else:
                        verts = []; weights = []; ub = []; i = 0
                        for v in range(nv):
                            cnt = int(vs[i]); i += 1; wx = wy = 0; weights.append(cnt)
                            for j in range(cnt):
                                bi = int(vs[i]); bx, by, w = vs[i + 1], vs[i + 2], vs[i + 3]; i += 4
                                A_, B_, C_, D_, X_, Y_ = W[order[bi]]; wx += w * (A_ * bx + B_ * by + X_); wy += w * (C_ * bx + D_ * by + Y_)
                                weights += [bi, r5(w)]
                                if bi not in ub: ub.append(bi)
                            verts += [round(wx, 3), round(-wy, 3)]
                        d['vertices'] = verts; d['weights'] = weights; d['slotPose'] = [1, 0, 0, 1, 0, 0]
                        bp = []
                        for bi in ub: bp += [bi] + [round(x, 6) for x in dbmat(order[bi])]
                        d['bonePose'] = bp
                    if 'edges' in g: d['edges'] = g['edges']
                    if t == 'linkedmesh' and at.get('timelines') is False: d['_shareDeform'] = at['parent']
                else: continue
                disp.append(d)
                slot_displays.setdefault(slot_name, set()).add(k)
            if disp: skin_slots[sk].append({'name': slot_name, 'display': disp})
    for o in slots:
        cur = o.pop('_cur'); o['displayIndex'] = 0 if cur else -1; o['_defaultAtt'] = cur
    ik = []
    for c in rig.get('ik', []):
        ik.append({'name': c['name'], 'bone': c['bones'][-1], 'target': c['target'], 'chain': len(c['bones']) - 1, 'weight': c.get('mix', 1), 'bendPositive': bool(a.bend) if c.get('bendPositive', True) else (not bool(a.bend))})
    src_skins = {k['name']: k for k in rig['skins']} if isinstance(rig.get('skins'), list) else {}
    # constraints a skin switches on (Spine "skin required" constraints) are kept as data for our own physics (src/db/motion.js)
    skins = [dict({'name': sk, 'slot': skin_slots[sk]}, **{'_' + k: src_skins[sk][k] for k in ('physics', 'transform', 'ik', 'bones') if sk in src_skins and k in src_skins[sk]}) for sk in order_sk if sk in skin_slots]
    # the attachment shown at setup: stored by name so the loader can pick the index in the merged skin
    arm = {'type': 'Armature', 'frameRate': a.fps, 'name': a.name, 'aabb': {'x': -250, 'y': -1000, 'width': 500, 'height': 1100},
           'bone': bones, 'slot': slots, 'ik': ik, 'skin': skins, 'animation': [],
           # not part of DragonBones: Spine physics / transform constraints, kept as data for src/db/motion.js (our own physics)
           '_physics': rig.get('physics', []), '_transform': rig.get('transform', [])}
    if a.embed:
        arm['animation'] = convert_animations(rig, [(k, v) for k, v in rig.get('animations', {}).items()], a.fps)
    out = {'frameRate': a.fps, 'name': a.name, 'version': '5.5', 'compatibleVersion': '5.5', 'armature': [arm], '_tex': texfiles}
    json.dump(out, open(os.path.join(a.out, f'{a.name}_ske.json'), 'w'), separators=(',', ':'))
    print('bones', len(bones), 'slots', len(slots), 'skins', len(skins), 'ik', len(ik))

# --------------------------------------------------------------------------------------------- animations
def bez(c, i, t0, v0, t1, v1, t):
    """Spine 4.x bezier curve for channel i of a key: c = [cx1, cy1, cx2, cy2, ...] absolute (time, value) control points"""
    cx1, cy1, cx2, cy2 = c[i * 4:i * 4 + 4]
    lo, hi = 0.0, 1.0
    def X(s): return 3 * (1 - s) ** 2 * s * cx1 + 3 * (1 - s) * s * s * cx2 + s ** 3 * t1 + (1 - s) ** 3 * t0
    for _ in range(40):
        m = (lo + hi) / 2
        if X(m) < t: lo = m
        else: hi = m
    s = (lo + hi) / 2
    return (1 - s) ** 3 * v0 + 3 * (1 - s) ** 2 * s * cy1 + 3 * (1 - s) * s * s * cy2 + s ** 3 * v1

def sample(keys, chans, t, default):
    """value of every channel at time t. keys sorted by time; each key has 'time', channel values, optional 'curve'"""
    if not keys: return default
    if t <= keys[0].get('time', 0): return [keys[0].get(c, d) for c, d in zip(chans, default)]
    if t >= keys[-1].get('time', 0): return [keys[-1].get(c, d) for c, d in zip(chans, default)]
    for i in range(len(keys) - 1):
        k0, k1 = keys[i], keys[i + 1]; t0, t1 = k0.get('time', 0), k1.get('time', 0)
        if t0 <= t < t1:
            cur = k0.get('curve'); out = []
            for ci, (c, d) in enumerate(zip(chans, default)):
                v0, v1 = k0.get(c, d), k1.get(c, d)
                if cur == 'stepped': out.append(v0)
                elif isinstance(cur, list) and len(cur) >= (ci + 1) * 4: out.append(bez(cur, ci, t0, v0, t1, v1, t))
                else: out.append(v0 + (v1 - v0) * (t - t0) / (t1 - t0 if t1 > t0 else 1))
            return out
    return [keys[-1].get(c, d) for c, d in zip(chans, default)]

def key_times(keys, fps, step_deg=None, chans=None):
    """frame numbers where the DragonBones timeline needs a key: every Spine key, plus sub-keys on curved / large-angle segments"""
    fr = set(); ks = sorted(keys, key=lambda k: k.get('time', 0))
    for i, k in enumerate(ks):
        f0 = round(k.get('time', 0) * fps); fr.add(f0)
        if i + 1 < len(ks):
            f1 = round(ks[i + 1].get('time', 0) * fps); cur = k.get('curve'); n = 0
            if isinstance(cur, list): n = f1 - f0 - 1
            elif step_deg and chans:
                big = max(abs(ks[i + 1].get(c, 0) - k.get(c, 0)) for c in chans)
                if big > step_deg: n = int(big // step_deg)
            if cur != 'stepped':
                if isinstance(cur, list): fr.update(range(f0 + 1, f1))
                elif n > 0:
                    for j in range(1, n + 1): fr.add(f0 + round((f1 - f0) * j / (n + 1)))
    return sorted(fr)

def build_frames(keys, chans, default, fps, make, step_deg=None, stepped_ok=True):
    ks = sorted(keys, key=lambda k: k.get('time', 0))
    frs = key_times(ks, fps, step_deg, chans if step_deg else None); out = []
    for i, f in enumerate(frs):
        v = sample(ks, chans, f / fps, default); fr = make(v)
        # stepped segment: hold (no tween); everything else linear between the sampled keys
        src = None
        for k in ks:
            if round(k.get('time', 0) * fps) <= f: src = k
        step = src is not None and src.get('curve') == 'stepped' and round(src.get('time', 0) * fps) == f
        if not step: fr['tweenEasing'] = 0
        out.append((f, fr))
    res = []
    for i, (f, fr) in enumerate(out):
        fr['duration'] = (out[i + 1][0] - f) if i + 1 < len(out) else 0; res.append(fr)
    if out and out[0][0] > 0: res.insert(0, dict(make(default), duration=out[0][0], tweenEasing=0))
    return res

def linked_children(rig):
    out = {}
    for sk, slots in skins_of(rig).items():
        for sn, atts in slots.items():
            for k, at in atts.items():
                if at.get('type') == 'linkedmesh' and at.get('timelines') is False:
                    out.setdefault((sn, at['parent']), set()).add(k)
    return out

def convert_animation(rig, name, d, fps, any_rig=False):
    if any_rig:
        B = set(d.get('bones', {})); S = set(d.get('slots', {})) | {sn for bys in (d.get('deform') or {}).values() for sn in bys}; slot_names = sorted(S)
    else:
        B = {b['name'] for b in rig['bones']}; slot_names = [s['name'] for s in rig['slots']]; S = set(slot_names)
    kids = linked_children(rig) if not any_rig else {}
    last = 0.0
    def upd(keys):
        nonlocal last
        for k in keys: last = max(last, k.get('time', 0))
    bl = []
    for bn, bd in d.get('bones', {}).items():
        if bn not in B: continue
        e = {'name': bn}
        for tl in bd.values(): upd(tl)
        if 'rotate' in bd or 'angle' in bd:
            ks = bd.get('rotate') or bd.get('angle')
            ks = [dict(k, value=k.get('value', k.get('angle', 0))) for k in ks]
            e['rotateFrame'] = build_frames(ks, ['value'], [0], fps, lambda v: {'rotate': r5(-v[0], 4)}, step_deg=90)
        tr = None
        if 'translate' in bd: tr = bd['translate']; tch = ['x', 'y']
        if 'translatex' in bd or 'translatey' in bd:
            tx = bd.get('translatex', []); ty = bd.get('translatey', [])
            times = sorted({k.get('time', 0) for k in tx + ty}); xs = sorted(tx, key=lambda k: k.get('time', 0)); ys = sorted(ty, key=lambda k: k.get('time', 0))
            tr = []
            for t in times:
                tr.append({'time': t, 'x': sample(xs, ['value'], t, [0])[0], 'y': sample(ys, ['value'], t, [0])[0]})
            tch = ['x', 'y']
        if tr: e['translateFrame'] = build_frames(tr, ['x', 'y'], [0, 0], fps, lambda v: {'x': r5(v[0], 3), 'y': r5(-v[1], 3)})
        sc = None
        if 'scale' in bd: sc = bd['scale']
        elif 'scalex' in bd or 'scaley' in bd:
            sx = sorted(bd.get('scalex', []), key=lambda k: k.get('time', 0)); sy = sorted(bd.get('scaley', []), key=lambda k: k.get('time', 0))
            times = sorted({k.get('time', 0) for k in sx + sy})
            sc = [{'time': t, 'x': sample(sx, ['value'], t, [1])[0], 'y': sample(sy, ['value'], t, [1])[0]} for t in times]
        if sc: e['scaleFrame'] = build_frames(sc, ['x', 'y'], [1, 1], fps, lambda v: {'x': r5(v[0], 4), 'y': r5(v[1], 4)})
        if len(e) > 1: bl.append(e)
    sl = []
    for sn, sd in d.get('slots', {}).items():
        if sn not in S: continue
        e = {'name': sn}
        for tl in sd.values(): upd(tl)
        if 'attachment' in sd:
            ks = sorted(sd['attachment'], key=lambda k: k.get('time', 0)); fr = []
            for k in ks:
                f = round(k.get('time', 0) * fps)
                if fr and f <= fr[-1][0]: continue
                fr.append((f, {'displayName': k.get('name') or ''}))
            res = []
            for i, (f, x) in enumerate(fr): x['duration'] = (fr[i + 1][0] - f) if i + 1 < len(fr) else 0; res.append(x)
            if fr and fr[0][0] > 0: res.insert(0, {'displayName': None, 'duration': fr[0][0], '_setup': True})
            e['displayFrame'] = res
        ck = sd.get('rgba') or sd.get('color')
        if ck:
            def hexv(k):
                c = k.get('color', 'ffffffff'); c = c + 'ff' if len(c) == 6 else c
                return [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4, 6)]
            ck = [dict(k, r=hexv(k)[0], g=hexv(k)[1], b=hexv(k)[2], a=hexv(k)[3]) for k in ck]
            e['colorFrame'] = build_frames(ck, ['r', 'g', 'b', 'a'], [1, 1, 1, 1], fps, lambda v: {'value': {'rM': round(v[0] * 100, 2), 'gM': round(v[1] * 100, 2), 'bM': round(v[2] * 100, 2), 'aM': round(v[3] * 100, 2)}})
        elif 'alpha' in sd:
            ak = [dict(k, a=k.get('value', 1)) for k in sd['alpha']]
            e['colorFrame'] = build_frames(ak, ['a'], [1], fps, lambda v: {'value': {'aM': round(v[0] * 100, 2)}})
        if len(e) > 1: sl.append(e)
    ffd = []
    for sk, bys in (d.get('deform') or {}).items():
        for sn, byatt in bys.items():
            if sn not in S: continue
            for att, keys in byatt.items():
                for k in keys: last = max(last, k.get('time', 0))
                ks = sorted(keys, key=lambda k: k.get('time', 0))
                n = max((k.get('offset', 0) + len(k.get('vertices', []))) for k in ks)
                def full(k):
                    v = [0.0] * n; o = k.get('offset', 0)
                    for i, x in enumerate(k.get('vertices', [])): v[o + i] = x
                    return v
                arrs = [(k.get('time', 0), full(k), k.get('curve')) for k in ks]
                frs = key_times(ks, fps); out = []
                for f in frs:
                    t = f / fps; v = None
                    if t <= arrs[0][0]: v = arrs[0][1]
                    elif t >= arrs[-1][0]: v = arrs[-1][1]
                    else:
                        for i in range(len(arrs) - 1):
                            t0, a0, c0 = arrs[i]; t1, a1, _ = arrs[i + 1]
                            if t0 <= t < t1:
                                if c0 == 'stepped': u = 0
                                elif isinstance(c0, list): u = (bez(c0, 0, t0, 0, t1, 1, t))
                                else: u = (t - t0) / (t1 - t0 if t1 > t0 else 1)
                                v = [x0 + (x1 - x0) * u for x0, x1 in zip(a0, a1)]; break
                    fr = {'offset': 0, 'vertices': [round(x if i % 2 == 0 else -x, 3) for i, x in enumerate(v)], 'tweenEasing': 0}
                    out.append((f, fr))
                res = []
                for i, (f, fr) in enumerate(out): fr['duration'] = (out[i + 1][0] - f) if i + 1 < len(out) else 0; res.append(fr)
                if out and out[0][0] > 0: res.insert(0, {'offset': 0, 'vertices': [0.0] * n, 'duration': out[0][0], 'tweenEasing': 0})
                ffd.append({'name': att, 'slot': sn, 'skin': sk, 'frame': res})
                for child in sorted(kids.get((sn, att), ())): ffd.append({'name': child, 'slot': sn, 'skin': sk, 'frame': res})
    z = None
    if d.get('drawOrder') or d.get('draworder'):
        ks = sorted(d.get('drawOrder') or d.get('draworder'), key=lambda k: k.get('time', 0)); upd(ks); fr = []
        for k in ks:
            f = round(k.get('time', 0) * fps)
            if fr and f <= fr[-1][0]: continue
            fr.append((f, {'zOrderByName': [[o['slot'], o.get('offset', 0)] for o in k.get('offsets', [])]}))
        res = []
        for i, (f, x) in enumerate(fr): x['duration'] = (fr[i + 1][0] - f) if i + 1 < len(fr) else 0; res.append(x)
        if fr and fr[0][0] > 0: res.insert(0, {'zOrderByName': [], 'duration': fr[0][0]})
        z = {'frame': res}
    length = d.get('_length', last)
    o = {'name': name, 'duration': max(1, round(length * fps)), 'playTimes': 0, 'bone': bl, 'slot': sl}
    if ffd: o['ffd'] = ffd
    if z: o['zOrder'] = z
    return o

def convert_animations(rig, items, fps, any_rig=False):
    return [convert_animation(rig, n, d, fps, any_rig) for n, d in items]

def convert_anims_cmd(a):
    any_rig = a.rig == 'any'; rig = {'bones': [], 'slots': [], 'skins': []} if any_rig else json.load(open(a.rig)); items = []
    for f in a.anims:
        d = json.load(open(f))
        if 'animations' in d:
            items += list(d['animations'].items())
        else:
            items.append((os.path.splitext(os.path.basename(f))[0], d))
    out = {n: x for n, x in zip([n for n, _ in items], convert_animations(rig, items, a.fps, any_rig))}
    if a.split:
        os.makedirs(a.split, exist_ok=True)
        for n, x in out.items(): json.dump({n: x}, open(os.path.join(a.split, n + '.json'), 'w'), separators=(',', ':'))
    json.dump(out, open(a.out, 'w'), separators=(',', ':'))
    print(len(out), 'animations ->', a.out)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('rig'); r.add_argument('--rig', required=True); r.add_argument('--atlas', required=True); r.add_argument('--pages', nargs='+', required=True)
    r.add_argument('--out', required=True); r.add_argument('--name', required=True); r.add_argument('--fps', type=int, default=60)
    r.add_argument('--skins', nargs='*', default=None); r.add_argument('--bend', type=int, default=0); r.add_argument('--embed', action='store_true')
    n = sub.add_parser('anims'); n.add_argument('--rig', required=True); n.add_argument('--anims', nargs='+', required=True); n.add_argument('--out', required=True); n.add_argument('--fps', type=int, default=60); n.add_argument('--split', default=None, help='also write one file per animation into this folder')
    a = ap.parse_args()
    convert_rig(a) if a.cmd == 'rig' else convert_anims_cmd(a)
