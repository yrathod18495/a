export function memoryFirestore(){
 const data=new Map();let queue=Promise.resolve(),count=0;
 const doc=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path),delete:async()=>{data.delete(path);},set:async(v,opt)=>data.set(path,opt?.merge?{...data.get(path),...structuredClone(v)}:structuredClone(v)),collection:name=>collection(path+'/'+name)});
 const snap=path=>{const value=structuredClone(data.get(path));return {id:path.split('/').at(-1),exists:data.has(path),data:()=>value};};
 const collection=path=>{const filters=[];let max=Infinity;const query={doc:id=>doc(path+'/'+(id||'event'+(++count))),add:async value=>{const ref=doc(path+'/event'+(++count));await ref.set(value);return ref;},get:async()=>({docs:[...data.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1).filter(k=>filters.every(([field,value])=>data.get(k)?.[field]===value)).slice(0,max).map(snap)}),limit(n){max=n;return query;},orderBy(){return query;},where(field,op,value){if(op!=='==')throw Error('fake firestore supports equality filters only');filters.push([field,value]);return query;},startAfter(){return query;}};return query;};
 return {data,doc,collection,getAll:async(...refs)=>refs.map(r=>snap(r.path)),runTransaction(fn){
  const run=queue.then(async()=>{
   const writes=[];
   const t={get:async ref=>snap(ref.path),getAll:async(...refs)=>refs.map(r=>snap(r.path)),
    set:(ref,v,opt)=>writes.push(()=>data.set(ref.path,opt?.merge?{...data.get(ref.path),...structuredClone(v)}:structuredClone(v))),
    update:(ref,v)=>writes.push(()=>data.set(ref.path,{...data.get(ref.path),...structuredClone(v)})),
    create:(ref,v)=>writes.push(()=>{if(data.has(ref.path))throw Error('exists');data.set(ref.path,structuredClone(v));})};
   const out=await fn(t);writes.forEach(fn=>fn());return out;
  });queue=run.catch(()=>{});return run;
 }};
}
export function response(){
 return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};
}
