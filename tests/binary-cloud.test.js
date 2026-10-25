import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
const store=new Map(),puts=[],signs=[];
globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
globalThis.fetch=async(url,opts={})=>{
 if(opts.method==='PUT'){puts.push({url,headers:opts.headers,size:opts.body.size});return {ok:true,status:200};}
 return {ok:true,blob:async()=>files.get(url)};
};
const files=new Map();
mock.module('../src/session.js',{exports:{apiCall:async(url,body,uid)=>{
 assert.equal(url,'/api/r2');
 if(body.action==='sign'){signs.push(body);return {have:[],upload:Object.fromEntries(body.items.map(i=>[i.hash,{url:'https://r2.test/'+i.hash,headers:{'Content-Type':'application/octet-stream'}}])),...(body.state?{state:{url:'https://r2.test/state-'+body.state.opId,headers:{}}}:{})};}
 if(body.action==='urls')return {urls:Object.fromEntries(body.hashes.map(h=>[h,'https://r2.test/'+h]))};
 throw Error('unexpected '+body.action);
}}});
const {uploadAssets,downloadAssets,hashBlob}=await import('../src/binary-cloud.js');
const a=new Blob(['first picture']),b=new Blob(['second picture, longer']);

test('files are signed and sent once; what this browser already uploaded is neither signed nor sent again',async()=>{
 const ha=await hashBlob(a),hb=await hashBlob(b);
 const first=await uploadAssets('u1',new Map([[ha,a],[hb,b]]));
 assert.equal(signs.length,1);assert.equal(puts.length,2);assert.deepEqual(first.fresh.map(f=>f.size).sort(),[a.size,b.size].sort());
 const again=await uploadAssets('u1',new Map([[ha,a],[hb,b]]));
 assert.equal(signs.length,1);assert.equal(puts.length,2);assert.deepEqual(again.fresh,[]);        // no request at all
 const other=await uploadAssets('u2',new Map([[ha,a]]));                                           // another account has its own list
 assert.equal(signs.length,2);assert.equal(other.fresh.length,1);
});
test('a project snapshot is always signed and sent, together with only the new files',async()=>{
 const hc=await hashBlob(new Blob(['third']));
 const out=await uploadAssets('u1',new Map([[hc,new Blob(['third'])]]),{projectId:'p'.repeat(16),opId:'o'.repeat(16),blob:new Blob(['{}'])});
 const sign=signs.at(-1);assert.equal(sign.items.length,1);assert.equal(sign.state.size,2);assert.equal(out.sent,2);
 await uploadAssets('u1',new Map(),{projectId:'p'.repeat(16),opId:'q'.repeat(16),blob:new Blob(['{"v":2}'])});
 assert.deepEqual(signs.at(-1).items,[]);                                                           // nothing new: only the snapshot link is asked for
});
test('downloads are checked against their hash',async()=>{
 const h=await hashBlob(a);files.set('https://r2.test/'+h,a);
 const got=await downloadAssets('u1',[h,h]);assert.equal(got.size,1);assert.equal(await got.get(h).text(),'first picture');
 files.set('https://r2.test/'+h,new Blob(['tampered']));
 await assert.rejects(downloadAssets('u3',[h]),/kharab/);
});
