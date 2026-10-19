import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateMap,crossSection} from '../src/map/format.js';
import {buildGeometry} from '../src/map/geometry.js';
import {roadLine,projectOnLine,addObject,deleteObject,setGateway} from '../src/map/edit.js';
import {smartPlace,gatewayOf,ruleFor} from '../src/map/placement.js';
import {miniKotaRoads as convertMiniKota} from '../src/map/default-map.js';

const manifest=JSON.parse(readFileSync(new URL('../public/models/manifest.json',import.meta.url),'utf8'));
const asset=id=>manifest.assets.find(a=>a.id===id);
const testMap=()=>validateMap(JSON.parse(readFileSync(new URL('../public/maps/peta-uji.json',import.meta.url),'utf8')));
const P=(x,z)=>({x,z});

test('a traffic light stands on the approaching driver\'s left kerb and faces the traffic',()=>{
  const map=testMap(),g=buildGeometry(map);
  // West leg of the crossroads at (120,110): drivers head east and keep left, i.e. north.
  const placed=smartPlace(map,g,asset('traffic-light'),P(95,100));
  assert.match(placed.label,/simpang-4/);
  assert.ok(placed.z<110-7.3,'north of the carriageway');
  assert.ok(placed.x<120-8,'before the junction');
  assert.equal(placed.rotation,270,'front faces west, towards approaching traffic');
});

test('a CCTV on the verge watches the traffic coming towards it',()=>{
  const map=testMap(),g=buildGeometry(map);
  const placed=smartPlace(map,g,asset('cctv'),P(60,100));     // north side of an east-west road
  assert.ok(placed.z<110-7.3);
  assert.equal(placed.rotation,270,'vehicles on this side travel east, so the camera faces west');
});

test('vehicles snap to the lane on the side clicked and face its direction',()=>{
  const map=testMap(),g=buildGeometry(map);
  const north=smartPlace(map,g,asset('car'),P(60,105)),south=smartPlace(map,g,asset('car'),P(60,115));
  assert.equal(north.rotation,90);assert.equal(south.rotation,270);
  assert.ok(Math.abs(north.z-(110-0.3-1.75))<0.01);
});

test('a building dropped inside a lot sits in its centre facing the nearest road',()=>{
  const map=validateMap(convertMiniKota()),g=buildGeometry(map);
  const school=map.lots.find(l=>l.id==='school');
  const placed=smartPlace(map,g,asset('school'),P(school.x+5,school.z+5));
  assert.equal(placed.x,school.x+school.w/2);assert.equal(placed.z,school.z+school.d/2);
  assert.match(placed.label,/Sekolah/);
});

test('no asset except vehicles is placed on the carriageway, wherever it is dropped',()=>{
  const map=testMap(),g=buildGeometry(map);
  const onCarriageway=p=>map.roads.some(r=>{
    const cs=crossSection(map.profiles[r.profile]);
    return projectOnLine(roadLine(map,r),p).distance<Math.max(cs.left,cs.right)-0.01;
  });
  const cursors=[];for(let x=10;x<=290;x+=20)for(let z=10;z<=220;z+=20)cursors.push(P(x,z));
  for(const a of manifest.assets){
    if(ruleFor(a)==='lane'||ruleFor(a)==='lot')continue;
    for(const p of cursors){const placed=smartPlace(map,g,a,p);assert.ok(!onCarriageway(placed),`${a.id} at ${JSON.stringify(p)} -> ${JSON.stringify(placed)}`);}
  }
});

test('sensors use the nearest gateway unless one is chosen; deleting a gateway clears the choice',()=>{
  const map=testMap();
  const near=addObject(map,'gateway',P(100,100)),far=addObject(map,'gateway',P(250,100));
  const cam=addObject(map,'cctv',P(110,95)),tree=addObject(map,'tree-shade',P(110,95));
  assert.deepEqual(gatewayOf(map,cam),{id:near.id,auto:true,distance:Math.hypot(10,5)});
  assert.equal(gatewayOf(map,tree),null);
  setGateway(map,cam.id,far.id);assert.deepEqual(gatewayOf(map,cam),{id:far.id,auto:false});
  validateMap(map);
  deleteObject(map,far.id);assert.equal(gatewayOf(map,cam).id,near.id);
});
