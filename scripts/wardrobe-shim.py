#!/usr/bin/env python3
"""OFFLINE conversion helper (CLAUDE.md: the app never loads Spine data).
Reads a "wardrobe" character page (SPECS / ASSETS / ANIMS_BY constants) and writes a small page in the OLDER format that
scripts/character-html-to-spine.mjs reads (POSES / IMG / ANIMS_BY), for ONE outfit: every view of that outfit, with its pictures
composed into one atlas page per view.

  python3 -I scripts/wardrobe-shim.py <wardrobe.html> <outfit> <out.html> [--list]
"""
import sys, re, json, io, base64
from PIL import Image

def main():
    if len(sys.argv) < 4:
        print(__doc__); sys.exit(1)
    path, outfit, out = sys.argv[1:4]
    text = open(path, encoding='utf8').read()
    body = text[text.index('<script>') + 8:]
    dec = json.JSONDecoder()
    def const(name):
        m = re.search(r'(?:^|\n)const ' + name + r'\s*=\s*', body)
        return dec.raw_decode(body[m.end():])[0]
    specs, assets, anims, atlases = const('SPECS'), const('ASSETS'), const('ANIMS_BY'), const('ORIGINAL_ATLASES')
    if '--list' in sys.argv:
        for v, o in specs.items(): print(v, list(o)); return
    poses, imgs, by = [], {}, {}
    for view, outfits in specs.items():
        if outfit not in outfits: continue
        sp = outfits[outfit]
        key = f'{view}/{outfit}'
        size = atlases[key] if key in atlases else None
        w = h = 4096
        if size:
            m = re.search(r'size:\s*(\d+),\s*(\d+)', size)
            if m: w, h = int(m.group(1)), int(m.group(2))
        page = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        missing = 0
        for name, reg in sp['reg'].items():
            aid = sp['srcs'].get(name)
            if not aid or aid not in assets: missing += 1; continue
            im = Image.open(io.BytesIO(base64.b64decode(assets[aid].split(',', 1)[1]))).convert('RGBA')
            x, y, rw, rh = reg[0], reg[1], reg[2], reg[3]
            if im.size != (rw, rh): im = im.resize((rw, rh), Image.LANCZOS)
            page.alpha_composite(im, (x, y))
        buf = io.BytesIO(); page.save(buf, 'WEBP', quality=92, method=4)
        imgs[view] = base64.b64encode(buf.getvalue()).decode()
        poses.append({'id': view, 'v': view, 'ch': 'maya', 'label': sp['label'], 'bones': sp['bones'], 'slots': sp['slots'], 'att': sp['att'], 'reg': sp['reg']})
        by[view] = anims[view]
        print(f'{view}: page {w}x{h}, {len(sp["reg"])} pictures ({missing} missing), {len(buf.getvalue())/1048576:.1f} MB', file=sys.stderr)
    open(out, 'w', encoding='utf8').write('<script>\nconst POSES=' + json.dumps(poses) + ';\nconst IMG=' + json.dumps(imgs) + ';\nconst ANIMS_BY=' + json.dumps(by) + ';\n</script>\n')

main()
