import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSimulation} from '../src/live-simulation.js';
const make=()=>new LiveSimulation({students:0,university:0,workers:0,homemakers:0,other:8,noCar:100,oneCar:0,twoCars:0,throughRate:0});
const balance=w=>assert.ok(Math.abs(w.generated-w.inBuildings-w.carried-w.waiting-w.inTrucks-w.storage)<1e-6);
test('trucks collect on the road network and conserve mass through unloading',()=>{
 const s=make(),w=s.waste;
 for(const l of w.sources){l.waste.amount=100;w.generated+=100;}
 for(let i=0;i<4*3600;i++)s.step(1);
 assert.ok(w.collected>0);assert.ok(w.delivered>0);balance(w.stats);
 assert.ok(w.trucks.every(t=>t.load<=t.capacity));
 assert.equal(new Set(w.trucks.map(t=>t.target).filter(t=>t&&t!=='wasteDepot')).size,w.trucks.filter(t=>t.target&&t.target!=='wasteDepot').length);
});
test('full depot retains truck load; day rollover preserves stocks',()=>{
 const s=make(),w=s.waste,t=w.trucks[0];
 w.storage=w.storageCapacity;t.load=100;t.target='wasteDepot';t.serviceAt=s.time;
 w.generated=w.storage+100;w.step(1);
 assert.equal(t.load,100);assert.equal(t.status,'TPS3R penuh');balance(w.stats);
 s.time=86400;w.step(1);assert.ok(w.today.generated<1);assert.equal(w.storage,w.storageCapacity);balance(w.stats);
});
test('zero production and reset start with empty sources',()=>{
 const s=make();s.applyConfig({...s.config,wastePerPerson:0});s.waste.step(60);
 assert.equal(s.waste.generated,0);assert.equal(s.waste.stats.waiting,0);
 assert.throws(()=>s.applyConfig({...s.config,wastePerPerson:-1}));
});

test('representative carries waste out, deposits only at bin, and returns without duplicating mass',()=>{
 const s=make(),w=s.waste,lot=w.sources[0];s.time=6*3600;
 lot.waste.building=3;w.generated=3;w.dispose();
 assert.equal(w.walkers.length,1);const trip=w.walkers[0];
 assert.equal(lot.waste.building,0);assert.equal(lot.waste.amount,0);assert.equal(w.stats.carried,3);balance(w.stats);
 s.time=trip.depositAt-1;w.dispose();assert.equal(lot.waste.amount,0);
 const atBin=w.walkPosition(trip);assert.equal(atBin.x,trip.route.points.at(-1).x);assert.equal(atBin.z,trip.route.points.at(-1).z);
 s.time=trip.depositAt;w.dispose();assert.equal(lot.waste.amount,3);assert.equal(w.stats.carried,0);assert.equal(w.walkPosition(trip).carrying,false);balance(w.stats);
 w.dispose();assert.equal(lot.waste.amount,3);
 s.time=trip.returnAt;const returned=w.walkPosition(trip);assert.ok(Math.hypot(returned.x-trip.route.points[0].x,returned.z-trip.route.points[0].z)<1e-8);
 w.dispose();assert.equal(w.walkers.length,0);balance(w.stats);
});
test('carriers respect hours, load limit and one trip per area; bins can overflow without losing waste',()=>{
 const s=make(),w=s.waste,l=w.sources[0];l.waste.building=12;l.waste.amount=l.waste.capacity;w.generated=12+l.waste.amount;
 w.dispose();assert.equal(w.walkers.length,0);
 s.time=6*3600;w.dispose();w.dispose();assert.equal(w.walkers.length,1);assert.equal(w.walkers[0].load,5);assert.equal(l.waste.building,7);
 s.time=w.walkers[0].depositAt;w.dispose();assert.equal(l.waste.amount,l.waste.capacity+5);assert.equal(w.stats.overflowing,1);balance(w.stats);
});
