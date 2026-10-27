// /12toons/<path> (see vercel.json) -> a redirect to a signed link of the file in R2. Public on purpose: these are the ready-made characters, the same for everybody.
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { client, configured } from '../server/r2-storage.js';
import { libraryKey, REDIRECT_TTL, SIGN_TTL } from '../server/library.js';
const text = (res, code, message) => { res.statusCode = code; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(message); };
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'This request is not valid.');
  const raw = req.query?.path ?? new URL(req.url, 'http://x').searchParams.get('path'), path = Array.isArray(raw) ? raw.join('/') : raw;
  const key = libraryKey(path, process.env.LIBRARY_PREFIX);
  if (!key) return text(res, 400, 'The file path is not valid.');
  if (!configured()) return text(res, 503, 'Cloud storage is not set up yet.');
  try {
    const url = await getSignedUrl(client(), new GetObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME, Key: key }), { expiresIn: SIGN_TTL });
    res.statusCode = 302; res.setHeader('Location', url);
    res.setHeader('Cache-Control', `public, max-age=${REDIRECT_TTL}, s-maxage=${REDIRECT_TTL}, immutable`);
    res.end();
  } catch (e) { console.error('library link failed:', e?.name); return text(res, 500, 'Could not create a link for the file. Please try again shortly.'); }
}
