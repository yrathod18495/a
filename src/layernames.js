// Names of the character parts in Hinglish (what users see in the Character Studio). The technical names (ARM_L, Palm_17 …) stay inside the files
// and in PSD / ZIP layer names, so uploads by name keep working. The admin can still rename any layer (layerrules.js); this is the default.

const SIDE = { L: 'Baayi', R: 'Daayi' }, SIDE2 = { L: 'Baayan', R: 'Daayan' }, SIDE3 = { L: 'Baayein', R: 'Daayein' };

/** hands, by what they do (they exist for the left and the right palm slot) */
export const PALMS = {
  L_Palm: 'Dhila khula hath (seedha latka)', R_Palm: 'Dhila khula hath (seedha latka)', L_Plam: 'Band mutthi (side se)',
  Palm_1: 'Katora hath (kuch maangne / lene ke liye)', Palm_2: 'Latka hua halka hath', Palm_3: 'Angootha bahar, ungliyan neeche (cheez pakadne ki taiyari)',
  Palm_4: 'Latka hath, ungliyan thodi mudi hui', Palm_5: 'Poora khula panja (hello / rukiye)', Palm_6: 'Mutthi me cheez pakdi hui (andar ki taraf)',
  Palm_7: 'Latka dhila hath (aaram se)', Palm_8: 'Cheez pakadne wala hath (ungliyan neeche)', Palm_9: 'Hath uthaya hua (baat samjhane wala)',
  Palm_10: 'Aage badhaya hath (tirchha)', Palm_10_2: 'Aage badhaya hath (handshake jaisa)', Palm_11: 'Khula latka hath (ungliyan jodkar)',
  Palm_12: 'Ungliyan jodkar pakadne wala hath', Palm_13: 'Chauda khula hath (ungliyan neeche)', Palm_14: 'Chutki / chimti wala hath (khana, chhoti cheez)',
  Palm_15: 'Aage faila hath (cheez dikhane wala)', Palm_16: 'Chhoti mutthi (cheez pakadne wali)', Palm_17: 'Ungli dikhane wala hath (ishara)',
  Palm_18: 'Kasi hui mutthi (taakat / gussa)', Palm_19: 'Ungliyan jodkar pakadne wala hath (upar)', Palm_20: 'Tirchhi mutthi (cheez pakadne wali)',
  Palm_21: 'Mutthi side se (danda / cheez pakadne wali)', Palm_22: 'Gol cheez pakadne wala hath (glass, gola)', Palm_23: 'Cheez uthane wala hath',
  Palm_24: 'Moti mutthi (bhaari cheez pakadne wali)', Palm_25: 'Do ungliyon se pakadne wala hath (neeche)', Palm_26: 'Patla tirchha hath (ungliyan saaf)',
  Palm_27: 'Letha hua seedha hath (table par rakha)', Palm_28: 'Thoda tirchha khula hath (rukne ka ishara)', Palm_29: 'Seedha khada hath (stop)',
  Palm_30: 'Seedha hath, ungliyan upar (thoda tirchha)', Palm_31: 'Namaste jaisa hath (ungliyan jodi hui)', Palm_32: 'Khula hath (aage)',
  Palm_Mobile: 'Mobile pakadne wala hath', Palm_Point: 'Neeche ungli dikhane wala hath', Palm_Think: 'Sochne wala hath (ungli neeche)', R_Palm_Strong: 'Majboot mutthi (taakat dikhane wali)',
};
const MOUTH = {
  X: 'shaant (chup)', A: 'band (b, m, p)', B: 'daant dikhte (e, c, d, g, k, s, t)', C: 'gol (o, l)', D: 'bada khula (a)',
  E: 'chhota gol (sh, ch, j, r)', F: 'u wala (u, w)', A_B: 'daant neeche hoth par (f, v)',
};
const FIXED = {
  TORSO_2: 'Dhad (upar ka badan)', TORSO: 'Dhad (andar ka)', Body: 'Poora badan', Pelvis: 'Kamar (pelvis)', Duptta: 'Dupatta', Lungi: 'Lungi',
  HEAD: 'Sir / chehra', Head_Prop: 'Sir par rakhi cheez', L_Props: 'Baayein hath ki cheez', R_Props: 'Daayein hath ki cheez',
  Back_Hair: 'Peeche ke lambe baal', Bun_Hair: 'Joora', Hair: 'Aage ke baal', Hair_Part: 'Baalon ki maang', Beard: 'Daadhi', Mustache: 'Moonchh', Nose: 'Naak', White: 'Aankh ka safed hissa',
  '2': 'Pajama / pant (upar ka)', Earring_L: 'Baayi baali', Earring_R: 'Daayi baali', Ear_L: 'Baayan kaan', Ear_R: 'Daayan kaan',
  EB: 'Palak (khuli)', EB2: 'Palak (aadhi band)', EB3: 'Palak (band)', EB4: 'Palak (gussa)',
};
const PAIRS = [['ARM_', 'upar ki bhuja (kandhe se kohni)'], ['FOREARM_', 'kohni se kalai tak ki bhuja'], ['THIGH_', 'jaangh (upar ka pair)'], ['CALF_', 'pindli (neeche ka pair)'], ['SHOE_', 'joota']];

/** Hinglish name of one picture, or '' when there is none (the caller then shows the technical name) */
export function hinglish(slot, key) {
  if (/^Palm_\d+_P$|^R_Palm_Strong_P$/.test(key) || /^[LR]_Palm_Part$/.test(slot) || slot === 'Palm_4') {
    const base = key.replace(/_P$/, ''), hand = PALMS[base] || base;
    return `Ungliyon ka upari hissa — ${hand}`;
  }
  if (slot === 'L_Palm' || slot === 'R_Palm') return `${slot[0] === 'L' ? 'Baayan' : 'Daayan'} hath — ${PALMS[key] || key}`;
  const mouth = key.match(/^Mouth\/(.+)$/);
  if (mouth) return `Munh — ${MOUTH[mouth[1]] || `mix (${mouth[1].replace('_', ' + ')})`}`;
  const brow = key.match(/^Eyebrow_([LR])_N(\d*)$/);
  if (brow) return `${SIDE[brow[1]]} bhaunh${brow[2] ? ` (style ${brow[2]})` : ''}`;
  const ball = key.match(/^Eyeball_([LR])$/);
  if (ball) return `${SIDE[ball[1]]} aankh ki putli`;
  for (const [pre, label] of PAIRS) {
    const m = key.match(new RegExp(`^${pre}([LR])$`));
    if (m) return `${SIDE[m[1]]} ${label}`;
  }
  return FIXED[key] || '';
}
/** the group names (Top, Bottom …) */
export const GROUPS = { Top: 'Upar ke kapde', Bottom: 'Neeche ke kapde', Shoes: 'Joote', Face: 'Chehra', Eyes: 'Aankhein', Eyebrows: 'Bhaunhein', Nose: 'Naak', Ears: 'Kaan', Hair: 'Baal', Earrings: 'Baaliyan', Lips: 'Munh / hothon ke shape', Palms: 'Haath ke panje', Other: 'Baaki parts', Parts: 'Parts' };
