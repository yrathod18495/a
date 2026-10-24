// DragonBones platform layer for 12toons: no scene graph, just plain display objects that the WebGL renderer (src/db/renderer.js) draws.
// Nothing in here touches WebGL or the DOM, so the same code runs in the browser, in workers and in Node (tests).
import dragonBones from './dragonBones.js';

const { BaseObject, Slot, Armature, BaseFactory, TextureAtlasData, TextureData, DragonBones } = dragonBones;

export class GLTextureData extends TextureData {
  static toString() { return '[class GLTextureData]'; }
}
export class GLTextureAtlasData extends TextureAtlasData {
  static toString() { return '[class GLTextureAtlasData]'; }
  _onClear() { super._onClear(); this.renderTexture = null; }
  createTexture() { return BaseObject.borrowObject(GLTextureData); }
}

/** the armature "display": only the event proxy DragonBones needs */
export class GLArmatureDisplay {
  constructor() { this._armature = null; }
  dbInit(armature) { this._armature = armature; }
  dbClear() { this._armature = null; }
  dbUpdate() {}
  dispose() { if (this._armature) { this._armature.dispose(); this._armature = null; } }
  dispatchDBEvent() {}
  hasDBEventListener() { return false; }
  addDBEventListener() {}
  removeDBEventListener() {}
  get armature() { return this._armature; }
  get animation() { return this._armature.animation; }
}

const newDisplay = (type) => ({ type, visible: false, alpha: 1, r: 1, g: 1, b: 1, blend: 0, tex: null, verts: null, uvs: null, idx: null, identity: false });

export class GLSlot extends Slot {
  static toString() { return '[class GLSlot]'; }
  _onClear() { super._onClear(); this._renderDisplay = null; }
  _initDisplay() {}
  _disposeDisplay() {}
  _onUpdateDisplay() { this._renderDisplay = this._display ? this._display : this._rawDisplay; }
  _addDisplay() {}
  _replaceDisplay() {}
  _removeDisplay() {}
  _updateZOrder() {}
  _updateVisible() { this._renderDisplay.visible = this._parent.visible && this._visible; }
  _updateBlendMode() { this._renderDisplay.blend = this._blendMode; }
  _updateColor() {
    const c = this._colorTransform, d = this._renderDisplay;
    d.alpha = c.alphaMultiplier * this._globalAlpha; d.r = c.redMultiplier; d.g = c.greenMultiplier; d.b = c.blueMultiplier;
  }
  _updateFrame() {
    const td = this._textureData, d = this._renderDisplay;
    if (this._displayIndex >= 0 && this._display !== null && td !== null) {
      d.tex = td;
      if (this._geometryData !== null) {                       // mesh
        const data = this._geometryData.data, ints = data.intArray, floats = data.floatArray, o = this._geometryData.offset;
        const vc = ints[o + 0], tc = ints[o + 1]; let vo = ints[o + 2]; if (vo < 0) vo += 65536;
        const uo = vo + vc * 2, scale = this._armature._armatureData.scale;
        const a = td.parent, r = td.region, uvs = new Float32Array(vc * 2), idx = new Uint16Array(tc * 3);
        for (let i = 0; i < tc * 3; i++) idx[i] = ints[o + 4 + i];
        for (let i = 0; i < vc * 2; i += 2) { const u = floats[uo + i], v = floats[uo + i + 1]; uvs[i] = (r.x + u * r.width) / a.width; uvs[i + 1] = (r.y + v * r.height) / a.height; }
        d.verts = new Float32Array(vc * 2); d.uvs = uvs; d.idx = idx;
        for (let i = 0; i < vc * 2; i++) d.verts[i] = floats[vo + i] * scale;
        d.identity = this._geometryData.weight !== null;
      } else d.identity = false;
      this._visibleDirty = true;
      return;
    }
    d.tex = null; d.visible = false;
  }
  _updateMesh() {
    const scale = this._armature._armatureData.scale, deform = this._displayFrame.deformVertices, bones = this._geometryBones;
    const g = this._geometryData, weight = g.weight, hasDeform = deform.length > 0 && g.inheritDeform, out = this._renderDisplay.verts;
    const data = g.data, ints = data.intArray, floats = data.floatArray, vc = ints[g.offset + 0];
    if (weight !== null) {
      let wo = ints[weight.offset + 1]; if (wo < 0) wo += 65536;
      for (let i = 0, iD = 0, iB = weight.offset + 2 + bones.length, iV = wo, iF = 0; i < vc; i++) {
        const bc = ints[iB++]; let xG = 0, yG = 0;
        for (let j = 0; j < bc; j++) {
          const bone = bones[ints[iB++]];
          if (bone !== null) {
            const m = bone.globalTransformMatrix, w = floats[iV++]; let xL = floats[iV++] * scale, yL = floats[iV++] * scale;
            if (hasDeform) { xL += deform[iF++]; yL += deform[iF++]; }
            xG += (m.a * xL + m.c * yL + m.tx) * w; yG += (m.b * xL + m.d * yL + m.ty) * w;
          }
        }
        out[iD++] = xG; out[iD++] = yG;
      }
    } else {
      let vo = ints[g.offset + 2]; if (vo < 0) vo += 65536;
      for (let i = 0; i < vc * 2; i += 2) {
        let x = floats[vo + i] * scale, y = floats[vo + i + 1] * scale;
        if (hasDeform) { x += deform[i]; y += deform[i + 1]; }
        out[i] = x; out[i + 1] = y;
      }
    }
  }
  _updateTransform() { this.updateGlobalTransform(); }
  _identityTransform() { this._renderDisplay.identity = true; }

