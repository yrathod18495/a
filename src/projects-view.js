import { friendlyError } from '../shared/hinglish-errors.js';
import { h, brandWordmark } from './dom.js';
import { listProjects, createProject, renameProject, deleteProject, copyProject } from './store.js';
import { refreshProjects, syncProject, onSyncStatus, resolveConflict } from './project-sync.js';
export async function projectsView({user,kind,home,toast}) {
  const root=h('div',{class:`sh projects-page ${kind==='animation'?'projects-animation':'projects-character'}`}), list=h('div',{class:'projects-grid'}), status=h('p',{class:'projects-status'});
  const open=p=>{location.hash='#/'+(kind==='animation'?'toons':'characters')+'/'+p.id;location.reload();};
  const run=fn=>async()=>{try{await fn();await draw();}catch(e){toast(e.message);}};
  function dialog({title,description='',value='',placeholder='',confirmLabel='Continue',danger=false,confirmOnly=false}){
    return new Promise(resolve=>{
      const input=confirmOnly?null:h('input',{class:'project-dialog-input',type:'text',value,placeholder,'aria-label':title,maxlength:80});
      const close=result=>{window.removeEventListener('keydown',onKey);overlay.remove();resolve(result);};
      const onKey=e=>{if(e.key==='Escape')close(null);if(e.key==='Enter'&&!confirmOnly){e.preventDefault();save();}};
      const save=()=>{const text=input?.value.trim();if(!confirmOnly&&!text){input?.focus();return;}close(confirmOnly?true:text);};
      const overlay=h('div',{class:'project-dialog-backdrop',onclick:e=>{if(e.target===overlay)close(null);}},
        h('section',{class:'project-dialog','role':'dialog','aria-modal':'true','aria-labelledby':'project-dialog-title'},
          h('span',{class:'project-dialog-icon','aria-hidden':'true'},danger?'!':'✦'),
          h('h2',{id:'project-dialog-title'},title),
          description?h('p',{class:'project-dialog-description'},description):null,
          input,
          h('div',{class:'project-dialog-actions'},
            h('button',{class:'btn project-dialog-cancel',onclick:()=>close(null)},'Cancel'),
            h('button',{class:`btn ${danger?'project-dialog-danger':'pri'} project-dialog-confirm`,onclick:save},confirmLabel))));
      window.addEventListener('keydown',onKey);root.append(overlay);input?.focus();input?.select();
    });
  }
  async function draw(){
    const projects=(await listProjects(user.uid)).filter(p=>p.kind===kind&&!p.deleted).sort((a,b)=>b.updatedAt-a.updatedAt);
    list.replaceChildren(...projects.map(p=>{
      const actions=[
        h('button',{class:'btn project-action',onclick:run(async()=>{const name=await dialog({title:'Rename project',description:'Choose a clear name for this project.',value:p.name,confirmLabel:'Save name'});if(name)await renameProject(user.uid,p.id,name);})},'Rename'),
        h('button',{class:'btn project-action',onclick:run(async()=>{const copy=await copyProject(user.uid,p.id);toast('Aapka local kaam is naam se bacha liya gaya: '+copy.name);})},'Keep a Copy')
      ];
      if(p.dirty)actions.push(h('button',{class:'btn project-action',onclick:run(async()=>{
        if(!await dialog({title:'Resolve sync conflict?',description:'Your local edits will be saved as a separate project before the latest cloud version is restored here.',confirmLabel:'Keep edits and restore',danger:true,confirmOnly:true}))return;
        const backup=await resolveConflict(user.uid,p.id);toast('Aapke local badlav yahan rakhe gaye: '+backup.name);
      })},'Resolve Conflict'));
      actions.push(h('button',{class:'btn project-action danger',onclick:run(async()=>{
        if(!await dialog({title:'Delete this project?',description:`“${p.name}” will be removed from your project list.`,confirmLabel:'Delete project',danger:true,confirmOnly:true}))return;
        await deleteProject(user.uid,p.id);
        // the project is gone locally the moment deleteProject resolves; the list must reflect that even if the cloud push below fails or is still catching up
        syncProject(user.uid,p.id).catch(()=>{});
      })},'Delete'));
      return h('article',{class:'project-card'},
        h('div',{class:'project-card-head'},h('span',{class:'project-card-icon','aria-hidden':'true'},kind==='animation'?'▶':'✦'),h('span',{class:`project-badge ${p.dirty?'pending':'saved'}`},p.dirty?'Cloud pending':'Saved to Cloud')),
        h('h2',{class:'project-name'},p.name),h('p',{class:'project-state'},p.dirty?'Your latest changes are saved on this device and waiting to sync.':'This project is synced and ready to open.'),
        h('button',{class:'btn pri project-open',onclick:()=>open(p)},'Open Project'),
        h('div',{class:'project-actions'},...actions));
    }));
    if(!projects.length)list.append(h('div',{class:'projects-empty'},h('span',{'aria-hidden':'true'},'✦'),h('h2',{},'No projects yet'),h('p',{},'Create your first project to get started.')));
  }
  const title=kind==='animation'?'Animation Studio':'Character Studio';
  const toolbar=h('div',{class:'projects-toolbar'},
    h('button',{class:'btn pri',onclick:run(async()=>{const name=await dialog({title:'Create a project',description:`Give your new ${kind==='animation'?'animation':'character'} project a name.`,value:'Untitled project',confirmLabel:'Create project'});if(name){const p=await createProject(user.uid,kind,name);open(p);}})},'Create New Project'),
    kind!=='animation'?h('button',{class:'btn',onclick:run(async()=>{await refreshProjects(user.uid);})},'Refresh from Cloud'):null);
  root.append(h('header',{class:'projects-header'},h('a',{class:'projects-brand',href:'/#/',style:'text-decoration:none','aria-label':'12toons home'},...brandWordmark()),h('span',{class:'projects-divider'}),h('div',{class:'projects-heading'},h('h1',{},'My Projects'),h('p',{},title)),h('span',{class:'sp'}),h('button',{class:'btn projects-home',onclick:home},'Home')),
    h('main',{class:'projects-main'},h('div',{class:'projects-intro'},h('div',{},h('span',{class:'projects-eyebrow'},'YOUR WORKSPACE'),h('h2',{},`Your ${kind==='animation'?'animations':'characters'}`),h('p',{},`Open and manage your ${kind==='animation'?'animation':'character'} projects.`)),status),toolbar,list));
  const off=onSyncStatus(s=>{status.textContent=s.text+(s.error?' — '+s.error:'');});
  root.dispose=off;
  await draw();
  refreshProjects(user.uid).then(draw).catch(e=>{status.textContent='Cloud abhi nahi mil raha: '+friendlyError(e);});
  return root;
}
