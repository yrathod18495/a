// The tools in the studio's tool bar. The admin can switch each one off for normal users (Admin -> Overview -> Studio tools); admins still see it, a little lighter.
// The switch is a feature flag named `tool_<key>` in the same place as the tool cards of the hub (config/features); a missing flag = on.
export const STUDIO_TOOLS = [
  ['audio', 'Audio (voices, music)'], ['uploads', 'Uploads'], ['chars', 'Characters'], ['anim', 'Animations'], ['tears', 'Tears'], ['motion', 'Move (path)'], ['camera', 'Camera'], ['mask', 'Mask'],
  ['ai', 'AI'], ['grade', 'Colour'], ['canvas', 'Background'], ['handprops', 'Props (held in a hand)'], ['props', 'Objects'], ['shadow', 'Shadow'], ['fx', 'Effects'], ['effects', 'Overlays'], ['skills', 'Skills'], ['export', 'Export'],
];
export const toolFeature = (key) => `tool_${key}`;
export const TOOL_FEATURES = STUDIO_TOOLS.map(([key]) => toolFeature(key));
