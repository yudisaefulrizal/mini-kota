import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateMap,crossSection,emptyMap,DEFAULT_PROFILES} from '../src/map/format.js';
import {buildGeometry,offsetLine,cut,polylineLength} from '../src/map/geometry.js';
import {miniKotaRoads} from '../src/map/default-map.js';

const testMap=()=>validateMap(JSON.parse(readFileSync(new URL('../public/maps/peta-uji.json',import.meta.url),'utf8')));
const finite=value=>JSON.stringify(value,(k,v)=>{if(typeof v==='number'&&!Number.isFinite(v))throw Error(`non-finite ${k}`);return v;});

test('validateMap rejects broken files with readable messages',()=>{
  assert.throws(()=>validateMap({format:'lain'}),/Bukan file peta/);
  const base=emptyMap('uji');
  assert.throws(()=>validateMap({...base,version:2}),/Versi peta/);
  const nodes=[{id:'a',x:0,z:0},{id:'b',x:10,z:0}];
  assert.throws(()=>validateMap({...base,nodes,roads:[{id:'r',from:'a',to:'x',profile:'jalan-1x1'}]}),/simpul ujung/);
  assert.throws(()=>validateMap({...base,nodes,roads:[{id:'r',from:'a',to:'b',profile:'jalan-9x9'}]}),/profil jalan-9x9/);
  assert.throws(()=>validateMap({...base,nodes:[...nodes,{id:'a',x:1,z:1}]}),/ganda/);
  assert.equal(validateMap({...base,nodes,roads:[{id:'r',from:'a',to:'b',profile:'jalan-1x1'}]}).roads.length,1);
});

test('cross-section puts forward lanes on the left and centres one-way roads',()=>{
  assert.deepEqual(crossSection(DEFAULT_PROFILES['jalan-2x2']),{left:7.3,right:7.3,center:0.3});
  assert.deepEqual(crossSection(DEFAULT_PROFILES['satu-arah-2']),{left:3.5,right:3.5,center:0});
});

test('offsets go to the left of the direction of travel; cut keeps the requested length',()=>{
  const line=[{x:0,z:0},{x:10,z:0}];
  assert.deepEqual(offsetLine(line,2).map(p=>[p.x,p.z]),[[0,-2],[10,-2]]);
  assert.ok(Math.abs(polylineLength(cut([{x:0,z:0},{x:10,z:0},{x:10,z:10}],3,15))-12)<1e-9);
});

test('test map builds every junction type cleanly',()=>{
  const g=buildGeometry(testMap());
  finite(g);
  assert.equal(g.warnings.length,0,g.warnings.map(w=>w.message).join('; '));
  const arms=Object.fromEntries(g.junctions.map(j=>[j.id,j.arms]));
  assert.deepEqual(arms,{'simpang-4':4,'simpang-3':3,'simpang-y':3,'bund-timur':3,'bund-selatan':3,'bund-barat':3,'bund-utara':3});
  for(const p of g.polygons)assert.ok(p.points.length>=6,`junction ${p.node} outline too small`);
  assert.ok(g.quads.some(q=>q.zebra),'zebra crossings expected');
  assert.ok(g.quads.some(q=>!q.zebra),'stop lines expected');
  assert.ok(g.ribbons.some(r=>r.kind==='sidewalk'&&r.corner),'corner pavements expected');
});

test('ribbons of a road meet the junction outline exactly',()=>{
  const g=buildGeometry(testMap());
  const outline=g.polygons.find(p=>p.node==='simpang-4').points;
  const asphalt=g.ribbons.filter(r=>r.kind==='asphalt');
  const ends=asphalt.flatMap(r=>[r.left[0],r.right[0],r.left.at(-1),r.right.at(-1)]);
  for(const p of outline.slice(0,2))assert.ok(ends.some(e=>Math.hypot(e.x-p.x,e.z-p.z)<1e-9),'mouth point shared with a road edge');
});

test('Mini Kota map data: valid, two lanes each way, the original layout, deterministic geometry',()=>{
  const map=miniKotaRoads();
  assert.equal(map.nodes.length,58);assert.equal(map.roads.length,65);
  assert.equal(map.nodes.filter(n=>n.signal).length,15);assert.equal(map.gates.length,13);assert.equal(map.lots.length,11);
  assert.ok(map.roads.filter(r=>!['akses','bundaran'].includes(r.profile)).every(r=>r.profile==='jalan-2x2'));
  const g=buildGeometry(map);finite(g);
  assert.ok(g.warnings.every(w=>w.type==='short'),g.warnings.map(w=>w.message).join('; '));
  assert.equal(JSON.stringify(buildGeometry(miniKotaRoads())),JSON.stringify(g),'deterministic');
});
