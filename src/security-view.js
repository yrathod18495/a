import { friendlyError } from '../shared/hinglish-errors.js';
import { h } from './dom.js';
import { apiCall } from './session.js';
import { userRow, openUserDialog } from './admin-users.js';

const date = value => value ? new Date(value).toLocaleString() : '—';
const ONLINE_MS = 15 * 60 * 1000;   // the browser reports in every 5 minutes while open
const isOnline = (s, now = Date.now()) => !!s && !s.revoked && !!s.lastSeen && now - s.lastSeen < ONLINE_MS;
const short = value => value ? String(value).slice(0, 10) + '…' : '—';
const statusName = value => ({active:'Active',blocked:'Blocked',restricted:'Restricted',suspended:'Suspended'})[value] || 'Active';
const el = (tag, cls, ...children) => h(tag, {class:cls}, ...children);
const btn = (label, click, cls='') => h('button', {class:'btn sa-btn '+cls, type:'button', onclick:click}, label);

export async function securityView({ home, toast, initialTab = 'users' }) {
  const root=el('div','sh sa');
  const header=el('header','sa-head',
    el('div','sa-head-copy',h('a',{class:'sa-eyebrow',href:'/#/',style:'text-decoration:none','aria-label':'12toons home'},'12TOONS  /  ADMIN CONSOLE'),
      h('h1',{},'Users & Security'),
      el('p','sa-sub','Manage account access, sessions and device risk from one place.')),
    btn('← Back to admin',home,'sa-back'));
  const status=el('span','sa-sync','Loading…');
  const refresh=btn('↻ Refresh',()=>load(false),'sa-refresh');
  const toolbar=el('div','sa-toolbar',el('div','sa-toolbar-title',el('span','sa-live-dot'),'Live security overview'),el('div','sa-toolbar-actions',status,refresh));
  const stats=el('div','sa-stats');
  const controls=el('div','sa-controls');
  const list=el('div','sa-list');
  const events=el('div','sa-list');
  const devices=el('div','sa-list');
  const audit=el('div','sa-list');
  const more=el('div','sa-more');
  const tabs=el('div','sa-tabs');
  const panel=el('div','sa-panel');
  const search=h('input',{class:'sa-search',type:'search',placeholder:'Search by email, name or user ID…','aria-label':'Search users'});
  const title=el('div','sa-section-title',h('h2',{},'Accounts'),el('p','sa-sub','Actions take effect on the server. All changes are recorded.'));
  const note=el('p','sa-footnote','Device IDs identify a browser installation—not a physical device. Private browsing or clearing storage can bypass detection.');
  root.append(header,toolbar,stats,el('div','sa-card',controls,tabs,panel),note);
  let state=null,filter='all',term='',tab=initialTab,loading=false;

  const tabsData=[['users','Users'],['events','Login activity'],['devices','Devices'],['audit','Audit log']];
  const badge=(text,tone='neutral')=>el('span','sa-badge sa-'+tone,text);
  const empty=(headline,description)=>el('div','sa-empty',el('div','sa-empty-icon','◎'),h('b',{},headline),el('p','sa-sub',description));
  const block=(name,value)=>el('div','sa-metric',el('span','sa-metric-label',name),el('strong','sa-metric-value',String(value)));
  const sectionRow=(headline,detail,badges=[],right=null)=>el('div','sa-row',
    el('div','sa-avatar',String(headline||'?')[0].toUpperCase()),
    el('div','sa-row-main',el('div','sa-row-name',h('b',{},headline),...badges),el('p','sa-row-detail',detail)),
    right || el('span','sa-muted',''));
  const allow=(message,fn)=>{if(window.confirm(message))fn();};
  async function act(payload,question){
    if(question&&!window.confirm(question))return;
    try{
      status.textContent='Applying change…';await apiCall('/api/security',payload);toast('Security change saved.');
      patchLocal(payload);renderContent();status.textContent='Saved';
      load(false);          // refreshes quietly in the background: the list above already shows the change
    }catch(e){status.textContent='Action failed';toast(friendlyError(e));}
  }
  /** the change is shown at once, without waiting for the whole overview to be read again */
  function patchLocal(p){
    if(p.action!=='moderate'||!state)return;
    const u=(state.users||[]).find(x=>x.id===p.uid);
    if(u&&p.status!=='revoke'){u.status=p.status;u.until=p.until||0;}
    const sx=(state.sessions||[]).find(x=>x.id===p.uid);if(sx)sx.revoked=true;
  }
  async function assignRole(uid,select,button){
    const role=select.value;
    if(!['user','admin'].includes(role))return;
    button.disabled=true;
    try{await apiCall('/api/security',{action:'assignRole',uid,role});toast(`User access updated to ${role}.`);await load(false);}
    catch(e){toast(e.message);button.disabled=false;}
  }
  function renderStats(){
    if(!state)return;
    const users=state.users||[],sess=state.sessions||[],ev=state.events||[];
    const active=sess.filter(s=>isOnline(s)).length;
    const flagged=ev.filter(e=>e.code==='device_review'&&e.review==='pending').length;
    stats.replaceChildren(block('TOTAL USERS',users.length),block('ONLINE NOW',active),block('PENDING REVIEWS',flagged),block('LOGIN EVENTS',ev.length));
  }
  function renderTabs(){
    tabs.replaceChildren(...tabsData.map(([key,name])=>h('button',{
      class:'sa-tab '+(tab===key?'on':''),type:'button','aria-pressed':tab===key,
      onclick:()=>showTab(key)
    },name, key==='events'&&state?.events?.some(e=>e.code==='device_review'&&e.review==='pending')?el('span','sa-tab-count',String(state.events.filter(e=>e.code==='device_review'&&e.review==='pending').length)):null)));
  }
  function renderControls(){
    controls.replaceChildren(el('div','sa-filter-title',h('b',{},tab==='users'?'Account directory':'Security records'),
      el('p','sa-sub',tab==='users'?'Review accounts and manage permissions.':'Review activity and account security history.')),
      el('div','sa-filters',search,h('select',{class:'sa-select','aria-label':'Filter accounts',onchange:e=>{filter=e.target.value;renderContent();}},
       ...[['all','All statuses'],['active','Active'],['blocked','Blocked'],['restricted','Restricted'],['suspended','Suspended']].map(([v,t])=>h('option',{value:v,selected:filter===v},t)))));
    search.value=term;search.oninput=e=>{term=e.target.value.trim().toLowerCase();renderContent();};
    search.onkeydown=e=>{if(e.key==='Enter'&&tab==='users'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(term)&&!(state?.users||[]).some(u=>String(u.email||'').toLowerCase()===term))findByEmail(term);};
    search.hidden=tab!=='users';controls.querySelector('select').hidden=tab!=='users';
  }
  async function showProjects(uid, button, target) {
    if (!target.hidden) { target.hidden = true; return; }
    target.hidden = false;
    if (target.dataset.loaded === 'true') return;
    button.disabled = true; button.textContent = 'Loading cloud projects…';
    try {
      const data = await apiCall('/api/admin-user-data', {action:'userProjects',uid});
      if (!data.projects.length) target.replaceChildren(el('p','sa-associated','No cloud-synced projects were found.'));
      else target.replaceChildren(...data.projects.map(project => {
        const detail = el('div','sa-project-detail');
        detail.hidden = true;
        const open = btn('View uploads & save history', async () => {
          if (!detail.hidden) { detail.hidden = true; open.textContent = 'View uploads & save history'; return; }
          detail.hidden = false; open.disabled = true; open.textContent = 'Loading…';
          try {
            const result = await apiCall('/api/admin-user-data', {action:'projectDetails',uid,projectId:project.id});
            const files = result.snapshotAvailable
              ? (result.audioFiles.length ? result.audioFiles.map(file => el('p','sa-associated',
                  (file.filename || 'File name not found') + (file.speaker ? ' · Speaker: '+file.speaker : '') +
                  (file.order != null ? ' · Track '+file.order : '') + (file.available ? ' · Stored' : ' · File reference missing')))
                : [el('p','sa-associated','No audio files in the current cloud snapshot.')])
              : [el('p','sa-associated',result.snapshotMessage || 'The cloud snapshot is not available right now.')];
            const history = result.history.length
              ? result.history.map(event => el('p','sa-associated',(event.action || 'Saved')+' · revision '+(event.revision || '—')+' · '+date(event.at)+' · '+(event.audioCount || 0)+' audio file(s)'))
              : [el('p','sa-associated','Older saves did not record a detailed history; new cloud saves will be recorded.')];
            detail.replaceChildren(el('p','sa-row-detail','Latest snapshot · '+project.kind+' · revision '+project.revision+' · last saved '+date(project.updatedAt)),el('h4',{},'Uploaded audio'),...files,el('h4',{},'Save history'),...history);
          } catch(error) { detail.replaceChildren(el('p','sa-associated','Could not load the project details: '+friendlyError(error))); }
          finally { open.disabled = false; open.textContent = 'Hide uploads & save history'; }
        },'sa-positive');
        return el('article','sa-project-row',sectionRow(project.name,project.kind+' · '+(project.deleted?'Deleted':'Cloud saved')+' · revision '+project.revision),open,detail);
      }));
      if (data.hasMore) target.append(el('p','sa-row-detail','Showing the 100 most recently updated cloud projects.'));
      target.dataset.loaded = 'true';
    } catch(error) { target.replaceChildren(el('p','sa-associated','Could not load cloud projects: '+friendlyError(error))); }
    finally { button.disabled = false; button.textContent = 'Hide cloud projects & uploads'; }
  }
  /* Users: one row per account; a row opens the account dialog (src/admin-users.js). A full email that is not in the list is looked up on the server. */
  const dialogCtx={
    toast,sessionOf:(id)=>(state?.sessions||[]).find(x=>x.id===id),
    showProjects:(uid,button,target)=>showProjects(uid,button,target,true),
    onChanged:(u)=>{const row=(state?.users||[]).find(x=>x.id===u.id);if(row){Object.assign(row,{status:u.status,until:u.until,role:u.role,credits:u.credits,statusReason:u.statusReason,statusAt:u.statusAt});}if(tab==='users')renderUsers();load(false,null,true);},
  };
  let findBusy=false;
  async function findByEmail(email){
    if(findBusy)return;findBusy=true;
    try{const {user}=await apiCall('/api/payments',{action:'adminUserLookup',email});openUserDialog({id:user.uid,email:user.email,name:user.name,status:user.status,until:user.until,role:user.role,credits:user.credits,registeredAt:user.registeredAt,lastSignIn:user.lastSignIn,tier:user.tier},dialogCtx);}
    catch(e){toast(friendlyError(e));}
    finally{findBusy=false;}
  }
  function renderUsers(){
    const users=(state.users||[]).filter(u=>(filter==='all'||(u.status||'active')===filter)&&(!term||String(u.email||'').toLowerCase().includes(term)||String(u.name||'').toLowerCase().includes(term)||u.id.toLowerCase().includes(term)));
    const out=users.map(u=>userRow(u,{session:(state.sessions||[]).find(x=>x.id===u.id),onOpen:(row)=>openUserDialog(row,dialogCtx)}));
    const isEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(term);
    if(!users.length){panel.replaceChildren(empty('No matching accounts',isEmail?'This email is not in the loaded list.':'Try another search or status filter.'),...(isEmail?[btn('Search all accounts for '+term,()=>findByEmail(term),'sa-positive')]:[]));return;}
    panel.replaceChildren(el('div','sa-results-count',users.length+' account'+(users.length===1?'':'s')),el('div','au-list',...out),...(isEmail?[btn('Not here? Search all accounts for '+term,()=>findByEmail(term),'sa-quiet')]:[]));
  }
  function renderEvents(){
    const rows=[...(state.events||[])].sort((a,b)=>(b.at||0)-(a.at||0));
    if(!rows.length){panel.replaceChildren(empty('No login events yet','Authentication events will appear here.'));return;}
    panel.replaceChildren(...rows.map(e=>{
      const suspicious=e.code==='device_review';
      const head=sectionRow(e.email||e.uid||'Unknown account',
        date(e.at)+' · Device: '+short(e.deviceId),
        [badge(suspicious?'Needs review':e.code||'Login',suspicious?'warning':'success')]);
      const associated=el('p','sa-associated','Linked accounts: '+((e.accounts||[]).join(', ')||'None recorded'));
      const actions=suspicious?el('div','sa-actions',
        btn('Approve device',()=>act({action:'deviceDecision',uid:e.uid,deviceId:e.deviceId,approve:true},'Approve this account on the device?'),'sa-positive'),
        btn('Reject device',()=>act({action:'deviceDecision',uid:e.uid,deviceId:e.deviceId,approve:false},'Reject this account on the device?'),'sa-danger')):null;
      return el('article','sa-user',head,associated,actions);
    }));
  }
  function renderDevices(){
    if(!state.devices?.length){panel.replaceChildren(empty('No devices registered','Browser device records will appear when users sign in.'));return;}
    panel.replaceChildren(...state.devices.map(d=>el('article','sa-user',
      sectionRow('Browser '+short(d.id),'First seen: '+date(d.firstSeen)+' · Last seen: '+date(d.lastSeen),
      [badge((d.accounts||[]).length+' linked account(s)')]),
      el('p','sa-associated','Account IDs: '+((d.accounts||[]).join(', ')||'None')),
      (d.denied||[]).length?el('p','sa-associated','Denied accounts: '+d.denied.join(', ')):null)));
  }
  function renderAudit(){
    const rows=[...(state.audit||[])].sort((a,b)=>(b.at||0)-(a.at||0));
    if(!rows.length){panel.replaceChildren(empty('No admin actions yet','Changes by administrators will be listed here.'));return;}
    panel.replaceChildren(...rows.map(a=>el('article','sa-user',
      sectionRow(a.action||'Admin action','Target: '+(a.target||'—')+' · '+date(a.at),[badge('Audit')]),
      el('p','sa-associated','Performed by: '+(a.admin||'—')+(a.deviceId?' · Device: '+short(a.deviceId):'')))));
  }
  function renderContent(){
    renderControls();
    if(tab==='users')renderUsers();
    else if(tab==='events')renderEvents();
    else if(tab==='devices')renderDevices();
    else renderAudit();
    more.replaceChildren();
    if(Object.values(state.cursors||{}).some(Boolean))more.append(btn('Load more records',()=>load(true),'sa-more-btn'));
    panel.append(more);
  }
  /* The page opens at once and fills in; only the sections that are shown are fetched (devices and the audit log when their tab is opened). */
  const loaded=new Set();
  const SECTION={users:'users',events:'events',devices:'devices',audit:'audit'};
  function skeleton(){panel.replaceChildren(...[0,1,2,3].map(()=>el('div','sa-skel',el('i','rf-sk sa-skel-a'),el('i','rf-sk sa-skel-b'))));}
  async function load(append=false,parts){
    if(loading&&!parts)return;
    loading=true;refresh.disabled=true;status.textContent='Syncing…';
    try{
      let want=parts||(append?Object.entries(state?.cursors||{}).filter(([,v])=>v).map(([k])=>k):[...loaded]);
      if(!want.length)want=['users','sessions','events'];
      if(want.includes('users')&&!want.includes('sessions'))want.push('sessions');
      const data=await apiCall('/api/security',{action:'overview',parts:want,...(append&&state?{cursors:state.cursors}:{})});
      const next={...(state||{}),cursors:{...(state?.cursors||{}),...data.cursors}};
      for(const key of ['users','sessions','devices','events','audit']){
        if(!(key in data))continue;
        next[key]=append&&state?[...new Map([...(state[key]||[]),...(data[key]||[])].map(v=>[v.id,v])).values()]:data[key];
        loaded.add(key);
      }
      state=next;renderStats();renderTabs();renderContent();status.textContent='Updated just now';
    }catch(e){status.textContent='Sync failed';if(!state)panel.replaceChildren(empty('Could not load security data',friendlyError(e)));toast(friendlyError(e));}
    finally{loading=false;refresh.disabled=false;}
  }
  async function showTab(key){
    tab=key;renderTabs();
    const need=key==='devices'?'devices':key==='audit'?'audit':null;
    if(need&&!loaded.has(need)){skeleton();await load(false,[need]);return;}
    if(state)renderContent();
  }
  renderTabs();renderControls();skeleton();
  load();          // not awaited: the page is shown now and fills in when the data arrives
  root.dispose=()=>{};
  return root;
}
