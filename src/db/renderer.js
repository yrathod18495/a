// Minimal WebGL renderer for the DragonBones draw lists made by GLSlot.collect(). Works on the page and in a Web Worker (OffscreenCanvas).
// Pictures are premultiplied (ImageBitmap with premultiplyAlpha), so the blend is ONE / ONE_MINUS_SRC_ALPHA.

const VS = `attribute vec2 a_pos; attribute vec2 a_uv; attribute vec4 a_col; uniform vec4 u_cam; varying vec2 v_uv; varying vec4 v_col; varying vec2 v_pos;
void main(){ v_uv=a_uv; v_col=a_col; v_pos=a_pos; gl_Position=vec4((a_pos.x-u_cam.x)*u_cam.z-1.0, 1.0-(a_pos.y-u_cam.y)*u_cam.w, 0.0, 1.0); }`;
const FS = `precision mediump float; uniform sampler2D u_tex; uniform vec4 u_mask; uniform int u_maskMode; uniform int u_maskInvert; uniform vec2 u_poly[8]; uniform int u_polyCount; varying vec2 v_uv; varying vec4 v_col; varying vec2 v_pos;
bool crosses(vec2 a, vec2 b, vec2 q){ return ((a.y>q.y)!=(b.y>q.y))&&(q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y+0.00001)+a.x); }
void main(){ if(u_maskMode>0){ vec2 q=(v_pos-u_mask.xy)/(u_mask.zw-u_mask.xy); bool inside=all(greaterThanEqual(q,vec2(0.0)))&&all(lessThanEqual(q,vec2(1.0))); if(u_maskMode==2){ vec2 d=(q-0.5)*2.0; inside=inside&&dot(d,d)<=1.0; } if(u_maskMode==3){ inside=false; if(u_polyCount>0&&crosses(u_poly[0],u_poly[7],q))inside=!inside; if(u_polyCount>1&&crosses(u_poly[1],u_poly[0],q))inside=!inside; if(u_polyCount>2&&crosses(u_poly[2],u_poly[1],q))inside=!inside; if(u_polyCount>3&&crosses(u_poly[3],u_poly[2],q))inside=!inside; if(u_polyCount>4&&crosses(u_poly[4],u_poly[3],q))inside=!inside; if(u_polyCount>5&&crosses(u_poly[5],u_poly[4],q))inside=!inside; if(u_polyCount>6&&crosses(u_poly[6],u_poly[5],q))inside=!inside; if(u_polyCount>7&&crosses(u_poly[7],u_poly[6],q))inside=!inside; } if((u_maskInvert==0&&!inside)||(u_maskInvert==1&&inside)) discard; } gl_FragColor = texture2D(u_tex, v_uv) * v_col; }`;
import { cleanFx, fxActive, hexToRgb } from '../../shared/fx.js';

