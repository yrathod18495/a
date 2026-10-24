export function syncFailure(error) {
  const code = error.code || (error.status === 401 ? 'unauthorized' : error.status === 403 ? 'forbidden' : 'network');
  const signIn = error.status === 401 || /session|unauthorized|token|account.changed/.test(code);
  const conflict = code === 'conflict';
  const denied = error.status === 403;
  const setup = /not configured|storage is not set up/i.test(error.message || '');
  const quota = code === 'quota_exceeded' || error.status === 413;
  const message = setup ? 'Cloud storage is not enabled on the server. Your changes remain on this device.'
    : quota ? 'Cloud storage is full or a file exceeds its limit. Reduce the upload size or contact support.'
      : conflict ? 'A newer cloud version exists. Open My Projects to resolve it.'
    : signIn ? 'Your sign-in needs refreshing. Sign in again before syncing.'
      : denied ? 'Cloud access was denied. Check your account access or contact support.'
        : error.status === 503 ? 'Cloud saving is temporarily unavailable. Try again later.'
          : 'Cloud saving could not finish. Check your connection and retry.';
  return { code, retryable: !signIn && !conflict && !denied && !setup && !quota, message, detail: error.message || 'Cloud request failed.' };
}
export function syncPresentation(state) {
  if (state.text === 'Saved to Cloud') return { label: 'Saved to cloud', tone: 'saved' };
  if (state.text === 'Saving') return { label: 'Saved locally · syncing…', tone: 'saving' };
  if (state.text === 'Offline') return { label: 'Saved locally · offline', tone: 'offline' };
  if (state.text === 'Conflict' || state.text === 'Sync Failed') return { label: 'Saved locally · sync needs attention', tone: 'error' };
  return { label: 'Saved locally', tone: 'local' };
}
