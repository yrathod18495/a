import { readFileSync } from 'node:fs';
export const ZIP = '/home/user/a/deliver/dayan-plus.zip';
export async function open(page, { bg = true, chr = true, workers = 0 } = {}) {
  page.on('pageerror', (e) => { (page.__errs ||= []).push(String(e)); console.log('PAGEERR', String(e).slice(0, 200)); });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } })); await page.goto('/?debug&workers=' + workers + '#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Cam');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  if (bg) await page.evaluate(async () => {
    const T = window.__toon, c = document.createElement('canvas'); c.width = 1600; c.height = 900; const g = c.getContext('2d');
    g.fillStyle = '#d33'; g.fillRect(0, 0, 640, 900); g.fillStyle = '#888'; g.fillRect(640, 0, 320, 900); g.fillStyle = '#33d'; g.fillRect(960, 0, 640, 900);
    g.fillStyle = '#fff'; g.font = 'bold 300px sans-serif'; g.textAlign = 'center'; g.fillText('L', 320, 560); g.fillText('C', 800, 560); g.fillText('R', 1280, 560);
    g.strokeStyle = '#000'; g.lineWidth = 6; for (let x = 0; x <= 1600; x += 200) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 900); g.stroke(); } for (let y = 0; y <= 900; y += 150) { g.beginPath(); g.moveTo(0, y); g.lineTo(1600, y); g.stroke(); }
    const blob = await new Promise((r) => c.toBlob(r)), rec = { id: 'bgt', name: 'test.png', blob }; T.S.myBgs.push(rec); await T.addBgClipForTest(rec);
  });
  if (chr) await page.evaluate(async (bytes) => {
    const T = window.__toon, m = await import('/src/admin-characters.js');
    const pkg = await m.readCharacterZip(new File([new Uint8Array(bytes)], 'd.zip')), def = await m.viewDef(pkg, pkg.manifest.views[0]);
    T.S.libDefs.set(def.id, def); T.S.speakers.push({ key: 'actor1', name: 'Dayan', narrator: false, color: '#fff', charId: def.id, flip: false, visible: true, manual: true }); T.S.order.push('actor1');
    await T.stage.loadCharacter(def); await T.applyLayers(); T.drawTimeline(); T.S.dirty = true;
  }, Array.from(readFileSync(ZIP)));
  await page.locator('.panel.open .sheet-close button').click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(800);
}
