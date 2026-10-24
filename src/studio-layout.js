// Studio workspace layout: which panels are visible, how big they are, canvas guides.
// Kept free of DOM work (except applyLayout) so it can be unit-tested.
const KEY = '12toons.studio.layout';

export const DEFAULT_LAYOUT = { focus: false, panelW: 310, tlH: 0, loop: false };
export const PANEL_MIN = 240, TIMELINE_MIN = 110;

export const clampPanel = (w, viewport = 1280) => Math.round(Math.min(Math.max(PANEL_MIN, +w || DEFAULT_LAYOUT.panelW), Math.max(PANEL_MIN, Math.min(720, viewport * 0.6))));
export const clampTimeline = (h, viewport = 800) => Math.round(Math.min(Math.max(TIMELINE_MIN, +h || TIMELINE_MIN), Math.max(TIMELINE_MIN, viewport * 0.6)));

export function loadLayout(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY) || '{}');
    return {
      focus: false, // always start with the normal workspace
      panelW: clampPanel(saved.panelW),
      tlH: saved.tlH ? clampTimeline(saved.tlH) : 0,
      loop: saved.loop === true,
    };
  } catch { return { ...DEFAULT_LAYOUT }; }
}
export function saveLayout(layout, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify({ ...layout, focus: false })); } catch { /* private mode: layout just isn't remembered */ }
}

/** Mirror the layout onto the workspace element; the CSS reads these attributes and variables. */
export function applyLayout(ws, layout) {
  if (!ws) return;
  ws.dataset.focus = String(layout.focus);
  ws.style.setProperty('--panel-w', `${layout.panelW}px`);
  if (layout.tlH) ws.style.setProperty('--tl-h', `${layout.tlH}px`); else ws.style.removeProperty('--tl-h');
}

export const SHORTCUT_GROUPS = [
  ['Playback', [['Space', 'Play / pause'], ['Home', 'Jump to start'], ['End', 'Jump to end'], ['← / →', 'Step 0.1 s (hold Shift for 1 s)'], ['L', 'Loop playback on / off']]],
  ['Workspace', [['F', 'Focus mode — canvas only'], ['Esc', 'Leave focus mode'], ['[', 'Slide the tool menu in / out'], [']', 'Slide the side panel in / out'], ['0', 'Fit scene to the editor']]],
  ['Edit', [['Ctrl / ⌘ + Z', 'Undo'], ['Ctrl / ⌘ + Y', 'Redo'], ['?', 'Show this list']]],
];

/** One-click export setups; each only touches the settings the export panel already has. */
export const EXPORT_PRESETS = [
  { id: 'draft', label: 'Quick draft', note: '360p · fast to render', quality: 360, format: 'webm', fps: 15, level: 'std' },
  { id: 'share', label: 'Chat share', note: '480p MP4 · small file', quality: 480, format: 'mp4', fps: 24, level: 'std' },
  { id: 'hd', label: 'YouTube HD', note: '1080p MP4 · 30 fps', quality: 1080, format: 'mp4', fps: 30, level: 'high' },
  { id: 'best', label: 'Best quality', note: '4K MP4 · maximum', quality: 2160, format: 'mp4', fps: 30, level: 'max' },
];
export const presetMatch = (s) => EXPORT_PRESETS.find((p) => p.quality === s.quality && p.format === s.format && p.fps === s.fps && p.level === s.level)?.id || null;
