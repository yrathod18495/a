// Every file request validates the current Firebase session. No bearer R2 URLs leave the server.
import { access, bodyOf, send, failure } from '../server/access.js';
import { configured, objectHead, putChunk, completeObject, readRange } from '../server/r2-storage.js';
const maintenanceEnabled = () => process.env.MAINTENANCE_MODE !== 'false';
export default async function handler(req,res) {
 if(req.method!=='POST')return send(res,405,{error:'POST required'});
 try {
  const b=await bodyOf(req,3*1024*1024);
  if(b.action==='status')return send(res,200,{configured:configured()});
  if(!configured())return send(res,503,{error:'R2 is not configured on the server.'});
  const write=['put','putChunk','complete','delete'].includes(b.action);
  const who=await access(req,{write}), {uid}=who;
  if(maintenanceEnabled()&&!who.admin)return send(res,503,{code:'maintenance',error:'12toons is temporarily under maintenance.'});
  const authorize=()=>access(req,{write:true});
  if(b.action==='head')return send(res,200,await objectHead(uid,b.key));
  if(b.action==='get')return send(res,200,await readRange(uid,b.key,b.start??0,b.length??2*1024*1024));
  if(b.action==='putChunk')return send(res,200,await putChunk(uid,b,authorize));
  if(b.action==='complete')return send(res,200,await completeObject(uid,b,authorize));
  return send(res,400,{error:'Unsupported file action. Update this browser tab.'});
 }catch(e){return failure(res,e);}
}

