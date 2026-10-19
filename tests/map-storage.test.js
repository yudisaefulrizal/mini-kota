import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMap} from '../src/map/format.js';
import {buildGeometry} from '../src/map/geometry.js';
import {addObject} from '../src/map/edit.js';
import {miniKotaRoads as convertMiniKota} from '../src/map/default-map.js';
import {serializeMap,parseMapFile,fileName,saveDraft,loadDraft,clearDraft,DRAFT_KEY} from '../src/map/storage.js';

const richMap=()=>{
  const map=validateMap(convertMiniKota());
  const gw=addObject(map,'gateway',{x:100,z:100,rotation:90});
  const cam=addObject(map,'cctv',{x:110,z:95,rotation:270});cam.gateway=gw.id;
  const lit=map.nodes.find(n=>n.signal);lit.signalPlan={pattern:'2-fase',leftFree:false,green:[30,25]};
  return map;
};
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),data};};

test('saving and loading gives back the same map, roads and all',()=>{
  const map=richMap(),text=serializeMap(map,{savedAt:'2026-10-18T10:00:00.000Z'});
  const back=parseMapFile(text);
  const strip=m=>{const {meta,...rest}=m;return rest;};
  assert.deepEqual(strip(back),strip(map));
  assert.equal(back.meta.savedAt,'2026-10-18T10:00:00.000Z');
  assert.equal(JSON.stringify(buildGeometry(back)),JSON.stringify(buildGeometry(map)));
  assert.deepEqual(Object.keys(JSON.parse(text)).slice(0,4),['format','version','name','bounds'],'stable key order');
});

test('broken files are refused with readable messages',()=>{
  assert.throws(()=>parseMapFile('{bukan json'),/bukan JSON/);
  assert.throws(()=>parseMapFile(JSON.stringify({format:'lain'})),/Bukan file peta/);
  const map=richMap();map.objects.push({id:map.objects[0].id,asset:'cctv',x:0,z:0});
  assert.throws(()=>parseMapFile(serializeMap(map)),/ganda/);
});

test('file names are safe and readable',()=>{
  assert.equal(fileName({name:'Mini Kota — Revisi 2!'}),'mini-kota-revisi-2.json');
  assert.equal(fileName({name:'   '}),'peta.json');
});

test('drafts round-trip and fail quietly when storage is unavailable',()=>{
  const storage=memory(),map=richMap();
  assert.equal(saveDraft(map,storage),true);
  const draft=loadDraft(storage);
  assert.equal(draft.map.roads.length,map.roads.length);assert.ok(draft.savedAt);
  clearDraft(storage);assert.equal(loadDraft(storage),null);
  const broken={getItem(){throw Error('blocked');},setItem(){throw Error('full');},removeItem(){throw Error('blocked');}};
  assert.equal(saveDraft(map,broken),false);assert.equal(loadDraft(broken),null);clearDraft(broken);
  storage.setItem(DRAFT_KEY,'{"map":{"format":"lain"}}');assert.equal(loadDraft(storage),null,'invalid draft ignored');
});
