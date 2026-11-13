// Admin → Users: one row per account, and a dialog per account with the tabs Overview / Projects / Coins / Actions.
// Everything that changes an account runs on the server (api/security.js `moderate` / `assignRole`, api/payments.js `adminCreditAdjust`, api/export.js `adminSetTier`);
// this file only draws it and shows each change at once, then checks it again quietly in the background.
import { h } from './dom.js';
import { icon } from './icons.js';
import { goldCoin } from './coin.js';
import { apiCall } from './session.js';
import { friendlyError } from '../shared/hinglish-errors.js';

const ONLINE_MS = 15 * 60 * 1000;
const STATUS = { active: ['Active', 'ok'], blocked: ['Blocked', 'bad'], suspended: ['Suspended', 'warn'], restricted: ['Restricted', 'warn'] };
const el = (tag, cls, ...kids) => h(tag, { class: cls }, ...kids);
const when = (v) => (v ? new Date(v).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const coinsText = (n) => Number(n || 0).toLocaleString('en-IN');
const hue = (s) => { let x = 0; for (const c of String(s || '?')) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const ago = (ms) => { if (!ms) return 'Never'; const s = Math.max(0, (Date.now() - ms) / 1000); return s < 90 ? 'Just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
export const isOnline = (s) => !!s && !s.revoked && !!s.lastSeen && Date.now() - s.lastSeen < ONLINE_MS;
const avatar = (u, size = '') => { const a = el(`span`, `au-avatar ${size}`, String((u.name || u.email || '?')[0]).toUpperCase()); a.style.setProperty('--h', hue(u.email || u.id)); return a; };
const badge = (text, tone = 'neutral') => el('span', `au-badge ${tone}`, text);
const statusBadge = (u) => { const [t, tone] = STATUS[u.status || 'active'] || STATUS.active; return badge(t, tone); };
const copyIcon = () => icon('copy');

/** one account in the list */
export function userRow(u, { session, onOpen }) {
  const online = isOnline(session);
  const open = () => onOpen(u);
  return h('article', { class: 'au-row', tabindex: '0', role: 'button', 'aria-label': `Manage ${u.email || u.id}`, onclick: open, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
    avatar(u),
    el('div', 'au-id', el('b', 'au-name', u.name || u.email || u.id), el('small', 'au-mail', u.email || u.id),
      el('div', 'au-badges', statusBadge(u), u.role === 'admin' ? badge('Admin', 'info') : null, online ? badge('Online', 'ok') : null)),
    el('div', 'au-coins', goldCoin(18), el('b', '', coinsText(u.credits))),
    el('div', 'au-seen', el('small', '', 'Last activity'), el('span', '', online ? 'Online now' : ago(session?.lastSeen || 0))),
    el('span', 'au-manage', 'Manage', icon('chevron-right')));
}

/** the account dialog */
export function openUserDialog(row, ctx) {
  document.querySelector('.au-modal')?.remove();
  const u = { ...row, ledger: [], bonus: null, tier: row.tier || 'free', loaded: false, signedIn: undefined };
  let tab = ctx.startTab || 'overview', busy = false;
  const body = el('div', 'au-body');
  const tabsEl = el('div', 'au-tabs', null);
  const title = el('div', 'au-head-main');
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const modal = el('div', 'au-modal', h('div', { class: 'au-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Account details' },
    el('header', 'au-head', title, h('button', { type: 'button', class: 'au-x', 'aria-label': 'Close', onclick: close }, icon('x'))),
    tabsEl, body));
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(modal);

  const session = () => ctx.sessionOf?.(u.id);
  const paintHead = () => {
    const online = isOnline(session());
    const uidBtn = h('button', { type: 'button', class: 'au-copy', title: 'Copy the user ID', 'aria-label': 'Copy the user ID', onclick: async () => { try { await navigator.clipboard.writeText(u.id); ctx.toast('User ID copied.'); } catch { ctx.toast('Could not copy.'); } } }, copyIcon());
    title.replaceChildren(avatar(u, 'lg'), el('div', 'au-head-text',
      el('div', 'au-head-line', el('b', 'au-head-name', u.name || u.email || u.id), statusBadge(u), u.role === 'admin' ? badge('Admin', 'info') : null, online ? badge('Online now', 'ok') : null),
      el('div', 'au-uid', u.email && u.name ? el('span', '', u.email) : null, el('code', '', u.id), uidBtn)));
  };
  const paintTabs = () => tabsEl.replaceChildren(...[['overview', 'Overview'], ['projects', 'Projects'], ['coins', 'Coins'], ['actions', 'Actions']].map(([k, label]) =>
    h('button', { type: 'button', class: `au-tab${tab === k ? ' on' : ''}${k === 'actions' ? ' danger' : ''}`, 'aria-pressed': String(tab === k), onclick: () => { tab = k; paintTabs(); paintBody(); } }, label)));
  const paint = () => { paintHead(); paintTabs(); paintBody(); };

  /** a change: lock the dialog, call the server, show the result at once, then check quietly */
  async function run(fn, { done = 'Saved.', refresh = true } = {}) {
    if (busy) return false;
    busy = true; modal.classList.add('busy');
    try { await fn(); ctx.toast(done); ctx.onChanged?.(u); paint(); if (refresh) look(true); return true; }
    catch (e) { ctx.toast(friendlyError(e)); return false; }
    finally { busy = false; modal.classList.remove('busy'); }
  }
  async function look(quiet) {
    if (!u.email) return;
    try {
      const { user } = await apiCall('/api/payments', { action: 'adminUserLookup', email: u.email });
      Object.assign(u, { ledger: user.ledger || [], bonus: user.bonus, tier: user.tier, credits: user.credits, status: user.status, until: user.until, statusReason: user.statusReason, statusAt: user.statusAt, role: user.role, signedIn: user.signedIn, lastSignIn: user.lastSignIn || u.lastSignIn, registeredAt: user.registeredAt || u.registeredAt, loaded: true });
      ctx.onChanged?.(u); paint();
    } catch (e) { if (!quiet) ctx.toast(friendlyError(e)); u.loaded = true; paintBody(); }
  }

  const field = (label, value) => el('div', 'au-field', el('small', '', label), el('b', '', value == null || value === '' ? '—' : value));

  function overview() {
    const gift = u.bonus ? (u.bonus.status === 'granted' ? '20 Coins given' : u.bonus.reason === 'device_used' ? 'Not given (this browser was already used)' : 'Not given') : (u.loaded ? 'Not given' : '…');
    return [
      el('div', 'au-metrics', el('div', 'au-metric hero', el('small', '', 'Coins'), el('b', '', coinsText(u.credits))), el('div', 'au-metric', el('small', '', 'Plan'), el('b', '', u.tier === 'paid' ? 'Paid' : 'Free')), el('div', 'au-metric', el('small', '', 'Account'), el('b', '', (STATUS[u.status || 'active'] || STATUS.active)[0]))),
      el('div', 'au-grid', field('Email', u.email), field('Role', u.role === 'admin' ? 'Admin' : 'User'), field('Registered', when(u.registeredAt)), field('Last sign-in', when(u.lastSignIn)), field('Signed in now', u.signedIn === undefined ? '…' : u.signedIn ? 'Yes' : 'No'), field('Welcome gift', gift)),
    ];
  }

  function projects() {
    const list = el('div', 'au-projects'), go = h('button', { type: 'button', class: 'btn pri', onclick: () => { go.hidden = true; ctx.showProjects(u.id, go, list); } }, 'Load cloud projects & uploads');
    list.hidden = true;
    return [el('p', 'au-hint', 'Projects this account has saved to the cloud, with their uploads and save history.'), go, list];
  }

  function coins() {
    const mode = { v: 'adjust' };
    const amount = h('input', { class: 'au-input big', type: 'text', inputmode: 'numeric', placeholder: 'e.g. +100 or -50', 'aria-label': 'Coins to add or remove', autocomplete: 'off' });
    const reason = h('input', { class: 'au-input', type: 'text', maxlength: '200', placeholder: 'Reason (kept in the audit log)', 'aria-label': 'Reason' });
    const hint = el('p', 'au-hint', 'Type + to add or - to remove. Example: +100 adds 100 Coins, -50 removes 50.');
    const seg = el('div', 'au-seg', ...[['adjust', 'Add or remove'], ['set', 'Set exact balance']].map(([k, label]) => h('button', { type: 'button', class: k === mode.v ? 'on' : '', onclick: (e) => {
      mode.v = k; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      amount.placeholder = k === 'set' ? 'New balance, e.g. 500' : 'e.g. +100 or -50'; hint.textContent = k === 'set' ? 'The balance becomes exactly this number.' : 'Type + to add or - to remove. Example: +100 adds 100 Coins, -50 removes 50.';
    } }, label)));
    const opId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(16).slice(2)}`;          // one id per form: a double click is applied once
    const apply = h('button', { type: 'button', class: 'btn pri au-apply', onclick: () => {
      const raw = amount.value.trim(), why = reason.value.trim();
      let kind, n;
      if (mode.v === 'set') { if (!/^\d+$/.test(raw)) { ctx.toast('Please enter the new balance as a whole number.'); return; } kind = 'set'; n = Number(raw); }
      else { if (!/^[+-]?\d+$/.test(raw) || Number(raw) === 0) { ctx.toast('Please type a whole number like +100 or -50.'); return; } kind = raw.startsWith('-') ? 'remove' : 'add'; n = Math.abs(Number(raw)); }
      if (why.length < 3) { ctx.toast('Please write a short reason.'); return; }
      if (!window.confirm(`${kind === 'set' ? 'Set the balance to' : kind === 'add' ? 'Add' : 'Remove'} ${coinsText(n)} Coins ${kind === 'set' ? '' : (kind === 'add' ? 'to' : 'from')} ${u.email}? Current balance: ${coinsText(u.credits)}.`)) return;
      run(async () => {
        const res = await apiCall('/api/payments', { action: 'adminCreditAdjust', uid: u.id, mode: kind, amount: n, reason: why, opId });
        u.credits = res.balance; if (res.line && !res.duplicate) u.ledger = [{ id: `new-${Date.now()}`, ...res.line }, ...(u.ledger || [])].slice(0, 10);
      }, { done: 'Coins updated.' });
    } }, 'Apply');
    const history = (u.ledger || []).length ? el('div', 'au-ledger', ...u.ledger.map((l) => el('div', 'au-ledger-row',
      el('b', `au-delta ${l.delta >= 0 ? 'up' : 'down'}`, `${l.delta >= 0 ? '+' : '−'}${coinsText(Math.abs(l.delta))}`),
      el('div', '', el('span', 'au-why', l.reason || l.kind || ''), el('small', '', `${when(l.at)} · balance ${coinsText(l.balance)}`))))) : el('p', 'au-hint', u.loaded ? 'No Coins activity yet.' : 'Loading…');
    return [
      el('div', 'au-card hero', el('small', 'au-label', 'Coins balance'), el('div', 'au-balance', goldCoin(18), el('b', '', coinsText(u.credits)))),
      el('div', 'au-card', el('h3', '', 'Change Coins'), seg, amount, hint, reason, apply),
      el('div', 'au-card', el('h3', '', 'Recent activity'), history),
    ];
  }

  function actions() {
    const moderate = (status, extra = {}, done) => run(async () => {
      await apiCall('/api/security', { action: 'moderate', uid: u.id, status, ...extra });
      if (status === 'revoke') u.signedIn = false; else { u.status = status; u.until = extra.until || 0; u.statusReason = extra.reason || ''; u.statusAt = Date.now(); }
    }, { done });
    let newRole = u.role === 'admin' ? 'admin' : 'user';
    const roleSeg = el('div', 'au-seg', ...['user', 'admin'].map((r) => h('button', { type: 'button', class: r === newRole ? 'on' : '', onclick: (e) => { newRole = r; roleSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, r === 'admin' ? 'Admin' : 'User')));
    let newTier = u.tier === 'paid' ? 'paid' : 'free';
    const tierSeg = el('div', 'au-seg', ...['free', 'paid'].map((r) => h('button', { type: 'button', class: r === newTier ? 'on' : '', onclick: (e) => { newTier = r; tierSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, r === 'paid' ? 'Paid' : 'Free')));
    const save = h('button', { type: 'button', class: 'btn', onclick: async () => {
      if (newRole !== (u.role === 'admin' ? 'admin' : 'user') && !window.confirm(`Make ${u.email} ${newRole === 'admin' ? 'an admin' : 'a regular user'}?`)) return;
      await run(async () => {
        if (newRole !== (u.role === 'admin' ? 'admin' : 'user')) { await apiCall('/api/security', { action: 'assignRole', uid: u.id, role: newRole }); u.role = newRole; }
        if (newTier !== u.tier) { await apiCall('/api/export', { action: 'adminSetTier', uid: u.id, tier: newTier }); u.tier = newTier; }
      });
    } }, 'Save access and plan');
    const st = u.status || 'active';
    const current = st === 'active' ? null : el('div', 'au-current',
      el('b', '', st === 'blocked' ? 'This account is blocked' : st === 'suspended' ? 'This account is suspended' : 'This account is restricted to read-only'),
      st === 'suspended' && u.until ? el('p', '', `Ends: ${when(u.until)}`) : null,
      el('p', '', el('small', '', 'Reason: '), u.statusReason || 'No reason was written.'),
      u.statusAt ? el('p', '', el('small', '', 'Since: '), when(u.statusAt)) : null);
    const stop = h('button', { type: 'button', class: 'btn au-danger', onclick: () => openStop() }, icon('ban'), 'Suspend or block this account');
    const back = h('button', { type: 'button', class: 'btn au-ok', onclick: () => { if (window.confirm(`Reactivate ${u.email}?`)) moderate('active', {}, 'Account reactivated.'); } }, icon('check'), 'Reactivate this account');
    const quiet = el('div', 'au-quiet',
      h('button', { type: 'button', class: 'btn sm', onclick: () => { if (window.confirm(`Restrict ${u.email} to read-only access?`)) moderate('restricted', { reason: 'Restricted by an admin' }, 'Account restricted.'); } }, 'Restrict to read-only'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => { if (window.confirm(`End the current session of ${u.email}?`)) moderate('revoke', {}, 'Signed out everywhere.'); } }, 'Sign out everywhere'));
    return [
      el('div', 'au-card', el('h3', '', 'Access and plan'), el('div', 'au-two', el('div', '', el('small', 'au-label', 'Role'), roleSeg), el('div', '', el('small', 'au-label', 'Plan'), tierSeg)), save),
      el('div', 'au-card danger', el('div', 'au-danger-title', icon('ban'), 'Account security'), current, st === 'active' ? stop : back, quiet),
    ];
  }

  /** the suspend / block form: how long, and why */
  function openStop() {
    const dur = h('select', { class: 'au-input', 'aria-label': 'How long' }, ...[['86400000', 'Suspend for 24 hours'], ['604800000', 'Suspend for 7 days'], ['2592000000', 'Suspend for 30 days'], ['block', 'Block permanently']].map(([v, t]) => h('option', { value: v }, t)));
    const reason = h('textarea', { class: 'au-input', rows: '3', maxlength: '200', placeholder: 'e.g. Suspicious activity detected', 'aria-label': 'Reason' });
    const sub = el('div', 'au-modal sub', el('div', 'au-dialog small',
      el('header', 'au-head', el('b', '', 'Suspend or block this account'), h('button', { type: 'button', class: 'au-x', 'aria-label': 'Close', onclick: () => sub.remove() }, icon('x'))),
      el('div', 'au-body', el('p', 'au-hint', `${u.email} will be signed out at once. A suspension ends by itself; a block stays until you reactivate the account.`), el('small', 'au-label', 'How long'), dur, el('small', 'au-label', 'Reason (required, kept in the audit log)'), reason,
        el('div', 'au-two', h('button', { type: 'button', class: 'btn', onclick: () => sub.remove() }, 'Cancel'),
          h('button', { type: 'button', class: 'btn au-danger', onclick: async () => {
            const why = reason.value.trim(); if (why.length < 3) { ctx.toast('Please write a short reason.'); return; }
            sub.remove();
            if (dur.value === 'block') await run(async () => { await apiCall('/api/security', { action: 'moderate', uid: u.id, status: 'blocked', reason: why }); u.status = 'blocked'; u.until = 0; u.statusReason = why; u.statusAt = Date.now(); }, { done: 'Account blocked.' });
            else await run(async () => { const until = Date.now() + Number(dur.value); await apiCall('/api/security', { action: 'moderate', uid: u.id, status: 'suspended', until, reason: why }); u.status = 'suspended'; u.until = until; u.statusReason = why; u.statusAt = Date.now(); }, { done: 'Account suspended.' });
          } }, 'Confirm')))));
    sub.addEventListener('click', (e) => { if (e.target === sub) sub.remove(); });
    document.body.append(sub);
    reason.focus();
  }

  function paintBody() {
    const parts = tab === 'projects' ? projects() : tab === 'coins' ? coins() : tab === 'actions' ? actions() : overview();
    body.replaceChildren(...parts.filter(Boolean));
  }
  paint();
  look();
  return { close };
}
