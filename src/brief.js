// "Brief" workflow: download a text file that any AI (Claude, ChatGPT, Gemini …) can follow, then import the file it returns.
// No API key needed. The brief holds the instructions, the characters, every animation (name, length, how it moves) and the script.

/** how an animation moves, worked out from its bone timelines ("right arm: big, head: subtle") */
const PARTS = [
  ['head', /head|neck|hair|eye|brow|lid|face/i],
  ['body/torso', /upper_body|torso|chest|back|spine|waist|pelvis|hip|body|root|bone10/i],
  ['left arm/hand', /left.*(hand|arm|palm|finger|elbow|shoulder)/i],
  ['right arm/hand', /right.*(hand|arm|palm|finger|elbow|shoulder)/i],
  ['legs/feet', /leg|foot|feet|knee|thigh|shin|shoe|toe/i],
];
export function describeMotion(json) {
  if (!json) return '';
  const amp = new Map();
  for (const tl of json.bone || []) {
    const part = PARTS.find(([, re]) => re.test(tl.name))?.[0];
    if (!part) continue;
    let a = 0;
    const rot = (tl.rotateFrame || []).map((k) => k.rotate).filter((v) => typeof v === 'number');
    if (rot.length > 1) a = Math.max(a, Math.max(...rot) - Math.min(...rot));
    const xs = (tl.translateFrame || []).flatMap((k) => [k.x, k.y]).filter((v) => typeof v === 'number');
    if (xs.length > 1) a = Math.max(a, (Math.max(...xs) - Math.min(...xs)) / 8);   // pixels -> roughly degrees
    amp.set(part, Math.max(amp.get(part) || 0, a));
  }
  const size = (a) => (a < 4 ? 'tiny' : a < 15 ? 'small' : a < 40 ? 'medium' : 'big');
  const moves = [...amp].filter(([, a]) => a >= 2).sort((x, y) => y[1] - x[1]).map(([p, a]) => `${p} ${size(a)}`);
  const shapes = (json.slot || []).length ? 'changes hand shapes / face' : '';
  return [moves.length ? `moves ${moves.join(', ')}` : 'almost still', shapes].filter(Boolean).join('; ');
}

