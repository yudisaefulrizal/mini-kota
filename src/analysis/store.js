// The history and the models, kept in this browser (IndexedDB), per map:
//   chunks  [key, seq] -> a chunk of records (src/analysis/learn.js)
//   meta    key -> the registry: record count, chunk list, model versions and params
// Usable from the page and from the worker. Nothing leaves the browser.
const DB='mini-kota-analisis',VERSION=1;
let opening=null;
function open(){
  if(opening)return opening;
  opening=new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB,VERSION);
    r.onupgradeneeded=()=>{const db=r.result;db.createObjectStore('chunks',{keyPath:['key','seq']});db.createObjectStore('meta',{keyPath:'key'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>{opening=null;reject(r.error);};
  });
  return opening;
}
const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});
const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});

export async function loadMeta(key){
  try{const db=await open();return await req(db.transaction('meta').objectStore('meta').get(key))??null;}catch{return null;}
}
// Writes a chunk and the registry together.
export async function putChunk(meta,chunk){
  const db=await open(),tx=db.transaction(['chunks','meta'],'readwrite');
  tx.objectStore('chunks').put({...chunk,key:meta.key});tx.objectStore('meta').put(meta);
  return done(tx);
}
export async function putMeta(meta){const db=await open(),tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(meta);return done(tx);}
// The chunks with these seq numbers, one at a time (in order).
export async function* readChunks(key,seqs){
  const db=await open();
  for(const seq of seqs){const c=await req(db.transaction('chunks').objectStore('chunks').get([key,seq]));if(c)yield c;}
}
export async function clear(key){
  const db=await open(),tx=db.transaction(['chunks','meta'],'readwrite');
  tx.objectStore('chunks').delete(IDBKeyRange.bound([key,-Infinity],[key,Infinity]));tx.objectStore('meta').delete(key);
  return done(tx);
}