  /** appends this slot's triangles (world positions) to the draw list; returns false when nothing is drawn */
  collect(list) {
    const d = this._renderDisplay;
    if (!d || !d.visible || !d.tex || d.alpha <= 0.001) return false;
    const td = d.tex, a = td.parent, r = td.region, m = this.globalTransformMatrix, px = this._pivotX, py = this._pivotY;
    let verts, uvs, idx;
    if (this._geometryData !== null) {
      uvs = d.uvs; idx = d.idx; const src = d.verts, n = src.length; verts = new Float32Array(n);
      if (d.identity) verts.set(src);
      else for (let i = 0; i < n; i += 2) { const x = src[i] - px, y = src[i + 1] - py; verts[i] = m.a * x + m.c * y + m.tx; verts[i + 1] = m.b * x + m.d * y + m.ty; }
    } else {
      const w = r.width, h = r.height, x0 = -px, y0 = -py, x1 = w - px, y1 = h - py;
      verts = new Float32Array([m.a * x0 + m.c * y0 + m.tx, m.b * x0 + m.d * y0 + m.ty, m.a * x1 + m.c * y0 + m.tx, m.b * x1 + m.d * y0 + m.ty,
        m.a * x1 + m.c * y1 + m.tx, m.b * x1 + m.d * y1 + m.ty, m.a * x0 + m.c * y1 + m.tx, m.b * x0 + m.d * y1 + m.ty]);
      const u0 = r.x / a.width, v0 = r.y / a.height, u1 = (r.x + w) / a.width, v1 = (r.y + h) / a.height;
      uvs = new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]); idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
    }
    list.push({ atlas: a, verts, uvs, idx, alpha: d.alpha, r: d.r, g: d.g, b: d.b, blend: d.blend, slot: this.name });
    return true;
  }
}

export class GLFactory extends BaseFactory {
  constructor() {
    super(null);
    this._dragonBones = new DragonBones(new GLArmatureDisplay());
  }
  _buildTextureAtlasData(atlasData, texture) {
    if (atlasData) atlasData.renderTexture = texture; else atlasData = BaseObject.borrowObject(GLTextureAtlasData);
    return atlasData;
  }
  _buildArmature(pkg) {
    const armature = BaseObject.borrowObject(Armature), display = new GLArmatureDisplay();
    armature.init(pkg.armature, display, display, this._dragonBones);
    return armature;
  }
  _buildSlot(_pkg, slotData, armature) {
    const slot = BaseObject.borrowObject(GLSlot);
    slot.init(slotData, armature, newDisplay('image'), newDisplay('mesh'));
    return slot;
  }
}

export { dragonBones };
