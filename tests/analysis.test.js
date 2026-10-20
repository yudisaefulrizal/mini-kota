import test from 'node:test';
import assert from 'node:assert/strict';
import {miniKotaLengkap} from '../src/map/default-map.js';
import {TrafficEngine} from '../src/traffic/engine.js';
import {collect,train,evaluate,STEP} from '../src/analysis/learn.js';

const map=miniKotaLengkap(),options={demand:900,seed:42,adaptive:true,binMode:'sensor',binFill:3000*0.7/6/120/86400};

test('a learning round: sensor samples in, four models out, all from counts only',()=>{
  const engine=new TrafficEngine(map,options);
  const data=collect(engine,{seconds:1800});
  assert.equal(data.step,STEP);assert.equal(data.cams.length,engine.sensors.length);
  assert.equal(data.count[0].length,1800/STEP);assert.equal(data.fill[0].length,30);
  const model=train(engine,data,null);
  assert.equal(model.round,1);assert.equal(model.minutes,30);
  // 1 · forecast per camera, checked against the naive guess
  assert.equal(model.forecast.length,engine.sensors.length);assert.ok(model.error.windows>0);
  // 2 · green per phase from the controllers' log, within bounds
  for(const g of Object.values(model.greens))for(const x of g)assert.ok(x>=10&&x<=45);
  // 3 · links only for platoons the downstream camera cannot see yet
  for(const l of model.links)assert.ok(l.travel>=10&&l.share>0&&l.share<=1);
  // 4 · bin fill rates and truck lead
  for(const b of Object.values(model.waste.bins))assert.ok(b.rate>=0&&b.lead>0);
  // A second round builds on the first.
  const again=train(engine,collect(engine,{seconds:600}),model,model.learned);
  assert.equal(again.round,2);assert.equal(again.minutes,40);
});

test('the engine takes a learned model; the evaluation averages several days',()=>{
  const sig=[...new TrafficEngine(map,options).signals.keys()][0];
  const learned={greens:{[sig]:[33,11,22,44]},links:[],bins:{}};
  const e=new TrafficEngine(map,{...options,learned});
  assert.deepEqual(e.signals.get(sig).plan.phases.map(p=>p.green),[33,11,22,44].slice(0,e.signals.get(sig).plan.phases.length));
  const make=(l,seed)=>new TrafficEngine(map,{...options,seed,learned:l});
  const a=evaluate(make,null,{seconds:300,seeds:[1,2]}),b=evaluate(make,null,{seconds:300,seeds:[1,2]});
  assert.deepEqual(a,b,'deterministic');assert.ok(a.completed>0);
});
