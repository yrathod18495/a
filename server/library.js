// The ready-made character library (rigs, atlases, pictures, animations) lives in the SAME R2 bucket as everything else, in its own folder:
//   <bucket>/lib/v1/12toons/chars/<character>/<pose>_ske.json ...
// The bucket stays private (users' files are in it too). The site asks for /12toons/<path>; /api/library answers with a redirect to a signed R2 link,
// and the redirect is cached for days (browser and Vercel's edge), so a file is looked up once and then comes straight from R2 / the browser cache.
export const LIBRARY_PREFIX_DEFAULT = 'lib/v1';
export const REDIRECT_TTL = 5 * 24 * 3600, SIGN_TTL = 7 * 24 * 3600;      // the cached redirect always has at least 2 days of signed-link life left
const ALLOWED = /\.(json|webp|png|jpg|jpeg|svg|gif|mp4|webm|mp3|wav|ogg|txt)$/i;

/** the R2 key for a library file, or null when the path is not a plain file path inside the library */
export function libraryKey(path, prefix = LIBRARY_PREFIX_DEFAULT) {
  if (typeof path !== 'string' || !path || path.length > 300) return null;
  const clean = path.replace(/^\/+/, '');
  if (!/^[A-Za-z0-9_@.()\- /]+$/.test(clean) || clean.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.')) || !ALLOWED.test(clean)) return null;
  const safePrefix = String(prefix || LIBRARY_PREFIX_DEFAULT).replace(/^\/+|\/+$/g, '');
  return `${safePrefix}/12toons/${clean}`;
}
