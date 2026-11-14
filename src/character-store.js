// The Character Store (dashboard → Character Store): premium characters the admin sells for Coins. A purchase gives the character for 30 days,
// counted on the SERVER clock: the days left shown here are the server's end time minus the server's "now", moved forward only by the time that
// passed on this device since the answer arrived, so a wrong phone clock changes nothing. See docs/CHARACTER-STORE.md.
import './character-store.css';
import { h, logo, toast } from './dom.js';
import { goldCoin } from './coin.js';
import { friendlyError } from '../shared/hinglish-errors.js';
import { groupOf, CHARACTER_GROUPS } from '../shared/character-package.js';
import { STORE_DAYS, timeLeft, leftText } from '../shared/character-store.js';
import { listCharacterStore, buyCharacter, pictureUrl } from './cloud-characters.js';
import { coinBalance, refreshCoins, setCoinBalance } from './credits-badge.js';
import { openCreditPlans } from './credits-plans.js';

const coins = (n) => Number(n || 0).toLocaleString('en-IN');
const GROUP = Object.fromEntries(CHARACTER_GROUPS);
const pretty = (name) => String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const newOp = () => `op_${(crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 40).padEnd(20, '0');

/** a small in-page dialog (no browser pop-ups) */
function modal({ title, body, actions }) {
  const dialog = h('dialog', { class: 'cs-dialog', 'aria-label': title });
  const close = () => dialog.close();
  dialog.append(h('header', { class: 'cs-dialog-head' }, h('h2', {}, title), h('button', { type: 'button', class: 'cs-x', 'aria-label': 'Close', onclick: close }, '✕')), h('div', { class: 'cs-dialog-body' }, body), h('footer', { class: 'cs-dialog-foot' }, ...actions(close)));
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog); dialog.showModal();
  return dialog;
}

export async function view({ user, home }) {
  const root = h('div', { class: 'sh cs-page' });
  const content = h('main', { class: 'cs-main' }, h('p', { class: 'cs-hint', role: 'status' }, 'Loading the store…'));
  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Character Store'), h('span', { class: 'sp' }), h('button', { class: 'btn', type: 'button', onclick: home }, 'Home')), content);

  let characters = [], skew = 0, ticker = 0;
  const serverNow = () => Date.now() + skew;                    // the server's clock, moved on by this device's own elapsed time only
  const pendingOps = new Map();                                 // character id -> the id of a purchase whose answer has not come back (a retry is not charged twice)
  const thumbOf = (c) => c.views?.f34?.thumb || c.thumb || Object.values(c.views || {}).find((v) => v.thumb)?.thumb || null;

  async function load() {
    try {
      const r = await listCharacterStore();
      characters = r.characters.filter((c) => c.store); skew = r.serverNow - r.receivedAt;
      draw();
    } catch (e) { content.replaceChildren(h('p', { class: 'cs-hint error', role: 'alert' }, `Could not load the store: ${friendlyError(e)}`), h('button', { class: 'btn', type: 'button', onclick: () => { content.replaceChildren(h('p', { class: 'cs-hint' }, 'Loading the store…')); load(); } }, 'Try again')); }
  }

  function card(c) {
    const left = c.access ? timeLeft(c.access.expiresAt, serverNow()) : 0, owned = left > 0, unlocked = !c.locked;
    const img = h('img', { alt: '', loading: 'lazy' }); const ref = thumbOf(c); if (ref) pictureUrl(ref).then((u) => { img.src = u; }).catch(() => img.remove());
    const status = h('div', { class: `cs-status ${owned ? 'on' : ''}` }, owned ? h('span', { class: 'cs-left', 'data-until': c.access.expiresAt }, `${leftText(left)}`) : c.access ? 'Ended — renew to use it again' : `${STORE_DAYS} days`);
    const buyLabel = owned ? 'Renew +30 days' : 'Buy';
    return h('article', { class: `cs-card ${owned ? 'owned' : ''}` },
      h('div', { class: 'cs-thumb' }, img, owned ? h('span', { class: 'cs-badge' }, 'Yours') : null),
      h('div', { class: 'cs-info' }, h('b', { class: 'cs-name' }, c.name), h('small', {}, GROUP[groupOf(c, c.categoryName)] || ''), status),
      h('div', { class: 'cs-actions' },
        h('button', { type: 'button', class: 'btn sm', onclick: () => preview(c) }, 'Preview'),
        c.store.enabled === false && !owned ? h('span', { class: 'cs-off' }, 'Not on sale') : h('button', { type: 'button', class: 'btn pri sm cs-buy', onclick: () => confirmBuy(c) }, buyLabel, ' · ', goldCoin(14), ' ', coins(c.store.price))));
  }
  function draw() {
    const mine = characters.filter((c) => c.access && timeLeft(c.access.expiresAt, serverNow()) > 0), rest = characters.filter((c) => !mine.includes(c));
    content.replaceChildren(
      h('section', { class: 'cs-hero' }, h('div', {}, h('h1', {}, 'Character Store'), h('p', { class: 'sub' }, `Premium characters. Pay with Coins and use a character for ${STORE_DAYS} days.`)),
        h('div', { class: 'cs-wallet' }, h('small', {}, 'Your Coins'), h('b', { class: 'cs-balance' }, goldCoin(20), ' ', coinBalance() == null ? '…' : coins(coinBalance())), h('button', { type: 'button', class: 'btn sm', onclick: () => openCreditPlans({ user, onBalance: () => draw() }) }, 'Buy Coins'))),
      !characters.length ? h('div', { class: 'cs-empty' }, goldCoin(34), h('b', {}, 'No premium characters yet'), h('p', {}, 'New characters will appear here.')) : null,
      mine.length ? h('section', {}, h('h2', { class: 'cs-sub' }, 'Your characters'), h('div', { class: 'cs-grid' }, ...mine.map(card))) : null,
      rest.length ? h('section', {}, h('h2', { class: 'cs-sub' }, mine.length ? 'More characters' : 'Characters for sale'), h('div', { class: 'cs-grid' }, ...rest.map(card))) : null,
      h('p', { class: 'cs-note' }, `A character stays in your character list for ${STORE_DAYS} days after you buy it. The ${STORE_DAYS} days are counted by our server (${STORE_DAYS} × 24 hours, whatever the month), not by your phone's clock. Buying again while it is active adds ${STORE_DAYS} more days.`));
  }

  // the "days left" text moves on by itself; when a purchase ends the list is asked again
  ticker = setInterval(() => {
    if (!root.isConnected) { clearInterval(ticker); return; }
    let ended = false;
    root.querySelectorAll('.cs-left').forEach((el) => { const ms = timeLeft(Number(el.dataset.until), serverNow()); el.textContent = leftText(ms); if (ms <= 0) ended = true; });
    if (ended) load();
  }, 30000);
  root.dispose = () => clearInterval(ticker);

  function preview(c) {
    const viewIds = Object.keys(c.views || {});
    let active = viewIds.includes('f34') ? 'f34' : viewIds[0];
    const grid = h('div', { class: 'cs-previews' });
    const drawGrid = () => {
      const v = c.views[active], items = Object.entries(v?.gifs || {}).slice(0, 12);
      grid.replaceChildren(...(items.length ? items.map(([name, ref]) => {
        const box = h('figure', { class: 'cs-prev' }), cap = h('figcaption', {}, pretty(name));
        const mp4 = v.previewType === 'mp4', media = mp4 ? h('video', { muted: true, loop: true, autoplay: true, playsinline: true }) : h('img', { alt: pretty(name) });
        media.muted = true; box.append(media, cap);
        pictureUrl(ref, mp4 ? 'video/mp4' : null).then((u) => { media.src = u; if (mp4) media.play?.().catch(() => {}); }).catch(() => box.remove());
        return box;
      }) : [h('p', { class: 'cs-hint' }, 'No previews for this view.')]));
    };
    const tabs = h('div', { class: 'cs-tabs', role: 'group', 'aria-label': 'View' }, ...viewIds.map((id) => h('button', { type: 'button', class: `btn sm ${id === active ? 'pri' : ''}`, onclick: (e) => { active = id; tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('pri', b === e.currentTarget)); drawGrid(); } }, c.views[id].label || id)));
    drawGrid();
    modal({ title: c.name, body: [viewIds.length > 1 ? tabs : null, grid, h('p', { class: 'cs-hint' }, 'A few of the animations. After buying you can use the character in the Animator Studio.')], actions: (close) => [h('button', { type: 'button', class: 'btn', onclick: close }, 'Close'), c.store.enabled === false ? null : h('button', { type: 'button', class: 'btn pri', onclick: () => { close(); confirmBuy(c); } }, 'Buy · ', coins(c.store.price), ' Coins')] });
  }

  async function confirmBuy(c) {
    await refreshCoins({ force: true }).catch(() => {});
    const balance = coinBalance(), price = c.store.price, short = balance != null && balance < price, owned = c.access && timeLeft(c.access.expiresAt, serverNow()) > 0;
    const message = h('p', { class: 'cs-msg', role: 'status', 'aria-live': 'polite' }, '');
    const dlg = modal({
      title: owned ? `Renew ${c.name}?` : `Buy ${c.name}?`,
      body: [
        h('div', { class: 'cs-sum' }, h('div', {}, h('small', {}, 'Price'), h('b', {}, goldCoin(16), ' ', coins(price), ' Coins')), h('div', {}, h('small', {}, 'Your balance'), h('b', {}, goldCoin(16), ' ', balance == null ? '…' : coins(balance))),
          h('div', {}, h('small', {}, 'After buying'), h('b', {}, goldCoin(16), ' ', balance == null ? '…' : coins(Math.max(0, balance - price))))),
        h('p', {}, owned ? `This adds ${STORE_DAYS} more days to the time you have left.` : `You can use ${c.name} for ${STORE_DAYS} days, counted from now on our server.`),
        short ? h('p', { class: 'cs-msg error' }, `You need ${coins(price - balance)} more Coins.`) : null, message],
      actions: (close) => [h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'),
        short ? h('button', { type: 'button', class: 'btn pri', onclick: () => { close(); openCreditPlans({ user, onBalance: () => draw() }); } }, 'Buy Coins')
          : h('button', { type: 'button', class: 'btn pri cs-confirm', onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true; message.className = 'cs-msg'; message.textContent = 'Buying…';
            const opId = pendingOps.get(c.id) || newOp(); pendingOps.set(c.id, opId);
            try {
              const r = await buyCharacter({ id: c.id, price, opId });
              pendingOps.delete(c.id);
              setCoinBalance(r.balance); skew = r.serverNow - Date.now();
              c.access = { expiresAt: r.expiresAt }; c.locked = false;
              toast(`${c.name} is yours for ${STORE_DAYS} days.`); close(); draw(); load();
            } catch (err) {
              if (err.status) pendingOps.delete(c.id);                  // a definite answer: a new tap is a new purchase; with no answer at all the same id is used again
              message.className = 'cs-msg error'; message.textContent = err.code === 'price_changed' ? `${friendlyError(err)}` : friendlyError(err);
              b.disabled = false; if (err.code === 'price_changed') load();
            }
          } }, `Buy · ${coins(price)} Coins`)],
    });
    return dlg;
  }

  await load();
  return root;
}
