// Amazon Bedrock (Claude Haiku) for the AI director. Called from the server only: the Bedrock key never reaches the browser.
// Env (Vercel): AWS_BEARER_TOKEN_BEDROCK (a Bedrock API key), optional BEDROCK_REGION (default ap-south-1), BEDROCK_MODEL_ID.
import { AccessError } from './security-policy.js';

const env = (k) => process.env[k] || '';
export const bedrockConfigured = () => !!env('AWS_BEARER_TOKEN_BEDROCK');
export const BEDROCK_MODEL = () => env('BEDROCK_MODEL_ID') || 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
export const MAX_PROMPT_CHARS = 120_000;

/** one request/answer with the Converse API; `json` asks for a JSON-only answer */
export async function converse({ system, user, json = false, signal, fetchImpl = fetch }) {
  if (!bedrockConfigured()) throw new AccessError('ai_unavailable', 'Amazon Bedrock is not set up yet. Please choose OpenRouter or try again later.', 503);
  if (typeof user !== 'string' || !user || user.length > MAX_PROMPT_CHARS) throw new AccessError('invalid_prompt', 'The AI request is empty or too large.', 400);
  const region = env('BEDROCK_REGION') || 'ap-south-1';
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(BEDROCK_MODEL())}/converse`;
  const body = {
    system: [{ text: String(system || '').slice(0, 20_000) + (json ? '\nAnswer with one JSON object only, no other text.' : '') }],
    messages: [{ role: 'user', content: [{ text: user }] }],
    inferenceConfig: { maxTokens: 2000, temperature: json ? 0.5 : 0.1 },
  };
  let r;
  try {
    r = await fetchImpl(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('AWS_BEARER_TOKEN_BEDROCK')}` }, body: JSON.stringify(body) });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new AccessError('ai_unreachable', 'Could not reach Amazon Bedrock. Please try again shortly.', 502);
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 429 || data.__type === 'ThrottlingException') throw new AccessError('ai_busy', 'The AI is busy right now. Please try again in a moment.', 429);
  if (!r.ok) { console.error('Bedrock error', r.status, String(data.message || '').slice(0, 300)); throw new AccessError('ai_failed', 'Amazon Bedrock could not answer. Please try again shortly.', 502); }
  const text = (data.output?.message?.content || []).map((p) => p.text || '').join('');
  if (!text) throw new AccessError('ai_empty', 'The AI model sent an empty response. Please try again.', 502);
  return text;
}
