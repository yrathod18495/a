#!/usr/bin/env python3
"""Hand-made Dayan 3/4 animations (no props), hands placed by inverse kinematics: see dayan_anim.py.
   usage: make-dayan-animations.py --json NAME out.json     (one animation, for looking at it)
          make-dayan-animations.py in.zip out.zip           (adds / replaces them all in the ZIP; drops Leaning_on_Wall)"""
import sys, os, json, zipfile, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dayan_rig import Rig
from dayan_anim import Maker, SHAPES

ANIMS = {}
REST = dict(free=(0.0, 0.0, 0.0), shape='default')       # the rig's rest pose (arms hanging)
def anim(name, label, dur, group, layer='body', far_front=None, only_arms=False):
    def deco(fn): ANIMS[name] = dict(fn=fn, label=label, dur=dur, group=group, layer=layer, far_front=far_front, only_arms=only_arms); return fn
    return deco


@anim('Praying', 'Praying', 75, 'Hands', layer='hand', far_front=(8, 68), only_arms=True)
def praying(m):
    m.key(0, L=REST, R=REST)
    m.key(12, L=dict(p=(330, 110), ang=-60), R=dict(p=(330, -165), ang=-60))              # the hands lift from the sides to the front of the waist ...
    m.key(20, L=dict(p=(650, -5), ang=-4, shape='namaste'), R=dict(p=(657, -36), ang=-6, shape='namaste'))   # ... and press together at the chest
    m.key(27, L=dict(p=(655, -3), ang=-3), R=dict(p=(662, -34), ang=-5))
    m.key(48, L=dict(p=(650, -6), ang=-5), R=dict(p=(657, -37), ang=-7))
    m.key(57, L=dict(p=(650, -5), ang=-4), R=dict(p=(657, -36), ang=-6))
    m.key(64, L=dict(p=(330, 110), ang=-60), R=dict(p=(330, -165), ang=-60))
    m.key(75, L=REST, R=REST)
    m.shape(14, 'both', 'namaste'); m.shape(62, 'both', 'default')

@anim('Clapping', 'Clapping', 120, 'General', layer='hand', far_front=(8, 112), only_arms=True)
def clapping(m):
    APART = (dict(p=(640, 120), ang=-12), dict(p=(648, -170), ang=-14))          # near / far hand with the palms open
    TOGETHER = (dict(p=(650, -4), ang=-4), dict(p=(657, -36), ang=-6))          # palms flat on each other
    m.key(0, L=REST, R=REST)
    m.key(12, L=dict(p=(330, 110), ang=-60), R=dict(p=(330, -165), ang=-60))     # the hands lift from the sides to the front of the waist ...
    m.key(22, L=dict(**APART[0], shape='namaste'), R=dict(**APART[1], shape='namaste'))   # ... and open at the chest, ready to clap
    t = 22
    for i in range(6):
        t += 6; m.key(t, 'in', L=TOGETHER[0], R=TOGETHER[1])                     # the clap: they hit and stay one beat
        t += 4 if i < 5 else 6; m.key(t, 'out', L=APART[0] if i < 5 else dict(p=(650, -5), ang=-4), R=APART[1] if i < 5 else dict(p=(657, -36), ang=-6))
    m.key(108, L=dict(p=(330, 110), ang=-60), R=dict(p=(330, -165), ang=-60))
    m.key(120, L=REST, R=REST)
    m.shape(14, 'both', 'namaste'); m.shape(106, 'both', 'default')

