import {toMetres} from '../src/scale.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,LOTS,GATES,makeNetwork} from '../src/simulation.js';
import {makePedestrianNetwork,walkingPosition} from '../src/pedestrians.js';

test('walking crossings exist at signalised junctions and roundabout approaches',()=>{
  const network=makeNetwork(),graph=makePedestrianNetwork(network,[...LOTS,...GATES]);
  const crossings=graph.edges.filter(edge=>edge.kind==='crossing');
  assert.ok(crossings.length>0);
  for(const edge of crossings){
    const a=edge.points[0],b=edge.points.at(-1),x=(a.x+b.x)/2,z=(a.z+b.z)/2;
    const junction=network.nodes.reduce((best,node)=>Math.hypot(node.x-x,node.z-z)<Math.hypot(best.x-x,best.z-z)?node:best);
    assert.ok(junction.roundabout||(junction.edges.length>=3&&!junction.lot&&!junction.access),`Crossing outside a public junction ${junction.id}`);
  }
});

test('each roundabout approach has a zebra crossing and sidewalks avoid the circulating lane',()=>{
  const network=makeNetwork(),graph=makePedestrianNetwork(network,[...LOTS,...GATES]);
  const radius=p=>Math.hypot(p.x-713,p.z-419);
  for(const junction of network.nodes.filter(n=>n.roundabout)){
    const nearby=graph.edges.filter(e=>e.points.every(p=>Math.hypot(p.x-junction.x,p.z-junction.z)<50));
    const crossings=nearby.filter(e=>e.kind==='crossing');
    assert.equal(crossings.length,1);
    assert.ok(crossings[0].length>=34&&crossings[0].length<=38,'crossing should span both traffic lanes');
    assert.ok(crossings[0].points.every(p=>radius(p)>88),'crossing should be outside the circulating lane');
    for(const edge of nearby.filter(e=>e.kind==='sidewalk')){
      for(let i=1;i<edge.points.length;i++)for(let t=0;t<=1;t+=.1){
        const a=edge.points[i-1],b=edge.points[i],r=radius({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
        assert.ok(r<54||r>86,'sidewalk cuts across the circulating lane');
      }
    }
  }
});

test('walking graph connects every destination in both directions with continuous routes',()=>{
  const lots=[...LOTS,...GATES],graph=makePedestrianNetwork(makeNetwork(),lots);
  assert.ok(graph.edges.some(e=>e.kind==='crossing'));
  assert.ok(graph.edges.some(e=>e.kind==='access'));
  for(const a of lots)for(const b of lots){if(a===b)continue;
    const route=graph.route(a.id,b.id),reverse=graph.route(b.id,a.id);
    assert.ok(route.length>0);assert.ok(Math.abs(route.length-reverse.length)<1e-6);
    assert.deepEqual([route.points[0].x,route.points[0].z],a.gate);
    assert.deepEqual([route.points.at(-1).x,route.points.at(-1).z],b.gate);
    assert.ok(Math.abs(route.length-route.lengths.at(-1))<1e-6);
    const end=walkingPosition(route,route.length);assert.ok(Math.hypot(end.x-b.gate[0],end.z-b.gate[1])<1e-6);
  }
});
test('walkers follow scheduled sidewalk distance and disappear on arrival',()=>{
  const sim=new Simulation({noCar:100,oneCar:0,twoCars:0,throughRate:0});
  const trip=sim.virtual.find(v=>v.mode==='walk');assert.ok(trip);
  const route=sim.pedestrianNetwork.route(trip.from,trip.to);
  assert.ok(Math.abs(trip.arrive-trip.depart-toMetres(route.length)/1.2)<1e-6);
  sim.time=trip.depart-.01;assert.ok(!sim.pedestrians.includes(trip));
  sim.time=(trip.depart+trip.arrive)/2;assert.ok(sim.pedestrians.includes(trip));
  const actual=sim.pedestrianPosition(trip),expected=walkingPosition(route,route.length/2);
  assert.ok(Math.hypot(actual.x-expected.x,actual.z-expected.z)<1e-6);
  sim.time=trip.arrive;assert.ok(!sim.pedestrians.includes(trip));
});

test('both sidewalks reach each city exit boundary without a diagonal access across the road',()=>{
  const graph=makePedestrianNetwork(makeNetwork(),[...LOTS,...GATES]);
  for(const gate of GATES){
    const axis=gate.gate[0]===0||gate.gate[0]===1536?'x':'z';
    const boundary=gate.gate[axis==='x'?0:1];
    const endpoints=graph.edges.filter(e=>e.kind==='sidewalk').flatMap(e=>[e.points[0],e.points.at(-1)])
      .filter(p=>Math.abs(p[axis]-boundary)<1e-8&&Math.hypot(p.x-gate.gate[0],p.z-gate.gate[1])<40);
    assert.equal(endpoints.length,2,`${gate.id} must have two sidewalks at the map edge`);
    const connector=graph.edges.find(e=>e.kind==='boundary'&&e.points[0].x===gate.gate[0]&&e.points[0].z===gate.gate[1]);
    assert.ok(connector,`${gate.id} uses an unpaved logical boundary connection`);
    assert.ok(connector.points.every(p=>Math.abs(p[axis]-boundary)<1e-8));
  }
});
