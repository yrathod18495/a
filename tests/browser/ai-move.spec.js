import { test, expect } from '@playwright/test';
// The AI answer can say who walks from where to where: it becomes a walk clip of that character for the line, with one path (two places) on it.
test('AI "move": a walk clip and one path are made for the line, and a second answer replaces them', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Move');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  const out = await page.evaluate(() => {
    const T = window.__toon, S = T.S;
    S.speakers.push({ key: 'ravi', name: 'Ravi', color: '#c06', charId: 'fake' });
    const libs = new Map([['ravi', { byId: new Map([['7', { source: 'lib', id: 7, name: 'walk' }], ['9', { source: 'lib', id: 9, name: 'wave', layer: 'hand' }]]) }]]);
    const L = { id: 'line1', speaker: 'ravi', dur: 6, start: 2 };
    const first = T.applyMoves(L, { ravi: { anim: 7, from: { x: 0.1, y: 0.1 }, to: { x: 0.8, y: 0.12 }, flip: false } }, libs);
    const a = { dropped: first, clips: S.manual.ravi.map((m) => [m.kind, m.ref.id, m.start, m.dur]), path: S.paths.ravi && { pts: S.paths.ravi.pts, start: S.paths.ravi.start, dur: S.paths.ravi.dur }, keys: (S.charKeys.ravi || []).length };
    // a second answer for the same line replaces the first one (never two paths), an unknown animation is skipped
    const second = T.applyMoves(L, { ravi: { anim: 7, from: { x: 0.8, y: 0.1 }, to: { x: 0.2, y: 0.1 }, flip: true }, nobody: { anim: 7 } }, libs);
    const b = { dropped: second, clips: S.manual.ravi.length, pts: S.paths.ravi.pts, flip: S.speakers.at(-1).flip };
    const third = T.applyMoves(L, { ravi: { anim: 9, from: { x: 0.1, y: 0.1 }, to: { x: 0.5, y: 0.1 } } }, libs);       // a hand animation is not a walk
    const c = { dropped: third, clips: (S.manual.ravi || []).length, path: !!S.paths.ravi };
    return { a, b, c };
  });
  expect(out.a.dropped).toBe(0); expect(out.a.clips).toEqual([['body', 7, 2, 6]]);
  expect(out.a.path).toEqual({ pts: [{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.12 }], start: 2, dur: 6 }); expect(out.a.keys).toBeGreaterThan(1);
  expect(out.b.dropped).toBe(1); expect(out.b.clips).toBe(1); expect(out.b.pts[0].x).toBe(0.8); expect(out.b.flip).toBe(true);
  expect(out.c.dropped).toBe(1); expect(out.c.clips).toBe(0); expect(out.c.path).toBe(false);
});
