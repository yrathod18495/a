// "Saved 2 min ago": how long ago something was saved, in words a person reads at a glance.
export function agoText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${Math.floor(s / 10) * 10} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? '1 min ago' : `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? '1 h ago' : `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
/** the label shown in the studio bar: the state, plus when it was saved for the states that mean "it is saved" */
export function saveLabel(base, tone, savedAt, now = Date.now()) {
  return (tone === 'saved' || tone === 'local') && savedAt ? `${base} · ${agoText(now - savedAt)}` : base;
}
