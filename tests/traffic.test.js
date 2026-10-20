import test from 'node:test';
import {miniKotaRoads,miniKotaLengkap} from '../src/map/default-map.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateMap} from '../src/map/format.js';
import {buildGeometry} from '../src/map/geometry.js';
import {buildLaneGraph,routesFrom} from '../src/traffic/lanes.js';
import {TrafficEngine} from '../src/traffic/engine.js';
import {miniKotaRoads as convertMiniKota} from '../src/map/default-map.js';
import {furnish} from '../src/map/furnish.js';
import {buildWalkGraph} from '../src/traffic/pedestrians.js';

const testMap=()=>JSON.parse(readFileSync(new URL('../public/maps/peta-uji.json',import.meta.url),'utf8'));
// Mini Kota with every asset filled in (the editor's default map).
const fullMap=miniKotaLengkap;
const graphOf=raw=>{const map=validateMap(raw);return buildLaneGraph(map,buildGeometry(map));};

test('every road gets one lane per lane in its profile, in both directions',()=>{
  const map=validateMap(testMap()),graph=graphOf(map);
  const expected=map.roads.reduce((n,r)=>n+map.profiles[r.profile].lanes[0]+map.profiles[r.profile].lanes[1],0);
  assert.equal(graph.segs.filter(s=>s.kind==='lane').length,expected);
});

test('left turns leave from the kerb lane, right turns from the lane next to the centre',()=>{
  const graph=graphOf(testMap());
  for(const c of graph.connectors){
    const from=graph.byId.get(c.from);
    if(c.turn==='kiri')assert.equal(from.index,0);
    if(c.turn==='kanan')assert.equal(from.index,from.count-1);
  }
});

test('Mini Kota: from any entry every exit is reachable, and no lane leads nowhere',()=>{
  const graph=graphOf(convertMiniKota());
  for(const src of graph.sources){const to=routesFrom(graph,src);assert.ok(graph.sinks.every(t=>to(t)),`source ${src}`);}
  for(const s of graph.segs)if(s.kind==='lane')assert.ok(s.next.length||graph.sinks.includes(s.id),`lane ${s.id}`);
});

// Runs a model and checks safety on every step.
function audited(raw,options,seconds){
  const engine=new TrafficEngine(raw,options),dt=0.25;
  let minGap=Infinity,crossings=0,lanesUsed=new Set();
  for(let t=0;t<seconds;t+=dt){
    engine.step(dt);
    const bySeg=new Map();
    for(const v of engine.vehicles){const id=v.route[v.idx];(bySeg.get(id)||bySeg.set(id,[]).get(id)).push(v);}
    for(const [id,list] of bySeg){
      const seg=engine.graph.byId.get(id);
      if(seg.kind==='lane'&&seg.count>1)lanesUsed.add(`${seg.road}:${seg.dir}:${seg.index}`);
      list.sort((a,b)=>a.s-b.s);
      for(let i=1;i<list.length;i++)minGap=Math.min(minGap,list[i].s-list[i-1].s);
      if(seg.kind==='connector')for(const other of seg.conflicts)if(bySeg.has(other))crossings++;
    }
  }
  return {engine,summary:engine.summary(),minGap,crossings,lanesUsed};
}

test('test map, 20 minutes: trips complete, no red-light runs, no conflicting moves, no overlaps',()=>{
  const {summary,minGap,crossings,lanesUsed}=audited(testMap(),{demand:900},1200);
  assert.ok(summary.completed>250,`completed ${summary.completed}`);
  assert.equal(summary.redViolations,0);
  assert.equal(crossings,0,'two vehicles on crossing paths at once');
  assert.ok(minGap>=4,`vehicles in one lane at least a car length apart, got ${minGap}`);
  const both=[...lanesUsed].filter(k=>k.endsWith(':0')).filter(k=>lanesUsed.has(k.replace(/:0$/,':1')));
  assert.ok(both.length>0,'both lanes of a 2-lane road are used');
});

test('Mini Kota, 20 minutes with adaptive lights: safe and flowing',()=>{
  const {summary,crossings}=audited(fullMap(),{demand:900,adaptive:true},1200);
  assert.ok(summary.completed>250);assert.equal(summary.redViolations,0);assert.equal(crossings,0);
  assert.equal(summary.signals,15);
});

