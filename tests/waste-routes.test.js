import test from 'node:test';
import assert from 'node:assert/strict';
import {planRoutes,tripTime,START,END} from '../src/traffic/waste-routes.js';
import {miniKotaLengkap} from '../src/map/default-map.js';
import {TrafficEngine} from '../src/traffic/engine.js';

// Stops on a line: depot at 0, stops at 10, 20, 30; the way back also at 0.
const at=[10,20,30],pos=i=>i===START||i===END?0:at[i],cost=(a,b)=>Math.abs(pos(a)-pos(b));

test('Clarke-Wright joins trips while the load fits; 2-opt orders the visits',()=>{
  const all=planRoutes([1,1,1],{cost,capacity:3});
  assert.equal(all.trips.length,1);assert.equal(tripTime(all.trips[0],cost),60);
  assert.deepEqual([...all.trips[0]].sort(),[0,1,2]);
  const two=planRoutes([2,2,2],{cost,capacity:4});
  assert.equal(two.trips.length,2);assert.equal(two.trips.flat().length,3);
  const cut=planRoutes([1,1],{cost:(a,b)=>a===START&&b===1?Infinity:cost(a,b),capacity:3});
  assert.deepEqual(cut.unreachable,[1]);assert.deepEqual(cut.trips,[[0]]);
});

test('the smart city sends one truck along the bins that called, emptying each',()=>{
  const e=new TrafficEngine(miniKotaLengkap(),{demand:300,seed:3,adaptive:true,binMode:'sensor'});
  for(const b of e.bins)b.fill=0.85;
  e.step(0.25);   // the bins report; trucks are routed
  const trucks=[...e.backlog,...e.vehicles].filter(b=>b.type==='truck');
  assert.ok(trucks.length>=1&&trucks.length<=2);
  assert.ok(trucks.some(t=>t.stops.length>1),'a truck visits several bins');
  assert.equal(trucks.reduce((n,t)=>n+t.stops.length,0),e.bins.filter(b=>b.truck==='called').length);
  assert.equal(e.stats.truckTrips,trucks.length);
  for(const t of trucks)for(let k=1;k<t.stops.length;k++)assert.ok(t.stops[k].idx>=t.stops[k-1].idx,'stops in route order');
  const before=e.stats.truckTrips;e.step(5);assert.equal(e.stats.truckTrips,before,'no truck for bins already on a route');
  e.run(1800);
  assert.ok(e.bins.filter(b=>b.emptied>0).length>=e.bins.length-1,`${e.bins.filter(b=>b.emptied>0).length} of ${e.bins.length} emptied`);
});

test('before leaving, stops and load are set within what the truck carries; a full truck goes back',()=>{
  const e=new TrafficEngine(miniKotaLengkap(),{demand:300,seed:3,adaptive:true,binMode:'sensor',truckCapacity:230});
  for(const b of e.bins)b.fill=0.85;
  e.step(0.25);
  const trucks=[...e.backlog,...e.vehicles].filter(b=>b.type==='truck');
  for(const t of trucks)assert.ok(t.stops.length<=2,'0.85 x 120 kg twice fits in 230 kg, three times not');
  const two=trucks.find(t=>t.stops.length===2);assert.ok(two,'a truck with two stops');
  // The second bin filled up faster than reported: the truck goes back after the first.
  const second=e.bins.find(b=>b.id===two.stops[1].bin),first=e.bins.find(b=>b.id===two.stops[0].bin);
  let t=0;while(first.emptied===0&&t<1800){second.fill=1.2;e.step(0.25);t+=0.25;}
  assert.equal(first.emptied,1);
  for(let k=0;k<40;k++)e.step(0.25);
  const truck=e.vehicles.find(v=>v.type==='truck'&&v.load>0&&v.stops.length===0&&v.route.at(-1)===two.route.at(-1));
  assert.ok(truck,'the truck heads back with no stops left');assert.equal(second.emptied,0);
  assert.notEqual(second.truck,truck.id);
});
