// Minimal WebGL renderer for the DragonBones draw lists made by GLSlot.collect(). Works on the page and in a Web Worker (OffscreenCanvas).
// Pictures are premultiplied (ImageBitmap with premultiplyAlpha), so the blend is ONE / ONE_MINUS_SRC_ALPHA.

const VS = `attribute vec2 a_pos; attribute vec2 a_uv; attribute vec4 a_col; uniform vec4 u_cam; varying vec2 v_uv; varying vec4 v_col; varying vec2 v_pos;
void main(){ v_uv=a_uv; v_col=a_col; v_pos=a_pos; gl_Position=vec4((a_pos.x-u_cam.x)*u_cam.z-1.0, 1.0-(a_pos.y-u_cam.y)*u_cam.w, 0.0, 1.0); }`;
const FS = `precision mediump float; uniform sampler2D u_tex; uniform vec4 u_mask; uniform int u_maskMode; uniform int u_maskInvert; uniform vec2 u_poly[8]; uniform int u_polyCount; varying vec2 v_uv; varying vec4 v_col; varying vec2 v_pos;
bool crosses(vec2 a, vec2 b, vec2 q){ return ((a.y>q.y)!=(b.y>q.y))&&(q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y+0.00001)+a.x); }
void main(){ if(u_maskMode>0){ vec2 q=(v_pos-u_mask.xy)/(u_mask.zw-u_mask.xy); bool inside=all(greaterThanEqual(q,vec2(0.0)))&&all(lessThanEqual(q,vec2(1.0))); if(u_maskMode==2){ vec2 d=(q-0.5)*2.0; inside=inside&&dot(d,d)<=1.0; } if(u_maskMode==3){ inside=false; if(u_polyCount>0&&crosses(u_poly[0],u_poly[7],q))inside=!inside; if(u_polyCount>1&&crosses(u_poly[1],u_poly[0],q))inside=!inside; if(u_polyCount>2&&crosses(u_poly[2],u_poly[1],q))inside=!inside; if(u_polyCount>3&&crosses(u_poly[3],u_poly[2],q))inside=!inside; if(u_polyCount>4&&crosses(u_poly[4],u_poly[3],q))inside=!inside; if(u_polyCount>5&&crosses(u_poly[5],u_poly[4],q))inside=!inside; if(u_polyCount>6&&crosses(u_poly[6],u_poly[5],q))inside=!inside; if(u_polyCount>7&&crosses(u_poly[7],u_poly[6],q))inside=!inside; } if((u_maskInvert==0&&!inside)||(u_maskInvert==1&&inside)) discard; } gl_FragColor = texture2D(u_tex, v_uv) * v_col; }`;
import { cleanGrade, gradeActive, hexToRgb } from '../../shared/color-grade.js';

