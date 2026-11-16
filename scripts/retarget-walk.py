#!/usr/bin/env python3
"""OFFLINE conversion helper. Moves an animation made for the bones of one rig onto the same-shaped rig with other bone names
(the "jt" rig -> the "circle" rig): the bone names are mapped and the rotations are shifted by the difference of the two rest poses,
so the bones end up at exactly the same angles.

  python3 -I scripts/retarget-walk.py <finished-walk.json> <runtime.json of the target character> <out.json> [--name Walk --group Walking]
"""
import sys, json
NAMES = {'hips': 'pelvis', 'torso2': 'upper_body2', 'head_turn': 'head_rotate', 'left_thigh_jt': 'left_upper_leg_circle', 'left_shin_jt': 'left_lower_leg_circle', 'left_foot_jt': 'left_foot_circle',
         'right_thigh_jt': 'right_upper_leg_circle', 'right_shin_jt': 'right_lower_leg_circle', 'right_foot_jt': 'right_foot_circle', 'left_arm_up_jt': 'left_upper_hand_circle', 'left_arm_dn_jt': 'left_lower_hand_circle',
         'left_palm_jt': 'left_hand_palm_circle', 'right_arm_up_jt': 'right_upper_hand_circle', 'right_arm_dn_jt': 'right_lower_hand_circle', 'right_palm_jt': 'right_hand_palm_circle',
         'hair_k': 'hair_bone', 'hair_k2': 'hair_bone2', 'hair_k3': 'hair_bone3', 'hair_k4': 'hair_bone4', 'hair_k5': 'hair_bone5', 'drape': 'saree', 'drape_right': 'saree_right', 'drape_left': 'saree_left',
         'drape_right2': 'saree_right2', 'drape_right3': 'saree_right3', 'drape_left2': 'saree_left2', 'drape_left3': 'saree_left3', 'drape_back': 'saree_back', 'drape_back_two': 'saree_back_two',
         'drape_back_three': 'saree_back_three', 'left_jhumka': 'left_earring', 'right_jhumka': 'right_earring', 'lid': 'eye_lid', 'sclera': 'eye_white', 'hips2': 'pelvis2', 'hips3': 'pelvis3'}
SLOTS = {'lid': 'eye_lid', 'sclera': 'eye_white'}
def norm(a):
    return a - 360 * ((a + 180) // 360)
def main():
    src, target, out = sys.argv[1:4]
    opt = lambda n, d: sys.argv[sys.argv.index('--' + n) + 1] if '--' + n in sys.argv else d
    s = json.load(open(src)); walk = s['walk']; rest_new = {b[0]: b[4] for b in s['bones']}
    rest_dst = {b[0]: b[4] for b in json.load(open(target))['P']['bones']}
    bones, skipped = {}, []
    for name, tl in walk['b'].items():
        dst = NAMES.get(name, name)
        if dst not in rest_dst: skipped.append(name); continue
        t = dict(tl)
        if 'r' in t:
            shift = rest_new.get(name, 0) - rest_dst[dst]
            t['r'] = [[k[0], norm(k[1] + shift)] + k[2:] for k in t['r']]
        bones[dst] = t
    fix = lambda v: ('eye_' + v) if isinstance(v, str) and v.startswith('lid_') else v          # picture names: lid_Idle_open -> eye_lid_Idle_open
    slots = {SLOTS.get(n, n): [[k[0], fix(k[1])] + k[2:] for k in v] for n, v in (walk.get('s') or {}).items()}
    anim = {**walk, 'b': bones, 's': slots, 'n': opt('name', 'Walk'), 'c': opt('group', 'Walking')}
    json.dump(anim, open(out, 'w'))
    print(f'{len(bones)} bones moved, skipped: {skipped}')
main()
