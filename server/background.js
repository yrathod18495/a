// Work that must not hold an answer up (a Telegram note, for example). On Vercel the platform keeps the function alive until the promise ends
// (`waitUntil`); anywhere else we wait for it, but only for a moment.
export function inBackground(promise, { fallbackMs = 1200 } = {}) {
  const task = Promise.resolve(promise).catch(() => {});
  try {
    const context = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
    if (typeof context?.waitUntil === 'function') { context.waitUntil(task); return Promise.resolve(); }
  } catch { /* fall through */ }
  return Promise.race([task, new Promise((resolve) => setTimeout(resolve, fallbackMs))]);
}