test('adaptive lights need cameras: with CCTV they cut queueing, without they run the fixed plan; runs are deterministic',()=>{
  const fixed=new TrafficEngine(fullMap(),{demand:900}).run(1800).summary();
  const adaptive=new TrafficEngine(fullMap(),{demand:900,adaptive:true}).run(1800).summary();
  assert.equal(adaptive.sensedSignals,15);
  assert.ok(adaptive.queueSeconds<fixed.queueSeconds*0.4,`${adaptive.queueSeconds} vs ${fixed.queueSeconds}`);
  const blindFixed=new TrafficEngine(convertMiniKota(),{demand:900}).run(900).summary();
  const blindAdaptive=new TrafficEngine(convertMiniKota(),{demand:900,adaptive:true}).run(900).summary();
  assert.equal(blindAdaptive.sensedSignals,0);
  assert.equal(blindAdaptive.queueSeconds,blindFixed.queueSeconds,'no camera, no adaptation');
  assert.deepEqual(new TrafficEngine(testMap(),{seed:7}).run(600).summary(),new TrafficEngine(testMap(),{seed:7}).run(600).summary());
});

test('signal state follows the plan: green, yellow, all-red, next phase',()=>{
  const engine=new TrafficEngine(testMap(),{demand:0});
  const states=[];
  for(let t=0;t<60;t+=0.25){engine.step(0.25);const s=engine.signalState('simpang-4');states.push(`${s.phase}:${s.stage}`);}
  const order=[...new Set(states)];
  assert.deepEqual(order.slice(0,4),['0:green','0:yellow','0:allRed','1:green']);
  assert.equal(states.filter(s=>s==='0:green').length,20*4-1,'20 s of green');
});

test('devices at work: cameras count, angkots call at bus stops, full bins bring a garbage truck',()=>{
  const engine=new TrafficEngine(fullMap(),{demand:900}).run(1800),s=engine.summary();
  assert.ok(engine.sensors.every(x=>x.count>0),'every camera counted vehicles');
  assert.ok(s.busStops>5,`bus stop calls ${s.busStops}`);
  assert.ok(s.bins>=5&&s.binsEmptied>=s.bins-1,`bins ${s.bins}, emptied ${s.binsEmptied}`);
  assert.equal(s.binsFull,0);
  const state=engine.sensorState(engine.sensors[0].id);
  assert.ok(state.count>0&&Array.isArray(state.legs));
});

test('pedestrians cross at zebras; no vehicle drives over a crossing while people are on it',()=>{
  const map=fullMap(),walk=buildWalkGraph(validateMap(map),buildGeometry(validateMap(map)));
  assert.ok(walk.edges.filter(e=>e.kind==='cross').length>=40,'zebra crossings');
  const engine=new TrafficEngine(map,{demand:900,adaptive:true,pedestrians:60});
  let conflicts=0;
  for(let t=0;t<1200;t+=0.25){
    engine.step(0.25);
    for(const [key] of engine.pedestrians.crossingNow)for(const id of engine.connectorsByLeg.get(key)||[])
      for(const vid of engine.onConnector.get(id)){const v=engine.vehicles.find(v=>v.id===vid);if(v&&v.route[v.idx]===id)conflicts++;}
  }
  const s=engine.summary();
  assert.equal(conflicts,0);assert.equal(s.redViolations,0);
  assert.ok(s.pedestrians.crossings>300,`crossings ${s.pedestrians.crossings}`);
  assert.ok(s.completed>200,`completed ${s.completed}`);
});

test('light timers: a fixed light changes colour exactly when its countdown runs out; adaptive ones are estimates',()=>{
  const engine=new TrafficEngine(fullMap(),{demand:600}),node=[...engine.signals.keys()][0];
  const legs=engine.signalCountdown(node).length;
  let checked=0;
  for(let leg=0;leg<legs;leg++){
    const e=new TrafficEngine(fullMap(),{demand:600});
    for(let t=0;t<200;t+=0.25){
      e.step(0.25);
      const c=e.signalCountdown(node)[leg];if(c.internal)break;
      if(Math.abs(t%7)>1e-9)continue;
      // Run until just before and just after the predicted change.
      const probe=new TrafficEngine(fullMap(),{demand:600});probe.run(t+0.25);
      const at=probe.time,state=probe.signalState(node).legs[leg];
      const left=probe.signalCountdown(node)[leg].seconds;
      while(probe.time<at+left-1.25)probe.step(0.25);
      assert.equal(probe.signalState(node).legs[leg],state,`still ${state} just before`);
      while(probe.time<at+left+0.25)probe.step(0.25);
      assert.notEqual(probe.signalState(node).legs[leg],state,`changed after ${left} s`);
      checked++;if(checked>12)break;
    }
  }
  assert.ok(checked>=6);
  const adaptive=new TrafficEngine(fullMap(),{demand:600,adaptive:true});adaptive.run(30);
  assert.ok(adaptive.signalCountdown(node).every(c=>c.estimated));
});

