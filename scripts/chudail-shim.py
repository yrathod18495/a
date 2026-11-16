#!/usr/bin/env python3
"""OFFLINE conversion helper (CLAUDE.md: the app never loads Spine data).
Like wardrobe-shim.py, but for the named characters of a wardrobe page (CHUDEL_PACK.rigs: Dayan, the Ranis ...).
Only the pictures the rig really uses (its `att` list) are put into the atlas. Pieces that the page did not place on its sheet
(position 0,0: hair, horns, whole arms, pendant, face parts) are packed into free space so nothing lies on top of anything else.

  python3 -I scripts/chudail-shim.py <wardrobe.html> <character id, e.g. dayan> <out.html>
"""
import sys, re, json, io, base64
from PIL import Image

def main():
    if len(sys.argv) < 4: print(__doc__); sys.exit(1)
    path, cid, out = sys.argv[1:4]
    text = open(path, encoding='utf8').read(); body = text[text.index('<script>') + 8:]
    dec = json.JSONDecoder()
    def const(name):
        m = re.search(r'(?:^|\n)(?:const )?' + name + r'\s*=\s*', body)
        return dec.raw_decode(body[m.end():])[0]
    pack = const('CHUDEL_PACK'); assets = const('ASSETS'); anims = const('ANIMS_BY')
    r = pack['rigs'][cid]
    used = {a['p'] for atts in r['att'].values() for a in atts.values()}
    missing = [p for p in used if p not in r['srcs']]
    if missing: print('WARNING: used pictures without data:', missing, file=sys.stderr)
    W = H = 4096; page = Image.new('RGBA', (W, H), (0, 0, 0, 0)); occ = []   # occupied rectangles
    reg = {}; todo = []
    def load(name):
        im = Image.open(io.BytesIO(base64.b64decode(assets[r['srcs'][name]].split(',', 1)[1]))).convert('RGBA'); w, h = r['reg'][name][2:4]
        return im if im.size == (w, h) else im.resize((w, h), Image.LANCZOS)
    for name in sorted(used & set(r['srcs'])):
        v = list(r['reg'][name])
        if v[0] == 0 and v[1] == 0: todo.append(name); continue
        im = load(name); page.alpha_composite(im, (v[0], v[1])); occ.append((v[0], v[1], v[2], v[3])); reg[name] = v
    free = lambda x, y, w, h: x + w <= W and y + h <= H and all(x + w <= a or a + c <= x or y + h <= b or b + d <= y for a, b, c, d in occ)
    for name in sorted(todo, key=lambda n: -r['reg'][n][3]):
        v = list(r['reg'][name]); w, h = v[2], v[3]; spot = None
        for y in range(0, H - h + 1, 16):
            for x in range(0, W - w + 1, 16):
                if free(x + 0, y + 0, w + 4, h + 4): spot = (x, y); break
            if spot: break
        if not spot: raise SystemExit(f'no room for {name} ({w}x{h}) on the 4096 page')
        im = load(name); page.alpha_composite(im, spot); occ.append((spot[0], spot[1], w + 4, h + 4)); v[0], v[1] = spot; reg[name] = v
    buf = io.BytesIO(); page.save(buf, 'WEBP', quality=92, method=4)
    P = {'id': 'f34', 'v': 'f34', 'ch': 'maya', 'label': r['label'], 'bones': r['bones'], 'slots': r['slots'], 'att': r['att'], 'reg': reg}
    open(out, 'w', encoding='utf8').write('<script>\nconst POSES=' + json.dumps([P]) + ';\nconst IMG=' + json.dumps({'f34': base64.b64encode(buf.getvalue()).decode()}) + ';\nconst ANIMS_BY=' + json.dumps({'f34': anims['f34']}) + ';\n</script>\n')
    print(f'{cid}: {len(reg)} pictures ({len(todo)} repacked), page {W}x{H}, {len(buf.getvalue())/1048576:.1f} MB', file=sys.stderr)
main()
