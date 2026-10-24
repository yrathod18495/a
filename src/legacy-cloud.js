import { auth, getDoc, wsDoc } from './firebase.js';
import { apiCall } from './session.js';
import { downloadBinary } from './binary-cloud.js';
import { importLegacyCloud, STORES } from './store.js';
export async function recoverLegacyCloud(uid) {
 if(auth.currentUser?.uid!==uid)throw Error('Purana cloud save wapas lene ke liye pehle sign in karein.');
 const snap=await getDoc(wsDoc(uid,'sync','main'));
 if(!snap.exists()||!Array.isArray(snap.data().items))throw Error('Koi purana cloud save nahi mila.');
 async function download(key) {
  if(typeof key!=='string'||!key.startsWith('sync/'))throw Error('Purana asset sahi nahi hai');
  return downloadBinary(uid,key);
 }
 async function unpack(v) {
  if(v?.__bin){const b=await download(v.__bin);return v.kind==='ab'?b.arrayBuffer():new Blob([b],{type:v.type||b.type});}
  if(Array.isArray(v))return Promise.all(v.map(unpack));
  if(v&&typeof v==='object'){const o={};for(const[k,x]of Object.entries(v))o[k]=await unpack(x);return o;}return v;
 }
 const records=[];
 for(const item of snap.data().items){
  const [store,...parts]=item.split('/');if(!STORES.includes(store))throw Error('Purane backup me anjaan store mila');
  const value=await unpack(JSON.parse(await(await download('sync/'+store+'/'+parts.join('/')+'/record.json')).text()));
  records.push({store,value});
 }
 if(auth.currentUser?.uid!==uid)throw Error('Account badal gaya. Dobara try karein.');
 return importLegacyCloud(uid,records);
}
