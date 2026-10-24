import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { AccessError } from './security-policy.js';
export const CHUNK_SIZE = 2 * 1024 * 1024, MAX_FILE = 40 * 1024 * 1024;
const MAX_USER = 300 * 1024 * 1024;
const env = k => process.env[k] || '';
export const configured = () => !!(env('CLOUDFLARE_R2_ACCOUNT_ID') && env('CLOUDFLARE_R2_ACCESS_KEY_ID') && env('CLOUDFLARE_R2_SECRET_ACCESS_KEY') && env('CLOUDFLARE_R2_BUCKET_NAME'));
let s3;
export const client = () => s3 ||= new S3Client({
 region:'auto',endpoint:'https://'+env('CLOUDFLARE_R2_ACCOUNT_ID')+'.r2.cloudflarestorage.com',
 credentials:{accessKeyId:env('CLOUDFLARE_R2_ACCESS_KEY_ID'),secretAccessKey:env('CLOUDFLARE_R2_SECRET_ACCESS_KEY')},
 requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',
});
const digest = data => createHash('sha256').update(data).digest('hex');
const args = (uid,key) => ({Bucket:env('CLOUDFLARE_R2_BUCKET_NAME'),Key:'u/'+uid+'/'+key});
export function validKey(key) {
 if(typeof key!=='string'||!key.length||key.length>300||key.includes('\\')||key.split('/').some(p=>!p||p==='.'||p==='..'))
  throw new AccessError('invalid_key','File ka path sahi nahi hai.',400);
 return key;
}
export async function objectHead(uid,key) {
 validKey(key);
 try {
  const h=await client().send(new HeadObjectCommand(args(uid,key)));
  const chunked=h.Metadata?.protocol==='chunks-v1';
  return {exists:true,size:chunked?Number(h.Metadata.logicalsize):h.ContentLength,type:h.Metadata?.filetype||h.ContentType||'application/octet-stream',chunked,digest:h.Metadata?.digest||null};
 } catch(e){if(e.$metadata?.httpStatusCode===404)return {exists:false};throw e;}
}
async function raw(uid,key,range) {
 const out=await client().send(new GetObjectCommand({...args(uid,validKey(key)),...(range?{Range:range}:{})}));
 return Buffer.from(await out.Body.transformToByteArray());
}
async function quota(uid,extra) {
 let used=0,token;
 do {
  const page=await client().send(new ListObjectsV2Command({Bucket:env('CLOUDFLARE_R2_BUCKET_NAME'),Prefix:'u/'+uid+'/',ContinuationToken:token}));
  for(const o of page.Contents||[])used+=o.Size||0;
  token=page.IsTruncated?page.NextContinuationToken:undefined;
 }while(token);
 if(used+extra>MAX_USER)throw new AccessError('quota_exceeded','Cloud storage ki limit poori ho gayi. Purani files hatakar dobara try karein.',413);
}
async function immutablePut(uid,key,body,metadata,authorize) {
 const head=await objectHead(uid,key);
 if(head.exists){if(head.digest===metadata.digest)return;throw new AccessError('immutable_file','Ye file pehle se maujood hai aur uska content alag hai.',409);}
 await quota(uid,body.length);await authorize();
 try {
  await client().send(new PutObjectCommand({...args(uid,key),Body:body,ContentType:'application/octet-stream',Metadata:metadata,IfNoneMatch:'*'}));
 }catch(e){
  if(e.$metadata?.httpStatusCode!==412)throw e;
  const latest=await objectHead(uid,key);if(latest.digest!==metadata.digest)throw new AccessError('immutable_file','File ek saath do jagah se badal gayi. Dobara try karein.',409);
 }
}
export async function putChunk(uid,body,authorize) {
 if(typeof body.data!=='string'||body.data.length>Math.ceil(CHUNK_SIZE/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))throw new AccessError('invalid_chunk','Upload ka hissa sahi nahi hai.',400);
 const data=Buffer.from(body.data,'base64'),hash=digest(data);
 if(data.length>CHUNK_SIZE||body.key!=='chunks/'+hash)throw new AccessError('invalid_chunk','Upload ka hissa kharab ho gaya (checksum match nahi hua). Dobara try karein.',400);
 await immutablePut(uid,body.key,data,{digest:hash},authorize);
 return {ok:true};
}
export async function completeObject(uid,body,authorize) {
 validKey(body.key);
 if(!/^(assets|projects|characters)\//.test(body.key)||!Array.isArray(body.chunks)||body.chunks.length>20||!Number.isSafeInteger(body.size)||body.size<0||body.size>MAX_FILE||typeof body.type!=='string'||body.type.length>150||! /^[a-f0-9]{64}$/.test(body.digest))
  throw new AccessError('invalid_upload','Upload ki list sahi nahi hai.',400);
 let size=0;const hash=createHash('sha256');
 for(const [i,c] of body.chunks.entries()) {
  if(!/^chunks\/[a-f0-9]{64}$/.test(c.key)||!Number.isSafeInteger(c.size)||c.size<0||c.size>CHUNK_SIZE||(i<body.chunks.length-1&&c.size!==CHUNK_SIZE))throw new AccessError('invalid_chunk','Upload ka hissa sahi nahi hai.',400);
  const data=await raw(uid,c.key);
  if(data.length!==c.size||'chunks/'+digest(data)!==c.key)throw new AccessError('incomplete_upload','Upload poora nahi hua. Dobara try karein.',409);
  size+=data.length;hash.update(data);
 }
 if(size!==body.size||hash.digest('hex')!==body.digest||body.key.startsWith('assets/')&&body.key!=='assets/'+body.digest)throw new AccessError('incomplete_upload','Upload kharab ho gaya (checksum match nahi hua). Dobara try karein.',409);
 const recipe=Buffer.from(JSON.stringify({version:1,chunks:body.chunks}));
 await immutablePut(uid,body.key,recipe,{protocol:'chunks-v1',logicalsize:String(size),filetype:body.type,digest:body.digest},authorize);
 return {ok:true};
}
export async function readRange(uid,key,start=0,length=CHUNK_SIZE) {
 const head=await objectHead(uid,key);
 if(!head.exists)throw new AccessError('not_found','File nahi mili.',404);
 if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(length)||length<1||length>CHUNK_SIZE||head.size>MAX_FILE)throw new AccessError('invalid_range','File ki range sahi nahi hai.',400);
 if(start>=head.size)return {data:'',type:head.type,size:head.size};
 const end=Math.min(head.size,start+length),parts=[];
 if(!head.chunked)parts.push(await raw(uid,key,'bytes='+start+'-'+(end-1)));
 else {
  const recipe=JSON.parse((await raw(uid,key)).toString('utf8'));let offset=0;
  for(const c of recipe.chunks){
   const next=offset+c.size;
   if(next>start&&offset<end)parts.push(await raw(uid,c.key,'bytes='+Math.max(0,start-offset)+'-'+(Math.min(c.size,end-offset)-1)));
   offset=next;if(offset>=end)break;
  }
 }
 const data=Buffer.concat(parts);if(data.length!==end-start)throw new AccessError('incomplete_file','Saved file adhuri hai.',409);
 return {data:data.toString('base64'),type:head.type,size:head.size};
}
export async function readObject(uid,key) {
 const head=await objectHead(uid,key);if(!head.exists||head.size>MAX_FILE)throw new AccessError('invalid_file','Saved file sahi nahi hai.',400);
 const parts=[];for(let start=0;start<head.size;start+=CHUNK_SIZE)parts.push(Buffer.from((await readRange(uid,key,start)).data,'base64'));
 return Buffer.concat(parts);
}
