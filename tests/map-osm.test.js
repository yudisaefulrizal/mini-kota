import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readOSM,importOSM,profileFor} from '../src/map/osm.js';
import {buildGeometry} from '../src/map/geometry.js';
import {TrafficEngine} from '../src/traffic/engine.js';

const fixture=readFileSync(new URL('./fixtures/contoh.osm',import.meta.url),'utf8');

test('the reader understands nodes, ways, tags and XML entities',()=>{
  const osm=readOSM(fixture);
  assert.equal(osm.nodes.size,14);assert.equal(osm.ways.length,7);
  assert.equal(osm.ways[0].tags.name,'Jalan Utama & Raya');
  assert.equal(osm.nodes.get('2').tags.highway,'traffic_signals');
  assert.throws(()=>readOSM('{"bukan":"osm"}'),/bukan data OpenStreetMap/);
});

test('profiles come from road class, lanes and oneway',()=>{
  assert.deepEqual(profileFor({highway:'primary',lanes:'4'}),{profile:'jalan-2x2',oneway:0});
  assert.deepEqual(profileFor({highway:'secondary'}),{profile:'jalan-2x2',oneway:0});
  assert.deepEqual(profileFor({highway:'residential'}),{profile:'jalan-1x1',oneway:0});
  assert.deepEqual(profileFor({highway:'residential',oneway:'yes'}),{profile:'satu-arah-1',oneway:1});
  assert.deepEqual(profileFor({highway:'primary',junction:'roundabout'}),{profile:'bundaran',oneway:1});
  assert.equal(profileFor({highway:'footway'}),null);
  assert.equal(profileFor({building:'yes'}),null);
});

test('an export becomes a valid map: junction with lights, one-ways kept in direction, clipped at the edge',()=>{
  const {map,report}=importOSM(fixture,{name:'Contoh'});
  assert.equal(report.signals,1);
  const lit=map.nodes.find(n=>n.signal);assert.equal(lit.id,'n2');
  assert.equal(map.roads.filter(r=>r.from==='n2'||r.to==='n2').length,4,'crossroads at the signal');
  assert.ok(map.bounds.width>600&&map.bounds.width<700,`width ${map.bounds.width}`);
  // Way 104 is oneway=-1 drawn 11→10, so traffic runs 10→11.
  const reversed=map.roads.find(r=>r.profile==='satu-arah-2'&&r.from==='n10');assert.ok(reversed&&reversed.to==='n11');
  // Node 9 lies outside the bounds; the way is cut at node 8.
  assert.ok(!map.nodes.some(n=>n.id==='n9'));
  assert.ok(report.clipped);
  assert.match(map.meta.attribution,/OpenStreetMap/);
  const g=buildGeometry(map);assert.equal(g.junctions.find(j=>j.id==='n2').arms,4);
});

test('the imported map can be simulated straight away',()=>{
  const {map}=importOSM(fixture);
  const summary=new TrafficEngine(map,{demand:600}).run(900).summary();
  assert.ok(summary.completed>20,`completed ${summary.completed}`);
  assert.equal(summary.redViolations,0);
});

test('two divided roads crossing (four junctions ~14 m apart) become one simpang gabungan and keep flowing',()=>{
  const text=readFileSync(new URL('./fixtures/simpang-bermedian.osm',import.meta.url),'utf8');
  const {map,report}=importOSM(text);
  assert.equal(report.junctions,4);assert.equal(report.signals,4);
  const g=buildGeometry(map);
  assert.equal(g.clusters.length,1);assert.deepEqual(g.clusters[0].nodes.length,4);
  assert.ok(!g.warnings.some(w=>w.type==='short'),'the short links inside are intended');
  const run=m=>{const e=new TrafficEngine(m,{demand:900,seed:3});e.run(1200);return {done:e.stats.completed,stuck:e.vehicles.filter(v=>v.v<0.3&&e.time-v.born>300).length,red:e.stats.redViolations};};
  const joined=run(map);
  const apart=structuredClone(map);for(const n of apart.nodes)if(n.signal)n.signalPlan={separate:true};
  const separate=run(apart);
  assert.equal(joined.stuck,0);assert.equal(joined.red,0);
  assert.ok(joined.done>200,`joined ${joined.done}`);
  assert.ok(separate.done<joined.done/2,`as four separate signals it locks up (${separate.done} vs ${joined.done})`);
});
