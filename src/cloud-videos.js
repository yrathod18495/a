// "My cloud videos": every finished cloud export is kept for 3 days so it can be downloaded later, even after the studio was closed.
import { h, toast } from './dom.js';
import { exportFileName } from './export-name.js';
import { listCloudVideos, deleteCloudVideo, saveCloudVideo } from './cloud-export.js';

const mb = (n) => (n / 1048576 < 10 ? (n / 1048576).toFixed(1) : Math.round(n / 1048576)) + ' MB';
const left = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.round((m % 1440) / 60)} h left` : m >= 60 ? `${Math.floor(m / 60)} h left` : `${m} min left`; };

export function openCloudVideos(uid, { projectId = null } = {}) {
  const list = h('div', { class: 'cv-list', role: 'list' }, h('p', { class: 'sub' }, 'Loading…'));
  const close = () => el.remove();
  const el = h('div', { class: 'modal', onclick: (e) => e.target === el && close() },
    h('div', { class: 'sheet cv-sheet' },
      h('div', { class: 'row', style: 'margin-bottom:6px' }, h('h2', { style: 'margin:0' }, 'My cloud videos'), h('span', { class: 'sp' }), h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Close', onclick: close }, '✕')),
      h('p', { class: 'sub', style: 'margin:0 0 10px;font-size:12px' }, 'Videos made with Render on the cloud stay here for 3 days, then are deleted automatically.'),
      list));
  document.body.append(el);
  const draw = (videos) => {
    const shown = projectId ? videos.filter((v) => v.projectId === projectId) : videos;
    if (!shown.length) { list.replaceChildren(h('p', { class: 'sub' }, projectId ? 'No cloud videos for this project yet.' : 'No cloud videos yet. Use Render on the cloud in the Export tab.')); return; }
    list.replaceChildren(...shown.map((v) => {
      const download = h('button', { type: 'button', class: 'btn ok sm', onclick: async () => {
        download.disabled = true;
        try { await saveCloudVideo(uid, v.id, exportFileName(v.projectId, 'mp4', new Date(v.createdAt)), v.size); }
        catch (e) { toast(e.message); } finally { download.disabled = false; }
      } }, 'Download');
      const remove = h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Delete this video', onclick: async () => {
        remove.disabled = true;
        try { await deleteCloudVideo(uid, v.id); row.remove(); if (!list.children.length) draw([]); } catch (e) { toast(e.message); remove.disabled = false; }
      } }, 'Delete');
      const row = h('div', { class: 'cv-row', role: 'listitem' },
        h('div', { class: 'cv-info' }, h('b', {}, v.projectName || 'Project'), h('small', {}, `${v.quality || ''}p · ${v.fps || ''} fps · ${Math.round(v.seconds || 0)} s · ${mb(v.size)} · ${left(v.expiresAt - Date.now())}`)),
        h('div', { class: 'cv-actions' }, download, remove));
      return row;
    }));
  };
  listCloudVideos(uid).then(draw).catch((e) => list.replaceChildren(h('p', { class: 'exp-opt-msg exp-opt-msg-error', role: 'alert' }, e.message)));
  return close;
}
