// Minimal WebGL renderer for the DragonBones draw lists made by GLSlot.collect(). Works on the page and in a Web Worker (OffscreenCanvas).
// Pictures are premultiplied (ImageBitmap with premultiplyAlpha), so the blend is ONE / ONE_MINUS_SRC_ALPHA.

const VS = `attribute vec2 a_pos; attribute vec2 a_uv; attribute vec4 a_col; uniform vec4 u_cam; varying vec2 v_uv; varying vec4 v_col; varying vec2 v_pos;
void main(){ v_uv=a_uv; v_col=a_col; v_pos=a_pos; gl_Position=vec4((a_pos.x-u_cam.x)*u_cam.z-1.0, 1.0-(a_pos.y-u_cam.y)*u_cam.w, 0.0, 1.0); }`;
const FS = `precision mediump float; uniform sampler2D u_tex; uniform vec4 u_mask; uniform int u_maskMode; uniform int u_maskInvert; uniform vec2 u_poly[8]; uniform int u_polyCount; varying vec2 v_uv; varying vec4 v_col; varying vec2 v_pos;
bool crosses(vec2 a, vec2 b, vec2 q){ return ((a.y>q.y)!=(b.y>q.y))&&(q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y+0.00001)+a.x); }
void main(){ if(u_maskMode>0){ vec2 q=(v_pos-u_mask.xy)/(u_mask.zw-u_mask.xy); bool inside=all(greaterThanEqual(q,vec2(0.0)))&&all(lessThanEqual(q,vec2(1.0))); if(u_maskMode==2){ vec2 d=(q-0.5)*2.0; inside=inside&&dot(d,d)<=1.0; } if(u_maskMode==3){ inside=false; if(u_polyCount>0&&crosses(u_poly[0],u_poly[7],q))inside=!inside; if(u_polyCount>1&&crosses(u_poly[1],u_poly[0],q))inside=!inside; if(u_polyCount>2&&crosses(u_poly[2],u_poly[1],q))inside=!inside; if(u_polyCount>3&&crosses(u_poly[3],u_poly[2],q))inside=!inside; if(u_polyCount>4&&crosses(u_poly[4],u_poly[3],q))inside=!inside; if(u_polyCount>5&&crosses(u_poly[5],u_poly[4],q))inside=!inside; if(u_polyCount>6&&crosses(u_poly[6],u_poly[5],q))inside=!inside; if(u_polyCount>7&&crosses(u_poly[7],u_poly[6],q))inside=!inside; } if((u_maskInvert==0&&!inside)||(u_maskInvert==1&&inside)) discard; } gl_FragColor = texture2D(u_tex, v_uv) * v_col; }`;
const STRIDE = 8, MAXV = 32768;      // floats per vertex: x y u v r g b a