// Colour grading: the scene is drawn into a texture first, then one full-screen pass applies the grade (same maths for the preview and the export).
const GVS = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }`;
const GFS = `precision highp float; uniform sampler2D u_scene; uniform vec2 u_res; uniform float u_seed; varying vec2 v_uv;
uniform float u_bright,u_contrast,u_sat,u_vib,u_exp,u_gamma,u_hue,u_temp,u_tintAmt,u_shadows,u_highlights,u_fade,u_sharp,u_vig,u_grain; uniform vec3 u_tint;
float luma(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }
void main(){
  vec2 px=1.0/u_res; vec3 c=texture2D(u_scene,v_uv).rgb;
  if(u_sharp>0.0){ vec3 n=texture2D(u_scene,v_uv+vec2(px.x,0.0)).rgb+texture2D(u_scene,v_uv-vec2(px.x,0.0)).rgb+texture2D(u_scene,v_uv+vec2(0.0,px.y)).rgb+texture2D(u_scene,v_uv-vec2(0.0,px.y)).rgb; c+=u_sharp*(c*4.0-n)*0.5; }
  c*=u_bright*exp2(u_exp);
  c.r+=u_temp*0.0012; c.b-=u_temp*0.0012; c.g+=u_temp*0.0003;
  c=mix(c,c*u_tint,u_tintAmt);
  float l=luma(c);
  c+=u_shadows*(1.0-smoothstep(0.0,0.5,l))*0.3; c+=u_highlights*smoothstep(0.5,1.0,l)*0.3;
  c=(c-0.5)*(1.0+u_contrast)+0.5;
  float a=radians(u_hue), ca=cos(a), sa=sin(a);
  mat3 rot=mat3(0.299+0.701*ca+0.168*sa,0.587-0.587*ca+0.330*sa,0.114-0.114*ca-0.497*sa, 0.299-0.299*ca-0.328*sa,0.587+0.413*ca+0.035*sa,0.114-0.114*ca+0.292*sa, 0.299-0.300*ca+1.250*sa,0.587-0.588*ca-1.050*sa,0.114+0.886*ca-0.203*sa);
  c=rot*c;
  l=luma(c); c=mix(vec3(l),c,u_sat);
  float sat=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b)); c=mix(vec3(luma(c)),c,1.0+u_vib*(1.0-sat));
  c=pow(max(c,vec3(0.0)),vec3(1.0/u_gamma));
  c=c*(1.0-u_fade)+vec3(u_fade*0.22);
  float d=distance(v_uv,vec2(0.5))*1.4142; c*=1.0-u_vig*smoothstep(0.3,1.0,d);
  float g=fract(sin(dot(v_uv*u_res+u_seed,vec2(12.9898,78.233)))*43758.5453); c+=(g-0.5)*u_grain*0.25;
  gl_FragColor=vec4(clamp(c,0.0,1.0),1.0);
}`;
const STRIDE = 8, MAXV = 32768;      // floats per vertex: x y u v r g b a

export class GLTex {
  constructor(r, source, mips) {
    const gl = r.gl; this.gl = gl; this.w = source.width; this.h = source.height; this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const uploadError = gl.getError();
    if (uploadError !== gl.NO_ERROR) { gl.deleteTexture(this.tex); throw new Error('Graphics memory is not available. Try lowering the preview quality.'); }
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
    this.mips = true; this.grade = null; this.scene = null;
  }
  /** call before clear(): scenes with an active grade are drawn into a texture, others straight to the screen */
  target(grade, W, H) {
    const gl = this.gl; this.grade = gradeActive(grade) ? cleanGrade(grade) : null;
    if (!this.grade) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
    const sc = this.scene;
    if (!sc || sc.W !== W || sc.H !== H) { this.disposeScene(); this.scene = this.makeScene(W, H); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.ms ?? this.scene.fbo);
  }
  makeScene(W, H) {
    const gl = this.gl, tex = gl.createTexture(), fbo = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const scene = { W, H, tex, fbo, ms: null, rb: null };
    if (this.gl2) {                                           // smooth edges: draw into a multisampled buffer, then resolve into the texture
      scene.rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, scene.rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Math.min(4, gl.getParameter(gl.MAX_SAMPLES)), gl.RGBA8, W, H);
      scene.ms = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, scene.ms); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, scene.rb);
    }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { scene.ms = null; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); }
    return scene;
  }
  disposeScene() {
    const gl = this.gl, sc = this.scene; if (!sc) return;
    try { gl.deleteTexture(sc.tex); gl.deleteFramebuffer(sc.fbo); if (sc.ms) gl.deleteFramebuffer(sc.ms); if (sc.rb) gl.deleteRenderbuffer(sc.rb); } catch { /* context lost */ }
    this.scene = null;
  }
  /** the full-screen pass that applies the grade to the finished scene texture */
  gradePass(seed) {
    const gl = this.gl, sc = this.scene, g = this.grade;
    if (sc.ms) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sc.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sc.fbo); gl.blitFramebuffer(0, 0, sc.W, sc.H, 0, 0, sc.W, sc.H, gl.COLOR_BUFFER_BIT, gl.NEAREST); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!this.gp) {
      const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
      const prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, GVS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, GFS)); gl.bindAttribLocation(prog, 0, 'a_pos'); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      const names = ['u_scene', 'u_res', 'u_seed', 'u_bright', 'u_contrast', 'u_sat', 'u_vib', 'u_exp', 'u_gamma', 'u_hue', 'u_temp', 'u_tintAmt', 'u_shadows', 'u_highlights', 'u_fade', 'u_sharp', 'u_vig', 'u_grain', 'u_tint'];
      this.gp = { prog, u: Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)])), buf: gl.createBuffer() };
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gp.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    }
    const { prog, u, buf } = this.gp;
    gl.viewport(0, 0, sc.W, sc.H); gl.disable(gl.BLEND);
    for (const loc of [this.loc.pos, this.loc.uv, this.loc.col]) gl.disableVertexAttribArray(loc);
    gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sc.tex); gl.uniform1i(u.u_scene, 0);
    gl.uniform2f(u.u_res, sc.W, sc.H); gl.uniform1f(u.u_seed, seed % 97);
    const f = (n, v) => gl.uniform1f(u[n], v);
    f('u_bright', g.brightness); f('u_contrast', g.contrast); f('u_sat', g.saturation); f('u_vib', g.vibrance); f('u_exp', g.exposure); f('u_gamma', g.gamma); f('u_hue', g.hue);
    f('u_temp', g.temperature); f('u_tintAmt', g.tintAmount); f('u_shadows', g.shadows); f('u_highlights', g.highlights); f('u_fade', g.fade); f('u_sharp', g.sharpen); f('u_vig', g.vignette); f('u_grain', g.grain);
    gl.uniform3fv(u.u_tint, hexToRgb(g.tint));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(0); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.enable(gl.BLEND);
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
  end(seed = 0) { this.flush(); if (this.grade && this.scene) this.gradePass(seed); }
}

