// A tiny in-memory Realtime Database for tests: the same calls as the Admin SDK ref(path).get / set / update / remove / transaction.
export function memoryRtdb() {
  const root = {};
  const parts = (path) => String(path).split('/').filter(Boolean);
  const read = (path) => { let node = root; for (const key of parts(path)) { if (node == null || typeof node !== 'object' || !(key in node)) return null; node = node[key]; } return node === undefined ? null : structuredClone(node); };
  const write = (path, value) => {
    const keys = parts(path);
    if (!keys.length) { for (const k of Object.keys(root)) delete root[k]; if (value && typeof value === 'object') Object.assign(root, structuredClone(value)); return; }
    let node = root;
    for (const key of keys.slice(0, -1)) { if (node[key] == null || typeof node[key] !== 'object') node[key] = {}; node = node[key]; }
    const last = keys.at(-1);
    if (value == null) delete node[last]; else node[last] = structuredClone(value);
    // like RTDB, parents that became empty disappear
    for (let i = keys.length - 1; i > 0; i--) { const parent = read(keys.slice(0, i).join('/')); if (parent && typeof parent === 'object' && !Object.keys(parent).length) write(keys.slice(0, i).join('/'), null); }
  };
  const snapshot = (value) => ({ exists: () => value !== null, val: () => value });
  let queue = Promise.resolve();
  return {
    root,
    ref: (path) => ({
      get: async () => snapshot(read(path)),
      set: async (value) => write(path, value),
      update: async (patch) => { for (const [k, v] of Object.entries(patch)) write(`${path}/${k}`, v); },
      remove: async () => write(path, null),
      transaction: (fn) => {
        const run = queue.then(() => {
          const next = fn(read(path));
          if (next === undefined) return { committed: false, snapshot: snapshot(read(path)) };
          write(path, next); return { committed: true, snapshot: snapshot(read(path)) };
        });
        queue = run.catch(() => {}); return run;
      },
    }),
  };
}
