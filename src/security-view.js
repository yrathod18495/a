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
  // "User Hub": nothing is listed until the admin searches (so opening the page reads nothing); Login activity, Devices and the Audit log are read when their tab is opened.
  const root=el('div','sh sa sa-hub');
  const header=el('header','sa-head',
    el('div','sa-head-copy',h('a',{class:'sa-eyebrow',href:'/#/',style:'text-decoration:none','aria-label':'12toons home'},'12TOONS  /  ADMIN CONSOLE'),
      h('h1',{},'User Hub'),
      el('p','sa-sub','Full platform oversight: search an account to manage its access and Coins.')),
    btn('← Back to admin',home,'sa-back'));
  const status=el('span','sa-sync','');
  const refresh=btn('↻ Refresh',()=>refreshCurrent(),'sa-refresh');
  const stats=el('div','sa-stats');
  const controls=el('div','sa-controls');
  const more=el('div','sa-more');
  const tabs=el('div','sa-tabs');
  const panel=el('div','sa-panel');
  const search=h('input',{class:'sa-search',type:'search',placeholder:'Search identity via email or user ID…','aria-label':'Search accounts',autocomplete:'off',spellcheck:'false'});
  const note=el('p','sa-footnote','Device IDs identify a browser installation—not a physical device. Private browsing or clearing storage can bypass detection.');
  root.append(header,el('div','sa-card',controls,tabs,panel),note);
  let state={cursors:{}},tab=initialTab,loading=false,hub={results:null,sessions:[],busy:false,note:''};

  const tabsData=[['users','User Hub'],['events','Login activity'],['devices','Devices'],['audit','Audit log']];
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
  function renderTabs(){
    tabs.replaceChildren(...tabsData.map(([key,name])=>h('button',{class:'sa-tab '+(tab===key?'on':''),type:'button','aria-pressed':tab===key,onclick:()=>showTab(key)},name,
      key==='events'&&state.events?.some(e=>e.code==='device_review'&&e.review==='pending')?el('span','sa-tab-count',String(state.events.filter(e=>e.code==='device_review'&&e.review==='pending').length)):null)));
  }
  function renderControls(){
    if(tab!=='users'){controls.replaceChildren(el('div','sa-filter-title',h('b',{},'Security records'),el('p','sa-sub','Review activity and account security history. Read when you open a tab.')),el('div','sa-filters',status,refresh));return;}
    controls.replaceChildren(el('div','sa-hub-search',el('div','sa-hub-field',search),
      el('div','sa-hub-actions',btn('Search Database',()=>runSearch(),'sa-positive sa-go'),btn('Recent sign-ins',()=>runSearch(true),'sa-quiet'))));
    search.onkeydown=e=>{if(e.key==='Enter')runSearch();};
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
  /* Users = "User Hub": search-first. Nothing is read until the admin searches; a search reads at most 10 accounts, "Recent sign-ins" the newest 20. */
  const dialogCtx={
    toast,sessionOf:(id)=>(hub.sessions||[]).find(x=>x.id===id),
    showProjects:(uid,button,target)=>showProjects(uid,button,target,true),
    onChanged:(u)=>{const row=(hub.results||[]).find(x=>x.id===u.id);if(row){Object.assign(row,{status:u.status,until:u.until,role:u.role,credits:u.credits,statusReason:u.statusReason,statusAt:u.statusAt});if(tab==='users')renderUsers();}},
  };
  async function runSearch(recent=false){
    const q=search.value.trim();
    if(!recent&&q.length<3){toast('Please type at least 3 characters of an email or a user ID.');return;}
    if(hub.busy)return;hub.busy=true;hub.note='';renderUsers();
    try{const r=await apiCall('/api/security',{action:'userSearch',...(recent?{recent:true}:{query:q})});hub.results=r.users||[];hub.sessions=r.sessions||[];hub.note=recent?'Newest sign-ins':`Results for “${q}”`;}
    catch(e){hub.results=null;hub.note='';toast(friendlyError(e));}
    finally{hub.busy=false;renderUsers();}
  }
  function renderUsers(){
    if(hub.busy){panel.replaceChildren(...[0,1].map(()=>el('div','sa-skel',el('i','rf-sk sa-skel-a'),el('i','rf-sk sa-skel-b'))));return;}
    if(hub.results===null){panel.replaceChildren(empty('Search to see accounts','Type an email address or a user ID above, or open the newest sign-ins. Nothing is loaded until you search.'));return;}
    if(!hub.results.length){panel.replaceChildren(empty('No matching accounts','Check the spelling. An email can be searched from its first letters; a user ID must be complete.'));return;}
    panel.replaceChildren(el('div','sa-results-count',hub.note+' · '+hub.results.length+' account'+(hub.results.length===1?'':'s')),
      el('div','au-list',...hub.results.map(u=>userRow(u,{session:(hub.sessions||[]).find(x=>x.id===u.id),onOpen:(row)=>openUserDialog(row,dialogCtx)}))));
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
    else{
      if(tab==='events')renderEvents();else if(tab==='devices')renderDevices();else renderAudit();
      more.replaceChildren();
      if(state.cursors?.[tab])more.append(btn('Load more records',()=>load(true),'sa-more-btn'));
      panel.append(more);
    }
  }
  function skeleton(){panel.replaceChildren(...[0,1,2].map(()=>el('div','sa-skel',el('i','rf-sk sa-skel-a'),el('i','rf-sk sa-skel-b'))));}
  /** reads one section of the security records (login activity, devices or the audit log): only when its tab is opened, or on Refresh / Load more */
  const loaded=new Set();
  async function load(append=false,parts){
    const key=(parts&&parts[0])||(tab!=='users'?tab:null);
    if(!key||loading)return;
    loading=true;refresh.disabled=true;status.textContent='Syncing…';
    try{
      const data=await apiCall('/api/security',{action:'overview',parts:[key],...(append?{cursors:{[key]:state.cursors?.[key]}}:{})});
      state[key]=append?[...new Map([...(state[key]||[]),...(data[key]||[])].map(v=>[v.id,v])).values()]:data[key];
      state.cursors={...state.cursors,[key]:data.cursors?.[key]||null};loaded.add(key);
      renderTabs();if(tab===key||tab==='users'){if(tab===key)renderContent();}status.textContent='Updated just now';
    }catch(e){status.textContent='Sync failed';if(tab===key)panel.replaceChildren(empty('Could not load security data',friendlyError(e)));toast(friendlyError(e));}
    finally{loading=false;refresh.disabled=false;}
  }
  function refreshCurrent(){if(tab==='users')runSearch(hub.note==='Newest sign-ins');else load(false);}
  async function showTab(key){
    tab=key;renderTabs();renderControls();
    if(key==='users'){renderUsers();return;}
    if(!loaded.has(key)){skeleton();await load(false,[key]);return;}
    renderContent();
  }
  showTab(tab);
  root.dispose=()=>{};
  return root;
}