export class GLTex {
  constructor(r, source, mips) {
    const gl = r.gl; this.gl = gl; this.w = source.width; this.h = source.height; this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const uploadError = gl.getError();
    if (uploadError !== gl.NO_ERROR) { gl.deleteTexture(this.tex); throw new Error('Graphics memory available nahi hai. Preview quality kam karke dekhein.'); }
    const pot = (n) => (n & (n - 1)) === 0, ok = mips && (r.gl2 || (pot(this.w) && pot(this.h)));
    if (ok) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, ok ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  dispose() { try { this.gl.deleteTexture(this.tex); } catch { /* context lost */ } }
}

export class GLRenderer {
  constructor(canvas, opts = {}) {
    const attrs = { alpha: false, antialias: true, premultipliedAlpha: false, ...opts };
    this.gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
    const gl = this.gl; this.gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    this.prog = gl.createProgram(); gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.prog));
    this.loc = { pos: gl.getAttribLocation(this.prog, 'a_pos'), uv: gl.getAttribLocation(this.prog, 'a_uv'), col: gl.getAttribLocation(this.prog, 'a_col'), cam: gl.getUniformLocation(this.prog, 'u_cam'), tex: gl.getUniformLocation(this.prog, 'u_tex'), mask: gl.getUniformLocation(this.prog, 'u_mask'), maskMode: gl.getUniformLocation(this.prog, 'u_maskMode'), maskInvert: gl.getUniformLocation(this.prog, 'u_maskInvert'), poly: gl.getUniformLocation(this.prog,'u_poly[0]'), polyCount: gl.getUniformLocation(this.prog,'u_polyCount') };
    this.vbo = gl.createBuffer(); this.ibo = gl.createBuffer();
    this.v = new Float32Array(MAXV * STRIDE); this.i = new Uint16Array(MAXV * 3); this.nv = 0; this.ni = 0; this.cur = null; this.blend = -1;
    this.mips = true;
  }
  texture(source) { return new GLTex(this, source, this.mips); }

  /** camera: the canvas rectangle (x, y of its top-left corner, width, height; y down) that fills the screen */
  begin(W, H, cam) {
    const gl = this.gl; this.W = W; this.H = H;
    this.cam = [cam.x, cam.y, 2 / cam.w, 2 / cam.h];
    gl.viewport(0, 0, W, H); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND);
    gl.useProgram(this.prog); gl.uniform4fv(this.loc.cam, this.cam); gl.uniform1i(this.loc.tex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(this.loc.pos); gl.enableVertexAttribArray(this.loc.uv); gl.enableVertexAttribArray(this.loc.col);
    gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, STRIDE * 4, 0); gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, STRIDE * 4, 8); gl.vertexAttribPointer(this.loc.col, 4, gl.FLOAT, false, STRIDE * 4, 16);
    this.cur = null; this.blend = -1; this.nv = 0; this.ni = 0;
  }
  clear(r, g, b) { const gl = this.gl; gl.clearColor(r, g, b, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
  setMask(mask, W, H) {
    const gl = this.gl; this.flush();
    const enabled = mask?.enabled !== false && mask?.shape && Number.isFinite(mask.x) && Number.isFinite(mask.y) && Number.isFinite(mask.w) && Number.isFinite(mask.h) && mask.w > 0 && mask.h > 0;
    gl.uniform1i(this.loc.maskMode, !enabled ? 0 : mask.shape === 'ellipse' ? 2 : mask.shape === 'polygon' ? 3 : 1);
    gl.uniform1i(this.loc.maskInvert, mask?.invert ? 1 : 0);
    const points=(mask?.points||[]).slice(0,8), poly=new Float32Array(16); points.forEach((p,i)=>{poly[i*2]=p.x;poly[i*2+1]=p.y;});
    gl.uniform2fv(this.loc.poly,poly); gl.uniform1i(this.loc.polyCount,points.length);
    gl.uniform4f(this.loc.mask, enabled ? mask.x * W : 0, enabled ? mask.y * H : 0, enabled ? (mask.x + mask.w) * W : 1, enabled ? (mask.y + mask.h) * H : 1);
    this.cur = null; this.blend = -1;
  }
  setBlend(mode) {
    const gl = this.gl; if (mode === this.blend) return; this.blend = mode;
    switch (mode) {
      case 1: gl.blendFunc(gl.ONE, gl.ONE); break;                                 // add
      case 10: gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;          // multiply
      case 12: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;                // screen
      default: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }
  flush() {
    if (!this.ni) return;
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cur.tex);
    gl.bufferData(gl.ARRAY_BUFFER, this.v.subarray(0, this.nv * STRIDE), gl.STREAM_DRAW); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.i.subarray(0, this.ni), gl.STREAM_DRAW);
    gl.drawElements(gl.TRIANGLES, this.ni, gl.UNSIGNED_SHORT, 0); this.nv = 0; this.ni = 0;
  }
  /** adds one item of a draw list; m = [a, b, c, d, tx, ty] maps the armature's coordinates to canvas pixels */
  add(item, tex, m, alpha = 1) {
    const n = item.verts.length / 2, k = item.idx.length;
    if (this.cur !== tex || this.blend !== item.blend || this.nv + n > MAXV || this.ni + k > MAXV * 3) { this.flush(); this.cur = tex; this.setBlend(item.blend); }
    const a = item.alpha * alpha, v = this.v, base = this.nv, [ma, mb, mc, md, tx, ty] = m;
    for (let j = 0, o = base * STRIDE; j < n; j++, o += STRIDE) {
      const x = item.verts[j * 2], y = item.verts[j * 2 + 1];
      v[o] = ma * x + mc * y + tx; v[o + 1] = mb * x + md * y + ty; v[o + 2] = item.uvs[j * 2]; v[o + 3] = item.uvs[j * 2 + 1];
      v[o + 4] = item.r * a; v[o + 5] = item.g * a; v[o + 6] = item.b * a; v[o + 7] = a;
    }
    for (let j = 0; j < k; j++) this.i[this.ni + j] = base + item.idx[j];
    this.nv += n; this.ni += k;
  }
  /** a flat picture covering the canvas (background) */
  quad(tex, x, y, w, h) {
    this.add({ verts: new Float32Array([x, y, x + w, y, x + w, y + h, x, y + h]), uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), idx: new Uint16Array([0, 1, 2, 0, 2, 3]), alpha: 1, r: 1, g: 1, b: 1, blend: 0 }, tex, [1, 0, 0, 1, 0, 0]);
  }
  end() { this.flush(); }
}

