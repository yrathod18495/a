// OFFLINE conversion helper. Reads an older character page (POSES / ANIMS_BY and the page's own walk-variant and animation-style code),
// finishes the animations the way the page shows them and writes the finished 'walk' of the 3/4 Front view with that rig's bones:
//   node scripts/wardrobe-finish-walk.mjs <older-page.html> <out.json>
// scripts/retarget-walk.py then moves it onto the bones of another rig.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(process.argv[2], 'utf8');
function literalEnd(s, i) { const open = s[i]; if (open !== '[' && open !== '{') return -1; let depth = 0, q = null; for (let j = i; j < s.length; j++) { const c = s[j]; if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; } if (c === '"' || c === "'" || c === '`') { q = c; continue; } if (c === '[' || c === '{') depth++; else if (c === ']' || c === '}') { depth--; if (depth === 0) return j + 1; } } return -1; }
function constant(name) { const m = new RegExp(`(?:^|[;\\s])const\\s+${name}\\s*=\\s*`).exec(html); const start = m.index + m[0].length, end = literalEnd(html, start); return vm.runInNewContext(`(${html.slice(start, end)})`, {}, { timeout: 60000 }); }
const POSES = constant('POSES'), ANIMS_BY = constant('ANIMS_BY');
const lines = html.split('\n'); const from = lines.findIndex((l) => l.startsWith('function walkVariant(')), to = lines.findIndex((l) => l.startsWith('function setNS('));
console.log('finishing code lines', from, to);
const code = lines.slice(from, to).join('\n');
const sandbox = { ANIMS_BY, Math, JSON, Set, Array, Object, Number, Infinity };
vm.runInNewContext(`${code}\n;globalThis.__done = typeof ALLAN !== 'undefined' ? ALLAN.length : -1;`, sandbox, { timeout: 60000 });
console.log('styled', sandbox.__done);
const walk = ANIMS_BY.f34.filter((a) => /^walk$/i.test(a.n));
console.log(walk.length, walk.map((a) => [a.n, a.l, Object.keys(a.b).length, Object.keys(a.s || {}), (a.d || []).length]));
writeFileSync(process.argv[3], JSON.stringify({ walk: walk[0], bones: POSES.find((p) => p.id === 'f34').bones }));
