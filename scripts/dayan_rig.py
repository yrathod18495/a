"""Forward / inverse kinematics of the Dayan 3/4 rig (DragonBones skeleton read from a character ZIP), used to make hand-made animations in which the
hands have to meet or hold something (praying, clapping, digging ...). All numbers are in the skeleton's own units; angles in degrees.
A bone's local transform is (x, y, rotation); an animation's rotate value is added to the rotation. (All of this rig's bones have equal skX / skY and scale 1.)"""
import json, math, zipfile

class Rig:
    def __init__(self, zip_path, view='f34'):
        z = zipfile.ZipFile(zip_path); m = json.loads(z.read('manifest.json'))
        v = next(x for x in m['views'] if x['id'] == view)
        arm = json.loads(z.read(v['skeleton']))['armature'][0]
        self.bone = {b['name']: b for b in arm['bone']}
        self.slots = [s['name'] for s in arm['slot']]

    def local(self, name, off):
        b = self.bone[name]; t = b['transform']
        return t.get('x', 0.0), t.get('y', 0.0), t.get('skY', 0.0) + off.get(name, 0.0)

    def chain(self, name):
        out = []
        while name:
            out.append(name); name = self.bone[name].get('parent')
        return out[::-1]

    def world(self, name, off=None):
        """-> (x, y, angle_deg) of the bone's origin in armature space, with animation rotation offsets `off` {bone: degrees}"""
        off = off or {}; x = y = 0.0; ang = 0.0
        for n in self.chain(name):
            lx, ly, lr = self.local(n, off)
            c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
            x, y = x + c * lx - s * ly, y + s * lx + c * ly; ang += lr
        return x, y, ang

    def to_local(self, parent, point, off=None):
        """a point given in armature space -> in the coordinates of bone `parent`"""
        px, py, pa = self.world(parent, off); c, s = math.cos(math.radians(pa)), math.sin(math.radians(pa))
        dx, dy = point[0] - px, point[1] - py
        return c * dx + s * dy, -s * dx + c * dy

    def from_local(self, parent, p, off=None):
        px, py, pa = self.world(parent, off); c, s = math.cos(math.radians(pa)), math.sin(math.radians(pa))
        return px + c * p[0] - s * p[1], py + s * p[0] + c * p[1]

    def arm_names(self, side):
        return f'{side}_upper_hand_circle', f'{side}_lower_hand_circle', f'{side}_hand_palm_circle'

    def solve_arm(self, side, target, off, elbow='down'):
        """Rotation offsets of the upper and lower arm so the palm bone (wrist) reaches `target` (armature space), given the other offsets `off` (torso ...).
        `elbow` picks which of the two possible bends is used: 'down' / 'up' (lower / higher elbow on screen), 'front' / 'back' (toward the front of the body, screen left / the back).
        Returns (upper, lower, reachable). A target that is too far is reached as far as the arm stretches; one that is too close folds the arm as far as it goes."""
        up, lo, pa = self.arm_names(side)
        w_up0 = self.world(up, {**off, up: 0.0})[2]; sh = self.world(up, {**off, up: 0.0})[:2]
        lx, ly, _ = self.local(lo, {}); px, py, _ = self.local(pa, {})
        l1 = math.hypot(lx, ly); l2 = math.hypot(px, py); eoff = math.degrees(math.atan2(ly, lx)); poff = math.degrees(math.atan2(py, px))
        dx, dy = target[0] - sh[0], target[1] - sh[1]; d0 = math.hypot(dx, dy); d = d0; reach = True
        if d > l1 + l2 - 1e-6: d = l1 + l2 - 1e-6; reach = False
        if d < abs(l1 - l2) + 1e-6: d = abs(l1 - l2) + 1e-6; reach = False
        base = math.degrees(math.atan2(dy, dx)); a = math.degrees(math.acos(max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))))
        best = None
        for sign in (+1, -1):
            w_e = base + sign * a                                           # world angle of the shoulder -> elbow line
            ex = sh[0] + l1 * math.cos(math.radians(w_e)); ey = sh[1] + l1 * math.sin(math.radians(w_e))
            score = {'down': ey, 'up': -ey, 'front': -ex, 'back': ex}[elbow]
            if best is None or score > best[0]: best = (score, sign, ex, ey)
        _, sign, ex, ey = best
        w_up = base + sign * a - eoff                                       # world angle of the upper arm bone
        fa = math.degrees(math.atan2(target[1] - ey, target[0] - ex)); w_lo = fa - poff
        u = (w_up - w_up0 + 540) % 360 - 180
        w_lo0 = self.world(lo, {**off, up: u, lo: 0.0})[2]
        l = (w_lo - w_lo0 + 540) % 360 - 180
        return u, l, max(0.0, d0 - (l1 + l2))
