import { friendlyError } from '../shared/hinglish-errors.js';
import { h, brandWordmark } from './dom.js';
import { projectDialog } from './project-dialog.js';
import { listProjects, createProject, renameProject, deleteProject, copyProject } from './store.js';
import { refreshProjects, syncProject, onSyncStatus, resolveConflict, registerProject } from './project-sync.js';
export async function projectsView({user,kind,home,toast}) {
  const search=h('input',{class:'projects-search',type:'search',placeholder:'Search projects…','aria-label':'Search projects',oninput:()=>draw()});
  const root=h('div',{class:`sh projects-page ${kind==='animation'?'projects-animation':'projects-character'}`}), list=h('div',{class:'projects-grid'}), status=h('p',{class:'projects-status'});
  const open=p=>{location.hash='#/'+(kind==='animation'?'toons':'characters')+'/'+p.id;location.reload();};
  const run=fn=>async()=>{try{await fn();await draw();}catch(e){toast(e.message);}};
  const dialog=options=>projectDialog(options,root);
  async function draw(){
    const projects=(await listProjects(user.uid)).filter(p=>p.kind===kind&&!p.deleted).sort((a,b)=>b.updatedAt-a.updatedAt);
    list.replaceChildren(...projects.map(p=>{
      const actions=[
        h('button',{class:'btn project-action',onclick:run(async()=>{const name=await dialog({title:'Rename project',description:'Choose a clear name for this project.',value:p.name,confirmLabel:'Save name'});if(name)await renameProject(user.uid,p.id,name);})},'Rename'),
        h('button',{class:'btn project-action',onclick:run(async()=>{const copy=await copyProject(user.uid,p.id);toast('Your local work was saved under this name: '+copy.name);})},'Keep a Copy')
      ];
      if(p.dirty)actions.push(h('button',{class:'btn project-action',onclick:run(async()=>{
        if(!await dialog({title:'Resolve sync conflict?',description:'Your local edits will be saved as a separate project before the latest cloud version is restored here.',confirmLabel:'Keep edits and restore',danger:true,confirmOnly:true}))return;
        const backup=await resolveConflict(user.uid,p.id);toast('Your local changes were kept here: '+backup.name);
      })},'Resolve Conflict'));
      actions.push(h('button',{class:'btn project-action danger',onclick:run(async()=>{
        if(!await dialog({title:'Delete this project?',description:`“${p.name}” will be removed from your project list.`,confirmLabel:'Delete project',danger:true,confirmOnly:true}))return;
        await deleteProject(user.uid,p.id);
        // the project is gone locally the moment deleteProject resolves; the list must reflect that even if the cloud push below fails or is still catching up
        syncProject(user.uid,p.id).catch(()=>{});
      })},'Delete'));
      const when=t=>new Date(t).toLocaleString([],{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
      const rest=actions.filter(a=>!/^(Rename|Delete)$/.test(a.textContent));
      return h('article',{class:'project-card'},
        h('h2',{class:'project-name'},p.name),
        h('p',{class:'project-created'},'Last saved'),h('p',{class:'project-updated'},when(p.updatedAt)),
        h('p',{class:`project-state ${p.dirty?'pending':'saved'}`},p.dirty?'Waiting to sync to your account':'Synced to your account'),
        h('div',{class:'project-row'},h('button',{class:'btn pri project-open',onclick:()=>open(p)},'Open'),...actions.filter(a=>/^(Rename|Delete)$/.test(a.textContent))),
        rest.length?h('div',{class:'project-actions'},...rest):null);
    }));
    const q=search.value.trim().toLowerCase();
    if(q)for(const card of [...list.children])if(!card.querySelector('.project-name')?.textContent.toLowerCase().includes(q))card.remove();
    if(!list.children.length)list.append(h('div',{class:'projects-empty'},h('h2',{},q?'No projects match your search':'No projects yet'),h('p',{},q?'Try a different name.':'Create your first project to get started.')));
  }
  const title=kind==='animation'?'Animator Studio':'Character Editor';
  const toolbar=h('div',{class:'projects-toolbar'},
    h('button',{class:'btn pri project-new','aria-label':'Create New Project',onclick:run(async()=>{const name=await dialog({title:'Create a project',description:`Give your new ${kind==='animation'?'animation':'character'} project a name.`,value:'Untitled project',confirmLabel:'Create project'});if(name){const p=await createProject(user.uid,kind,name);const id=await registerProject(user.uid,p.id,kind,name);open(id===p.id?p:{...p,id});}})},'+ New Project'),
    search);
  root.append(h('header',{class:'projects-header'},h('a',{class:'projects-brand',href:'/#/',style:'text-decoration:none','aria-label':'12toons home'},...brandWordmark())),
    h('main',{class:'projects-main'},h('div',{class:'projects-panel-head'},h('h1',{},kind==='animation'?'Animator Studio Projects':'Character Editor Projects'),h('span',{class:'sp'}),h('button',{class:'projects-close','aria-label':'Close',title:'Back to dashboard',onclick:home},'✕')),toolbar,status,list));
  const off=onSyncStatus(s=>{status.textContent=s.text+(s.error?' — '+s.error:'');});
  root.dispose=off;
  await draw();
  refreshProjects(user.uid).then(draw).catch(e=>{status.textContent='The cloud is not available right now: '+friendlyError(e);});
  return root;
}
