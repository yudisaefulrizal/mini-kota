import test from 'node:test';
import {miniKotaRoads,miniKotaLengkap} from '../src/map/default-map.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateMap,crossSection} from '../src/map/format.js';
import {buildGeometry,pointAt,polylineLength} from '../src/map/geometry.js';
import {projectOnLine} from '../src/map/edit.js';
import {miniKotaRoads as convertMiniKota} from '../src/map/default-map.js';
import {furnish,FOOTPRINT,lotKind} from '../src/map/furnish.js';
import {importOSM} from '../src/map/osm.js';

const full=()=>{const map=miniKotaRoads();const result=furnish(map);return {map,result};};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

test('Mini Kota is filled: every outer approach has a light, every signal (or simpang gabungan) one CCTV and one controller',()=>{
  const {map}=full(),g=buildGeometry(map);
  validateMap(map);
  const signals=g.junctions.filter(j=>map.nodes.find(n=>n.id===j.id).signal===true);
  // Each object belongs to the signalised junction nearest to it.
  const owner=o=>signals.reduce((best,j)=>!best||dist(o,j)<dist(o,best)?j:best,null);
  for(const j of signals){
    const near=asset=>map.objects.filter(o=>o.asset===asset&&owner(o)===j&&dist(o,j)<j.legs.reduce((m,l)=>Math.max(m,l.setback),0)+26);
    // A light beside every approach (it may stand a little back on a sharp fork).
    const lights=map.objects.filter(o=>/^traffic-light/.test(o.asset));
    for(const leg of j.legs.filter(l=>!l.access&&!l.internal)){
      // The first 22 m of the approach, following the road (it may curve).
      const gr=g.roads.find(r=>r.id===leg.road),out=leg.atStart?gr.line:[...gr.line].reverse();
      if(polylineLength(out)<6)continue;   // an approach straight out of the next junction has no kerb for a pole
      const samples=Array.from({length:12},(_,i)=>pointAt(out,i*2).p);
      assert.ok(lights.some(o=>samples.some(p=>dist(o,p)<=leg.right+leg.curb+leg.sidewalk+1)),`light at ${j.id} for ${leg.road}`);
    }
    // A simpang gabungan has one set, at its first junction; the other members none.
    const expected=!j.cluster||j.cluster===j.id?1:0;
    assert.equal(near('cctv-dome').length,expected,`cctv at ${j.id}`);
    assert.equal(near('controller').length,expected,`controller at ${j.id}`);
  }
  // No light on the link inside a simpang gabungan.
  for(const c of g.clusters)for(const id of c.roads){
    const r=g.roads.find(r=>r.id===id),mid=pointAt(r.line,polylineLength(r.line)/2).p;
    assert.ok(!map.objects.some(o=>/^traffic-light/.test(o.asset)&&dist(o,mid)<6),`no light on ${id}`);
  }
});

test('each lot gets its building, and buildings stay off the roads and each other',()=>{
  const {map}=full(),g=buildGeometry(map);
  const expected={school:'school',campus:'campus',industry:'factory',datacenter:'data-center',waste:'tps3r',shop:'mall'};
  for(const lot of map.lots){
    const inside=map.objects.filter(o=>FOOTPRINT[o.asset]&&o.x>lot.x&&o.x<lot.x+lot.w&&o.z>lot.z&&o.z<lot.z+lot.d);
    const kind=lotKind(lot);
    if(expected[kind])assert.ok(inside.some(o=>o.asset===expected[kind]),`${lot.id} has ${expected[kind]}`);
    if(kind==='home')assert.ok(inside.length>=8,`${lot.id} houses ${inside.length}`);
  }
  const rect=o=>{const [w,d]=FOOTPRINT[o.asset],q=Math.round(o.rotation/90)%2===1,hw=(q?d:w)/2,hd=(q?w:d)/2;return {x0:o.x-hw,x1:o.x+hw,z0:o.z-hd,z1:o.z+hd};};
  const buildings=map.objects.filter(o=>FOOTPRINT[o.asset]).map(rect);
  for(let a=0;a<buildings.length;a++)for(let b=a+1;b<buildings.length;b++){
    const p=buildings[a],q=buildings[b];assert.ok(p.x1<=q.x0||q.x1<=p.x0||p.z1<=q.z0||q.z1<=p.z0,'buildings overlap');
  }
  for(const b of buildings)for(const gr of g.roads){
    const prof=map.profiles[gr.profile],cs=crossSection(prof),clear=Math.max(cs.left,cs.right)+prof.curb;
    for(const p of [{x:b.x0,z:b.z0},{x:b.x1,z:b.z0},{x:b.x0,z:b.z1},{x:b.x1,z:b.z1},{x:(b.x0+b.x1)/2,z:(b.z0+b.z1)/2}])
      assert.ok(projectOnLine(gr.line,p).distance>clear,`building on road ${gr.id}`);
  }
});

test('street furniture stands beside the road, never on the carriageway',()=>{
  const {map,result}=full(),g=buildGeometry(map);
  assert.ok(result.added['street-light']>40&&result.added['tree-shade']>40,'lights and trees along the roads');
  assert.ok(result.added['bus-stop']>=3&&result.added['bin-sensor']>=5&&result.added.gateway>=5);
  for(const o of map.objects){
    if(FOOTPRINT[o.asset])continue;
    for(const gr of g.roads){const cs=crossSection(map.profiles[gr.profile]);assert.ok(projectOnLine(gr.line,o).distance>Math.max(cs.left,cs.right)-0.01,`${o.asset} ${o.id} on road ${gr.id}`);}
  }
});

test('deterministic, and a second run adds nothing; works on maps without lots',()=>{
  const a=full(),b=full();
  assert.deepEqual(a.map.objects,b.map.objects);
  assert.equal(furnish(a.map).total,0);
  const uji=validateMap(JSON.parse(readFileSync(new URL('../public/maps/peta-uji.json',import.meta.url),'utf8')));
  const r=furnish(uji);assert.ok((r.added['traffic-light']||0)+(r.added['traffic-light-arm']||0)>=7&&r.added['street-light']>10,JSON.stringify(r.added));
  const {map:osm}=importOSM(readFileSync(new URL('./fixtures/contoh.osm',import.meta.url),'utf8'));
  assert.ok(furnish(osm).added['cctv-dome']===1);
});
