const hex = bytes => [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
const typed = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, DataView };
export async function packRecords(records, upload) {
  const assets = new Map();
  async function walk(v) {
    if (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
      const blob = v instanceof Blob ? v : new Blob([v]);
      const key = 'assets/' + hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
      if (!assets.has(key)) { await upload(key, blob); assets.set(key, { key, size: blob.size }); }
      return { __asset: key, type: blob.type, kind: v instanceof Blob ? 'Blob' : v instanceof ArrayBuffer ? 'ArrayBuffer' : v.constructor.name };
    }
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === 'object') { const out = {}; for (const [k,x] of Object.entries(v)) out[k] = await walk(x); return out; }
    return v;
  }
  return { version: 1, records: await walk(records), assets: [...assets.values()] };
}
export async function unpackRecords(manifest, download) {
  if (manifest.version !== 1 || !Array.isArray(manifest.records) || !Array.isArray(manifest.assets)) throw Error('Unsupported project snapshot');
  const assets = new Map(manifest.assets.map(a => [a.key, a])), cache = new Map();
  async function walk(v) {
    if (v?.__asset) {
      const a = assets.get(v.__asset); if (!a) throw Error('Missing asset declaration');
      if (!cache.has(a.key)) cache.set(a.key, (async () => {
        const b = await download(a.key), ab = await b.arrayBuffer();
        if (b.size !== a.size || 'assets/' + hex(await crypto.subtle.digest('SHA-256', ab)) !== a.key) throw Error('Asset integrity check failed');
        return ab;
      })());
      const ab = (await cache.get(a.key)).slice(0);
      if (v.kind === 'Blob') return new Blob([ab], { type: v.type });
      if (v.kind === 'ArrayBuffer') return ab;
      if (!typed[v.kind]) throw Error('Unsupported binary type');
      return new typed[v.kind](ab);
    }
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === 'object') { const out={};for(const [k,x] of Object.entries(v))out[k]=await walk(x);return out; }
    return v;
  }
  return walk(manifest.records);
}
