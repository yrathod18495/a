// Admin → Users: one row per account, and a dialog per account with the tabs Overview / Projects / Coins / Actions.
// Everything that changes an account runs on the server (api/security.js `moderate` / `assignRole`, api/payments.js `adminCreditAdjust`, api/export.js `adminSetTier`);
// this file only draws it and shows each change at once, then checks it again quietly in the background.
import { h } from './dom.js';
import { icon } from './icons.js';
import { goldCoin } from './coin.js';
import { apiCall } from './session.js';
import { friendlyError } from '../shared/hinglish-errors.js';
import { auth } from './firebase.js';

const ONLINE_MS = 15 * 60 * 1000;
const STATUS = { active: ['Active', 'ok'], blocked: ['Blocked', 'bad'], suspended: ['Suspended', 'warn'], restricted: ['Restricted', 'warn'] };
const el = (tag, cls, ...kids) => h(tag, { class: cls }, ...kids);
const when = (v) => (v ? new Date(v).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const coinsText = (n) => Number(n || 0).toLocaleString('en-IN');
const hue = (s) => { let x = 0; for (const c of String(s || '?')) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const ago = (ms) => { if (!ms) return 'Never'; const s = Math.max(0, (Date.now() - ms) / 1000); return s < 90 ? 'Just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
export const isOnline = (s) => !!s && !s.revoked && !!s.lastSeen && Date.now() - s.lastSeen < ONLINE_MS;
const avatar = (u, size = '', online = false) => { const a = el(`span`, `au-avatar ${size}`, String((u.name || u.email || '?')[0]).toUpperCase()); a.style.setProperty('--h', hue(u.email || u.id)); if (online) a.append(el('i', 'au-live', '')); return a; };
const badge = (text, tone = 'neutral') => el('span', `au-badge ${tone}`, text);
/** Normal accounts show no status chip (it would only repeat the green Online mark); only a restriction is worth a chip. */
const statusBadge = (u) => { const st = u.status || 'active'; if (st === 'active') return null; const [t, tone] = STATUS[st] || STATUS.active; return badge(t, tone); };
const copyIcon = () => icon('copy');

/** a question inside the page (a browser's own confirm box can be blocked and looks different on every phone); resolves true / false */
function confirmBox({ title, text, confirm = 'Confirm', tone = '' }) {
  return new Promise((resolve) => {
    const done = (v) => { sub.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    const yes = h('button', { type: 'button', class: `btn au-btn ${tone === 'danger' ? 'au-danger' : 'pri'}`, onclick: () => done(true) }, confirm);
    const sub = el('div', 'au-modal sub', h('div', { class: 'au-dialog small', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', 'au-body', el('h3', 'au-confirm-title', title), el('p', 'au-hint', text),
        el('div', 'au-confirm-actions', h('button', { type: 'button', class: 'btn au-btn', onclick: () => done(false) }, 'Cancel'), yes))));
    sub.addEventListener('click', (e) => { if (e.target === sub) done(false); });
    document.addEventListener('keydown', onKey);
    document.body.append(sub);
    yes.focus();
  });
}

/** one account in the list */
export function userRow(u, { session, onOpen }) {
  const online = isOnline(session);
  const open = () => onOpen(u);
  return h('article', { class: 'au-row', tabindex: '0', role: 'button', 'aria-label': `Manage ${u.email || u.id}`, onclick: open, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
    avatar(u, '', online),
    el('div', 'au-id', el('b', 'au-name', u.name || u.email || u.id), el('small', 'au-mail', u.email || u.id),
      el('div', 'au-badges', statusBadge(u), u.role === 'admin' ? badge('Admin', 'info') : null)),
    el('div', 'au-coins', goldCoin(18), el('b', '', coinsText(u.credits))),
    el('div', 'au-seen', el('small', '', 'Last activity'), el('span', online ? 'au-on' : '', online ? 'Online now' : ago(session?.lastSeen || 0))),
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
    title.replaceChildren(avatar(u, 'lg', online), el('div', 'au-head-text',
      el('div', 'au-head-line', el('b', 'au-head-name', u.name || u.email || u.id), statusBadge(u), u.role === 'admin' ? badge('Admin', 'info') : null),
      el('div', 'au-uid', u.email && u.name ? el('span', '', u.email) : null, el('code', '', u.id), uidBtn)));
  };
  const paintTabs = () => tabsEl.replaceChildren(...[['overview', 'Overview'], ['projects', 'Projects'], ['coins', 'Coins'], ['actions', 'Actions']].map(([k, label]) =>
    h('button', { type: 'button', class: `au-tab${tab === k ? ' on' : ''}${k === 'actions' ? ' danger' : ''}`, 'aria-pressed': String(tab === k), onclick: () => { tab = k; paintTabs(); paintBody(); } }, label)));
  const paint = () => { paintHead(); paintTabs(); paintBody(); };

  /* Messages stay visible in the dialog (a toast can be missed on a phone). */
  let notice = null, noticeTimer = 0;
  const showFlash = () => { let f = body.querySelector(':scope > .au-flash'); if (!notice) { f?.remove(); return; } if (!f) { f = el('p', 'au-flash'); f.setAttribute('role', 'status'); body.prepend(f); } f.className = `au-flash ${notice.tone}`; f.textContent = notice.text; };
  const say = (text, tone = 'ok') => { notice = { text, tone }; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice = null; showFlash(); }, 5000); showFlash(); };

  /** a change: the clicked button shows a spinner, the rest of the dialog is locked, the result is shown at once and checked again quietly */
  async function run(fn, { done = 'Saved.', refresh = true, button = null } = {}) {
    if (busy) return false;
    busy = true; modal.classList.add('busy'); button?.classList.add('is-busy'); button?.setAttribute('aria-busy', 'true');
    try { await fn(); ctx.toast(done); say(done, 'ok'); ctx.onChanged?.(u); busy = false; modal.classList.remove('busy'); paint(); if (refresh) look(true); return true; }
    catch (e) { const m = friendlyError(e); ctx.toast(m); say(m, 'bad'); return false; }
    finally { busy = false; modal.classList.remove('busy'); button?.classList.remove('is-busy'); button?.removeAttribute('aria-busy'); }
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
  const self = () => !!auth.currentUser && auth.currentUser.uid === u.id;
  /** every action button: the same look and the same states (normal, hover, pressed, busy, done/active, disabled) */
  const abtn = (label, { cls = '', ic = null, on = false, disabled = false, title = '', onclick }) => {
    const b = h('button', { type: 'button', class: `btn au-btn ${cls}${on ? ' on' : ''}`, title, onclick: () => { if (b.disabled || busy) return; onclick(b); } }, ic ? icon(ic) : null, el('span', 'au-btn-text', label));
    if (disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
    return b;
  };

  function overview() {
    const gift = u.bonus ? (u.bonus.status === 'granted' ? '20 Coins given' : u.bonus.reason === 'device_used' ? 'Not given (this browser was already used)' : 'Not given') : (u.loaded ? 'Not given' : '…');
    return [
      el('div', 'au-metrics', el('div', 'au-metric hero', el('small', '', 'Coins'), el('b', '', coinsText(u.credits))), el('div', 'au-metric', el('small', '', 'Plan'), el('b', '', u.tier === 'paid' ? 'Paid' : 'Free')), el('div', 'au-metric', el('small', '', 'Account'), el('b', '', (STATUS[u.status || 'active'] || STATUS.active)[0]))),
      el('div', 'au-grid', field('Email', u.email), field('Role', u.role === 'admin' ? 'Admin' : 'User'), field('Registered', when(u.registeredAt)), field('Last sign-in', when(u.lastSignIn)), field('Signed in now', u.signedIn === undefined ? '…' : u.signedIn ? 'Yes' : 'No'), field('Welcome gift', gift)),
    ];
  }

  function projects() {
    const list = el('div', 'au-projects'), go = h('button', { type: 'button', class: 'btn au-btn pri', onclick: () => { go.hidden = true; ctx.showProjects(u.id, go, list); } }, 'Load cloud projects & uploads');
    list.hidden = true;
    return [el('p', 'au-hint', 'Projects this account has saved to the cloud, with their uploads and save history.'), go, list];
  }

  function coins() {
    const mode = { v: 'adjust' };
    const amount = h('input', { class: 'au-input big', type: 'text', inputmode: 'numeric', placeholder: 'e.g. +100 or -50', 'aria-label': 'Coins to add or remove', autocomplete: 'off' });
    const reason = h('input', { class: 'au-input', type: 'text', maxlength: '200', placeholder: 'Reason (kept in the audit log)', 'aria-label': 'Reason' });
    const hint = el('p', 'au-hint', 'Type + to add or - to remove. Example: +100 adds 100 Coins, -50 removes 50.');
    const seg = el('div', 'au-seg', ...[['adjust', 'Add or remove'], ['set', 'Set exact balance']].map(([k, label]) => h('button', { type: 'button', class: k === mode.v ? 'on' : '', 'aria-pressed': String(k === mode.v), onclick: (e) => {
      mode.v = k; seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); });
      amount.placeholder = k === 'set' ? 'New balance, e.g. 500' : 'e.g. +100 or -50'; hint.textContent = k === 'set' ? 'The balance becomes exactly this number.' : 'Type + to add or - to remove. Example: +100 adds 100 Coins, -50 removes 50.';
    } }, label)));
    const opId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(16).slice(2)}`;          // one id per form: a double click is applied once
    const apply = abtn('Apply', { cls: 'pri au-apply', onclick: async (b) => {
      const raw = amount.value.trim(), why = reason.value.trim();
      let kind, n;
      if (mode.v === 'set') { if (!/^\d+$/.test(raw)) { say('Please enter the new balance as a whole number.', 'bad'); return; } kind = 'set'; n = Number(raw); }
      else { if (!/^[+-]?\d+$/.test(raw) || Number(raw) === 0) { say('Please type a whole number like +100 or -50.', 'bad'); return; } kind = raw.startsWith('-') ? 'remove' : 'add'; n = Math.abs(Number(raw)); }
      if (why.length < 3) { say('Please write a short reason (at least 3 characters).', 'bad'); return; }
      const ok = await confirmBox({ title: kind === 'set' ? 'Set the balance?' : kind === 'add' ? 'Add Coins?' : 'Remove Coins?', text: `${kind === 'set' ? `The balance of ${u.email} becomes ${coinsText(n)} Coins` : kind === 'add' ? `${coinsText(n)} Coins will be added to ${u.email}` : `${coinsText(n)} Coins will be removed from ${u.email}`}. Current balance: ${coinsText(u.credits)}.`, confirm: 'Apply' });
      if (!ok) return;
      run(async () => {
        const res = await apiCall('/api/payments', { action: 'adminCreditAdjust', uid: u.id, mode: kind, amount: n, reason: why, opId });
        u.credits = res.balance; if (res.line && !res.duplicate) u.ledger = [{ id: `new-${Date.now()}`, ...res.line }, ...(u.ledger || [])].slice(0, 10);
      }, { done: `Coins updated. New balance: ${coinsText(u.credits)}.`, button: b });
    } });
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
    const me = self(), st = u.status || 'active';
    const moderate = (status, extra, done, button) => run(async () => {
      await apiCall('/api/security', { action: 'moderate', uid: u.id, status, ...extra });
      if (status === 'revoke') u.signedIn = false; else { u.status = status; u.until = extra.until || 0; u.statusReason = extra.reason || ''; u.statusAt = Date.now(); }
    }, { done, button });

    /* access and plan: the Save button is off until something is changed, and says what will change */
    const cur = { role: u.role === 'admin' ? 'admin' : 'user', tier: u.tier === 'paid' ? 'paid' : 'free' };
    const want = { ...cur };
    const save = abtn('Save changes', { cls: 'au-save', disabled: true, onclick: async (b) => {
      const changes = [want.role !== cur.role ? `role: ${cur.role === 'admin' ? 'Admin' : 'User'} → ${want.role === 'admin' ? 'Admin' : 'User'}` : '', want.tier !== cur.tier ? `plan: ${cur.tier === 'paid' ? 'Paid' : 'Free'} → ${want.tier === 'paid' ? 'Paid' : 'Free'}` : ''].filter(Boolean);
      if (!await confirmBox({ title: 'Save these changes?', text: `${u.email}: ${changes.join(', ')}.`, confirm: 'Save' })) return;
      run(async () => {
        if (want.role !== cur.role) { await apiCall('/api/security', { action: 'assignRole', uid: u.id, role: want.role }); u.role = want.role; }
        if (want.tier !== cur.tier) { await apiCall('/api/export', { action: 'adminSetTier', uid: u.id, tier: want.tier }); u.tier = want.tier; }
      }, { done: 'Access and plan saved.', button: b });
    } });
    const sync = () => { const dirty = want.role !== cur.role || want.tier !== cur.tier; save.disabled = !dirty; save.setAttribute('aria-disabled', String(!dirty)); save.querySelector('.au-btn-text').textContent = dirty ? 'Save changes' : 'No changes to save'; save.classList.toggle('ready', dirty); };
    const segOf = (key, options, locked) => { const box = el('div', 'au-seg', ...options.map(([v, label]) => h('button', { type: 'button', disabled: locked || null, class: v === want[key] ? 'on' : '', 'aria-pressed': String(v === want[key]), onclick: (e) => { want[key] = v; box.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === e.currentTarget); x.setAttribute('aria-pressed', String(x === e.currentTarget)); }); sync(); } }, label))); return box; };
    sync();

    const current = st === 'active' ? null : el('div', 'au-current',
      el('b', '', st === 'blocked' ? 'This account is blocked' : st === 'suspended' ? 'This account is suspended' : 'This account is restricted to read-only'),
      st === 'suspended' && u.until ? el('p', '', `Ends: ${when(u.until)}`) : null,
      el('p', '', el('small', '', 'Reason: '), u.statusReason || 'No reason was written.'),
      u.statusAt ? el('p', '', el('small', '', 'Since: '), when(u.statusAt)) : null);
    const stop = abtn('Suspend or block this account', { cls: 'au-danger', ic: 'ban', onclick: () => openStop() });
    const back = abtn('Reactivate this account', { cls: 'au-ok', ic: 'check', onclick: async (b) => { if (await confirmBox({ title: 'Reactivate this account?', text: `${u.email} will be able to sign in and work normally again.`, confirm: 'Reactivate' })) moderate('active', {}, 'Account reactivated.', b); } });
    const restrict = abtn(st === 'restricted' ? 'Restricted (read-only)' : 'Restrict to read-only', { on: st === 'restricted', disabled: st === 'restricted' || st === 'blocked' || st === 'suspended', title: 'The account can look but not change anything', onclick: async (b) => { if (await confirmBox({ title: 'Restrict this account?', text: `${u.email} will be able to look around but not save or change anything.`, confirm: 'Restrict' })) moderate('restricted', { reason: 'Restricted by an admin' }, 'Account restricted.', b); } });
    const out = abtn(u.signedIn === false ? 'Not signed in' : 'Sign out everywhere', { disabled: u.signedIn === false, title: 'Ends the current session on every device', onclick: async (b) => { if (await confirmBox({ title: 'Sign this account out?', text: `The current session of ${u.email} ends. They can sign in again.`, confirm: 'Sign out' })) moderate('revoke', {}, 'Signed out everywhere.', b); } });

    return [
      el('div', 'au-card', el('h3', '', 'Access and plan'),
        me ? el('p', 'au-hint', 'This is your own account: you cannot change your own role. You can still change the plan.') : null,
        el('div', 'au-two', el('div', '', el('small', 'au-label', 'Role'), segOf('role', [['user', 'User'], ['admin', 'Admin']], me)), el('div', '', el('small', 'au-label', 'Plan'), segOf('tier', [['free', 'Free'], ['paid', 'Paid']], false))), save),
      el('div', 'au-card danger', el('div', 'au-danger-title', icon('ban'), 'Account security'),
        me ? el('div', 'au-current mine', el('b', '', 'This is your own account'), el('p', '', 'For safety you cannot suspend, block, restrict or sign out your own account. Ask another admin to do it.')) : [current, st === 'active' ? stop : back, el('div', 'au-quiet', restrict, out)]),
    ].flat();
  }

  /** the suspend / block form: how long, and why */
  function openStop() {
    const dur = h('select', { class: 'au-input', 'aria-label': 'How long' }, ...[['86400000', 'Suspend for 24 hours'], ['604800000', 'Suspend for 7 days'], ['2592000000', 'Suspend for 30 days'], ['block', 'Block permanently']].map(([v, t]) => h('option', { value: v }, t)));
    const reason = h('textarea', { class: 'au-input', rows: '3', maxlength: '200', placeholder: 'e.g. Suspicious activity detected', 'aria-label': 'Reason' });
    const msg = el('p', 'au-flash bad', ''); msg.hidden = true;
    const go = h('button', { type: 'button', class: 'btn au-btn au-danger', onclick: async () => {
      const why = reason.value.trim(); if (why.length < 3) { msg.textContent = 'Please write a short reason (at least 3 characters).'; msg.hidden = false; return; }
      msg.hidden = true; go.classList.add('is-busy'); cancel.disabled = true;
      const permanent = dur.value === 'block', until = permanent ? 0 : Date.now() + Number(dur.value);
      const ok = await run(async () => {
        await apiCall('/api/security', { action: 'moderate', uid: u.id, status: permanent ? 'blocked' : 'suspended', ...(permanent ? {} : { until }), reason: why });
        u.status = permanent ? 'blocked' : 'suspended'; u.until = until; u.statusReason = why; u.statusAt = Date.now();
      }, { done: permanent ? 'Account blocked.' : 'Account suspended.' });
      go.classList.remove('is-busy'); cancel.disabled = false;
      if (ok) sub.remove(); else { msg.textContent = 'It could not be saved. See the message in the account window.'; msg.hidden = false; }
    } }, el('span', 'au-btn-text', 'Confirm'));
    const cancel = h('button', { type: 'button', class: 'btn au-btn', onclick: () => sub.remove() }, 'Cancel');
    const sub = el('div', 'au-modal sub', el('div', 'au-dialog small',
      el('header', 'au-head', el('b', '', 'Suspend or block this account'), h('button', { type: 'button', class: 'au-x', 'aria-label': 'Close', onclick: () => sub.remove() }, icon('x'))),
      el('div', 'au-body', el('p', 'au-hint', `${u.email} will be signed out at once. A suspension ends by itself; a block stays until you reactivate the account.`), el('small', 'au-label', 'How long'), dur, el('small', 'au-label', 'Reason (required, kept in the audit log)'), reason, msg,
        el('div', 'au-confirm-actions', cancel, go))));
    sub.addEventListener('click', (e) => { if (e.target === sub) sub.remove(); });
    document.body.append(sub);
    reason.focus();
  }

  function paintBody() {
    const parts = tab === 'projects' ? projects() : tab === 'coins' ? coins() : tab === 'actions' ? actions() : overview();
    body.replaceChildren(...parts.filter(Boolean));
    showFlash();
  }
  paint();
  look();
  return { close };
}
