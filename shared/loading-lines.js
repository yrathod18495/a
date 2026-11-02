// The short lines shown under the mascot while 12toons is loading. Plain English; every tip describes something the studio really does.
export const LOADING_LINES = Object.freeze([
  'Your story, your toons.',
  'Tip: press Space to play or pause.',
  'Every great cartoon starts with one small idea.',
  'Tip: Ctrl+Z undoes and Ctrl+Y redoes, as many times as you like.',
  'Tip: hold Alt while dragging a clip to turn snapping off.',
  'Lights, camera, toons!',
  'Tip: Shift-click clips on the timeline to select several at once.',
  'Tip: lock a layer with its padlock so it cannot be moved by accident.',
  'Good animation is patience, one frame at a time.',
  'Tip: your work is saved on this device first, then to the cloud.',
]);
/** the line to show after `index` (wraps around) */
export const nextLine = (index, lines = LOADING_LINES) => (index + 1) % lines.length;
