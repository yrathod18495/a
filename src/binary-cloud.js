import { apiCall } from './session.js';
const SIZE=2*1024*1024;
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const hash=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
export async function uploadBinary(uid,key,blob,deduplicate=false) {
 if(blob.size>40*1024*1024)throw Error('File exceeds the 40 MB limit.');
 const bytes=await blob.arrayBuffer(),digest=await hash(bytes);
 const existing=await apiCall('/api/r2',{action:'head',key},uid);
 if(existing.exists&&existing.digest===digest)return;
 const chunks=[];
 for(let start=0;start<blob.size;start+=SIZE){
  const data=new Uint8Array(bytes.slice(start,start+SIZE)),chunkKey='chunks/'+await hash(data);
  const head=await apiCall('/api/r2',{action:'head',key:chunkKey},uid);
  if(!head.exists)await apiCall('/api/r2',{action:'putChunk',key:chunkKey,data:base64(data)},uid);
  chunks.push({key:chunkKey,size:data.length});
 }
 await apiCall('/api/r2',{action:'complete',key,chunks,size:blob.size,type:blob.type||'application/octet-stream',digest},uid);
}
export async function downloadBinary(uid,key) {
 const head=await apiCall('/api/r2',{action:'head',key},uid);
 if(!head.exists||!Number.isSafeInteger(head.size)||head.size>40*1024*1024)throw Error('Cloud file unavailable.');
 const parts=[];
 for(let start=0;start<head.size;start+=SIZE){
  const out=await apiCall('/api/r2',{action:'get',key,start,length:SIZE},uid);
  parts.push(Uint8Array.from(atob(out.data),c=>c.charCodeAt(0)));
 }
 const blob=new Blob(parts,{type:head.type});
 if(blob.size!==head.size||head.digest&&await hash(await blob.arrayBuffer())!==head.digest)throw Error('Cloud file integrity check failed.');
 return blob;
}
