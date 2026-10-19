import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateMap,emptyMap} from '../src/map/format.js';
import {buildGeometry} from '../src/map/geometry.js';
import {addRoad} from '../src/map/edit.js';
import {movements,suggestSignal,buildPlan,conflicts,unserved,patternsFor,compass,TIMING} from '../src/map/signals.js';
import {convertMiniKota} from '../src/map/convert-minikota.js';

const testMap=()=>validateMap(JSON.parse(readFileSync(new URL('../public/maps/peta-uji.json',import.meta.url),'utf8')));
const P=(x,z)=>({x,z});
const junction=(g,id)=>g.junctions.find(j=>j.id===id);

test('turns follow left-hand traffic: from the west, left is north and right is south',()=>{
  const j=junction(buildGeometry(testMap()),'simpang-4');
  const names=j.legs.map(l=>compass(l.dir));
  const west=names.indexOf('Barat');
  const turns=Object.fromEntries(movements(j).filter(m=>m.from===west).map(m=>[names[m.to],m.turn]));
  assert.equal(turns.Timur,'lurus');assert.equal(turns.Utara,'kiri');assert.equal(turns.Barat+'',"undefined");
  assert.equal(Object.values(turns).filter(t=>t==='kanan').length,1);
});

test('lights are proposed where main roads meet, not for small roads, driveways or roundabouts',()=>{
  const g=buildGeometry(testMap());
  assert.equal(suggestSignal(junction(g,'simpang-4')),true);
  assert.equal(suggestSignal(junction(g,'simpang-3')),true);      // 2x2 main road + 1x1 branch
  assert.equal(suggestSignal(junction(g,'simpang-y')),false);     // all 1x1
  assert.equal(suggestSignal(junction(g,'bund-utara')),false);    // roundabout
  const map=emptyMap('uji',300,300);
  addRoad(map,[P(0,100),P(300,100)],{profile:'jalan-1x1',shape:'polyline'});
  addRoad(map,[P(150,100),P(150,200)],{profile:'akses',startTarget:{type:'road',id:'r1',point:P(150,100)}});
  assert.equal(suggestSignal(buildGeometry(validateMap(map)).junctions[0]),false);
});

test('defaults: crossroads 4 phases, T-junction 3 phases; every movement is served',()=>{
  const g=buildGeometry(testMap());
  const cross=buildPlan(junction(g,'simpang-4')),tee=buildPlan(junction(g,'simpang-3'));
  assert.equal(cross.pattern,'4-fase');assert.equal(cross.phases.length,4);
  assert.equal(tee.pattern,'3-fase');assert.equal(tee.phases.length,3);
  assert.deepEqual(unserved(junction(g,'simpang-4'),cross),[]);
  assert.equal(cross.cycle,4*(20+TIMING.yellow+TIMING.allRed));
});

test('no plan lets two protected movements cross or merge, on any junction and pattern',()=>{
  const maps=[testMap(),validateMap(convertMiniKota())];
  let checked=0;
  for(const map of maps){
    const g=buildGeometry(map);
    for(const j of g.junctions){
      if(j.legs.some(l=>l.ring))continue;
      for(const pattern of patternsFor(j.legs.length))for(const leftFree of [true,false]){
        const plan=buildPlan(j,{pattern,leftFree});
        for(const phase of plan.phases)assert.deepEqual(conflicts(j,phase),[],`${j.id} ${pattern} phase ${phase.index}`);
        assert.deepEqual(unserved(j,plan),[],`${j.id} ${pattern} serves every movement`);
        checked++;
      }
    }
  }
  assert.ok(checked>50,`checked ${checked} plans`);
});

test('2-phase plans make right turns yield; the arrow plan protects them in their own phase',()=>{
  const j=junction(buildGeometry(testMap()),'simpang-4');
  const two=buildPlan(j,{pattern:'2-fase'});
  assert.equal(two.phases.length,2);
  assert.ok(two.phases.every(p=>p.movements.filter(m=>m.turn==='kanan').every(m=>m.mode==='yield')));
  const arrow=buildPlan(j,{pattern:'2-fase-panah-kanan'});
  assert.equal(arrow.phases.length,3);
  assert.ok(arrow.phases[1].arrow&&arrow.phases[1].movements.filter(m=>m.mode==='protected').every(m=>m.turn==='kanan'));
});

test('free left turns appear in every phase; switching it off removes them; greens are clamped',()=>{
  const j=junction(buildGeometry(testMap()),'simpang-4');
  const free=buildPlan(j,{leftFree:true}),strict=buildPlan(j,{leftFree:false});
  assert.ok(free.phases.every(p=>p.movements.filter(m=>m.mode==='free').length>0));
  assert.ok(strict.phases.every(p=>p.movements.every(m=>m.mode!=='free')));
  const custom=buildPlan(j,{green:[1,500,30]});
  assert.deepEqual(custom.phases.map(p=>p.green),[TIMING.minGreen,TIMING.maxGreen,30,20]);
});
