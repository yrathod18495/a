#!/usr/bin/env python3
"""
Builds ALL DragonBones data of 12toons from the Spine sources in sources/spine/  (Spine is only ever an input of this script).

  python3 scripts/build-db-data.py            # everything
  python3 scripts/build-db-data.py chars      # only rigs      (autodraft + STPro characters)
  python3 scripts/build-db-data.py anims      # only animations (STPro, Autodraft per pose, rigs with their own animations)

Writes (all DragonBones):
  public/autodraft/chars/<char>/<pose>_ske.json, <pose>_tex_<n>.json/.webp, thumb.webp      (+ anims.json and anims/<name>.json for rigs with own animations)
  public/autodraft/anims/<pose>/<id>.json                                                      (name based animation files)
  public/animations/<id>.json
  public/characters/<name>/<name>_ske.json, <name>_tex_<n>.json/.webp
  public/autodraft/characters.json, public/catalog/characters.json                             (rewritten: ske / tex instead of rig / atlas / image)
"""
import json, os, sys, shutil, zipfile, glob, importlib.util, argparse, math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'sources' / 'spine'
PUB = ROOT / 'public'
spec = importlib.util.spec_from_file_location('s2d', ROOT / 'scripts' / 'spine_to_dragonbones.py'); s2d = importlib.util.module_from_spec(spec); spec.loader.exec_module(s2d)
FPS = 60

def ns(**k): return argparse.Namespace(**k)

def rig_to_db(rig, atlas, pages, out, name, embed=False):
    s2d.convert_rig(ns(rig=str(rig), atlas=str(atlas), pages=[str(p) for p in pages], out=str(out), name=name, fps=FPS, skins=None, bend=0, embed=embed))
    ske = json.load(open(Path(out) / f'{name}_ske.json'))
    return ske['_tex']

def anim_length(a):
    m = 0.0
    def walk(v):
        nonlocal m
        if isinstance(v, list):
            for f in v:
                if isinstance(f, dict) and isinstance(f.get('time'), (int, float)): m = max(m, f['time'])
        elif isinstance(v, dict):
            for x in v.values(): walk(x)
    walk(a); return round(m, 2)

def convert_files(files, rig_path, out_dir, fps=FPS):
    """one DragonBones animation file per Spine animation file ({name: animation})"""
    any_rig = rig_path is None
    rig = {'bones': [], 'slots': [], 'skins': []} if any_rig else json.load(open(rig_path))
    os.makedirs(out_dir, exist_ok=True); n = 0
    for f in files:
        d = json.load(open(f)); name = Path(f).stem
        out = s2d.convert_animation(rig, name, d, fps, any_rig)
        json.dump({name: out}, open(Path(out_dir) / f'{name}.json', 'w'), separators=(',', ':')); n += 1
    return n

def build_chars():
    data = json.load(open(SRC / 'autodraft' / 'characters.json'))
    only = set(os.environ.get('ONLY', '').split(',')) - {''}
    for c in data['characters']:
        if only and c['id'] not in only: continue
        outdir = PUB / 'autodraft' / 'chars' / c['id']; outdir.mkdir(parents=True, exist_ok=True)
        thumb = SRC / 'autodraft' / 'chars' / c['id'] / 'thumb.webp'
        if thumb.exists(): shutil.copy(thumb, outdir / 'thumb.webp')
        for p in c['poses']:
            base = SRC / 'autodraft' / 'chars' / c['id'] / p['pose']
            pages = [SRC / 'autodraft' / 'chars' / c['id'] / Path(v).name for v in (p['images'].values() if p.get('images') else [p['image']])]
            print('==', c['id'], p['pose'])
            tex = rig_to_db(str(base) + '.json', str(base) + '.atlas', pages, outdir, p['pose'])
            p['ske'] = f"autodraft/chars/{c['id']}/{p['pose']}_ske.json"; p['tex'] = [f"autodraft/chars/{c['id']}/{t}" for t in tex]
            for k in ('rig', 'atlas', 'image', 'images', 'page'): p.pop(k, None)
            if p.get('own'):
                rig = json.load(open(str(base) + '.json')); items = list(rig.get('animations', {}).items())
                adir = outdir / 'anims'; adir.mkdir(exist_ok=True); index = []
                for n_, a in items:
                    out = s2d.convert_animation(rig, n_, a, FPS)
                    safe = n_.replace('/', '_')
                    json.dump({n_: out}, open(adir / f'{safe}.json', 'w'), separators=(',', ':')); index.append({'name': n_, 'file': safe, 'length': anim_length(a)})
                json.dump(index, open(outdir / 'anims.json', 'w'), separators=(',', ':'))
                p['animIndex'] = f"autodraft/chars/{c['id']}/anims.json"; p['animDir'] = f"autodraft/chars/{c['id']}/anims/"
                print('   own animations', len(index))
    if not only: json.dump(data, open(PUB / 'autodraft' / 'characters.json', 'w'), indent=1)
    if os.environ.get('SKIP_STPRO'): return
    # STPro characters (bundled zips)
    cat = json.load(open(SRC / 'characters.catalog.json')); done = {}
    for z in sorted((SRC / 'characters').glob('*.zip')):
        name = z.stem; tmp = ROOT / '.tmp_stpro' / name; shutil.rmtree(tmp, ignore_errors=True); tmp.mkdir(parents=True)
        zipfile.ZipFile(z).extractall(tmp)
        atlas = next(tmp.glob('*.atlas')); pages = sorted(p for p in tmp.iterdir() if p.suffix in ('.webp', '.png'))
        outdir = PUB / 'characters' / name; outdir.mkdir(parents=True, exist_ok=True)
        print('==', name); tex = rig_to_db(tmp / 'rig.json', atlas, pages, outdir, name)
        done[tuple(sorted(p.name for p in pages))] = (f'characters/{name}/{name}_ske.json', [f'characters/{name}/{t}' for t in tex])
        shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(ROOT / '.tmp_stpro', ignore_errors=True)
    for ch in cat['characters']:
        if ch.get('json'):
            key = tuple(sorted(ch.get('images', {})))
            if key in done: ch['ske'], ch['tex'] = done[key]
            for k in ('json', 'atlas', 'images'): ch.pop(k, None)
    json.dump(cat, open(PUB / 'catalog' / 'characters.json', 'w'), separators=(',', ':'))

def build_anims():
    print('STPro animations'); print(convert_files(sorted(glob.glob(str(SRC / 'animations' / '*.json'))), None, PUB / 'animations'))
    for pose in ['front-side', 'front', 'back', 'back-2', 'side']:
        d = SRC / 'autodraft' / 'anims' / pose
        if not d.exists(): continue
        rig = SRC / 'autodraft' / 'chars' / 'neha' / f'{pose}.json'
        print('Autodraft animations', pose, convert_files(sorted(glob.glob(str(d / '*.json'))), rig, PUB / 'autodraft' / 'anims' / pose))

if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('all', 'chars'): build_chars()
    if what in ('all', 'anims'): build_anims()
