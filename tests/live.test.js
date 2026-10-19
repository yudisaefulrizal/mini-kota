import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSimulation} from '../src/live-simulation.js';
const small={students:0,university:0,workers:0,homemakers:0,other:8,throughRate:0,noCar:100,oneCar:0,twoCars:0};
const advance=(s,seconds)=>{for(let i=0;i<seconds;i++)s.step(1);};
test('random traffic preserves the same arrivals across polling intervals and hourly boundaries',()=>{
  const collect=interval=>{
    const s=new LiveSimulation({...small,throughRate:5000}),arrivals=[];
    s.newCar=properties=>arrivals.push(properties);
    const start=s.time,end=9*3600;
    for(let at=start;at<=end;at+=interval){s.time=at;s.streamTraffic();}
    return arrivals;
  };
  const fine=collect(.25),coarse=collect(60);
  assert.ok(fine.length>15000);
  assert.deepEqual(coarse,fine);
  assert.ok(fine.some((car,i)=>i&&car.readyAt-fine[i-1].readyAt<.25));
  assert.ok(fine.every(car=>car.readyAt%3600!==0));
});
function consistency(s){
  const actual=s.people.filter(p=>['resident','departureQueued','departing'].includes(p.residency));
  assert.equal(s.stats.population,actual.length);assert.equal(s.demography.reduce((a,b)=>a+b,0),actual.length);assert.equal(Object.values(s.modeCounts).reduce((a,b)=>a+b,0),actual.length);
  for(const p of actual)assert.ok(s.households[p.household].people.includes(p.id));
  const parked=[];for(const lot of Object.values(s.lots).filter(l=>!l.external))for(const id of lot.occupied.keys()){assert.equal(s.cars[id].lot,lot.id);parked.push(id);}
  assert.equal(new Set(parked).size,parked.length);assert.equal(s.stats.inside,s.initialInside+Object.values(s.crossings).reduce((sum,c)=>sum+c.in-c.out,0));
}
test('migration updates population only on physical arrival',()=>{
  const s=new LiveSimulation(small),time=s.time;s.applyConfig({...s.target,other:12});assert.equal(s.time,time);assert.equal(s.stats.population,8);assert.equal(s.stats.incomingResidents,4);
  const service=s.cars.find(c=>c.service);assert.equal(service.state,'outside');s.step(1);assert.equal(service.state,'driving');assert.equal(s.stats.population,8);
  advance(s,3600);assert.equal(s.stats.population,12);assert.equal(s.stats.incomingResidents,0);assert.equal(s.stats.localCars,0);consistency(s);
});
test('target reversal cancels queued migration and reconciles in-flight moves',()=>{
  const s=new LiveSimulation(small);s.applyConfig({...s.target,other:12});s.applyConfig({...s.target,other:8});assert.equal(s.stats.incomingResidents,0);assert.equal(s.stats.population,8);
  s.applyConfig({...s.target,other:12});s.step(1);s.applyConfig({...s.target,other:8});advance(s,86400);assert.equal(s.stats.population,8);assert.equal(s.stats.incomingResidents,0);assert.equal(s.stats.outgoingResidents,0);consistency(s);
});
test('departing residents remain counted until gate exit after their activities',()=>{
  const s=new LiveSimulation(small);s.applyConfig({...s.target,other:4});assert.equal(s.stats.population,8);assert.equal(s.stats.outgoingResidents,4);let saw=false;
  for(let i=0;i<86400;i++){s.step(1);const m=s.moves.find(m=>m.direction==='out'&&m.picked&&!m.done);if(m){saw=true;assert.ok(m.people.every(id=>s.people[id].residency==='departing'));}}
  assert.ok(saw);assert.equal(s.stats.population,4);assert.equal(s.stats.outgoingResidents,0);consistency(s);
});
test('traffic rate changes preserve moving cars and stop new arrivals',()=>{
  const s=new LiveSimulation({...small,throughRate:120});advance(s,300);const moving=s.cars.filter(c=>c.through&&c.state==='driving');assert.ok(moving.length);const count=s.throughScheduled;
  s.applyConfig({...s.target,throughRate:0});assert.ok(moving.every(c=>s.cars[c.id]===c&&c.state==='driving'));advance(s,1800);assert.equal(s.throughScheduled,count);assert.ok(s.throughCompleted>0);consistency(s);
});
test('green duration changes at the next complete cycle',()=>{
  const s=new LiveSimulation(small),n=s.nodes.find(n=>s.hasSignal(n)),old=n.signalGreen,before=s.phase(n,'x');s.applyConfig({...s.target,green:40});assert.equal(s.phase(n,'x'),before);assert.equal(n.signalGreen,old);
  s.time=n.switchAt;s.phase(n,'x');assert.equal(n.signalGreen,40);for(let i=0;i<100;i++){s.time++;assert.ok(!(s.phase(n,'x')==='green'&&s.phase(n,'z')==='green'));}
});
test('ownership changes use physical delivery and departure',()=>{
  const s=new LiveSimulation({...small,other:4});s.applyConfig({...s.target,noCar:0,oneCar:100});advance(s,86400);assert.equal(s.stats.localCars,1);const car=s.cars.find(c=>!c.external);assert.ok(car);
  s.applyConfig({...s.target,noCar:100,oneCar:0});advance(s,86400);assert.equal(s.stats.localCars,0);assert.equal(car.state,'outside');assert.ok(car.retired);consistency(s);
});
test('recurring activity passes the old two-day cutoff with stable residents',()=>{
  const s=new LiveSimulation({...small,other:0,workers:9,householdSize:1,noCar:0,oneCar:100,usage:100,outboundWorkers:0}),ids=s.people.map(p=>p.id);advance(s,3*86400);
  assert.equal(s.finished,false);assert.ok(s.time>48*3600);assert.ok(s.completed>36);assert.deepEqual(s.people.map(p=>p.id),ids);assert.ok(s.people.every(p=>p.lastPlanDay>=2));consistency(s);
});
test('household size changes wait for safe regrouping in the same residential area',()=>{
  const s=new LiveSimulation(small),homes=s.people.map(p=>s.households[p.household].home);s.applyConfig({...s.target,householdSize:2});advance(s,86400);
  assert.equal(s.stats.population,8);assert.equal(s.stats.households,4);assert.ok(s.households.filter(h=>h.people.length).every(h=>h.people.length===2));
  for(const p of s.people)assert.equal(s.households[p.household].home,homes[p.id]);consistency(s);
});
test('new destination probabilities apply to later daily plans without rewriting an active tour',()=>{
  const s=new LiveSimulation({...small,other:0,workers:6,outboundWorkers:0,oneDestination:100,twoDestinations:0,threeDestinations:0});
  const p=s.people[0],old=p.activities;s.applyConfig({...s.target,oneDestination:0,threeDestinations:100});assert.equal(p.activities,old);
  advance(s,2*86400);assert.ok(s.people.every(p=>p.requestedDestinations===3));assert.ok(s.people.some(p=>p.activities.length>1));consistency(s);
});
