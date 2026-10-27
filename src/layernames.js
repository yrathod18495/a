// Names of the character parts in plain English (what users see in the Character Studio). The technical names (ARM_L, Palm_17 …) stay inside the files
// and in PSD / ZIP layer names, so uploads by name keep working. The admin can still rename any layer (layerrules.js); this is the default.

const SIDE = { L: 'Left', R: 'Right' }, SIDE2 = { L: 'Left', R: 'Right' }, SIDE3 = { L: 'Left', R: 'Right' };

/** hands, by what they do (they exist for the left and the right palm slot) */
export const PALMS = {
  L_Palm: 'Loose open hand (hanging straight)', R_Palm: 'Loose open hand (hanging straight)', L_Plam: 'Closed fist (from the side)',
  Palm_1: 'Cupped hand (for asking for / taking something)', Palm_2: 'Relaxed hanging hand', Palm_3: 'Thumb out, fingers down (ready to grab something)',
  Palm_4: 'Hanging hand, fingers slightly bent', Palm_5: 'Fully open palm (hello / wait)', Palm_6: 'Fist holding an object (facing inward)',
  Palm_7: 'Loose hanging hand (relaxed)', Palm_8: 'Hand gripping an object (fingers down)', Palm_9: 'Raised hand (explaining a point)',
  Palm_10: 'Hand extended forward (angled)', Palm_10_2: 'Hand extended forward (handshake-like)', Palm_11: 'Open hanging hand (fingers together)',
  Palm_12: 'Hand gripping with joined fingers', Palm_13: 'Wide open hand (fingers down)', Palm_14: 'Pinching hand (food, small object)',
  Palm_15: 'Hand spread forward (showing something)', Palm_16: 'Small fist (holding something)', Palm_17: 'Pointing hand (gesture)',
  Palm_18: 'Clenched fist (strength / anger)', Palm_19: 'Fingers joined, gripping hand (up)', Palm_20: 'Angled fist (for gripping something)',
  Palm_21: 'Fist from the side (holding a stick / object)', Palm_22: 'Hand gripping a round object (glass, ball)', Palm_23: 'Hand picking something up',
  Palm_24: 'Thick fist (holding something heavy)', Palm_25: 'Hand gripping with two fingers (downward)', Palm_26: 'Thin angled hand (fingers neat)',
  Palm_27: 'Flat straight hand (resting on a table)', Palm_28: 'Slightly angled open hand (stop gesture)', Palm_29: 'Straight raised hand (stop)',
  Palm_30: 'Straight hand, fingers up (slightly angled)', Palm_31: 'Namaste-style hand (fingers joined)', Palm_32: 'Open hand (forward)',
  Palm_Mobile: 'Hand holding a phone', Palm_Point: 'Hand pointing downward', Palm_Think: 'Thinking hand (finger down)', R_Palm_Strong: 'Strong fist (showing strength)',
};
const MOUTH = {
  X: 'quiet (closed)', A: 'closed (b, m, p)', B: 'teeth showing (e, c, d, g, k, s, t)', C: 'round (o, l)', D: 'wide open (a)',
  E: 'small round (sh, ch, j, r)', F: 'rounded for u (u, w)', A_B: 'teeth on lower lip (f, v)',
};
const FIXED = {
  TORSO_2: 'Torso (upper body)', TORSO: 'Torso (inner)', Body: 'Whole body', Pelvis: 'Waist (pelvis)', Duptta: 'Dupatta', Lungi: 'Lungi',
  HEAD: 'Head / face', Head_Prop: 'Item on the head', L_Props: 'Item in the left hand', R_Props: 'Item in the right hand',
  Back_Hair: 'Long hair at the back', Bun_Hair: 'Hair bun', Hair: 'Front hair', Hair_Part: 'Hair parting', Beard: 'Beard', Mustache: 'Mustache', Nose: 'Nose', White: 'White of the eye',
  '2': 'Pajama / pants (top)', Earring_L: 'Left earring', Earring_R: 'Right earring', Ear_L: 'Left ear', Ear_R: 'Right ear',
  EB: 'Eyelid (open)', EB2: 'Eyelid (half closed)', EB3: 'Eyelid (closed)', EB4: 'Eyelid (angry)',
};
const PAIRS = [['ARM_', 'upper arm (shoulder to elbow)'], ['FOREARM_', 'forearm (elbow to wrist)'], ['THIGH_', 'thigh (upper leg)'], ['CALF_', 'calf (lower leg)'], ['SHOE_', 'shoe']];

/** plain-English name of one picture, or '' when there is none (the caller then shows the technical name) */
export function hinglish(slot, key) {
  if (/^Palm_\d+_P$|^R_Palm_Strong_P$/.test(key) || /^[LR]_Palm_Part$/.test(slot) || slot === 'Palm_4') {
    const base = key.replace(/_P$/, ''), hand = PALMS[base] || base;
    return `Fingertips — ${hand}`;
  }
  if (slot === 'L_Palm' || slot === 'R_Palm') return `${slot[0] === 'L' ? 'Left' : 'Right'} hand — ${PALMS[key] || key}`;
  const mouth = key.match(/^Mouth\/(.+)$/);
  if (mouth) return `Mouth — ${MOUTH[mouth[1]] || `mix (${mouth[1].replace('_', ' + ')})`}`;
  const brow = key.match(/^Eyebrow_([LR])_N(\d*)$/);
  if (brow) return `${SIDE[brow[1]]} eyebrow${brow[2] ? ` (style ${brow[2]})` : ''}`;
  const ball = key.match(/^Eyeball_([LR])$/);
  if (ball) return `${SIDE[ball[1]]} eyeball`;
  for (const [pre, label] of PAIRS) {
    const m = key.match(new RegExp(`^${pre}([LR])$`));
    if (m) return `${SIDE[m[1]]} ${label}`;
  }
  return FIXED[key] || '';
}
/** the group names (Top, Bottom …) */
export const GROUPS = { Top: 'Tops', Bottom: 'Bottoms', Shoes: 'Shoes', Face: 'Face', Eyes: 'Eyes', Eyebrows: 'Eyebrows', Nose: 'Nose', Ears: 'Ears', Hair: 'Hair', Earrings: 'Earrings', Lips: 'Mouth shapes', Palms: 'Hands', Other: 'Other parts', Parts: 'Parts' };
