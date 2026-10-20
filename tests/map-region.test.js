import test from 'node:test';
import assert from 'node:assert/strict';
import {miniKotaLengkap} from '../src/map/default-map.js';
import {emptyMap,validateMap} from '../src/map/format.js';
import {addRoad} from '../src/map/edit.js';
import {normalize} from '../src/map/normalize.js';
import {cityRegion,roadEnds,insideRegion,REGION_MARGIN} from '../src/map/region.js';
import {TrafficEngine} from '../src/traffic/engine.js';

test('Mini Kota: the 13 road ends on its edge are the gates, the 11 access roads are kawasan',()=>{
  const map=miniKotaLengkap(),ends=roadEnds(map),region=cityRegion(map);
  assert.deepEqual(ends.gates.map(g=>g.node).sort(),map.gates.map(g=>g.node).sort());
  assert.equal(ends.kawasan.size,11);assert.equal(ends.deadEnds.size,0);
  assert.deepEqual(ends.gates.map(g=>g.name),Array.from({length:13},(_,i)=>`Gerbang ${i+1}`));
  for(const n of map.nodes)assert.ok(insideRegion(region,n),`${n.id} inside`);
  assert.ok(region.box.x0<=-REGION_MARGIN+1&&region.box.width>614);
});

// Two parallel roads; a short road off the lower one ends below the upper one.
function grid(){
  const map=validateMap(emptyMap('uji',600,400));
  addRoad(map,[{x:50,z:100},{x:450,z:100}],{profile:'jalan-1x1',shape:'polyline'});
  addRoad(map,[{x:50,z:200},{x:450,z:200}],{profile:'jalan-1x1',shape:'polyline'});
  addRoad(map,[{x:250,z:200},{x:250,z:140}],{profile:'jalan-1x1',shape:'polyline'});
  normalize(map);   // the short road joins the lower one (a T-junction)
  return map;
}

test('a cul-de-sac inside the city is a road like any other: no vehicle appears or leaves there',()=>{
  const map=grid(),ends=roadEnds(map);
  assert.equal(ends.gates.length,4);assert.equal(ends.deadEnds.size,1);
  const cul=[...ends.deadEnds][0];assert.deepEqual([map.nodes.find(n=>n.id===cul).x,map.nodes.find(n=>n.id===cul).z],[250,140]);
  const e=new TrafficEngine(map,{demand:1800,seed:3});
  assert.ok(e.origins.every(s=>e.graph.byId.get(s).start!==cul));
  assert.ok(e.exits.every(s=>e.graph.byId.get(s).end!==cul));
  for(let t=0;t<300;t+=0.25)e.step(0.25);
  assert.ok(e.stats.completed>20);
});

test('drawing a road out past the edge widens the city; its end becomes a gate',()=>{
  const map=grid(),before=cityRegion(map).box;
  addRoad(map,[{x:50,z:100},{x:-150,z:100}],{profile:'jalan-1x1',shape:'polyline'});
  normalize(map);const far=roadEnds(map),after=cityRegion(map).box;
  assert.ok(after.x0<before.x0-100,`${before.x0} → ${after.x0}`);
  assert.ok(far.gates.some(g=>g.x===-150));
});
