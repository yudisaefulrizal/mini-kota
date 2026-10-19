import test from 'node:test';
import assert from 'node:assert/strict';
import {SimulationComparison} from '../src/comparison.js';
const quiet={students:0,university:0,workers:0,homemakers:0,other:1,noCar:100,oneCar:0,twoCars:0,throughRate:0};
test('gate waiting counts ready blocked arrivals only and preserves road-only fuel',()=>{
 const pair=new SimulationComparison(quiet);
 for(const sim of [pair.baseline,pair.smart]){
  const gate=Object.values(sim.lots).find(l=>l.external),to='homeA';
  const car=sim.newCar({lot:gate.id,readyAt:sim.time+.1,jobs:[{to,at:sim.time}]});
  sim.newCar({lot:gate.id,readyAt:sim.time+100,jobs:[{to,at:sim.time+100}]});
  sim.newCar({lot:gate.id,readyAt:sim.time,jobs:[]});
  sim.newCar({lot:gate.id,readyAt:sim.time,pendingExternal:sim.time+100,jobs:[{to,at:sim.time}]});
  sim.nodes[gate.node].owner=9999;
  sim.step(.25);
  assert.equal(sim.stats.gateWaiting,1);
  assert.ok(Math.abs(sim.stats.gateQueueSeconds-.15)<1e-9);
  assert.equal(sim.stats.queueSeconds,0);assert.equal(sim.stats.idleFuelLiters,0);
  sim.step(.25);assert.ok(Math.abs(sim.stats.gateQueueSeconds-.4)<1e-9);
  const accumulated=sim.stats.gateQueueSeconds;
  sim.applyConfig({...sim.config,green:30});assert.equal(sim.stats.gateQueueSeconds,accumulated);
  sim.nodes[gate.node].owner=null;sim.step(.25);
  assert.equal(car.state,'driving');assert.equal(sim.stats.gateWaiting,0);
  assert.equal(sim.stats.gateQueueSeconds,accumulated);
  assert.equal(sim.stats.totalQueueSeconds,sim.stats.queueSeconds+accumulated);
 }
 pair.baseline.gateQueueSeconds+=2;
 assert.equal(pair.stats.queueSavedSeconds,pair.baseline.stats.totalQueueSeconds-pair.smart.stats.totalQueueSeconds);
 pair.reset(quiet);assert.equal(pair.stats.baseline.totalQueueSeconds,0);assert.equal(pair.stats.smart.gateWaiting,0);
});
