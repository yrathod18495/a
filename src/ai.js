// AI director (client side only): talks to OpenRouter straight from the browser with the user's own key.
// The key is kept in this browser's localStorage and is only ever sent to openrouter.ai.
const LS = 'toon-ai';
const API = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'google/gemini-3.8-flash';

export function loadAi() {
  try { return { key: '', model: DEFAULT_MODEL, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { key: '', model: DEFAULT_MODEL }; }
}
export function saveAi(cfg) { try { localStorage.setItem(LS, JSON.stringify({ key: cfg.key, model: cfg.model })); } catch { /* private mode */ } }

/** public list of models (no key needed), used to suggest the exact id of the flash model */
export async function listModels() {
  const r = await fetch(`${API}/models`);
  if (!r.ok) throw new Error(`Could not get the list of models (code ${r.status}). Please check your API key.`);
  return ((await r.json()).data || []).map((m) => m.id).filter((id) => /gemini/i.test(id)).sort().reverse();
}

async function chat(cfg, messages, { json = false, signal } = {}) {
  if (!cfg.key) throw new Error('Please enter your OpenRouter API key first.');
  const body = { model: cfg.model || DEFAULT_MODEL, messages, temperature: json ? 0.5 : 0.1 };
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetch(`${API}/chat/completions`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', 'X-Title': '12toons' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error?.message || `OpenRouter ${r.status}`);
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('The AI model sent an empty response. Please try again.');
  return typeof text === 'string' ? text : text.map((p) => p.text || '').join('');
}

/** 16 kHz mono 16-bit wav of an AudioBuffer, base64 (about 1.9 MB per minute) */
function wavBase64(buffer) {
  const SR = 16000, src = buffer.getChannelData(0), ratio = buffer.sampleRate / SR, n = Math.floor(src.length / ratio);
  const bytes = new Uint8Array(44 + n * 2), dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0; for (let k = a; k < b; k++) s += src[k];
    dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s / (b - a))) * 32767, true);
  }
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** audio line -> text (in the language that is spoken) */
export async function transcribe(cfg, buffer, signal) {
  const out = await chat(cfg, [{ role: 'user', content: [
    { type: 'text', text: 'Transcribe this short audio line exactly as spoken, in the language and script it is spoken in (Hindi stays Hindi). Reply with the spoken words only, no quotes, no notes.' },
    { type: 'input_audio', input_audio: { data: wavBase64(buffer), format: 'wav' } },
  ] }], { signal });
  return out.trim().replace(/^["“]|["”]$/g, '');
}

const SYSTEM = `You are the director of a 2D cartoon. You get the previous, current and next dialogue line of a script, the characters that can appear on stage and the animation library. Decide ONLY for the CURRENT line:
- shot: camera size "wide" (everyone / establishing), "medium" or "close" (emotional or important line) and who the camera looks at ("focus": a character key, or "auto" = the speaker).
- in_frame: the keys of the characters visible during this line (the speaker is visible if he/she has a character). Show a listener only when the story needs him/her on screen.
- actions: for every visible character a timeline [{ "at": seconds from the start of the line, "anim": animation id }]. First entry has "at": 0. The speaker uses talking animations and changes gesture with the meaning of the words (pointing, hands raised, calm explaining, ...) roughly every 3-6 seconds on long lines. Listeners use standing / hands-held / idle animations and may react (nod, surprise) when the speaker says something that calls for it. Never use "at" beyond the line length. Use only ids from the list.
- expression: optional face animation id per character (from "expressions"), or null.
Keep continuity with "previous_direction" (do not jump around without a reason; switch shots only when the story calls for it).
Answer with JSON only: {"shot":{"type":"wide|medium|close","focus":"key|auto"},"in_frame":["key"],"actions":{"key":[{"at":0,"anim":123}]},"expression":{"key":456},"reason":"one short sentence"}`;

function parseJson(text) {
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1)); throw new Error('The AI model\'s response was not valid JSON. Please try again.'); }
}

/**
 * @param ctx {previous, current, next, characters:[{key,name}], animations:{category:[[id,name]]}, expressions:[[id,name]], previousDirection}
 * @returns the model's decision (not yet checked against the characters)
 */
export async function direct(cfg, ctx, signal) {
  const msg = [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(ctx) }];
  try { return parseJson(await chat(cfg, msg, { json: true, signal })); } catch (e) {
    if (e.name === 'AbortError' || /key|401|402|429/i.test(e.message)) throw e;
    return parseJson(await chat(cfg, msg, { json: true, signal })); // one retry for a malformed answer
  }
}
