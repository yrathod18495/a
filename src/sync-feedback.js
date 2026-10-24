export function syncFailure(error) {
  const code = error.code || (error.status === 401 ? 'unauthorized' : error.status === 403 ? 'forbidden' : 'network');
  const signIn = error.status === 401 || /session|unauthorized|token|account.changed/.test(code);
  const conflict = code === 'conflict';
  const denied = error.status === 403;
  const setup = code === 'storage_unavailable' || /set nahi hai|not configured|storage is not set up/i.test(error.message || '');
  const quota = code === 'quota_exceeded' || error.status === 413;
  const message = setup ? 'Server par cloud storage on nahi hai. Aapke badlav is device par safe hain.'
    : quota ? 'Cloud storage bhar gayi hai ya koi file limit se badi hai. Upload ka size kam karein ya support se sampark karein.'
      : conflict ? 'Cloud par isse naya version maujood hai. My Projects kholkar conflict hatayein.'
    : signIn ? 'Aapka sign in dobara karna padega. Sync se pehle dobara sign in karein.'
      : denied ? 'Cloud access mana kar diya gaya. Apna account access check karein ya support se sampark karein.'
        : error.status === 503 ? 'Cloud saving abhi thodi der ke liye band hai. Baad me dobara try karein.'
          : 'Cloud saving poori nahi ho payi. Internet check karke dobara try karein.';
  return { code, retryable: !signIn && !conflict && !denied && !setup && !quota, message, detail: error.message || 'Cloud request fail ho gayi.' };
}
export function syncPresentation(state) {
  if (state.text === 'Saved to Cloud') return { label: 'Saved to cloud', tone: 'saved' };
  if (state.text === 'Saving') return { label: 'Saved locally · syncing…', tone: 'saving' };
  if (state.text === 'Offline') return { label: 'Saved locally · offline', tone: 'offline' };
  if (state.text === 'Conflict' || state.text === 'Sync Failed') return { label: 'Saved locally · sync needs attention', tone: 'error' };
  return { label: 'Saved locally', tone: 'local' };
}
