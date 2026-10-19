import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation as BaseSimulation, DEFAULTS, GATES, GROUPS, LOTS, makeNetwork, shareKey, entryKey, exitKey, validate} from '../src/simulation.js';
// Legacy commuter/parking scenarios disable background traffic to isolate their assertions.
class Simulation extends BaseSimulation {constructor(config={}){super({throughRate:0,...config});}}

function invariant(s){
  assert.equal(s.people.length,s.config.population);
  assert.equal(s.demography.reduce((a,b)=>a+b,0),s.people.length);
  assert.equal(Object.values(s.modeCounts).reduce((a,b)=>a+b,0),s.people.length);
  const stats=s.stats;assert.equal(stats.driving+stats.atHome+stats.parked+stats.internal+stats.outside,stats.cars);
  assert.equal(stats.inside+stats.outside,stats.cars);
  assert.equal(stats.inside,s.initialInside+Object.values(s.crossings).reduce((n,g)=>n+g.in-g.out,0));
  for(const w of Object.values(s.workplaces))assert.equal(w.local+w.incoming+w.vacant,w.total);
  // Parking has no capacity any more, but two cars must never share one drawing position.
  for(const l of Object.values(s.lots).filter(l=>!l.external)){
    const slots=[...l.occupied.values(),...l.reserved.values()];assert.equal(new Set(slots).size,slots.length);
  }
  for(const c of s.cars){
    const p=s.position(c);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z));assert.ok(p.x>=0&&p.x<=1536&&p.z>=0&&p.z<=1024);
    const owned=Object.values(s.lots).filter(l=>!l.external&&l.occupied.has(c.id)).length;
    assert.equal(owned,['driving','outside'].includes(c.state)?0:1);
    if(c.state==='driving'){assert.ok(c.s>=0&&c.s<=s.edges[c.edge].length);assert.ok(c.v<=80/3.6);}
    if(!c.external)for(const job of c.jobs){assert.notEqual(s.people[job.riders[0]].role,'students','A student must not be the driver');assert.ok(job.riders.every(id=>s.people[id].household===c.household));}
  }
}
test('connected road network has thirteen boundary gateways, each leaving from a real junction',()=>{
  const {nodes,edges}=makeNetwork();assert.ok(nodes.every(n=>n.x>=0&&n.x<=1536&&n.z>=0&&n.z<=1024));assert.equal(nodes.filter(n=>n.external).length,13);assert.ok(nodes.every(n=>n.lot||n.edges.length>=2));
  // A gate must sit on the map edge and hang off a road node that already exists inland.
  for(const g of GATES){
    assert.ok(g.gate[0]===0||g.gate[0]===1536||g.gate[1]===0||g.gate[1]===1024,`${g.id} is not on the map edge`);
    assert.ok(nodes.some(n=>n.x===g.road[0]&&n.z===g.road[1]&&!n.external),`${g.id} does not attach to an existing road node`);
  }
  // A gate road that crossed another road without a junction would let cars drive through each other.
  const cross=(p,q,r,s)=>{
    const d=(q[0]-p[0])*(s[1]-r[1])-(q[1]-p[1])*(s[0]-r[0]);if(Math.abs(d)<1e-9)return false;
    const t=((r[0]-p[0])*(s[1]-r[1])-(r[1]-p[1])*(s[0]-r[0]))/d,u=((r[0]-p[0])*(q[1]-p[1])-(r[1]-p[1])*(q[0]-p[0]))/d;
    return t>.02&&t<.98&&u>.02&&u<.98;
  };
  for(const g of GATES)for(const e of edges)for(let i=1;i<e.points.length;i++)
    assert.ok(!cross(g.road,g.gate,[e.points[i-1].x,e.points[i-1].z],[e.points[i].x,e.points[i].z]),`${g.id} crosses a road without a junction`);
  const seen=new Set([0]),q=[0];for(const n of q)for(const id of nodes[n].edges){const next=edges[id].to;if(!seen.has(next)){seen.add(next);q.push(next);}}assert.equal(seen.size,nodes.length);
});
test('background traffic is deterministic, separate, variable and travels between different gates',()=>{
  const s=new BaseSimulation({throughRate:20}),repeat=new BaseSimulation({throughRate:20});
  const traffic=s.cars.filter(c=>c.through);assert.ok(traffic.length>0);assert.deepEqual(traffic.map(c=>c.readyAt),repeat.cars.filter(c=>c.through).map(c=>c.readyAt));
  assert.equal(s.people.length,400);assert.equal(s.stats.localCars,70);assert.equal(s.stats.externalCars,27);
  assert.ok(traffic.every(c=>c.jobs.length===1&&c.jobs[0].from!==c.jobs[0].to));
  assert.ok(new Set(traffic.slice(1).map((c,i)=>Math.round(c.readyAt-traffic[i].readyAt))).size>10);
  const ids=s.cars.map(c=>c.id);while(s.time<12*3600){s.step(.5);if(s.time%600===0)invariant(s);}
  assert.ok(s.throughCompleted>0);assert.deepEqual(s.cars.map(c=>c.id),ids);
  assert.ok(traffic.filter(c=>c.job===1).every(c=>c.state==='outside'));
  assert.ok(Object.values(s.lots).filter(l=>!l.external).every(l=>[...l.occupied.keys()].every(id=>!s.cars[id].through)));
  assert.equal(new BaseSimulation({throughRate:0}).stats.throughPlanned,0);
});
test('through traffic draws its entry and exit gates from separate shares',()=>{
  const zero=keyOf=>Object.fromEntries(GATES.map(g=>[keyOf(g.id),0]));
  const config={throughRate:120,...zero(entryKey),...zero(exitKey),
    gateEntryGate5:70,gateEntryGate14:30,gateExitGate8:60,gateExitGate13:40};
  const traffic=new BaseSimulation(config).cars.filter(c=>c.through);
  assert.ok(traffic.length>0);
  assert.ok(traffic.every(c=>['gate5','gate14'].includes(c.jobs[0].from)),'entered through a zero-share gate');
  assert.ok(traffic.every(c=>['gate8','gate13'].includes(c.jobs[0].to)),'left through a zero-share gate');
  const entered=traffic.filter(c=>c.jobs[0].from==='gate5').length/traffic.length;
  assert.ok(entered>.6&&entered<.8,`gate5 took ${(entered*100).toFixed(0)}% of entries, expected about 70%`);
  // Commuter shares are a separate dial: steering through traffic must not move them.
  const commuters=new BaseSimulation(config).cars.filter(c=>c.external&&!c.through);
  assert.ok(commuters.some(c=>!['gate5','gate14'].includes(c.home)),'commuters followed the through-traffic shares');
  assert.throws(()=>validate({...DEFAULTS,...zero(entryKey),gateEntryGate5:100}),/melintas/);
});
test('roundabout follows the reference circle in a single clockwise direction',()=>{
  const {edges}=makeNetwork(),ring=edges.filter(e=>e.roundabout);assert.equal(ring.length,4);
  for(const e of ring)for(const p of e.points)assert.ok(Math.abs(Math.hypot(p.x-713,p.z-419)-70)<.001);
  assert.ok(edges.some(e=>!e.roundabout&&e.points.length>3));
});
test('population, rounded counts, vehicle ownership and deterministic schedules',()=>{
  const s=new Simulation({students:83});invariant(s);assert.equal(s.households.length,101);assert.equal(s.people.length,403);
  assert.deepEqual(s.cars.map(c=>c.jobs),new Simulation({students:83}).cars.map(c=>c.jobs));
  assert.equal(new Simulation().stats.localCars,70);
});
test('default full day preserves fleet and parking; every planned vehicle returns home',()=>{
  const s=new Simulation();let maxTraffic=0,maxParked=0,maxQueue=0;
  while(!s.finished){s.step(.25);if(Math.floor(s.time*4)%120===0){invariant(s);maxTraffic=Math.max(maxTraffic,s.stats.driving);maxParked=Math.max(maxParked,s.stats.parked);maxQueue=Math.max(maxQueue,s.stats.waiting);}}
  invariant(s);assert.ok(maxTraffic>0&&maxParked>0&&maxQueue>0);assert.equal(s.stats.atHome,s.stats.localCars);assert.equal(s.stats.outside,s.stats.externalCars);assert.equal(s.completed,s.cars.reduce((n,c)=>n+c.jobs.length,0));
  // Each commuter returns through its own gate, so every gate balances; with the flow split
  // thirteen ways a given gate may draw nobody, but the city as a whole must see traffic.
  for(const [gate,counts] of Object.entries(s.crossings))assert.equal(counts.out-counts.in,s.initialGateBalance[gate]);
  assert.ok(Object.values(s.crossings).reduce((n,c)=>n+c.in,0)>0);
});
test('activity counts determine population and household estimate without changing other groups',()=>{
  const a=new Simulation(),b=new Simulation({students:100});
  assert.equal(a.people.length,400);assert.equal(b.people.length,420);assert.equal(b.households.length,105);
  assert.deepEqual(b.demography,[100,40,180,60,40]);
  const larger=new Simulation({householdSize:5});assert.equal(larger.people.length,400);assert.equal(larger.households.length,80);assert.ok(larger.stats.localCars<a.stats.localCars);
  const zero=Object.fromEntries(GROUPS.map(k=>[k,0]));
  assert.equal(new Simulation({...zero,other:1}).people.length,1);
  for(const config of [zero,{students:-1},{students:1.5},{students:NaN},{students:20000},{householdSize:.5},{householdSize:NaN}])assert.throws(()=>new Simulation(config));
});
test('zero car ownership retains people and non-car journeys',()=>{
  const s=new Simulation({noCar:100,oneCar:0,twoCars:0,incomingCar:0});assert.equal(s.cars.length,0);assert.equal(s.modeCounts.car,0);assert.ok(s.virtual.length>0);s.step();invariant(s);
});
test('parking is unlimited, yet the lot access still admits one car at a time',()=>{
  const s=new Simulation();let busiest=0;
  while(s.time<12*3600){s.step(.5);if(s.time%60===0){invariant(s);
    for(const l of Object.values(s.lots).filter(l=>!l.external)){
      busiest=Math.max(busiest,l.occupied.size);
      assert.ok(l.reserved.size<=1,`${l.id} reserved more than one approach`);
    }}}
  assert.ok(busiest>0,'no car ever parked');assert.equal(s.stats.localCars,70);
  assert.ok(s.parkingWait>0,'no car ever queued at a lot access');
});
test('signal opposing phases never green together and time configuration is validated',()=>{
  const s=new Simulation(),node=s.nodes.find(n=>n.edges.length>=3&&!n.access&&!n.lot&&!n.roundabout);for(let t=0;t<120;t++){s.time=t;assert.ok(!(s.phase(node,'x')==='green'&&s.phase(node,'z')==='green'));}
  assert.throws(()=>validate({...DEFAULTS,noCar:99}),/100%/);assert.throws(()=>validate({...DEFAULTS,schoolEnd:6}),/jam pulang/);assert.throws(()=>validate({...DEFAULTS,green:5}),/hijau/i);
});
test('lot turn-offs are not treated as signalised road intersections',()=>{
  const {nodes}=makeNetwork();
  const accesses=nodes.filter(n=>n.access);
  assert.equal(accesses.length,LOTS.length);
  assert.ok(accesses.some(n=>n.edges.length>=3),'expected a driveway branching from a main road');
  assert.ok(nodes.some(n=>n.edges.length>=3&&!n.access&&!n.lot&&!n.roundabout),'expected a public road intersection');
});
test('diagonal airport branch receives a separate signal phase from the main road',()=>{
  const s=new Simulation(),gate=s.nodes[s.lotNodes.gate8],entry=s.edges[gate.edges[0]],node=s.nodes[entry.to];
  const main=s.edges.filter(e=>e.to===node.id&&e.id!==entry.id);
  assert.equal(main.length,2);
  assert.equal(s.approach(main[0]).axis,s.approach(main[1]).axis);
  assert.notEqual(s.approach(entry).axis,s.approach(main[0]).axis);
  for(let t=0;t<120;t++){
    s.time=t;assert.ok(!(s.phase(node,s.approach(entry).axis)==='green'&&s.phase(node,s.approach(main[0]).axis)==='green'));
  }
});
test('junction lanes stay separate, join continuously, and reserve only conflicting movements',()=>{
  const s=new Simulation(),node=s.nodes.find(n=>n.x===1015&&n.z===409);
  const incoming=s.edges.filter(e=>e.to===node.id);
  const west=incoming.find(e=>s.nodes[e.from].x<node.x),east=incoming.find(e=>s.nodes[e.from].x>node.x);
  const north=incoming.find(e=>s.nodes[e.from].z<node.z),south=incoming.find(e=>s.nodes[e.from].z>node.z);
  const reverse=e=>s.edges.find(r=>r.from===node.id&&r.to===e.from).id;
  const a={id:10000,edge:west.id,path:[reverse(east)]},b={id:10001,edge:east.id,path:[reverse(west)]};
  node.movements=new Map([[a.id,s.movement(a.edge,a.path[0])]]);
  assert.equal(s.canClaim(node,b),true,'opposing straight lanes should coexist');
  assert.equal(s.canClaim(node,{id:10002,edge:north.id,path:[reverse(south)]}),false,'cross traffic must wait');
  for(const out of node.edges){
    const car={state:'driving',edge:west.id,path:[out],s:west.length};const before=s.position(car);
    const after=s.position({...car,previousEdge:west.id,edge:out,path:[],s:0});
    assert.ok(Math.hypot(before.x-after.x,before.z-after.z)<1e-8,'lane jumps at junction');
  }
});
test('changing schedules moves actual school departures; congestion increases travel time',()=>{
  const baseline=new Simulation(),later=new Simulation({schoolStart:8,schoolEnd:15});
  const escort=baseline.cars.find(c=>c.jobs[0]?.to==='school');
  assert.ok(escort);assert.equal(later.cars[escort.id].jobs[0].at-escort.jobs[0].at,3600);
  // With parking unlimited, delay can only come from the roads themselves.
  const busy=new BaseSimulation({throughRate:200});
  while(!baseline.finished)baseline.step(.5);while(!busy.finished)busy.step(.5);
  invariant(busy);assert.ok(busy.stats.averageMinutes>baseline.stats.averageMinutes);
});
test('commuter controls preserve jobs, residents, identities and external dwell time',()=>{
  // Route every commuter through one gate; the remaining twelve must stay unused.
  const only=GATES[0].id,shares=Object.fromEntries(GATES.map(g=>[shareKey(g.id),g.id===only?100:0]));
  const s=new Simulation(shares),ids=s.cars.map(c=>c.id);
  assert.equal(s.people.length,400);assert.equal(s.visitors.length,45);assert.equal(s.stats.localCars,70);
  let observed=false;
  while(s.time<19*3600){s.step(.5);const c=s.cars.find(c=>!c.external&&c.state==='outside'&&c.jobs[c.job]?.from===only&&!c.pendingExternal);if(c){observed=true;assert.ok(c.readyAt>=c.jobs[c.job].at+s.config.externalMinutes*60);}}
  assert.ok(observed);assert.deepEqual(s.cars.map(c=>c.id),ids);
  for(const g of GATES)if(g.id!==only)assert.equal(s.crossings[g.id].in+s.crossings[g.id].out,0,`${g.id} should be unused`);
  invariant(s);
  const closed=new Simulation({outboundWorkers:0,outboundUniversity:0});assert.equal(closed.visitors.length,0);assert.equal(closed.stats.outbound,0);
  const vacant=new Simulation({incomingFill:0});assert.equal(vacant.visitors.length,0);assert.equal(Object.values(vacant.workplaces).reduce((n,w)=>n+w.vacant,0),45);
});