// Colour grading and effects: the scene (or one picture) is drawn into a texture first, then one full-screen pass applies the numbers (same maths for the preview, the thumbnails and the export).
// The picture is premultiplied: a picture with see-through parts (a character, a prop) keeps its edges, the whole scene is opaque.
const GVS = `attribute vec2 a_pos; uniform float u_flipY; varying vec2 v_uv; void main(){ v_uv=a_pos*0.5+0.5; if(u_flipY>0.5) v_uv.y=1.0-v_uv.y; gl_Position=vec4(a_pos,0.0,1.0); }`;
const GFS = `precision highp float; uniform sampler2D u_scene; uniform vec2 u_res; uniform float u_seed; uniform int u_item; varying vec2 v_uv;
uniform float u_bright,u_contrast,u_sat,u_vib,u_exp,u_gamma,u_hue,u_temp,u_tintAmt,u_shadows,u_highlights,u_fade,u_sharp,u_vig,u_grain; uniform vec3 u_tint;
uniform float u_opacity,u_blur,u_glow,u_ghost,u_ghostShift,u_pixel,u_split;
float luma(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }
vec2 snapUv(vec2 uv){ if(u_pixel<=0.0) return uv; float b=1.0+u_pixel*u_res.y*0.04; return (floor(uv*u_res/b)+0.5)*b/u_res; }
vec4 tap(vec2 uv){ return texture2D(u_scene,clamp(snapUv(uv),vec2(0.0),vec2(1.0))); }
vec4 soft(vec2 uv,float rad){
  if(rad<0.5) return tap(uv);
  vec2 px=rad/u_res; vec4 s=tap(uv)*2.0;
  for(int i=0;i<6;i++){ float a=float(i)*1.0471976; vec2 d=vec2(cos(a),sin(a)); s+=tap(uv+d*px)+tap(uv+d*px*0.5); }
  return s/14.0;
}
vec4 look(vec2 uv){
  float rad=u_blur*0.03*u_res.y;
  if(u_split>0.0){ vec2 d=vec2(u_split*0.014,0.0); vec4 a=soft(uv+d,rad), b=soft(uv,rad), c=soft(uv-d,rad); return vec4(a.r,b.g,c.b,max(a.a,max(b.a,c.a))); }
  return soft(uv,rad);
}
void main(){
  vec2 px=1.0/u_res; vec4 p=look(v_uv);
  if(u_ghost>0.0){
    vec4 g1=look(v_uv-vec2(u_ghostShift*0.08,0.0)), g2=look(v_uv-vec2(u_ghostShift*0.16,0.0));
    if(u_item==1){ p+=(g1*0.7+g2*0.4)*(1.0-p.a)*u_ghost*0.8; } else { p=mix(p,max(p,g1*0.85),u_ghost*0.6); p=mix(p,max(p,g2*0.7),u_ghost*0.35); }
  }
  if(u_glow>0.0){
    float R=u_glow*0.05*u_res.y+2.0; vec4 gl=vec4(0.0);
    for(int i=0;i<12;i++){ float a=float(i)*0.5235988; vec2 d=vec2(cos(a),sin(a)); gl+=tap(v_uv+d*R*px)+tap(v_uv+d*R*0.5*px); }
    gl/=24.0; p.rgb+=gl.rgb*u_glow*1.1; p.a=min(1.0,p.a+gl.a*u_glow*0.8);
  }
  float al=(u_item==1)?p.a:1.0;
  vec3 c=al>0.001?p.rgb/al:vec3(0.0);
  if(u_sharp>0.0&&u_item==0){ vec3 n=texture2D(u_scene,v_uv+vec2(px.x,0.0)).rgb+texture2D(u_scene,v_uv-vec2(px.x,0.0)).rgb+texture2D(u_scene,v_uv+vec2(0.0,px.y)).rgb+texture2D(u_scene,v_uv-vec2(0.0,px.y)).rgb; c+=u_sharp*(c*4.0-n)*0.5; }
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
  c=clamp(c,0.0,1.0);
  if(u_item==1){ float ao=al*u_opacity; gl_FragColor=vec4(c*ao,ao); } else gl_FragColor=vec4(c,1.0);
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
    const gl = this.gl; this.grade = fxActive(grade) ? cleanFx(grade) : null;
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
    const gl = this.gl, sc = this.scene;
    if (sc.ms) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sc.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sc.fbo); gl.blitFramebuffer(0, 0, sc.W, sc.H, 0, 0, sc.W, sc.H, gl.COLOR_BUFFER_BIT, gl.NEAREST); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fxPass(sc.tex, this.grade, sc.W, sc.H, seed, false, false);
  }
  /** one full-screen pass with the effect numbers `g`: reads `tex`, draws into the framebuffer that is bound now. item = the picture has see-through parts (drawn over what is there) */
  fxPass(tex, g, W, H, seed, item, flipY) {
    const gl = this.gl;
    if (!this.gp) {
      const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
      const prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, GVS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, GFS)); gl.bindAttribLocation(prog, 0, 'a_pos'); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      const names = ['u_scene', 'u_res', 'u_seed', 'u_item', 'u_flipY', 'u_bright', 'u_contrast', 'u_sat', 'u_vib', 'u_exp', 'u_gamma', 'u_hue', 'u_temp', 'u_tintAmt', 'u_shadows', 'u_highlights', 'u_fade', 'u_sharp', 'u_vig', 'u_grain', 'u_tint',
        'u_opacity', 'u_blur', 'u_glow', 'u_ghost', 'u_ghostShift', 'u_pixel', 'u_split'];
      this.gp = { prog, u: Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)])), buf: gl.createBuffer() };
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gp.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    }
    const { prog, u, buf } = this.gp, p = cleanFx(g);
    gl.viewport(0, 0, W, H);
    if (item) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
    for (const loc of [this.loc.pos, this.loc.uv, this.loc.col]) gl.disableVertexAttribArray(loc);
    gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.u_scene, 0);
    gl.uniform2f(u.u_res, W, H); gl.uniform1f(u.u_seed, seed % 97); gl.uniform1i(u.u_item, item ? 1 : 0); gl.uniform1f(u.u_flipY, flipY ? 1 : 0);
    const f = (n, v) => gl.uniform1f(u[n], v);
    f('u_bright', p.brightness); f('u_contrast', p.contrast); f('u_sat', p.saturation); f('u_vib', p.vibrance); f('u_exp', p.exposure); f('u_gamma', p.gamma); f('u_hue', p.hue);
    f('u_temp', p.temperature); f('u_tintAmt', p.tintAmount); f('u_shadows', p.shadows); f('u_highlights', p.highlights); f('u_fade', p.fade); f('u_sharp', p.sharpen); f('u_vig', p.vignette); f('u_grain', p.grain);
    f('u_opacity', p.opacity); f('u_blur', p.blur); f('u_glow', p.glow); f('u_ghost', p.ghost); f('u_ghostShift', p.ghostShift); f('u_pixel', p.pixelate); f('u_split', p.split);
    gl.uniform3fv(u.u_tint, hexToRgb(p.tint));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(0); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.enable(gl.BLEND);
  }
  /** start drawing one picture on its own (a character, a prop, the background) so that an effect can be put on just that picture; everything drawn until itemEnd() goes into it */
  itemBegin(W, H) {
    const gl = this.gl; this.flush();
    if (!this.itemBuf || this.itemBuf.W !== W || this.itemBuf.H !== H) { this.disposeItem(); this.itemBuf = this.makeScene(W, H); }
    const ib = this.itemBuf; this.itemPrev = this.grade && this.scene ? (this.scene.ms ?? this.scene.fbo) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, ib.ms ?? ib.fbo); gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  /** finish that picture: the effect numbers `g` are applied and it is laid over what was drawn before */
  itemEnd(g, seed = 0) {
    const gl = this.gl, ib = this.itemBuf; this.flush();
    if (ib.ms) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ib.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, ib.fbo); gl.blitFramebuffer(0, 0, ib.W, ib.H, 0, 0, ib.W, ib.H, gl.COLOR_BUFFER_BIT, gl.NEAREST); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.itemPrev);
    this.fxPass(ib.tex, g, ib.W, ib.H, seed, true, false);
    this.rebind();
  }
  /** put the sprite program and its buffers back after a full-screen pass in the middle of the frame */
  rebind() {
    const gl = this.gl;
    gl.viewport(0, 0, this.W, this.H); gl.enable(gl.BLEND);
    gl.useProgram(this.prog); gl.uniform4fv(this.loc.cam, this.cam); gl.uniform1i(this.loc.tex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(this.loc.pos); gl.enableVertexAttribArray(this.loc.uv); gl.enableVertexAttribArray(this.loc.col);
    gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, STRIDE * 4, 0); gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, STRIDE * 4, 8); gl.vertexAttribPointer(this.loc.col, 4, gl.FLOAT, false, STRIDE * 4, 16);
    this.cur = null; this.blend = -1;
  }
  disposeItem() {
    const gl = this.gl, sc = this.itemBuf; if (!sc) return;
    try { gl.deleteTexture(sc.tex); gl.deleteFramebuffer(sc.fbo); if (sc.ms) gl.deleteFramebuffer(sc.ms); if (sc.rb) gl.deleteRenderbuffer(sc.rb); } catch { /* context lost */ }
    this.itemBuf = null;
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
  add(item, tex, m, alpha = 1, black = false) {          // black: draw it as a flat black silhouette (a shadow)
    const n = item.verts.length / 2, k = item.idx.length;
    if (this.cur !== tex || this.blend !== item.blend || this.nv + n > MAXV || this.ni + k > MAXV * 3) { this.flush(); this.cur = tex; this.setBlend(item.blend); }
    const a = item.alpha * alpha, v = this.v, base = this.nv, [ma, mb, mc, md, tx, ty] = m;
    for (let j = 0, o = base * STRIDE; j < n; j++, o += STRIDE) {
      const x = item.verts[j * 2], y = item.verts[j * 2 + 1];
      v[o] = ma * x + mc * y + tx; v[o + 1] = mb * x + md * y + ty; v[o + 2] = item.uvs[j * 2]; v[o + 3] = item.uvs[j * 2 + 1];
      v[o + 4] = black ? 0 : item.r * a; v[o + 5] = black ? 0 : item.g * a; v[o + 6] = black ? 0 : item.b * a; v[o + 7] = a;
    }
    for (let j = 0; j < k; j++) this.i[this.ni + j] = base + item.idx[j];
    this.nv += n; this.ni += k;
  }
  /** a flat picture covering the canvas (background) */
  quad(tex, x, y, w, h, shade = 1) {          // shade: one brightness, or a [r, g, b] tint
    const [r, g, b] = Array.isArray(shade) ? shade : [shade, shade, shade];
    this.add({ verts: new Float32Array([x, y, x + w, y, x + w, y + h, x, y + h]), uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), idx: new Uint16Array([0, 1, 2, 0, 2, 3]), alpha: 1, r, g, b, blend: 0 }, tex, [1, 0, 0, 1, 0, 0]);
  }
  end(seed = 0) { this.flush(); if (this.grade && this.scene) this.gradePass(seed); }
}


let thumbGL = null;
/** a small picture of `source` (a canvas) with the effect numbers `g` put on it: the Effects tab previews. It uses the very same pass as the stage, so the preview looks like the result. */
export function fxThumb(source, g, w, h, seed = 3) {
  if (!thumbGL) { const canvas = document.createElement('canvas'); thumbGL = { canvas, r: new GLRenderer(canvas, { preserveDrawingBuffer: true, antialias: false }) }; }
  const { canvas, r } = thumbGL;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const gl = r.gl, tex = new GLTex(r, source, false);
  try { gl.bindFramebuffer(gl.FRAMEBUFFER, null); r.fxPass(tex.tex, g, w, h, seed, false, true); } finally { tex.dispose(); }
  const out = document.createElement('canvas'); out.width = w; out.height = h; out.getContext('2d').drawImage(canvas, 0, 0);
  return out;
}
