import test from 'node:test';
import assert from 'node:assert/strict';
import {SimulationComparison} from '../src/comparison.js';
import {SmartSimulation} from '../src/smart-simulation.js';
const quiet={students:0,university:0,workers:0,homemakers:0,other:4,noCar:100,oneCar:0,twoCars:0,throughRate:0};

test('paired simulations preserve initial demand, clocks, common config and reset',()=>{
  const pair=new SimulationComparison({...quiet,workers:12,noCar:0,oneCar:100,usage:100,throughRate:80});
  assert.deepEqual(pair.baseline.people,pair.smart.people);
  assert.deepEqual(pair.baseline.cars,pair.smart.cars);
  assert.deepEqual(pair.baseline.virtual,pair.smart.virtual);
  for(let i=0;i<1200;i++)pair.step(.25);
  assert.equal(pair.baseline.time,pair.smart.time);
  assert.equal(pair.baseline.throughScheduled,pair.smart.throughScheduled);
  const before=pair.stats;
  pair.applyConfig({...pair.baseline.target,idleLitersPerHour:1.2,green:30});
  assert.deepEqual(pair.baseline.target,pair.smart.target);
  assert.equal(pair.baseline.queueSeconds,before.baseline.queueSeconds);
  assert.equal(pair.smart.queueSeconds,before.smart.queueSeconds);
  const valid=pair.baseline.target;
  assert.throws(()=>pair.applyConfig({...valid,idleLitersPerHour:-1}));
  assert.deepEqual(pair.baseline.target,pair.smart.target);
  pair.reset(valid);
  assert.equal(pair.baseline.time,19800);assert.equal(pair.smart.time,19800);
  assert.equal(pair.baseline.queueSeconds,0);assert.equal(pair.smart.idleFuelLiters,0);
});
test('adaptive lights serve demand after minimum green with yellow and all-red clearance',()=>{
  const s=new SmartSimulation(quiet),node=s.nodes.find(n=>s.hasSignal(n));
  const edge=s.edges.find(e=>e.to===node.id&&s.approach(e).axis==='z');
  s.cars.push({state:'driving',edge:edge.id,s:edge.length-20,v:0});
  const at=s.time;
  s.updateSignals(at+9.75);assert.equal(s.phase(node,'x'),'green');
  s.updateSignals(at+10);assert.equal(s.phase(node,'x'),'yellow');assert.equal(s.phase(node,'z'),'red');
  s.updateSignals(at+12.75);assert.equal(s.phase(node,'x'),'yellow');
  s.updateSignals(at+13);assert.equal(s.phase(node,'x'),'red');assert.equal(s.phase(node,'z'),'red');
  s.updateSignals(at+13.75);assert.equal(s.phase(node,'z'),'red');
  s.updateSignals(at+14);assert.equal(s.phase(node,'z'),'green');assert.equal(s.phase(node,'x'),'red');
});
test('adaptive maximum green prevents starvation and never grants conflicting greens',()=>{
  const s=new SmartSimulation(quiet),node=s.nodes.find(n=>s.hasSignal(n));
  const edges=['x','z'].map(axis=>s.edges.find(e=>e.to===node.id&&s.approach(e).axis===axis));
  for(const [i,e] of edges.entries())for(let j=0;j<(i===0?10:1);j++)s.cars.push({state:'driving',edge:e.id,s:e.length-20,v:0});
  const phases=[];
  for(let t=.25;t<=54;t+=.25){s.updateSignals(s.time+t);assert.ok(!(s.phase(node,'x')==='green'&&s.phase(node,'z')==='green'));phases.push(s.phase(node,'z'));}
  assert.equal(phases.at(-1),'green');
});
test('smart driving avoids a congested edge while planning keeps the original shortest route',()=>{
  const s=new SmartSimulation(quiet);s.updateTrafficCosts();
  let chosen;
  for(const e of s.edges){
    const base=s.route(e.from,e.to);
    if(base.length!==1)continue;
    s.trafficCosts[e.id]+=10000;s.smartRouteCache.clear();
    const alternate=s.drivingRoute(e.from,e.to);
    if(!alternate.includes(e.id)){chosen={e,base,alternate};break;}
    s.trafficCosts[e.id]-=10000;
  }
  assert.ok(chosen,'road network has an alternative path');
  assert.deepEqual(s.route(chosen.e.from,chosen.e.to),chosen.base);
  let at=chosen.e.from;
  for(const id of chosen.alternate){assert.equal(s.edges[id].from,at);at=s.edges[id].to;}
  assert.equal(at,chosen.e.to);
});
test('rerouting leaves claimed turns and cars close to the junction unchanged',()=>{
  const s=new SmartSimulation(quiet);s.updateTrafficCosts();
  const route=s.route(s.lots.homeA.node,s.lots.industry.node),edge=s.edges[route[0]];
  const car={state:'driving',claimed:true,edge:edge.id,s:0,path:route.slice(1),jobs:[{to:'industry'}],job:0};
  s.cars=[car];s.drivingRoute=()=>{throw Error('must not replan this turn');};
  s.rerouteCars();car.claimed=false;car.s=edge.length-40;s.rerouteCars();
  assert.deepEqual(car.path,route.slice(1));
});
test('active rerouting selects a cheaper connected detour without an immediate U-turn',()=>{
  const s=new SmartSimulation(quiet);
  s.nodes=[{edges:[0,5]},{edges:[1,2,4]},{edges:[3]},{edges:[]}];
  s.edges=[{from:0,to:1,length:200},{from:1,to:3,length:200},{from:1,to:2,length:100},{from:2,to:3,length:100},{from:1,to:0,length:100},{from:0,to:3,length:100}].map((e,id)=>({...e,id}));
  s.trafficCosts=[20,100,10,10,1,1];s.smartRouteCache=new Map();s.lots.industry.node=3;
  const car={state:'driving',claimed:false,edge:0,s:10,path:[1],jobs:[{to:'industry'}],job:0};s.cars=[car];
  s.rerouteCars();assert.deepEqual(car.path,[2,3]);assert.equal(s.reroutes,1);
  s.rerouteCars();assert.equal(s.reroutes,1);
});
