// "Download HTML" (admin): one stand-alone HTML file with a character's rig, pictures and animations and a small player.
// Everything is inside the file, readable by anyone who gets it. It is meant for the admin's own work (for example to show the
// character to an AI tool); do not publish it.
import { getJson, loadCloudView } from './cloud-characters.js';

const dataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, ' ');
const STYLE = `:root{--bg:#f4f1eb;--card:#fffdf9;--tx:#282e2c;--ln:#dddcd5;--accent:#18574f}*{box-sizing:border-box}body{margin:0;font:14px system-ui,sans-serif;background:var(--bg);color:var(--tx)}
header{height:60px;display:flex;align-items:center;justify-content:space-between;padding:12px 22px;border-bottom:1px solid var(--ln)}header strong{font-size:20px}header span{color:#6d766f;font-size:12px}
main{display:grid;grid-template-columns:minmax(0,1fr) 320px;height:calc(100vh - 60px)}.cv-stage{position:relative;background:radial-gradient(ellipse at 50% 35%,#f8f4ec,#ded7c9);display:grid;place-items:center;overflow:hidden}
.cv-stage canvas{max-width:100%;max-height:100%;width:auto!important;height:100%!important;object-fit:contain}.cv-status{position:absolute;inset:auto 0 12px;text-align:center;color:#64736c;margin:0}
aside{overflow:auto;border-left:1px solid var(--ln);padding:16px;display:grid;gap:12px;align-content:start}label{display:grid;gap:5px;font-size:12px}select,button{font:inherit;color:var(--tx);background:var(--card);border:1px solid var(--ln);border-radius:8px;padding:9px;min-height:38px}
button{cursor:pointer}.cv-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}.cv-info{color:#737c75}
@media(max-width:760px){main{display:flex;flex-direction:column;height:auto}.cv-stage{height:62vh}aside{border-left:0;border-top:1px solid var(--ln)}}`;

/** { name, html }: the HTML text of one character. `progress(text)` is called while the files are read. */
export async function buildCharacterHtml(character, { progress = () => {} } = {}) {
  const res = await fetch('/character-viewer.js');
  if (!res.ok) throw new Error('The player script is missing on this site build. Please run "npm run build" (or "npm run build:viewer") and try again.');
  const viewer = (await res.text()).replace(/<\/script/gi, '<\\/script');
  const views = [];
  for (const [id, meta] of Object.entries(character.views || {})) {
    progress(`Reading ${meta.label || id}…`);
    const { ske, tex } = await loadCloudView(character, id);
    const textures = [];
    for (const t of tex) textures.push({ json: t.json, image: await dataUrl(t.image) });
    const list = (character.animations?.[id]?.animations || []);
    const animations = [];
    for (const [i, a] of list.entries()) { progress(`${meta.label || id}: animation ${i + 1} / ${list.length}`); animations.push({ name: a.name, label: a.label || a.name, group: a.group || '', layer: a.layer || 'body', length: a.length, json: await getJson(a.file) }); }
    views.push({ id, label: meta.label || id, ske, tex: textures, animations });
  }
  if (!views.length) throw new Error('This character has no views to export.');
  const data = { name: character.name, id: character.id, category: character.category, exportedAt: new Date().toISOString(), views };
  const html = `<!doctype html>\n<!-- Exported from the 12toons admin screen for private work. The rig (DragonBones), the pictures and the animations are in the data block below. -->\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${String(character.name).replace(/[<&>]/g, '')} · character</title><style>${STYLE}</style></head><body>\n<script id="character-data" type="application/json">${safeJson(data)}</script>\n<script>${viewer}</script>\n<script>window.startCharacterViewer(JSON.parse(document.getElementById('character-data').textContent));</script>\n</body></html>`;
  return { name: `12toons-${String(character.id).replace(/[^\w-]+/g, '_')}.html`, html };
}
