import test from 'node:test';
import assert from 'node:assert/strict';
import {pedestrianSurfaces} from '../src/pedestrian-surfaces.js';
import {makeNetwork,LOTS,GATES} from '../src/simulation.js';
import {makePedestrianNetwork} from '../src/pedestrians.js';

test('a sidewalk across a road becomes stripes only over the roadway',()=>{
  const roads={nodes:[{},{}],edges:[{from:0,to:1,points:[{x:0,z:-50},{x:0,z:50}]}]};
  const surfaces=pedestrianSurfaces({edges:[{kind:'sidewalk',points:[{x:-30,z:0},{x:30,z:0}]}]},roads);
  assert.deepEqual(surfaces.map(s=>[s.kind,s.a.x,s.b.x]),[['sidewalk',-30,-14],['crossing',-14,14],['sidewalk',14,30]]);
});

test('all city sidewalks and lot paths stay outside road interiors after clipping',()=>{
  const roads=makeNetwork(),walking=makePedestrianNetwork(roads,[...LOTS,...GATES]);
  const surfaces=pedestrianSurfaces(walking,roads);
  for(const surface of surfaces.filter(s=>s.kind!=='crossing')){
    for(const road of roads.edges){
      if([road.from,road.to].some(id=>roads.nodes[id].lot&&!roads.nodes[id].external))continue;
      for(let i=1;i<road.points.length;i++){
        const a=road.points[i-1],b=road.points[i],length=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
        for(const t of [.01,.25,.5,.75,.99]){
          const x=surface.a.x+(surface.b.x-surface.a.x)*t-a.x,z=surface.a.z+(surface.b.z-surface.a.z)*t-a.z;
          assert.ok(!(x*dx+z*dz>1e-7&&x*dx+z*dz<length-1e-7&&Math.abs(-x*dz+z*dx)<14-1e-7),'pavement intrudes into a road');
        }
      }
    }
  }
  assert.ok(surfaces.filter(s=>s.kind==='crossing').length>walking.edges.filter(e=>e.kind==='crossing').length);
  assert.ok(!surfaces.some(s=>s.kind==='boundary'));
});
