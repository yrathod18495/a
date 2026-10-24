// Studio workspace layout: which panels are visible, how big they are, canvas guides.
// Kept free of DOM work (except applyLayout) so it can be unit-tested.
const KEY = '12toons.studio.layout';

export const DEFAULT_LAYOUT = { focus: false, rail: true, panelW: 310, tlH: 0, tlMin: false, guides: 'off', loop: false };
export const GUIDES = [['off', 'Guides off'], ['thirds', 'Rule of thirds'], ['safe', 'Safe areas'], ['center', 'Center cross'], ['all', 'All guides']];
export const PANEL_MIN = 240, TIMELINE_MIN = 110;

export const clampPanel = (w, viewport = 1280) => Math.round(Math.min(Math.max(PANEL_MIN, +w || DEFAULT_LAYOUT.panelW), Math.max(PANEL_MIN, Math.min(720, viewport * 0.6))));
export const clampTimeline = (h, viewport = 800) => Math.round(Math.min(Math.max(TIMELINE_MIN, +h || TIMELINE_MIN), Math.max(TIMELINE_MIN, viewport * 0.6)));
export const nextGuide = (current) => GUIDES[(GUIDES.findIndex(([key]) => key === current) + 1) % GUIDES.length][0];

export function loadLayout(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY) || '{}');
    return {
      focus: false, // always start with the normal workspace
      rail: saved.rail !== false,
      panelW: clampPanel(saved.panelW),
      tlH: saved.tlH ? clampTimeline(saved.tlH) : 0,
      tlMin: saved.tlMin === true,
      guides: GUIDES.some(([key]) => key === saved.guides) ? saved.guides : 'off',
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
  ws.dataset.rail = layout.rail ? 'shown' : 'hidden';
  ws.dataset.timeline = layout.tlMin ? 'min' : 'full';
  ws.style.setProperty('--panel-w', `${layout.panelW}px`);
  if (layout.tlH && !layout.tlMin) ws.style.setProperty('--tl-h', `${layout.tlH}px`); else ws.style.removeProperty('--tl-h');
}

export const SHORTCUT_GROUPS = [
  ['Playback', [['Space', 'Play / pause'], ['Home', 'Jump to start'], ['End', 'Jump to end'], ['← / →', 'Step 0.1 s (hold Shift for 1 s)'], ['L', 'Loop playback on / off']]],
  ['Workspace', [['F', 'Focus mode — canvas only'], ['Esc', 'Leave focus mode'], ['[', 'Show / hide the tool rail'], [']', 'Show / hide the side panel'], ['T', 'Collapse / expand the timeline'], ['G', 'Cycle canvas guides'], ['0', 'Fit scene to the editor']]],
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
