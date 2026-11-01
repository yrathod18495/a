import { h } from './dom.js';
// A small modal used for renaming, creating and deleting projects (same look everywhere).
export function projectDialog({title,description='',value='',placeholder='',confirmLabel='Continue',danger=false,confirmOnly=false,maxLength=80},host=document.body){
  return new Promise(resolve=>{
    const input=confirmOnly?null:h('input',{class:'project-dialog-input',type:'text',value,placeholder,'aria-label':title,maxlength:maxLength});
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
    window.addEventListener('keydown',onKey);host.append(overlay);input?.focus();input?.select();
  });
}