@anim('Digging_Shovel', 'Digging Shovel', 96, 'Action', far_front=(6, 92))
def digging(m):
    # an imaginary shovel held in both fists, the near hand on top of the handle: raise it, plunge it in with the whole body, lever, lift and throw the soil aside
    top = lambda x, y, a: dict(p=('w', x, y), ang=a, shape='big_prop')
    low = lambda x, y, a: dict(p=('w', x, y), ang=a, shape='big_prop')
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(14, torso=-4, head=-4, L=top(-20, -420, -90), R=low(-240, -250, -95))                  # take hold of the handle at the waist
    m.key(26, torso=6, head=0, L=top(0, -640, -80), R=low(-200, -520, -85))                      # raise the shovel
    m.key(38, torso=-38, head=-14, L=top(-330, -30, -105), R=low(-520, 170, -105))               # plunge the blade into the ground
    m.key(48, torso=-32, head=-12, L=top(-280, -150, -100), R=low(-480, 60, -100))               # lever it
    m.key(62, torso=-6, head=-2, L=top(0, -520, -80), R=low(-230, -400, -85))                    # lift the soil
    m.key(72, torso=8, head=2, L=top(180, -520, -50), R=low(-30, -470, -60))                     # swing it aside and throw
    m.key(82, torso=-4, head=-4, L=top(-20, -420, -90), R=low(-240, -250, -95))
    m.key(96, torso=0, head=0, L=REST, R=REST)

def W(x, y, a, shape='default', **kw): return dict(p=('w', x, y), ang=a, shape=shape, **kw)      # a hand target in space
def T(u, v, a, shape='default', **kw): return dict(p=(u, v), ang=a, shape=shape, **kw)           # a hand target in the chest frame

@anim('Wake_Someone_Up', 'Wake Someone Up', 96, 'Action', far_front=(8, 90))
def wake(m):
    # bends over someone lying down and shakes their shoulder with her near hand; the other hand rests on her thigh
    NEAR = lambda dx=0, dy=0: W(-540 + dx, -230 + dy, -70, 'default')
    FAR = W(-260, -40, -50, 'default')
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(16, torso=-24, head=-10, L=NEAR(), R=FAR)
    t = 16
    for burst in range(3):
        for i in range(6):
            t += 3; m.key(t, 'lin', torso=-24 + (2 if i % 2 else -1), head=-10, L=NEAR(-30 if i % 2 else 30, 45 if i % 2 else -45), R=FAR)
        t += 4; m.key(t, torso=-24, head=-10, L=NEAR(), R=FAR)
    m.key(88, torso=-8, head=-4, L=W(-300, -250, -80), R=W(-230, -90, -40))
    m.key(96, torso=0, head=0, L=REST, R=REST)

@anim('Lift_Sleeping_Person', 'Lift Sleeping Person', 132, 'Action', far_front=(8, 126))
def lift(m):
    # bends down, slips both arms under a sleeping person, stands up with them in her arms, holds, then sets them down again
    under = lambda: dict(L=W(-340, -20, -90, 'default'), R=W(-520, 70, -90, 'default'))
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(18, torso=-34, head=-12, **under())
    m.key(30, torso=-36, head=-12, **under())
    m.key(58, torso=-4, head=-4, L=W(-380, -470, -95), R=W(-560, -430, -95))           # stand up, the person in her arms
    m.key(66, torso=0, head=-4, L=W(-380, -470, -95), R=W(-560, -430, -95))
    m.key(90, torso=0, head=-4, L=W(-380, -470, -95), R=W(-560, -430, -95))
    m.key(110, torso=-34, head=-12, **under())
    m.key(120, torso=-34, head=-12, **under())
    m.key(132, torso=0, head=0, L=REST, R=REST)

@anim('Help_Up_Person', 'Help Up Person', 90, 'Action', far_front=(6, 84))
def helpup(m):
    # reaches both hands down to someone on the ground, grips their hands and pulls them up to their feet
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(14, torso=-24, head=-12, L=W(-430, -70, -85, 'default'), R=W(-540, -20, -85, 'default'))
    m.key(24, torso=-26, head=-12, L=W(-430, -70, -85, 'close'), R=W(-540, -20, -85, 'close'))
    m.key(36, torso=-14, head=-8, L=W(-380, -200, -85, 'close'), R=W(-490, -150, -85, 'close'))   # pulls
    m.key(54, torso=8, head=2, L=W(-200, -620, -80, 'close'), R=W(-300, -570, -80, 'close'))      # and leans back
    m.key(64, torso=4, head=0, L=W(-210, -600, -80, 'close'), R=W(-310, -550, -80, 'close'))
    m.key(74, torso=-2, head=-2, L=W(-260, -520, -80, 'default'), R=W(-340, -470, -80, 'default'))
    m.key(90, torso=0, head=0, L=REST, R=REST)

