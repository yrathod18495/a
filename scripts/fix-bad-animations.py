#!/usr/bin/env python3
"""Fix or drop animations that look wrong on a standing rig (found by looking at every animation of a *-plus.zip).
   usage: fix-bad-animations.py in.zip out.zip --rig dayan|william [--dry]
   - remove:      the animation is dropped (a good one with the same meaning exists)
   - stand_legs:  the leg tracks are removed, the legs stay in the rig's own standing pose (arms / head / body keep their motion)
   - lying:       the whole body lies down (the hips turn like the rig's own sleep / swim animation), legs straight; arms / head / torso keep only their own small motion
"""
import sys, json, zipfile, re, argparse

RIGS = {
    'dayan':   {'leg': r'(upper_leg|lower_leg|foot)', 'hips': 'pelvis', 'torso': 'upper_body2', 'arm': r'(hand_circle)', 'lie': -89},
    'william': {'leg': r'(thigh|shin|foot)_jt', 'hips': 'hips', 'torso': 'torso2', 'arm': r'(arm_up_jt|arm_dn_jt|palm_jt)', 'lie': -90},
}
# animation name -> action (per rig where it differs)
PLAN = {
    'dayan':   {'Action_Driving': 'stand_legs', 'Action_Swim': 'remove', 'Pose_Lean_on_a_wall': 'remove', 'Sleep_Back_2': 'lying', 'Sleep_Nightmare_2': 'lying'},
    'william': {'Action_Driving': 'stand_legs', 'Action_Swim': 'remove', 'Pose_Lean_on_a_wall': 'remove'},
}

def anim_of(d):
    return d if 'bone' in d else next(iter(d.values()))

def fix(an, action, rig):
    cfg = RIGS[rig]; leg = re.compile(cfg['leg']); arm = re.compile(cfg['arm'])
    if action == 'stand_legs':
        an['bone'] = [b for b in an['bone'] if not leg.search(b['name'])]
    elif action == 'lying':
        dur = int(an.get('duration', 60)); keep = []
        for b in an['bone']:
            n = b['name']
            if leg.search(n) or n == cfg['hips']: continue
            if n == cfg['torso']:                      # the torso keeps its own bending, measured from the lying line
                fr = b.get('rotateFrame', [])
                base = fr[0].get('rotate', 0) if fr else 0
                for f in fr: f['rotate'] = round(f.get('rotate', 0) - base, 3)
            keep.append(b)
        if re.search('Back', an.get('name', '')): keep = [b for b in keep if not arm.search(b['name'])]          # a plain lying-on-the-back pose: arms rest
        keep.insert(0, {'name': cfg['hips'], 'rotateFrame': [{'rotate': cfg['lie'], 'tweenEasing': 0, 'duration': dur}, {'rotate': cfg['lie'], 'tweenEasing': 0, 'duration': 0}]})
        an['bone'] = keep
    return an

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('dst'); ap.add_argument('--rig', required=True); ap.add_argument('--dry', action='store_true')
    a = ap.parse_args(); plan = PLAN[a.rig]
    zin = zipfile.ZipFile(a.src); m = json.loads(zin.read('manifest.json')); drop = set(); fixed = {}; removed = {}
    for v in m['views']:
        keep = []
        for an in v['animations']:
            act = plan.get(an['name'])
            if act == 'remove': drop.add(an['file']); removed.setdefault(v['id'], []).append(an['name']); continue
            if act: fixed.setdefault(v['id'], []).append((an['name'], an['file'], act))
            keep.append(an)
        v['animations'] = keep
    out = zipfile.ZipFile(a.dst, 'w', zipfile.ZIP_DEFLATED)
    todo = {f: act for lst in fixed.values() for (_, f, act) in lst}
    for n in zin.namelist():
        if n in drop: continue
        if n == 'manifest.json': out.writestr(n, json.dumps(m)); continue
        if n in todo:
            d = json.loads(zin.read(n)); wrapper = 'bone' not in d; an = anim_of(d)
            an = fix(an, todo[n], a.rig)
            if wrapper: d[next(iter(d))] = an
            else: d = an
            out.writestr(n, json.dumps(d)); continue
        out.writestr(n, zin.read(n))
    out.close()
    print('removed', removed); print('fixed', {k: [(x[0], x[2]) for x in v] for k, v in fixed.items()})

if __name__ == '__main__':
    main()