/** the text file */
export function buildBrief({ projectName, characters, groups, lines }) {
  const L = [];
  const add = (...s) => L.push(...s);
  add('=== 12TOONS · AUTO-DIRECTION BRIEF ===',
    '',
    'ROLE: You are the animation director of a 2D cartoon. A script (dialogue lines, in order) and a library of ready-made character animations are given below.',
    'TASK: For EVERY dialogue line decide (1) the camera shot, (2) which characters are on screen, (3) which animation each of them plays and at which second of the line,',
    '(4) an optional facial expression. Work line by line: read the PREVIOUS line, the CURRENT line and the NEXT line before you decide, so the whole scene flows and keeps continuity.',
    '',
    'RULES',
    '- Use ONLY animation ids that appear in the ANIMATIONS section for that character. Never invent ids.',
    '- The speaker of a line is on screen (if he/she has a character) and plays a talking / gesture animation that matches the meaning of the words (pointing, hands raised, calm explaining, angry, sad ...).',
    '- Long lines: change the animation every 3-6 seconds ("at" = seconds from the start of that line, the first entry has "at": 0, every "at" is smaller than the line length).',
    '- Listeners: show them only when the story needs them on screen. They play standing / hands-folded / idle animations and may react (nod, surprise, fear ...) when the words call for it.',
    '- Camera: "wide" = everyone / establishing, "medium" = normal dialogue, "close" = emotional or important line. "focus" = a character key, or "auto" (= the speaker). Do not change shot size on every line without a reason.',
    '- "expression" is optional: a facial animation id from the EXPRESSIONS list of that character, or leave it out.',
    '- "hand" and "legs" are optional too: some characters have HAND LAYER / LEG LAYER animations that run on top of the body animation for the whole line (for example a body "Talk" plus a hand gesture). Ids come from those lists only.',
    '- Keep the same people on screen across neighbouring lines unless the story changes the scene.',
    '- If an animation does not fit well (for example the legs move outside the clothes, or it clips), you may still use it, but add a short note in "animation_notes" saying what should be changed.',
    '',
    'OUTPUT: Reply with ONE JSON object and nothing else (no explanations before or after; it may be inside a ```json block). Save/return it as a text or .json file.',
    'Format:',
    '{',
    '  "version": 1,',
    '  "lines": [',
    '    {',
    '      "line": 1,',
    '      "shot": { "type": "wide | medium | close", "focus": "auto | <character key>" },',
    '      "in_frame": ["<character key>", "<character key>"],',
    '      "actions": { "<character key>": [ { "at": 0, "anim": <animation id> }, { "at": 4.5, "anim": <animation id> } ] },',
    '      "expression": { "<character key>": <expression id> },',
    '      "hand": { "<character key>": <hand layer id> },',
    '      "legs": { "<character key>": <leg layer id> },',
    '      "note": "optional: why you chose this"',
    '    }',
    '  ],',
    '  "animation_notes": [ { "anim": <animation id>, "note": "what is wrong / what to change" } ]',
    '}',
    'There must be one entry in "lines" for EVERY line number in the SCRIPT section (same numbers).',
    '');
  add(`=== PROJECT: ${projectName || '12toons project'} ===`, '', '=== CHARACTERS ===');
  for (const c of characters) add(`- key: "${c.key}" | name: ${c.name} | character: ${c.character}${c.pose ? ` (${c.pose})` : ''} | animation group: ${c.group}`);
  const silent = lines.map((l) => l.speaker).filter((k, i, a) => a.indexOf(k) === i && !characters.some((c) => c.key === k));
  if (silent.length) add('', `Voices without a character (heard but never shown, no animation needed): ${silent.map((k) => `"${k}"`).join(', ')}`);
  add('', '=== ANIMATIONS ===', 'Format: id | name | length in seconds | how it moves');
  for (const g of groups) {
    add('', `--- ANIMATION GROUP ${g.id} (used by: ${g.users.join(', ')}) ---`);
    for (const [cat, list] of Object.entries(g.animations)) {
      add(`[${cat}]`);
      for (const a of list) add(`  ${a.id} | ${a.name} | ${a.length ? `${(+a.length).toFixed(1)}s` : '?'} | ${a.motion || '-'}`);
    }
    const layer = (title, list) => { if (list?.length) { add(`[${title}]`); for (const a of list) add(`  ${a.id} | ${a.name} | ${a.length ? `${(+a.length).toFixed(1)}s` : '?'} | ${a.motion || '-'}`); } };
    layer('EXPRESSIONS — face only, layered on top of the body animation (use in "expression")', g.expressions);
    layer('HAND LAYER — arms / hands only, layered on top of the body animation (use in "hand")', g.hands);
    layer('LEG LAYER — legs only, layered on top of the body animation (use in "legs")', g.legs);
  }
  add('', '=== SCRIPT ===', 'Format: [line number] speaker key (name) | length | text');
  lines.forEach((l, i) => add(`[${i + 1}] ${l.speaker} (${l.name}) | ${l.dur.toFixed(1)}s | ${l.text || `(text not available — audio file "${l.file}". Judge from the speaker and the neighbouring lines.)`}`));
  add('', '=== END OF BRIEF ===');
  return L.join('\n');
}

/** pulls the JSON object out of whatever the AI sent back (plain, in a code block, with chatter around it) */
export function extractJson(text) {
  const t = String(text || '').replace(/^﻿/, '');
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const c of [fenced?.[1], t]) {
    if (!c) continue;
    const a = c.indexOf('{'), b = c.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(c.slice(a, b + 1)); } catch { /* try the next candidate */ } }
  }
  throw new Error('No JSON was found in that file. Ask the AI to respond with JSON only.');
}
