import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSimulation as Simulation} from '../src/live-simulation.js';
import {toMetres,toMapUnits} from '../src/scale.js';

test('free-flow displacement agrees with the metric speed shown in the dashboard',()=>{
  const sim=new Simulation({students:0,university:0,workers:0,homemakers:0,other:4,noCar:100,oneCar:0,twoCars:0,throughRate:0});
  const edge=sim.edges.find(e=>e.length>300);
  const car=sim.newCar({state:'driving',edge:edge.id,s:50,v:8.33,held:null,claimed:false,path:[],jobs:[{to:'homeA'}],job:0});
  sim.step(.25);
  assert.ok(Math.abs(toMetres(car.s-50)-(8.33+2.8*.25)*.25)<1e-8);
  assert.ok(Math.abs(sim.stats.speed-(8.33+2.8*.25)*3.6)<1e-8);
});

test('queued cars keep their body lengths plus two metres of clearance',()=>{
  const sim=new Simulation({students:0,university:0,workers:0,homemakers:0,other:4,noCar:100,oneCar:0,twoCars:0,throughRate:0});
  const edge=sim.edges.find(e=>e.length>300);
  const stop=edge.length-Math.min(20,edge.length/3);
  sim.canClaim=()=>false;
  const front=sim.newCar({state:'driving',edge:edge.id,s:stop,v:0,held:null,claimed:false,path:[],jobs:[{to:'homeA'}],job:0});
  const rear=sim.newCar({state:'driving',edge:edge.id,s:stop-toMapUnits(20),v:8.33,held:null,claimed:false,path:[],jobs:[{to:'homeA'}],job:0});
  for(let i=0;i<120;i++)sim.step(.25);
  assert.ok(toMetres(front.s-rear.s)>=6.5-1e-8);
  assert.ok(toMetres(front.s-rear.s)<6.6);
});


test('empty green junction preserves speed, red or blocked junction slows the car',()=>{
  function approach({green=true,blocked=false,claimed=false,queue=false}={}){
    const sim=new Simulation({students:0,university:0,workers:0,homemakers:0,other:4,noCar:100,oneCar:0,twoCars:0,throughRate:0});
    const edge=sim.edges.find(e=>e.length>100&&sim.edges.some(n=>n.from===e.to&&n.to!==e.from&&n.length>100));
    const next=sim.edges.find(n=>n.from===edge.to&&n.to!==edge.from&&n.length>100);
    sim.hasSignal=()=>true;sim.phase=()=>green?'green':'red';sim.canClaim=()=>!blocked;
    const start=edge.length-(claimed?2:30);
    const car=sim.newCar({state:'driving',edge:edge.id,s:start,v:10,held:null,claimed,path:[next.id],jobs:[{to:'homeA'}],job:0});
    if(queue)sim.newCar({state:'driving',edge:next.id,s:5,v:0,held:null,claimed:false,path:[],jobs:[{to:'homeA'}],job:0});
    sim.step(.1);
    return car.v;
  }
  assert.ok(approach()>10,'green must not brake for the edge boundary');
  assert.ok(approach({claimed:true})>=10,'cleared junction must not brake at its centre');
  assert.ok(approach({green:false})<10,'red must brake before the stop line');
  assert.ok(approach({blocked:true})<10,'conflicting traffic must still cause braking');
  assert.ok(approach({queue:true})<10,'occupied outgoing lane must still cause braking');
});

test('a nearby moving leader does not force the follower to crawl',()=>{
  const sim=new Simulation({students:0,university:0,workers:0,homemakers:0,other:4,noCar:100,oneCar:0,twoCars:0,throughRate:0});
  const edge=sim.edges.find(e=>e.length>300);
  sim.canClaim=()=>false;
  const properties={state:'driving',edge:edge.id,v:12,held:null,claimed:false,path:[],jobs:[{to:'homeA'}],job:0};
  const front=sim.newCar({...properties,s:50+toMapUnits(10)});
  const rear=sim.newCar({...properties,s:50});
  sim.step(.25);
  assert.ok(rear.v>=12,'follower should maintain its speed behind a moving leader');
  assert.ok(toMetres(front.s-rear.s)>=6.5,'body clearance must be preserved');
  front.v=0;
  front.s=edge.length-Math.min(20,edge.length/3);
  rear.s=front.s-toMapUnits(8);
  for(let i=0;i<40;i++){
    sim.step(.25);
    assert.ok(toMetres(front.s-rear.s)>=6.5-1e-8,'sudden stop must not cause overlap');
  }
  assert.ok(rear.v<.3,'follower must stop behind the stopped leader');
});
