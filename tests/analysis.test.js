import test from 'node:test';
import assert from 'node:assert/strict';
import {miniKotaLengkap} from '../src/map/default-map.js';
import {TrafficEngine} from '../src/traffic/engine.js';
import {recorder,train,chooseSetting,compose,MODELS,CHUNK,STEP} from '../src/analysis/learn.js';
import {labels,firstMorning} from '../src/analysis/calendar.js';
import {gbtFit,gbtPredict,gpFit,gpPredict} from '../src/analysis/ml.js';

const map=miniKotaLengkap(),options={demand:900,seed:42,adaptive:true,binMode:'sensor',binFill:3000*0.7/6/120/86400};

test('the methods: trees and a Gaussian process fit what they should',()=>{
  const X=Array.from({length:200},(_,i)=>[i%20,(i*7)%13]),y=X.map(([a,b])=>a>10?5+b*0.1:1);
  const m=gbtFit(X,y);assert.ok(Math.abs(gbtPredict(m,[15,3])-5.3)<0.5&&Math.abs(gbtPredict(m,[2,3])-1)<0.5);
  const g=gpFit([[0],[0.5],[1]],[1,0,1]);const p=gpPredict(g,[0.5]),far=gpPredict(g,[3]);
  assert.ok(p.mean<0.4&&p.sd<far.sd);
});

test('history: one record every 5 s, rows per id, labels and model versions',()=>{
  const engine=new TrafficEngine(map,options),origin=firstMorning(new Date(2026,9,20)),chunks=[];
  const rec=recorder(engine,{origin,versions:()=>MODELS.map(()=>0),onChunk:c=>chunks.push(c)});
  while(engine.time<3600+STEP){rec.tick();engine.step(0.25);}
  assert.equal(chunks.length,3600/STEP/CHUNK);const c=chunks[0];
  assert.equal(c.n,CHUNK);assert.equal(c.t[1]-c.t[0],STEP);
  assert.deepEqual([...c.lab.slice(0,7)],labels(origin));assert.deepEqual([...c.lab.slice(0,4)],[6,20,10,2026]);
  assert.equal(c.lewat.length,CHUNK*c.cams.length);assert.equal(c.fase.length,CHUNK*c.nodes.length);assert.equal(c.isi.length,CHUNK*c.bins.length);
  assert.ok(c.lewat.reduce((s,v)=>s+v,0)>0&&c.antre.reduce((s,v)=>s+v,0)>0);
  assert.ok(rec.partial().n>=1);
});

test('four models from the history, applied to the running city without a restart',async()=>{
  const engine=new TrafficEngine(map,options),chunks=[];
  const rec=recorder(engine,{origin:firstMorning(),versions:()=>MODELS.map(()=>0),onChunk:c=>chunks.push(c)});
  while(engine.time<3*3600){rec.tick();engine.step(0.25);}
  const reg={settingLog:{hijau:{0:{scale:1}},tahan:{0:{horizon:0}}},params:{}};
  const {records,params,summary}=await train([...chunks,rec.partial()].filter(Boolean),{reg,engine});
  assert.equal(records,3*3600/STEP);
  for(const m of ['arus','tempuh','hijau'])assert.ok(params[m],m);
  assert.equal(params.isi,undefined);assert.equal(params.truk,undefined);
  assert.ok(summary.arus.length>0&&summary.arus.every(a=>a.next>=0));
  for(const l of params.tempuh.links)assert.ok(l.travel>=10&&l.share>0&&l.share<=1);
  const setting=chooseSetting(params,rec.time);
  assert.ok(setting.scale>=0.8&&setting.scale<=1.4);
  const learned=compose(params,setting);
  const sig=[...engine.signals.entries()].find(([id])=>!engine.clusterOf.get(id))[1],before=sig.plan.phases.map(p=>p.green);
  engine.setLearned({...learned,greenScale:1.4});
  assert.ok(sig.plan.phases.some((p,i)=>p.green!==before[i]));
  engine.setLearned(null);assert.deepEqual(sig.plan.phases.map(p=>p.green),before.map((_,i)=>sig.base[i]));
  for(let k=0;k<400;k++)engine.step(0.25);   // keeps running
});
