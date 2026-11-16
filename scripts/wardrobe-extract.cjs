// OFFLINE conversion helper. Opens a wardrobe page in a headless browser, selects one named character and reads out what the page
// really draws for it (the rig after the page's own set-up, the final pictures, the draw order). scripts/chudail-shim.py turns that
// into the older page format for scripts/character-zip.mjs.
//   node scripts/wardrobe-extract.cjs <character id> <page.html> <out.json>
const { chromium } = require('playwright');
const fs = require('fs');
const cid = process.argv[2] || 'dayan', page = process.argv[3] || '/tmp/hfdata/maya.html', outFile = process.argv[4] || `/tmp/hfdata/${cid}-runtime.json`;
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}); const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + require('path').resolve(page), { waitUntil: 'load', timeout: 240000 });
  await p.waitForTimeout(6000);
  await p.evaluate(async (cid) => { const s = document.querySelector('#character'); s.value = cid; s.dispatchEvent(new Event('change')); }, cid);
  await p.waitForTimeout(9000);
  const data = await p.evaluate(() => {
    const sk = SK.f34, P = sk.P, rc = RC.f34;
    let order = null; try { order = indianHairOrder(sk, sareeDrawOrder(sk, correctedEarOrder(sk))); } catch (e) { order = 'ERR ' + e; }
    const used = new Set(); for (const atts of Object.values(P.att)) for (const a of Object.values(atts)) used.add(a.p);
    const imgs = {};
    for (const path of used) { const c = rc[path]; if (!c) { imgs[path] = null; continue; } const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); imgs[path] = cv.toDataURL('image/png'); }
    const strip = (v) => JSON.parse(JSON.stringify(v));
    return { P: strip({ bones: P.bones, slots: P.slots, att: P.att, reg: P.reg, id: P.id, label: P.label }), order: order, setup: strip(sk.setup), bi: sk.bi, imgs, sizes: Object.fromEntries(Object.entries(imgs).map(([k, v]) => [k, v ? 1 : 0])) };
  });
  fs.writeFileSync(outFile, JSON.stringify(data));
  console.log('order', Array.isArray(data.order) ? data.order.length : data.order, 'paths', Object.keys(data.imgs).length, 'null imgs', Object.entries(data.imgs).filter(([k, v]) => !v).map(([k]) => k));
  await b.close();
})();
