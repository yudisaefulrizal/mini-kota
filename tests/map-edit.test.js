import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyMap,validateMap} from '../src/map/format.js';
import {buildGeometry} from '../src/map/geometry.js';
import {addRoad,snapTarget,splitRoad,deleteRoad,deleteNode,insertPoint,deletePoint,simplify,History,pickRoad} from '../src/map/edit.js';

const blank=()=>emptyMap('uji',300,200);
const P=(x,z)=>({x,z});

test('a drawn road adds two nodes and validates',()=>{
  const map=blank();
  const road=addRoad(map,[P(10,50),P(60,40),P(110,50)],{profile:'jalan-1x1'});
  assert.equal(map.nodes.length,2);assert.deepEqual(road.points,[[60,40]]);
  validateMap(map);
});

test('ending near a node joins it; ending on a road body makes a T-junction',()=>{
  const map=blank();
  addRoad(map,[P(0,100),P(200,100)],{profile:'jalan-2x2',shape:'polyline'});
  const toNode=snapTarget(map,P(198,104),10);
  assert.equal(toNode.type,'node');
  const onRoad=snapTarget(map,P(100,106),10);
  assert.equal(onRoad.type,'road');assert.deepEqual(onRoad.point,P(100,100));
  addRoad(map,[P(100,20),onRoad.point],{profile:'jalan-1x1',endTarget:onRoad});
  assert.equal(map.roads.length,3,'the main road is split in two');
  const g=buildGeometry(validateMap(map));
  assert.deepEqual(g.junctions.map(j=>j.arms),[3]);
});

test('splitting a spline keeps control points on their own side',()=>{
  const map=blank();
  const r=addRoad(map,[P(0,0),P(50,30),P(100,0),P(150,30),P(200,0)],{profile:'jalan-1x1'});
  const node=splitRoad(map,r.id,P(100,0));
  const [a,b]=map.roads;
  assert.equal(a.to,node.id);assert.equal(b.from,node.id);
  assert.deepEqual(a.points,[[50,30]]);assert.deepEqual(b.points,[[150,30]]);
});

test('deleting a road removes nodes left without roads',()=>{
  const map=blank();
  const a=addRoad(map,[P(0,0),P(100,0)],{profile:'jalan-1x1'});
  addRoad(map,[P(100,0),P(100,100)],{profile:'jalan-1x1',startTarget:snapTarget(map,P(100,0),5)});
  deleteRoad(map,a.id);
  assert.equal(map.nodes.length,2);
  deleteNode(map,map.nodes[0].id);
  assert.equal(map.roads.length,0);assert.equal(map.nodes.length,0);
});

test('control points can be inserted in order and deleted',()=>{
  const map=blank();
  const r=addRoad(map,[P(0,0),P(100,0)],{profile:'jalan-1x1'});
  insertPoint(map,r.id,P(70,5));insertPoint(map,r.id,P(30,5));
  assert.deepEqual(r.points,[[30,5],[70,5]]);
  deletePoint(map,r.id,0);assert.deepEqual(r.points,[[70,5]]);
});

test('freehand strokes are simplified; picking finds the road under the cursor',()=>{
  const stroke=Array.from({length:50},(_,i)=>P(i*2,Math.sin(i/50)*0.2));
  assert.ok(simplify(stroke).length<=3);
  const map=blank();addRoad(map,[P(0,50),P(100,50)],{profile:'jalan-2x2'});
  assert.ok(pickRoad(map,P(50,55)));assert.equal(pickRoad(map,P(50,80)),null);
});

test('history undoes and redoes whole steps',()=>{
  let map=blank();const history=new History();
  history.record(map);addRoad(map,[P(0,0),P(50,0)],{profile:'jalan-1x1'});
  history.record(map);addRoad(map,[P(0,20),P(50,20)],{profile:'jalan-1x1'});
  map=history.undo(map);assert.equal(map.roads.length,1);
  map=history.undo(map);assert.equal(map.roads.length,0);
  map=history.redo(map);assert.equal(map.roads.length,1);
  assert.equal(history.canRedo,true);
});

test('snapping distance is measured from the road edge, so wide roads are easy to hit',()=>{
  const map=blank();
  addRoad(map,[P(0,100),P(200,100)],{profile:'jalan-2x2',shape:'polyline'});
  // 2x2 is 7.3 m from centre to edge; 15 m from the centre is still within 10 m of the edge.
  assert.equal(snapTarget(map,P(100,115),10)?.type,'road');
  assert.equal(snapTarget(map,P(100,120),10),null);
  // Near the end node of a wide road the node wins.
  assert.equal(snapTarget(map,P(12,112),10)?.type,'node');
});