@anim('Pull_Rope', 'Pull Rope', 72, 'Action', far_front=(4, 68))
def pullrope(m):
    # pulls an imaginary rope hand over hand, leaning back
    G = 'close'
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(10, torso=-2, head=-2, L=W(-520, -450, -90, G), R=W(-300, -330, -90, G))
    t = 10
    for i in range(4):
        t += 6; m.key(t, 'lin', torso=6, head=0, L=W(-230, -320, -90, G), R=W(-540, -470, -90, G))
        t += 6; m.key(t, 'lin', torso=0, head=-2, L=W(-520, -450, -90, G), R=W(-250, -310, -90, G))
    m.key(72, torso=0, head=0, L=REST, R=REST)

@anim('Draw_Water_Well', 'Draw Water From Well', 84, 'Action', far_front=(4, 80))
def well(m):
    # pulls a rope up out of a well hand over hand: the hands reach high, grip and pull down to the waist in turns
    G = 'close'
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(12, torso=-6, head=4, L=W(-280, -980, -90, G), R=W(-420, -560, -90, G))
    t = 12
    for i in range(4):
        t += 7; m.key(t, 'lin', torso=2, head=2, L=W(-300, -560, -90, G), R=W(-440, -990, -90, G))
        t += 7; m.key(t, 'lin', torso=-6, head=4, L=W(-280, -980, -90, G), R=W(-420, -560, -90, G))
    m.key(84, torso=0, head=0, L=REST, R=REST)

@anim('Push_Heavy_Object', 'Push Heavy Object', 84, 'Action', far_front=(4, 80))
def push(m):
    # both hands flat on something heavy, leaning into it and straining
    H = 'full_open'
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(14, torso=-20, head=-8, L=W(-560, -700, -20, H), R=W(-650, -640, -20, H))
    t = 14
    for i in range(5):
        t += 6; m.key(t, 'lin', torso=-26, head=-10, L=W(-610, -680, -20, H), R=W(-700, -620, -20, H))
        t += 6; m.key(t, 'lin', torso=-20, head=-8, L=W(-560, -700, -20, H), R=W(-650, -640, -20, H))
    m.key(84, torso=0, head=0, L=REST, R=REST)

@anim('Handshake', 'Handshake', 78, 'Action', far_front=(6, 72))
def shake(m):
    # offers her hand, shakes three times and lets go
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(14, torso=-4, head=-2, L=W(-600, -420, -80, 'default'))
    t = 14
    for i in range(3):
        t += 6; m.key(t, 'lin', L=W(-600, -340, -95))
        t += 6; m.key(t, 'lin', L=W(-600, -490, -65))
    m.key(62, torso=-2, head=0, L=W(-600, -420, -80))
    m.key(78, torso=0, head=0, L=REST, R=REST)

@anim('Beckon_Come_Here', 'Beckon Come Here', 84, 'Action', far_front=(6, 78))
def beckon(m):
    # calls someone over with a curling wave of the hand
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(14, torso=-3, head=-3, L=W(-660, -700, -45, 'default'))
    t = 14
    for i in range(4):
        t += 7; m.key(t, 'lin', L=W(-610, -690, -140))
        t += 7; m.key(t, 'lin', L=W(-660, -710, -40))
    m.key(84, torso=0, head=0, L=REST, R=REST)

@anim('Shush_Quiet', 'Shush Be Quiet', 84, 'Action', far_front=(6, 78))
def shush(m):
    # a finger to her lips: be quiet
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(16, torso=-3, head=-5, L=T(850, -255, -4, 'pointing_finger'), R=T(380, -300, -80))
    m.key(24, torso=-3, head=-5, L=T(845, -260, -7, 'pointing_finger'))
    m.key(36, torso=-3, head=-8, L=T(850, -255, -2, 'pointing_finger'))
    m.key(48, torso=-3, head=-5, L=T(845, -260, -7, 'pointing_finger'))
    m.key(60, torso=-3, head=-8, L=T(850, -255, -2, 'pointing_finger'))
    m.key(84, torso=0, head=0, L=REST, R=REST)

