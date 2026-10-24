import { h } from './dom.js';
import { apiCall } from './session.js';

const date = value => value ? new Date(value).toLocaleString() : '—';
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
  const search=h('input',{class:'sa-search',type:'search',placeholder:'Search by email or user ID…','aria-label':'Search users'});
  const title=el('div','sa-section-title',h('h2',{},'Accounts'),el('p','sa-sub','Actions take effect on the server. All changes are recorded.'));
  const note=el('p','sa-footnote','Device IDs identify a browser installation—not a physical device. Private browsing or clearing storage can bypass detection.');
  root.append(header,toolbar,stats,el('div','sa-card',controls,tabs,panel),note);
  let state=null,filter='all',term='',tab=initialTab,loading=false,requestTimer=0;
  const tabsData=[['users','Users'],['testers','Tester requests'],['events','Login activity'],['devices','Devices'],['audit','Audit log']];
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
    try{status.textContent='Applying change…';await apiCall('/api/security',payload);toast('Security change saved.');await load(false);}
    catch(e){status.textContent='Action failed';toast(e.message);}
  }
  async function assignRole(uid,select,button){
    const role=select.value;
    if(!['user','admin','tester'].includes(role))return;
    button.disabled=true;
    try{await apiCall('/api/security',{action:'assignRole',uid,role});toast(`User access updated to ${role}.`);await load(false);}
    catch(e){toast(e.message);button.disabled=false;}
  }
  async function reviewTester(uid,decision,buttons){
    buttons.forEach(button=>button.disabled=true);
    try{await apiCall('/api/security',{action:'reviewTester',uid,status:decision});toast(decision==='approved'?'Tester request approved.':'Tester request rejected.');await load(false);}
    catch(e){toast(e.message);buttons.forEach(button=>button.disabled=false);}
  }
  function renderStats(){
    const users=state.users||[],sess=state.sessions||[],ev=state.events||[];
    const active=sess.filter(s=>!s.revoked&&s.expiresAt>Date.now()).length;
    const flagged=ev.filter(e=>e.code==='device_review'&&e.review==='pending').length;
    stats.replaceChildren(block('TOTAL USERS',users.length),block('ACTIVE SESSIONS',active),block('PENDING REVIEWS',flagged+(state.testerRequests||[]).length),block('LOGIN EVENTS',ev.length));
  }
  function renderTabs(){
    tabs.replaceChildren(...tabsData.map(([key,name])=>h('button',{
      class:'sa-tab '+(tab===key?'on':''),type:'button','aria-pressed':tab===key,
      onclick:()=>{tab=key;renderTabs();renderContent();}
    },name, key==='testers'&&(state?.testerRequests||[]).length?el('span','sa-tab-count',String(state.testerRequests.length)):key==='events'&&state?.events?.some(e=>e.code==='device_review'&&e.review==='pending')?el('span','sa-tab-count',String(state.events.filter(e=>e.code==='device_review'&&e.review==='pending').length)):null)));
  }
  function renderControls(){
    controls.replaceChildren(el('div','sa-filter-title',h('b',{},tab==='users'?'Account directory':tab==='testers'?'Tester access requests':'Security records'),
      el('p','sa-sub',tab==='users'?'Review accounts and manage permissions.':tab==='testers'?'Approve or reject tester access requests.':'Review activity and account security history.')),
      el('div','sa-filters',search,h('select',{class:'sa-select','aria-label':'Filter accounts',onchange:e=>{filter=e.target.value;renderContent();}},
       ...[['all','All statuses'],['active','Active'],['blocked','Blocked'],['restricted','Restricted'],['suspended','Suspended']].map(([v,t])=>h('option',{value:v,selected:filter===v},t)))));
    search.value=term;search.oninput=e=>{term=e.target.value.trim().toLowerCase();renderContent();};
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
                  (file.filename || 'Filename unavailable') + (file.speaker ? ' · Speaker: '+file.speaker : '') +
                  (file.order != null ? ' · Track '+file.order : '') + (file.available ? ' · Stored' : ' · File reference missing')))
                : [el('p','sa-associated','No audio files in the current cloud snapshot.')])
              : [el('p','sa-associated',result.snapshotMessage || 'Cloud snapshot unavailable.')];
            const history = result.history.length
              ? result.history.map(event => el('p','sa-associated',(event.action || 'Saved')+' · revision '+(event.revision || '—')+' · '+date(event.at)+' · '+(event.audioCount || 0)+' audio file(s)'))
              : [el('p','sa-associated','Older saves did not record a detailed history; new cloud saves will be recorded.')];
            detail.replaceChildren(el('p','sa-row-detail','Latest snapshot · '+project.kind+' · revision '+project.revision+' · last saved '+date(project.updatedAt)),el('h4',{},'Uploaded audio'),...files,el('h4',{},'Save history'),...history);
          } catch(error) { detail.replaceChildren(el('p','sa-associated','Could not load project details: '+error.message)); }
          finally { open.disabled = false; open.textContent = 'Hide uploads & save history'; }
        },'sa-positive');
        return el('article','sa-project-row',sectionRow(project.name,project.kind+' · '+(project.deleted?'Deleted':'Cloud saved')+' · revision '+project.revision),open,detail);
      }));
      if (data.hasMore) target.append(el('p','sa-row-detail','Showing the 100 most recently updated cloud projects.'));
      target.dataset.loaded = 'true';
    } catch(error) { target.replaceChildren(el('p','sa-associated','Could not load cloud projects: '+error.message)); }
    finally { button.disabled = false; button.textContent = 'Hide cloud projects & uploads'; }
  }
  function renderUsers(){
    const users=(state.users||[]).filter(u=>(filter==='all'||(u.status||'active')===filter)&&(!term||String(u.email||'').toLowerCase().includes(term)||u.id.toLowerCase().includes(term)));
    if(!users.length){panel.replaceChildren(empty('No matching accounts','Try another search or status filter.'));return;}
    const out=users.map(u=>{
      const s=state.sessions.find(x=>x.id===u.id),live=s&&!s.revoked&&s.expiresAt>Date.now();
      const st=u.status||'active',tone=st==='active'?'success':st==='blocked'?'danger':'warning';
      const main=sectionRow(u.email||u.id,'User ID: '+u.id,[badge(statusName(st),tone),live?badge('● Session online','success'):badge('Offline')]);
      const details=el('div','sa-user-details',
        el('span','', 'Registered: '+(u.registeredAt||'—')),
        el('span','',live?'Device: '+short(s.deviceId):'No active session'),
        el('span','',live?'Session expiry: '+date(s.expiresAt):''));
      const actions=el('div','sa-actions',
        btn('Restrict',()=>act({action:'moderate',uid:u.id,status:'restricted'},'Restrict '+(u.email||u.id)+' to read-only access?')),
        btn('Suspend 24h',()=>act({action:'moderate',uid:u.id,status:'suspended',until:Date.now()+86400000},'Suspend this account for 24 hours?')),
        btn('Block',()=>act({action:'moderate',uid:u.id,status:'blocked'},'Block '+(u.email||u.id)+'?'),'sa-danger'),
        btn('Restore',()=>act({action:'moderate',uid:u.id,status:'active'},'Restore this account?'),'sa-positive'),
        btn('Revoke session',()=>act({action:'moderate',uid:u.id,status:'revoke'},'Revoke the current session?'),'sa-quiet'));
      const roleSelect=h('select',{class:'admin-role-select','aria-label':`Access role for ${u.email||u.id}`},...['user','admin','tester'].map(value=>h('option',{value,selected:(u.role||'user')===value},value==='admin'?'Admin':value==='tester'?'Tester':'User')));
      const roleButton=btn('Update access',()=>assignRole(u.id,roleSelect,roleButton),'sa-positive');
      const roleControls=el('div','admin-role-controls',h('label',{},h('span',{},'Account access'),roleSelect),roleButton);
      const projects=el('div','sa-project-list');
      projects.hidden=true;
      const projectsButton=btn('View cloud projects & uploads',()=>showProjects(u.id,projectsButton,projects),'sa-positive');
      return el('article','sa-user',main,details,actions,roleControls,projectsButton,projects);
    });
    panel.replaceChildren(el('div','sa-results-count',users.length+' account'+(users.length===1?'':'s')), ...out);
  }
  function renderTesterRequests(){
    const requests=state.testerRequests||[];
    if(!requests.length){panel.replaceChildren(empty('No tester requests','New Google sign-ups requesting tester access will appear here.'));return;}
    panel.replaceChildren(...requests.map(request=>{
      const approve=btn('Approve',()=>reviewTester(request.uid,'approved',[approve,reject]),'sa-positive');
      const reject=btn('Reject',()=>reviewTester(request.uid,'rejected',[approve,reject]),'sa-danger');
      return el('article','sa-user',sectionRow(request.name||'Google user',`${request.email||request.uid} · UID: ${request.uid}`,[badge('Pending','warning')]),el('p','sa-row-detail','Requested '+date(request.submittedAt)),el('div','sa-actions',approve,reject));
    }));
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
    else if(tab==='testers')renderTesterRequests();
    else if(tab==='events')renderEvents();
    else if(tab==='devices')renderDevices();
    else renderAudit();
    more.replaceChildren();
    if(Object.values(state.cursors||{}).some(Boolean))more.append(btn('Load more records',()=>load(true),'sa-more-btn'));
    panel.append(more);
  }
  async function load(append=false){
    if(loading)return;loading=true;refresh.disabled=true;status.textContent='Syncing…';
    try{
      const data=await apiCall('/api/security',{action:'overview',...(append&&state?{cursors:state.cursors}:{})});
      if(append&&state)for(const key of ['users','sessions','devices','events','audit'])
        data[key]=[...new Map([...(state[key]||[]),...(data[key]||[])].map(v=>[v.id,v])).values()];
      state=data;renderStats();renderTabs();renderContent();status.textContent='Updated just now';
    }catch(e){status.textContent='Sync failed';if(!state)panel.replaceChildren(empty('Could not load security data',e.message));toast(e.message);}
    finally{loading=false;refresh.disabled=false;}
  }
  await load();
  requestTimer=window.setInterval(async()=>{
    if(!root.isConnected){window.clearInterval(requestTimer);return;}
    if(document.hidden)return;
    try{
      const data=await apiCall('/api/security',{action:'testerRequests'});
      if (!state) { await load(false); return; }
      const previous = new Set((state.testerRequests||[]).map(request=>request.uid));
      state.testerRequests=data.requests||[];
      const added=state.testerRequests.filter(request=>!previous.has(request.uid));
      if(added.length)toast(`${added.length} new tester access request${added.length===1?'':'s'} awaiting approval.`);
      renderStats();renderTabs();
      if(tab==='testers')renderTesterRequests();
    }catch(error){console.warn('Could not refresh tester requests:',error.message);}
  },3000);
  root.dispose=()=>window.clearInterval(requestTimer);
  return root;
}