test('a camera watches the approach it faces; the zone length (one for all cameras) is drawn from the stop line',async()=>{
  const map=await miniKotaLengkap(),cam=map.objects.find(o=>o.asset==='cctv');
  const length=e=>e.zonePaths(cam.id).reduce((m,p)=>Math.max(m,p.points.slice(1).reduce((s,q,i)=>s+Math.hypot(q.x-p.points[i].x,q.z-p.points[i].z),0)),0);
  const a=new TrafficEngine(map,{demand:0}),st=a.sensorState(cam.id);
  assert.equal(st.zone,80);assert.equal(st.approaches.length,1);
  assert.ok(Math.abs(length(a)-80)<6,`zone ${length(a)} m`);
  const b=new TrafficEngine(map,{demand:0,zone:40});
  assert.equal(b.sensorState(cam.id).zone,40);assert.ok(Math.abs(length(b)-40)<6,`zone ${length(b)} m`);
  // Turned round, it no longer watches that approach.
  cam.rotation=(cam.rotation||0)+180;
  const c=new TrafficEngine(map,{demand:0}).sensorState(cam.id);
  assert.ok(!c||c.node!==st.node||c.legs[0]!==st.legs[0]);
});

test('both cities get the same trips and drivers, whatever happens on the road',async()=>{
  const map=await miniKotaLengkap(),trips=[];
  for(const adaptive of [false,true]){
    const e=new TrafficEngine(map,{demand:1200,seed:7,adaptive,pedestrians:30}),list=[],make=e.newTrip.bind(e);
    e.newTrip=()=>{const t=make();list.push([Math.round(e.time*4),t.src,t.route.at(-1),t.type,t.driver.pref.toFixed(4)].join('|'));return t;};
    for(let t=0;t<900;t+=0.25)e.step(0.25);
    trips.push(list);
  }
  assert.ok(trips[0].length>250);assert.deepEqual(trips[0],trips[1]);
});

test('drivers keep their own preferred speed; faster ones overtake on a long road and keep left',async()=>{
  const {emptyMap}=await import('../src/map/format.js'),edit=await import('../src/map/edit.js');
  const map=emptyMap('lurus',1000,200);edit.addRoad(map,[{x:10,z:100},{x:990,z:100}],{profile:'jalan-2x2',shape:'polyline'});
  const prefs=new TrafficEngine(map,{demand:1800,speedSpread:0.15}),seen=[];
  for(let t=0;t<120;t+=0.25){prefs.step(0.25);for(const v of prefs.vehicles)seen.push(v.pref);}
  assert.ok(Math.max(...seen)-Math.min(...seen)>0.2,'preferred speeds differ');
  assert.ok(seen.every(p=>p>=0.7&&p<=1.3));
  const flat=new TrafficEngine(map,{demand:1800,speedSpread:0});for(let t=0;t<60;t+=0.25)flat.step(0.25);
  assert.ok(flat.vehicles.every(v=>v.pref===1));
  const e=new TrafficEngine(map,{demand:1500,speedSpread:0.2,minibus:0.3}),off=new TrafficEngine(map,{demand:1500,speedSpread:0.2,minibus:0.3,overtaking:false});
  // Count the moves back to the kerb lane made after passing.
  let back=0;const out=new Set(),shift=e.shiftLane.bind(e);
  e.shiftLane=(v,from,to,s)=>{if(to.index>from.index&&v.passing)out.add(v.id);else if(to.index<from.index&&out.delete(v.id))back++;shift(v,from,to,s);};
  for(let t=0;t<900;t+=0.25){e.step(0.25);off.step(0.25);}
  assert.ok(e.stats.overtakes>10,`${e.stats.overtakes} overtakes`);assert.equal(off.stats.overtakes,0);
  assert.ok(back>e.stats.overtakes*0.5,`${back} of ${e.stats.overtakes} moved back after passing`);
  assert.ok(e.summary().averageTravel<off.summary().averageTravel,'passing saves time on a long road');
  assert.equal(e.summary().redViolations,0);assert.ok(e.stats.completed>200);
});

test('the detection zone is one setting for every camera',async()=>{
  const map=await miniKotaLengkap();map.objects.find(o=>o.asset==='cctv').zone=120;   // an old per-camera value is ignored
  const e=new TrafficEngine(map,{demand:0,zone:50});
  assert.ok(e.sensors.every(s=>e.sensorState(s.id).zone===50));
  assert.equal(new TrafficEngine(map,{demand:0}).sensors[0].zone,80);
});
