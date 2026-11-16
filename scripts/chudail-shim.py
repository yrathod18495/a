#!/usr/bin/env python3
"""OFFLINE conversion helper (CLAUDE.md: the app never loads Spine data).
Turns what scripts/wardrobe-extract.cjs read from a running wardrobe page (the rig after the page's own set-up, its final pictures and
draw order) into a small page in the OLDER format that scripts/character-html-to-spine.mjs reads (POSES / IMG / ANIMS_BY).
Pictures are packed into free space on a 4096 page so nothing lies on top of anything else.

  python3 -I scripts/chudail-shim.py <character>-runtime.json <wardrobe.html> <out.html> [extra-animation.json ...]

Extra animations (e.g. from scripts/retarget-walk.py) are put first in the list; one with the same name replaces the page's.
"""
import sys, re, json, io, base64
from PIL import Image

def main():
    if len(sys.argv) < 4: print(__doc__); sys.exit(1)
    runtime, html, out = sys.argv[1:4]
    d = json.load(open(runtime)); P = d['P']; extra = [a for f in sys.argv[4:] for a in (lambda v: v if isinstance(v, list) else [v])(json.load(open(f)))]
    text = open(html, encoding='utf8').read(); body = text[text.index('<script>') + 8:]
    m = re.search(r'(?:^|\n)const ANIMS_BY\s*=\s*', body); anims = json.JSONDecoder().raw_decode(body[m.end():])[0]
    W = H = 4096; page = Image.new('RGBA', (W, H), (0, 0, 0, 0)); occ = []; reg = {}
    free = lambda x, y, w, h: x + w <= W and y + h <= H and all(x + w <= a or a + c <= x or y + h <= b or b + e <= y for a, b, c, e in occ)
    items = []
    for path, url in d['imgs'].items():
        v = list(P['reg'][path]); im = Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGBA')
        if im.size != (v[2], v[3]): im = im.resize((v[2], v[3]), Image.LANCZOS)
        items.append((path, v, im))
    for path, v, im in sorted(items, key=lambda t: -t[1][3]):
        w, h = v[2], v[3]; spot = None
        for y in range(0, H - h + 1, 8):
            for x in range(0, W - w + 1, 8):
                if free(x, y, w + 4, h + 4): spot = (x, y); break
            if spot: break
        if not spot: raise SystemExit(f'no room for {path} ({w}x{h}) on the 4096 page')
        page.alpha_composite(im, spot); occ.append((spot[0], spot[1], w + 4, h + 4)); v[0], v[1] = spot; reg[path] = v
    # draw order as the page draws it (-2 marks the page's second pass over the arm: ignored); a slot that is not drawn keeps no picture
    seen, order = set(), []
    for i in d['order']:
        if i >= 0 and i not in seen: seen.add(i); order.append(i)
    slots = []
    for i in order: slots.append(P['slots'][i])
    for i, sl in enumerate(P['slots']):
        if i not in seen: slots.append([sl[0], sl[1], None] + sl[3:])
    buf = io.BytesIO(); page.save(buf, 'WEBP', quality=92, method=4)
    pose = {'id': 'f34', 'v': 'f34', 'ch': 'maya', 'label': P['label'], 'bones': P['bones'], 'slots': slots, 'att': P['att'], 'reg': reg}
    open(out, 'w', encoding='utf8').write('<script>\nconst POSES=' + json.dumps([pose]) + ';\nconst IMG=' + json.dumps({'f34': base64.b64encode(buf.getvalue()).decode()}) + ';\nconst ANIMS_BY=' + json.dumps({'f34': extra + [a for a in anims['f34'] if a['n'] not in {e['n'] for e in extra}]}) + ';\n</script>\n')
    print(f'{len(reg)} pictures, {len(order)} slots drawn, {len(slots)-len(order)} not drawn, {len(buf.getvalue())/1048576:.1f} MB', file=sys.stderr)
main()