@anim('Stir_Pot', 'Stir Pot', 72, 'Action', far_front=(4, 68))
def stir(m):
    # stirs an imaginary pot with a long spoon: the hand goes round in front of her waist
    import math
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(10, torso=-12, head=-12, L=W(-380, -240, -95, 'big_prop'), R=W(-230, -170, -90, 'default'))
    for i in range(1, 13):
        a = 2 * math.pi * i / 12
        m.key(10 + i * 4, 'lin', L=W(-380 + 70 * math.cos(a), -240 + 38 * math.sin(a), -95, 'big_prop'))
    m.key(72, torso=0, head=0, L=REST, R=REST)

@anim('Chopping_Wood', 'Chopping Wood', 96, 'Action', far_front=(6, 90))
def chop(m):
    # lifts an imaginary axe high over her head and brings it down hard, twice
    G = 'big_prop'
    m.key(0, torso=0, head=0, L=REST, R=REST)
    m.key(12, torso=-4, head=-4, L=W(-30, -520, -85, G), R=W(-230, -360, -85, G))
    t = 12
    for i in range(2):
        m.key(t + 14, torso=10, head=6, L=W(120, -1780, -10, G), R=W(-60, -1560, -20, G))      # swing it up high over her head
        m.key(t + 22, 'in', torso=-38, head=-14, L=W(-300, -60, -100, G), R=W(-470, 120, -100, G))   # bring it down
        m.key(t + 34, torso=-28, head=-10, L=W(-280, -120, -100, G), R=W(-440, 60, -100, G))
        t += 34
    m.key(88, torso=-4, head=-4, L=W(-30, -520, -85, G), R=W(-230, -360, -85, G))
    m.key(96, torso=0, head=0, L=REST, R=REST)

def build(name, rig):
    spec = ANIMS[name]; m = Maker(rig, name, spec['dur'], spec['group'], spec['layer']); spec['fn'](m)
    arms = [f'{s}_{p}' for s in ('left', 'right') for p in ('upper_hand_circle', 'lower_hand_circle', 'hand_palm_circle')]
    a = m.build(only=arms if spec['only_arms'] else None, far_front=spec['far_front'])
    import re as _re
    for w in sorted(set(m.warn), key=lambda w: -int(_re.search(r'falls (\d+)', w).group(1)))[:3]: print('WARN', w)
    print(name, 'frames with a hand out of reach:', len(m.warn), 'worst shortfall:', round(getattr(m, 'short', 0)), 'units (the arm is 1100 long)')
    return a

REMOVE = ['Leaning_on_Wall']

def add_to_zip(src, dst, rig):
    zin = zipfile.ZipFile(src); m = json.loads(zin.read('manifest.json')); v = next(x for x in m['views'] if x['id'] == 'f34')
    drop = {a['file'] for a in v['animations'] if a['name'] in REMOVE or a['name'] in ANIMS}
    v['animations'] = [a for a in v['animations'] if a['name'] not in REMOVE and a['name'] not in ANIMS]
    new = {}
    for name, spec in ANIMS.items():
        f = f'views/f34/animations/{name.lower()}.json'; new[f] = json.dumps({name: build(name, rig)})
        v['animations'].append({'name': name, 'label': spec['label'], 'group': spec['group'], 'layer': spec['layer'], 'length': round(spec['dur'] / 30, 3), 'file': f, 'source': 'handmade:dayan'})
    out = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
    for n in zin.namelist():
        if n in drop or n in new: continue
        out.writestr(n, json.dumps(m) if n == 'manifest.json' else zin.read(n))
    for f, b in new.items(): out.writestr(f, b)
    out.close(); print('removed', REMOVE, 'added/replaced', list(ANIMS))

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('a'); ap.add_argument('b'); ap.add_argument('--json', action='store_true'); ap.add_argument('--rig', default='deliver/dayan-plus.zip')
    x = ap.parse_args(); rig = Rig(x.rig)
    if x.json: json.dump(build(x.a, rig), open(x.b, 'w')); print('wrote', x.b)
    else: add_to_zip(x.a, x.b, rig)
