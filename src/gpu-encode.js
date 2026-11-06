// Talks to the GPU encoder of the cloud-export worker (hf-cloud-export/gpu_encode.py) over a local WebSocket.
// Only used when the worker added ?gpuenc=<port>.<token> to the render page's address; otherwise nothing here runs and the browser's own encoder is used.
export function gpuEncodeConfig() {
  const value = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('gpuenc');
  if (!value) return null;
  const [port, token] = value.split('.');
  return /^\d{2,5}$/.test(port) && token ? { url: `ws://127.0.0.1:${port}`, token } : null;
}

class Link {
  constructor(ws) {
    this.ws = ws; this.waiters = []; this.queued = []; this.onBinary = null; this.closed = false;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') { this.onBinary?.(e.data); return; }
      const msg = JSON.parse(e.data), at = this.waiters.findIndex((w) => w.t === msg.t);
      if (at >= 0) this.waiters.splice(at, 1)[0].resolve(msg); else this.queued.push(msg);
    };
    const gone = () => { this.closed = true; this.waiters.splice(0).forEach((w) => w.reject(Error('The GPU encoder connection closed.'))); };
    ws.onclose = gone; ws.onerror = gone;
  }
  send(data) { this.ws.send(typeof data === 'string' || data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data : JSON.stringify(data)); }
  wait(t, ms = 0) {
    const at = this.queued.findIndex((m) => m.t === t);
    if (at >= 0) return Promise.resolve(this.queued.splice(at, 1)[0]);
    if (this.closed) return Promise.reject(Error('The GPU encoder connection closed.'));
    return new Promise((resolve, reject) => {
      const waiter = { t, resolve, reject }; this.waiters.push(waiter);
      if (ms) setTimeout(() => { const i = this.waiters.indexOf(waiter); if (i >= 0) { this.waiters.splice(i, 1); reject(Error('The GPU encoder did not answer.')); } }, ms);
    });
  }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

/** opens a connection and says hello with the job's token; rejects quickly when the encoder is not there, so the caller can use the browser's own encoder */
export async function connectGpuEncoder(cfg, timeoutMs = 4000) {
  const ws = new WebSocket(cfg.url);
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(Error('The GPU encoder is not reachable.')); setTimeout(() => reject(Error('The GPU encoder did not answer.')), timeoutMs); });
  await opened;
  const link = new Link(ws);
  link.send({ t: 'hello', token: cfg.token });
  link.codec = (await link.wait('ready', timeoutMs)).codec;
  return link;
}
