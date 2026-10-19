import test from 'node:test';
import assert from 'node:assert/strict';
import {miniKotaLengkap,miniKotaRoads} from '../src/map/default-map.js';
import {buildGeometry,pointAt,polylineLength,CLUSTER_LINK} from '../src/map/geometry.js';
import {validateMap} from '../src/map/format.js';
import {TrafficEngine} from '../src/traffic/engine.js';
import {buildWalkGraph} from '../src/traffic/pedestrians.js';

// Simpang gabungan: signalised junctions joined by a link shorter than CLUSTER_LINK.
const separated=map=>{for(const n of map.nodes)if(n.id==='n19'||n.id==='n25')n.signalPlan={...(n.signalPlan||{}),separate:true};return map;};
const near=(q,p,r)=>q.points.some(a=>Math.hypot(a.x-p.x,a.z-p.z)<r);

test('Mini Kota: n19 and n25 form one simpang gabungan; its link has a yellow box, no stop line or zebra',()=>{
  const map=miniKotaRoads(),g=buildGeometry(map);
  assert.deepEqual(g.clusters,[{id:'n19',nodes:['n19','n25'],roads:['r25']}]);
  const link=g.roads.find(r=>r.id==='r25');assert.ok(polylineLength(link.line)<CLUSTER_LINK);
  for(const id of ['n19','n25']){const j=g.junctions.find(j=>j.id===id);assert.equal(j.cluster,'n19');assert.ok(j.legs.find(l=>l.road==='r25').internal);}
  const mid=pointAt(link.line,polylineLength(link.line)/2).p;
  // Quads centred on the link (the outer legs' zebras lie just beyond its mouths).
  const centre=q=>({x:q.points.reduce((a,p)=>a+p.x,0)/4,z:q.points.reduce((a,p)=>a+p.z,0)/4});
  const here=g.quads.filter(q=>{const c=centre(q);return Math.hypot(c.x-mid.x,c.z-mid.z)<3;});
  assert.ok(here.length>10&&here.every(q=>q.box),'only yellow box marking on the link');
  // Run separately: the box goes, stop lines and zebras come back.
  const s=buildGeometry(separated(miniKotaRoads()));
  assert.deepEqual(s.clusters,[]);
  assert.ok(!s.quads.some(q=>q.box));
  assert.ok(s.quads.some(q=>q.zebra&&near(q,mid,8)));
});

test('one controller: members share one cycle and start at the set offset; the link is not stopped again',()=>{
  const map=miniKotaLengkap(),e=new TrafficEngine(map,{demand:0});
  const cycle=sig=>sig.plan.phases.reduce((t,p)=>t+p.green+4,0);
  assert.equal(cycle(e.signals.get('n19')),cycle(e.signals.get('n25')));
  assert.ok(e.internal.has(`n19:${e.signals.get('n19').j.legs.filter(l=>!l.ring).findIndex(l=>l.road==='r25')}`));
  for(const c of e.graph.connectors)if(e.internal.has(`${c.node}:${c.legFrom}`))assert.equal(e.allows(c),'yield');
  // One camera (a dome at n19) watches the outer approaches of both junctions.
  const outer=id=>e.signals.get(id).j.legs.filter(l=>!l.ring).map((l,i)=>[l,i]).filter(([l])=>!l.internal&&!l.access).map(([,i])=>i);
  for(const id of ['n19','n25'])for(const i of outer(id))assert.ok(e.signals.get(id).sensed.has(i),`${id} leg ${i} watched`);
  // An offset delays the second member's cycle.
  const shifted=structuredClone(map);shifted.nodes.find(n=>n.id==='n25').signalPlan={offset:24};
  const a=new TrafficEngine(map,{demand:0}),b=new TrafficEngine(shifted,{demand:0});
  a.run(24);
  assert.deepEqual(b.signalState('n25'),a.signalState('n25'));
  assert.equal(b.offsets.n25,24);
});

test('pedestrians cross at the outer zebras only, not on the link of a simpang gabungan',()=>{
  const map=validateMap(miniKotaRoads()),walk=buildWalkGraph(map,buildGeometry(map));
  const g=buildGeometry(map),legIndex=id=>g.junctions.find(j=>j.id===id).legs.filter(l=>!l.ring).findIndex(l=>l.road==='r25');
  for(const id of ['n19','n25'])assert.ok(!walk.edges.some(e=>e.kind==='cross'&&e.node===id&&e.leg===legIndex(id)));
  assert.ok(walk.edges.some(e=>e.kind==='cross'&&e.node==='n19'));
});

test('run as one, the pair queues far less than as two separate signals',()=>{
  const measure=map=>{let pair=0,link=0;const e=new TrafficEngine(map,{demand:1200,seed:4});
    for(let t=0;t<1200;t+=0.25){e.step(0.25);for(const v of e.vehicles){if(v.v>=0.3||v.dwelling)continue;const s=e.graph.byId.get(v.route[v.idx]);
      if(['n19','n25'].includes(s.kind==='lane'?s.end:s.node))pair+=0.25;if(s.kind==='lane'&&s.road==='r25')link+=0.25;}}
    return {pair,link,red:e.stats.redViolations};};
  const joined=measure(miniKotaLengkap()),apart=measure(separated(miniKotaLengkap()));
  assert.ok(joined.pair<apart.pair*0.6,`pair ${joined.pair} vs ${apart.pair}`);
  assert.ok(joined.link<apart.link*0.3,`link ${joined.link} vs ${apart.link}`);
  assert.equal(joined.red+apart.red,0);
});
