import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSimulation} from '../src/live-simulation.js';
import {SmartSimulation} from '../src/smart-simulation.js';
import {signalTimer} from '../src/signal-timer.js';

test('fixed countdown matches the next colour change through a whole cycle',()=>{
  const sim=new LiveSimulation(),node=sim.nodes.find(n=>sim.hasSignal(n));
  for(const axis of ['x','z'])for(let offset=0;offset<58;offset+=.25){
    sim.time=node.signalAnchor+580+offset;
    const {phase,seconds,estimated}=signalTimer(sim,node,axis),at=sim.time;
    assert.equal(estimated,false);
    let until=0;
    do{until+=.25;sim.time=at+until;}while(sim.phase(node,axis)===phase&&until<60);
    assert.equal(seconds,Math.ceil(until));
  }
});

test('red countdown includes a pending change of green duration',()=>{
  const sim=new LiveSimulation(),node=sim.nodes.find(n=>sim.hasSignal(n));
  node.signalAnchor=0;node.signalGreen=25;node.switchAt=58;node.requestedGreen=40;sim.time=57;
  assert.deepEqual(signalTimer(sim,node,'z'),{phase:'red',seconds:45,estimated:false});
  sim.time=101.75;assert.equal(sim.phase(node,'z'),'red');
  sim.time=102;assert.equal(sim.phase(node,'z'),'green');
});

test('adaptive countdown covers both axes and clearance stages',()=>{
  const sim=new SmartSimulation(),node=sim.nodes.find(n=>sim.hasSignal(n));
  const signal=sim.adaptiveSignals.get(node.id);signal.axis='x';signal.since=100;sim.time=102;
  assert.deepEqual(signalTimer(sim,node,'x'),{phase:'green',seconds:48,estimated:true});
  assert.deepEqual(signalTimer(sim,node,'z'),{phase:'red',seconds:52,estimated:true});
  signal.stage='yellow';
  assert.equal(signalTimer(sim,node,'x').seconds,1);
  assert.equal(signalTimer(sim,node,'z').seconds,2);
  signal.stage='red';signal.since=sim.time;
  assert.equal(signalTimer(sim,node,'x').seconds,55);
  assert.equal(signalTimer(sim,node,'z').seconds,1);
  sim.updateSignals(103);sim.time=103;
  assert.equal(signalTimer(sim,node,'z').phase,'green');
});
