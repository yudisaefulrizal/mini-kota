import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSimulation} from '../src/live-simulation.js';
import {DATA_CENTER_SITE,dataCenterInventory,estimateDataCenter,validateDataCenter} from '../src/data-center.js';
import {LOTS} from '../src/simulation.js';
const make=()=>new LiveSimulation({students:0,university:0,workers:0,homemakers:0,other:4,noCar:100,oneCar:0,twoCars:0,throughRate:0});
test('data center is in the unassigned block below business with connected road and walking access',()=>{
  const s=make(),site=DATA_CENTER_SITE,business=LOTS.find(l=>l.id==='business');
  assert.ok(site.z>business.z+business.h);
  for(const lot of LOTS.filter(l=>l.id!==site.id))assert.ok(site.x+site.w<=lot.x||site.x>=lot.x+lot.w||site.z+site.h<=lot.z||site.z>=lot.z+lot.h);
  assert.ok(s.route(s.lots.homeA.node,s.lots.dataCenter.node).length>0);
  assert.ok(s.pedestrianNetwork.route('homeA','dataCenter').length>0);
  assert.equal(s.hasSignal(s.nodes[s.lots.dataCenter.node]),false);
});
test('traffic detectors partition all road directions without double counting; controllers are separate',()=>{
  const s=make(),d=dataCenterInventory(s);
  const roadCount=s.edges.filter(e=>![e.from,e.to].some(id=>s.nodes[id].lot&&!s.nodes[id].external)).length;
  assert.equal(d.sensors.slice(0,3).reduce((sum,row)=>sum+row.count,0),roadCount);
  assert.equal(d.totalSensors,d.sensors.reduce((sum,row)=>sum+row.count,0));
  assert.equal(d.signalControllers,s.nodes.filter(n=>s.hasSignal(n)).length);
  assert.equal(d.signalHeads,d.sensors[0].count);
  assert.equal(d.sensors.find(row=>row.id==='access').count,LOTS.length);
});
test('sizing formulas account for retention, copies, headroom, CPU utilization and N+1',()=>{
  const s=make();
  const inventory={sensors:[{count:10,interval:'traffic'},{count:5,interval:5}],totalSensors:15,signalControllers:2};
  const d=estimateDataCenter(s,{sampleSeconds:2,payloadBytes:1000,retentionDays:10,eventCpuMs:10,routeCpuMs:20,peakVehicles:100},inventory);
  assert.equal(d.eventsPerSecond,6);assert.equal(d.signalEvaluationsPerSecond,8);assert.equal(d.routeEvaluationsPerSecond,20);
  assert.equal(d.cpuCores,.54);assert.equal(d.vcpu,2);assert.equal(d.ramGB,6);
  assert.equal(d.dailyGB,.5184);assert.ok(Math.abs(d.storageGB-.5184*10*2*1.3)<1e-10);
  assert.equal(d.networkMbps,.0624);assert.equal(d.activeNodes,1);assert.equal(d.totalNodes,2);
  const more=estimateDataCenter(s,{sampleSeconds:1,payloadBytes:1000,retentionDays:20,eventCpuMs:100,routeCpuMs:1000,peakVehicles:1000},inventory);
  assert.ok(more.eventsPerSecond>d.eventsPerSecond);assert.ok(more.storageGB>d.storageGB);assert.ok(more.totalNodes>2);
  assert.ok(more.activeNodes*8>=more.vcpu);assert.ok(more.activeNodes*16>=more.ramGB);
});
test('live load can exceed planning peak, and invalid inputs cannot produce estimates',()=>{
  const s=make(),inventory=dataCenterInventory(s);s.cars.push(...Array.from({length:12},()=>({state:'driving'})));
  const d=estimateDataCenter(s,{peakVehicles:2},inventory);assert.equal(d.sizingVehicles,12);
  for(const input of [{sampleSeconds:0},{retentionDays:-1},{payloadBytes:NaN},{peakVehicles:Infinity},{peakVehicles:1.5},{routeCpuMs:-1}])assert.throws(()=>validateDataCenter(input));
});
