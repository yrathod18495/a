import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo } from './dom.js';
import { adminFindProject } from './cloud.js';

const fmt = (ts) => ts ? new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function findProjectView({ user, back, toast }) {
  const root = h('div', { class: 'sh admin-find-project' });
  const input = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'e.g. 418203957', class: 'ad-search', 'aria-label': 'Project ID', onkeydown: (e) => { if (e.key === 'Enter') search(); } });
  const button = h('button', { class: 'btn pri', onclick: search }, 'Find');
  const result = h('div', { class: 'card flat', style: 'margin-top:14px' }, h('p', { class: 'hint' }, 'User se unka project ID lein (jo URL me aur My Projects me dikhta hai) aur yahan daal kar check karein.'));
  root.append(
    h('header', { class: 'sh-bar' }, logo(back), h('span', { class: 'sh-crumb' }, 'Admin · Find Project'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: back }, 'Back to Admin')),
    h('main', { class: 'affiliate-admin-main' },
      h('div', { class: 'affiliate-admin-heading' }, h('div', {}, h('span', { class: 'projects-eyebrow' }, 'SUPPORT'), h('h1', {}, 'Find a Project'), h('p', {}, 'User apna project ID bataye to yahan dekh sakte hain project kis haal me hai.'))),
      h('div', { class: 'row', style: 'gap:8px' }, input, button),
      result));

  async function search() {
    const id = input.value.trim();
    if (!id) { input.focus(); return; }
    button.disabled = true; result.replaceChildren(h('p', { class: 'hint' }, 'Dhoondh rahe hain…'));
    try {
      const r = await adminFindProject(id, user);
      if (!r.found) { result.replaceChildren(h('p', { class: 'hint' }, `Project ID "${id}" nahi mila. ID sahi hai, ye check karein — ho sakta hai project kabhi banaya hi na gaya ho.`)); return; }
      if (r.pending) {
        result.replaceChildren(
          h('p', { class: 'hint' }, `ID ${r.id} ek ${r.kind === 'animation' ? 'animation' : 'character'} project ke liye bana hua hai, lekin abhi tak cloud par poora save nahi hua — shayad user offline hai ya abhi edit kar raha hai pehli bar.`),
          h('div', {}, h('small', { class: 'sub' }, 'Owner'), h('p', {}, r.owner.name || r.owner.email || r.owner.uid), r.owner.email ? h('small', {}, r.owner.email) : null));
        return;
      }
      const p = r.project;
      result.replaceChildren(
        h('h2', {}, p.name || 'Untitled project'),
        h('p', { class: 'hint', style: 'margin:0 0 10px' }, `ID ${r.id} · ${p.kind === 'animation' ? 'Animation' : 'Character'} project`),
        h('div', { class: 'row', style: 'gap:18px;flex-wrap:wrap' },
          h('div', {}, h('small', { class: 'sub' }, 'Owner'), h('p', {}, r.owner.name || r.owner.email || r.owner.uid), r.owner.email ? h('small', {}, r.owner.email) : null),
          h('div', {}, h('small', { class: 'sub' }, 'Status'), h('p', {}, p.deleted ? '🗑 Deleted' : `✓ Revision ${p.revision}`)),
          h('div', {}, h('small', { class: 'sub' }, 'First saved to cloud'), h('p', {}, fmt(p.firstCloudSavedAt))),
          h('div', {}, h('small', { class: 'sub' }, 'Last updated'), h('p', {}, fmt(p.updatedAt)))),
        p.summary ? h('div', { style: 'margin-top:10px' }, h('small', { class: 'sub' }, 'Last saved snapshot'), h('p', {}, JSON.stringify(p.summary))) : null,
        r.activity.length ? h('div', { style: 'margin-top:14px' }, h('small', { class: 'sub' }, 'Recent saves'),
          h('div', { class: 'ad-lrows' }, [...r.activity].reverse().map((a) => h('div', { class: 'ad-lrow' }, h('div', { class: 'ad-lorig', style: 'width:auto;flex:1' }, h('b', {}, a.action.replace(/_/g, ' ')), h('small', {}, `rev ${a.revision} · ${fmt(a.at)}`)))))) : null);
    } catch (e) { result.replaceChildren(h('p', { class: 'hint' }, `Dhoondh nahi paye: ${friendlyError(e)}`)); toast?.(friendlyError(e)); }
    finally { button.disabled = false; }
  }
  return root;
}
