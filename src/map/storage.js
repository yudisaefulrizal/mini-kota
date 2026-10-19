import {validateMap} from './format.js';

// Saving and loading map files, plus an automatic draft in the browser so an accidental
// reload does not lose work. The draft is a per-browser convenience; the .json file is the
// real save.

export const DRAFT_KEY='minikota.editor.draft';

// Pretty, stable JSON: top-level keys in a fixed order so saved files diff cleanly.
const ORDER=['format','version','name','bounds','reference','profiles','nodes','roads','lots','gates','objects','meta'];
export function serializeMap(map,{savedAt=new Date().toISOString()}={}){
  const out={};
  for(const key of ORDER)if(map[key]!==undefined)out[key]=map[key];
  for(const key of Object.keys(map))if(!(key in out))out[key]=map[key];
  out.meta={...(map.meta||{}),app:'Mini Kota editor peta',savedAt};
  return JSON.stringify(out,null,2)+'\n';
}

// Reads a file's text into a validated map, with readable errors.
export function parseMapFile(text){
  let data;
  try{data=JSON.parse(text);}catch{throw Error('File ini bukan JSON yang valid. Pastikan yang dipilih adalah file peta (.json).');}
  return validateMap(data);
}

export function fileName(map){
  return `${(map.name||'peta').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'peta'}.json`;
}

// Draft helpers never throw: storage may be full, blocked or unavailable.
export function saveDraft(map,storage=globalThis.localStorage){
  try{storage.setItem(DRAFT_KEY,JSON.stringify({savedAt:new Date().toISOString(),map}));return true;}catch{return false;}
}
export function loadDraft(storage=globalThis.localStorage){
  try{
    const raw=storage.getItem(DRAFT_KEY);if(!raw)return null;
    const draft=JSON.parse(raw);
    return {savedAt:draft.savedAt,map:validateMap(draft.map)};
  }catch{return null;}
}
export function clearDraft(storage=globalThis.localStorage){try{storage.removeItem(DRAFT_KEY);}catch{}}
