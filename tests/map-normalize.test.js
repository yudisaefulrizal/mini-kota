import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyMap,validateMap} from '../src/map/format.js';
import {buildGeometry} from '../src/map/geometry.js';
import {addRoad,moveNode} from '../src/map/edit.js';
import {normalize,editScope,describeChanges} from '../src/map/normalize.js';
import {convertMiniKota} from '../src/map/convert-minikota.js';

const P=(x,z)=>({x,z});
const blank=()=>emptyMap('uji',400,300);
const arms=map=>buildGeometry(validateMap(map)).junctions.map(j=>j.arms).sort();
const snap=map=>JSON.parse(JSON.stringify(map));

test('two roads drawn across each other become a crossroads',()=>{
  const map=blank();
  addRoad(map,[P(0,100),P(200,100)],{profile:'jalan-2x2',shape:'polyline'});
  const before=snap(map);
  addRoad(map,[P(100,0),P(100,200)],{profile:'jalan-1x1',shape:'polyline'});
  const changes=normalize(map,editScope(before,map));
  assert.equal(changes.filter(c=>c.type==='crossing').length,1);
  assert.equal(map.roads.length,4);
  assert.deepEqual(arms(map),[4]);
  assert.equal(describeChanges(changes),'1 perempatan dibuat');
});

test('a curved road crossing two roads makes two junctions',()=>{
  const map=blank();
  addRoad(map,[P(0,80),P(300,80)],{profile:'jalan-1x1',shape:'polyline'});
  addRoad(map,[P(0,180),P(300,180)],{profile:'jalan-1x1',shape:'polyline'});
  const before=snap(map);
  addRoad(map,[P(100,20),P(160,130),P(120,250)],{profile:'jalan-1x1'});
  normalize(map,editScope(before,map));
  assert.deepEqual(arms(map),[4,4]);
});

test('ends dropped close to each other are merged into one node',()=>{
  const map=blank();
  addRoad(map,[P(0,100),P(100,100)],{profile:'jalan-1x1'});
  const before=snap(map);
  addRoad(map,[P(103,102),P(200,150)],{profile:'jalan-1x1'});
  const changes=normalize(map,editScope(before,map));
  assert.equal(changes[0].type,'node-merge');
  assert.equal(map.nodes.length,3);
});

test('a dragged road end that lands beside a road attaches as a T-junction',()=>{
  const map=blank();
  addRoad(map,[P(0,100),P(300,100)],{profile:'jalan-1x1',shape:'polyline'});
  const branch=addRoad(map,[P(150,20),P(150,60)],{profile:'jalan-1x1',shape:'polyline'});
  const before=snap(map);
  moveNode(map,branch.to,P(150,95));   // 1 m beyond the 3 m half-width edge
  normalize(map,editScope(before,map));
  assert.deepEqual(arms(map),[3]);
});

test('two junctions joined by a very short road become one junction',()=>{
  const map=blank();
  addRoad(map,[P(0,100),P(300,100)],{profile:'jalan-1x1',shape:'polyline'});
  addRoad(map,[P(140,0),P(140,100)],{profile:'jalan-1x1',shape:'polyline',endTarget:{type:'road',id:'r1',point:P(140,100)}});
  const before=snap(map);
  addRoad(map,[P(146,100),P(146,250)],{profile:'jalan-1x1',shape:'polyline',startTarget:{type:'road',id:map.roads.find(r=>r.to==='n2').id,point:P(146,100)}});
  const changes=normalize(map,editScope(before,map));
  assert.ok(changes.some(c=>c.type==='junction-gap'),describeChanges(changes));
  assert.deepEqual(arms(map),[4]);
});

test('a tiny dead-end spur is removed',()=>{
  const map=blank();
  addRoad(map,[P(0,100),P(300,100)],{profile:'jalan-1x1',shape:'polyline'});
  const before=snap(map);
  addRoad(map,[P(150,100),P(150,97)],{profile:'jalan-1x1',startTarget:{type:'road',id:'r1',point:P(150,100)}});
  normalize(map,editScope(before,map));
  const changes=normalize(map);
  assert.deepEqual(changes,[]);   // already removed by the scoped pass above
  assert.equal(map.roads.length,2,'only the two halves of the main road remain');
  assert.equal(map.nodes.filter(n=>!map.roads.some(r=>r.from===n.id||r.to===n.id)).length,0);
});

test('editing one corner of Mini Kota does not rearrange the rest',()=>{
  const map=validateMap(convertMiniKota()),roads=map.roads.length,nodes=map.nodes.length;
  const before=snap(map);
  addRoad(map,[P(20,390),P(80,395)],{profile:'jalan-1x1'});
  const changes=normalize(map,editScope(before,map));
  assert.deepEqual(changes,[]);
  assert.equal(map.roads.length,roads+1);assert.equal(map.nodes.length,nodes+2);
});

test('tidying the whole of Mini Kota changes nothing: it already follows the rules',()=>{
  const map=validateMap(convertMiniKota()),before=JSON.stringify(map);
  assert.deepEqual(normalize(map),[]);
  assert.equal(JSON.stringify(map),before);
});
