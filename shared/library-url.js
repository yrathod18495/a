// The ready-made 12toons characters (rigs, atlases, pictures, animations) live in ONE place: a public Cloudflare R2 bucket
// (see docs/LIBRARY.md). The browser fetches every library file from there; until VITE_LIBRARY_URL is set the copy bundled
// with the site (public/12toons) is used, so nothing breaks while the bucket is being filled.
const LIBRARY_PREFIX = '12toons/';
export const isLibraryPath = (path) => typeof path === 'string' && path.startsWith(LIBRARY_PREFIX) && !path.includes('..');
/** the address of a file: library files from the bucket (when configured), everything else from the site itself */
export function assetAddress(path, { siteBase = '/', libraryBase = '' } = {}) {
  if (!path) return null;
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  const base = String(libraryBase || '').replace(/\/+$/, '');
  return base && isLibraryPath(path) ? `${base}/${path}` : siteBase + path;
}
/** content type and cache rule for a library file (files never change in place: a new version goes under a new prefix, so they can be cached for a year) */
export const LIBRARY_CACHE = 'public, max-age=31536000, immutable';
const TYPES = { json: 'application/json', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain; charset=utf-8' };
export const libraryType = (path) => TYPES[String(path).split('.').pop().toLowerCase()] || 'application/octet-stream';
