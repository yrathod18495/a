import { test, expect } from '@playwright/test';
// An old graphics error (a picture drawn after it was thrown away) must never be reported as "The picture could not be sent to the graphics (code 1282)" for the next picture,
// and a picture that was thrown away is not drawn at all.
test('a stale graphics error does not fail the next upload, and a disposed picture is skipped', async ({ page }) => {
  await page.goto('/?debug#/');
  const r = await page.evaluate(async () => {
    const { GLRenderer, GLTex } = await import('/src/db/renderer.js');
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const rend = new GLRenderer(cv), gl = rend.gl;
    const pic = document.createElement('canvas'); pic.width = pic.height = 32; pic.getContext('2d').fillRect(0, 0, 32, 32);
    const dead = new GLTex(rend, pic, false); dead.dispose();
    gl.bindTexture(gl.TEXTURE_2D, dead.tex);                         // the mistake: using a deleted texture leaves INVALID_OPERATION in the queue
    const stale = gl.getError(); gl.bindTexture(gl.TEXTURE_2D, dead.tex);   // put it back after reading it
    let err = null, ok = null; try { ok = new GLTex(rend, pic, false); } catch (e) { err = e.message; }
    // a draw list item whose texture is gone is skipped without raising anything
    rend.begin(64, 64, { x: 0, y: 0, w: 64, h: 64 }); rend.add({ verts: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]), uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), idx: new Uint16Array([0, 1, 2, 0, 2, 3]), alpha: 1, r: 1, g: 1, b: 1, blend: 0 }, dead, [1, 0, 0, 1, 0, 0]); rend.flush();
    return { stale, err, uploaded: !!ok, after: gl.getError() };
  });
  expect(r.stale).toBe(1282);
  expect(r.err).toBeNull(); expect(r.uploaded).toBe(true);
  expect(r.after).toBe(0);
});
