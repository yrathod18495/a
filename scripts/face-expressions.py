#!/usr/bin/env python3
"""OFFLINE conversion helper. Makes face-only animations (they change the eye and mouth pictures and move no bone) for a rig that has
the pictures eye_lid_<emotion>_open|half_close|close and lip_<emotion>: Happy, Sad, Angry, Scared, Shocked, Suspense Face, plus Laugh and Cry.
They are written in the compact animation format that scripts/chudail-shim.py takes as an extra file.

  python3 -I scripts/face-expressions.py <out.json>
"""
import sys, json
def blink(emo, length, every=2.4, start=1.0):
    keys, t = [[0, f'eye_lid_{emo}_open']], start
    while t + 0.4 < length:
        keys += [[round(t, 3), f'eye_lid_{emo}_half_close'], [round(t + 0.1, 3), f'eye_lid_{emo}_close'], [round(t + 0.2, 3), f'eye_lid_{emo}_half_close'], [round(t + 0.3, 3), f'eye_lid_{emo}_open']]
        t += every
    return keys + [[length, f'eye_lid_{emo}_open']]
def anim(name, length, eyes, lips, group='Expressions'):
    return {'b': {}, 's': {'eye_lid': eyes, 'lips': lips}, 'd': [], 'n': name, 'c': group, 'l': length}
out = []
for label, eye, lip in [('Happy Face', 'happy', 'lip_happy'), ('Sad Face', 'sad', 'lip_sad'), ('Angry Face', 'angry', 'lip_angry'), ('Scared Face', 'scared', 'lip_scared'), ('Shocked Face', 'shocked', 'lip_shocked'), ('Suspense Face', 'Suspense', 'lip_idle')]:
    out.append(anim(label, 3.0, blink(eye, 3.0), [[0, lip], [3.0, lip]]))
# laugh: eyes squint, the mouth opens and closes in pulses (the page's own timing: eight short pulses in 2.8 s)
pulses = [0, .26, .52, .78, 1.04, 1.7, 1.96, 2.22]; lips = [[0, 'lip_happy']]
for p0 in pulses: lips += [[p0, 'lip_a_e_i'], [round(p0 + .13, 3), 'lip_happy']]
lips.append([2.8, 'lip_happy'])
eyes = [[0, 'eye_lid_happy_half_close'], [1.3, 'eye_lid_happy_close'], [1.7, 'eye_lid_happy_half_close'], [2.5, 'eye_lid_happy_close'], [2.8, 'eye_lid_happy_half_close']]
out.append(anim('Laugh Face', 2.8, eyes, lips))
# cry: sad eyes, the mouth shakes between sad and a small "o"
lips = [[0, 'lip_sad']]; t = 0
while t < 2.6: lips += [[round(t + .2, 3), 'lip_o'], [round(t + .45, 3), 'lip_sad']]; t += 0.65
lips.append([2.6, 'lip_sad'])
eyes = [[0, 'eye_lid_sad_half_close'], [0.8, 'eye_lid_sad_close'], [1.0, 'eye_lid_sad_half_close'], [1.9, 'eye_lid_sad_close'], [2.1, 'eye_lid_sad_half_close'], [2.6, 'eye_lid_sad_half_close']]
out.append(anim('Cry Face', 2.6, eyes, lips))
json.dump(out, open(sys.argv[1], 'w')); print(f'{len(out)} face animations')
