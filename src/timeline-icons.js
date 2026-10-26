import { h } from './dom.js';

// Keep uploaded portraits stable across timeline redraws, then release unused URLs.
const thumbnails = new Map();
export function pruneTimelineThumbnails(sources = []) {
  const active = new Set(sources);
  for (const [blob, url] of thumbnails) if (!active.has(blob)) {
    URL.revokeObjectURL(url); thumbnails.delete(blob);
  }
}
export function timelineIcon(source, kind = 'character') {
  const icon = h('span', { class: `timeline-icon timeline-icon-${kind}`, 'aria-hidden': 'true' });
  if (kind !== 'camera') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    const paths = kind === 'background'
      ? ['M3 5h18v14H3z', 'M3 16l5-6 5 6 3-4 5 5', 'M16 8h.01']
      : kind === 'audio' ? ['M9 5v10a3 3 0 1 1-2-2.8', 'M9 5l9-2v10a3 3 0 1 1-2-2.8', 'M9 8l9-2']
        : kind === 'prop' ? ['M4 7l8-4 8 4v10l-8 4-8-4z', 'M4 7l8 4 8-4', 'M12 11v10']
          : ['M8 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0', 'M4 21v-2a8 8 0 0 1 16 0v2'];
    for (const d of paths) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
    icon.append(svg);
  }
  if (source) {
    let url = source;
    if (source instanceof Blob) {
      if (!thumbnails.has(source)) thumbnails.set(source, URL.createObjectURL(source));
      url = thumbnails.get(source);
    }
    if (typeof url === 'string') icon.append(h('img', { src: url, alt: '', decoding: 'async', onerror: e => e.currentTarget.remove() }));
  }
  return icon;
}
