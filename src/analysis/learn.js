import {TIMING} from '../map/signals.js';

// Learning from the smart city's own sensors: the counts each queue camera reports and the
// fill each bin sensor reports, nothing else (no vehicle is followed). One learning round:
//   collect   run the smart city and sample the sensors (every 5 s; bins every minute)
//   train     four models from those samples (and the previous round's, so it keeps learning)
//   apply     the engine takes the model as `learned` (green times, links, bin calls)
//   evaluate  the same day with and without the model
// In the field the same steps run on the data center's history (scheduled by Airflow).

export const STEP=5;                 // seconds between samples
const BUCKET=15*60;                  // time-of-day bucket for the flow forecast
const CLOCK0=6*3600;                 // the simulation starts at 06:00
const SATURATION=1800;               // vehicles per hour per lane while green
const DECAY=0.7;                     // weight kept by the previous rounds' history

const legsOf=sig=>sig.j.legs.filter(l=>!l.ring);
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;

// The history of a running engine: call tick() after each step; data() is what was sampled
// since the recorder started (or was last cleared). The controllers' log counts from the
// engine's start, so clear() keeps a baseline to subtract.
export function recorder(engine){
  const cams=engine.sensors.map(s=>({id:s.id,node:s.node,legs:[...s.legs]}));
  let data,next,minute,called,base;
  const logs=()=>new Map([...engine.signals].map(([node,sig])=>[node,(sig.log||[]).map(x=>({...x}))]));
  function clear(){
    data={step:STEP,t0:engine.time,cams,count:cams.map(()=>[]),inZone:cams.map(()=>[]),bins:engine.bins.map(b=>({id:b.id})),fill:engine.bins.map(()=>[]),leads:[]};
    next=engine.time;minute=engine.time;called=new Map();base=logs();
  }
  function tick(){
    if(engine.time<next)return;
    next+=STEP;
    engine.sensors.forEach((s,i)=>{data.count[i].push(s.count);data.inZone[i].push(engine.sensorState(s.id)?.inZone??0);});
    for(const b of engine.bins){
      if(b.truck==='called'&&!called.has(b.id))called.set(b.id,engine.time);
      if(typeof b.truck==='number'&&called.has(b.id)){data.leads.push(engine.time-called.get(b.id));called.delete(b.id);}
    }
    if(engine.time>=minute){minute+=60;engine.bins.forEach((b,i)=>data.fill[i].push(b.fill));}
  }
  clear();
  return {
    tick,clear,
    get seconds(){return (data.count[0]?.length||0)*STEP;},
    // A copy (it goes to the worker), with the controllers' log over the recorded time: per
    // phase, greens given and greens that ran out.
    data(){
      const now=logs();
      return {...data,count:data.count.map(a=>a.slice()),inZone:data.inZone.map(a=>a.slice()),fill:data.fill.map(a=>a.slice()),leads:data.leads.slice(),
        signals:[...engine.signals].map(([node,sig])=>({node,plan:sig.plan.phases.map(p=>p.green),log:now.get(node).map((x,i)=>{const b=base.get(node)?.[i]||{greens:0,maxouts:0,seconds:0};return {greens:x.greens-b.greens,maxouts:x.maxouts-b.maxouts,seconds:x.seconds-b.seconds};})}))};
    },
  };
}

// Runs the engine for `seconds` and returns what a recorder saw. onProgress(fraction) now and then.
export function collect(engine,{seconds,onProgress=()=>{}}){
  const rec=recorder(engine),end=engine.time+seconds;let k=0;
  while(engine.time<end){rec.tick();engine.step(0.25);if(++k%240===0)onProgress(rec.seconds/seconds);}
  onProgress(1);
  return rec.data();
}

// Per camera and sample: vehicles that entered its zone, and that crossed its stop line.
function series(data){
  return data.cams.map((_,i)=>{
    const c=data.count[i],z=data.inZone[i],arrivals=[],departures=[];
    for(let k=1;k<c.length;k++){const d=c[k]-c[k-1];departures.push(d);arrivals.push(Math.max(0,z[k]-z[k-1]+d));}
    return {arrivals,departures};
  });
}
const bucketOf=(data,k)=>Math.floor(((CLOCK0+data.t0+(k+1)*data.step)%86400)/BUCKET);

// 1 · Flow per approach and time of day (vehicles per hour), merged with earlier rounds.
function flowModel(data,flows,previous,upTo=Infinity){
  const model={};
  data.cams.forEach((cam,i)=>{
    const sums={};
    flows[i].arrivals.forEach((a,k)=>{if(k>=upTo)return;const b=bucketOf(data,k);(sums[b]||(sums[b]={n:0,v:0})).n++;sums[b].v+=a;});
    const old=previous?.[cam.id]||{},merged={};
    for(const b of new Set([...Object.keys(old),...Object.keys(sums)])){
      const o=old[b]||{n:0,perHour:0},s=sums[b]||{n:0,v:0},n=o.n*DECAY+s.n;
      merged[b]={n,perHour:n?(o.perHour*o.n*DECAY+s.v*3600/data.step)/n:0};
    }
    model[cam.id]=merged;
  });
  return model;
}
const perHour=(model,id,bucket)=>{const m=model[id]||{};if(m[bucket])return m[bucket].perHour;const all=Object.values(m);return all.length?all.reduce((s,x)=>s+x.perHour*x.n,0)/Math.max(1e-9,all.reduce((s,x)=>s+x.n,0)):0;};

// Forecast check on the last quarter of the data, against "the next 5 minutes are like the last 5".
function forecastError(data,flows,previous){
  const n=flows[0]?.arrivals.length||0,split=Math.floor(n*0.75),win=Math.round(300/data.step);
  const model=flowModel(data,flows,previous,split);let model5=0,naive5=0,count=0;
  data.cams.forEach((cam,i)=>{
    const a=flows[i].arrivals;
    for(let k=split;k+win<=n;k+=win){
      const actual=a.slice(k,k+win).reduce((s,x)=>s+x,0),last=a.slice(k-win,k).reduce((s,x)=>s+x,0);
      model5+=Math.abs(perHour(model,cam.id,bucketOf(data,k))*300/3600-actual);naive5+=Math.abs(last-actual);count++;
    }
  });
  return {model:count?model5/count:0,naive:count?naive5/count:0,windows:count};
}

// 2 · Green per phase from the controllers' log: a phase whose green often runs out while
// vehicles still wait gets more room (+20%), one that rarely needs its plan gives some back
// (-10%). Small steps, so the setting settles over the rounds.
function greenTimes(engine,data){
  const greens={},changes=[];
  for(const s of data.signals){
    if(engine.clusterOf?.get(s.node)||!s.log.length)continue;   // a simpang gabungan keeps its common cycle
    const next=s.plan.map((g,i)=>{
      const l=s.log[i];if(!l||l.greens<3)return g;
      const out=l.maxouts/l.greens,used=l.seconds/l.greens/(2*g);
      return out>0.5?g*1.2:out<0.1&&used<0.5?g*0.9:g;
    }).map(g=>Math.round(Math.min(45,Math.max(10,g))));
    if(next.some((g,i)=>g!==Math.round(s.plan[i]))){greens[s.node]=next;changes.push({node:s.node,before:s.plan.map(Math.round),after:next,maxouts:s.log.map(l=>l.greens?Math.round(l.maxouts/l.greens*100):0)});}
  }
  // Keep earlier rounds' settings for junctions that did not change this time.
  return {greens,changes};
}

// 3 · Coordination: for each signal approach fed straight from another signal, the delay at
// which vehicles leaving the upstream junction show up at this camera, and what share of them.
function links(engine,data,flows){
  const out=[],idx=new Map(data.cams.map((c,i)=>[c.id,i])),roads=engine.map.roads,nodes=new Map(engine.map.nodes.map(n=>[n.id,n]));
  const degree=new Map();for(const r of roads)for(const id of [r.from,r.to])degree.set(id,(degree.get(id)||0)+1);
  const upstream=(node,road)=>{   // follow the road through bends (2-way nodes) to the next node
    let at=node,r=roads.find(x=>x.id===road),guard=0;
    while(r&&guard++<20){const other=r.from===at?r.to:r.from;if(degree.get(other)!==2||engine.signals.has(other))return {node:other,road:r.id};at=other;r=roads.find(x=>x.id!==r.id&&(x.from===at||x.to===at));}
    return null;
  };
  for(const cam of engine.sensors){
    const sig=engine.signals.get(cam.node),legs=legsOf(sig);
    for(const leg of cam.legs){
      const up=upstream(cam.node,legs[leg].road);if(!up||!engine.signals.has(up.node)||up.node===cam.node)continue;
      const exclude=legsOf(engine.signals.get(up.node)).findIndex(l=>l.road===up.road);
      const ups=engine.sensors.filter(s=>s.node===up.node&&!s.legs.has(exclude)).map(s=>flows[idx.get(s.id)].departures);
      if(!ups.length)continue;
      const dep=ups[0].map((_,k)=>ups.reduce((s,d)=>s+d[k],0)),arr=flows[idx.get(cam.id)].arrivals;
      const md=mean(dep),ma=mean(arr);let best=null;
      for(let lag=1;lag<=Math.round(120/data.step);lag++){
        let sxy=0,sxx=0,syy=0;
        for(let k=lag;k<arr.length;k++){const x=dep[k-lag]-md,y=arr[k]-ma;sxy+=x*y;sxx+=x*x;syy+=y*y;}
        const r=sxy/Math.sqrt(sxx*syy||1);if(!best||r>best.r)best={r,lag};
      }
      // A platoon that reaches the camera's zone within 10 s is seen by the camera itself.
      if(!best||best.r<0.15||best.lag*data.step<10)continue;
      const share=Math.min(1,Math.max(0.05,arr.reduce((s,x)=>s+x,0)/Math.max(1,dep.reduce((s,x)=>s+x,0))));
      out.push({node:cam.node,leg,from:up.node,exclude,travel:best.lag*data.step,share:Math.round(share*100)/100,fit:Math.round(best.r*100)/100,distance:Math.round(Math.hypot(nodes.get(cam.node).x-nodes.get(up.node).x,nodes.get(cam.node).z-nodes.get(up.node).z))});
    }
  }
  return out;
}

// 4 · Bin fill rate (per second, between emptyings) and how long a called truck takes to arrive.
function bins(data,previous){
  const lead=data.leads.length?mean(data.leads):previous?.lead??300,out={};
  data.bins.forEach((b,i)=>{
    const steps=[];const f=data.fill[i];
    for(let k=1;k<f.length;k++){const d=f[k]-f[k-1];if(d>0)steps.push(d/60);}
    const old=previous?.bins?.[b.id];
    const rate=steps.length?(old?(old.rate*DECAY+mean(steps))/(1+DECAY):mean(steps)):old?.rate??0;
    out[b.id]={rate,lead,fill:f.at(-1)??0};
  });
  return {bins:out,lead};
}

// A model from one round's data, the previous model (its history; null at first) and the
// model in use (`applied`, whose settings the next ones build on).
export function train(engine,data,previous=null,applied=null){
  const flows=series(data),n=flows[0]?.arrivals.length||0;
  const flowsModel=flowModel(data,flows,previous?.flows);
  const nextBucket=bucketOf(data,n);
  const {greens:changed,changes}=greenTimes(engine,data);
  const greens={...(applied?.greens||{}),...changed};
  const linkList=links(engine,data,flows);
  const waste=bins(data,previous?.waste);
  const forecast=data.cams.map((c,i)=>({id:c.id,node:c.node,perHour:Math.round(perHour(flowsModel,c.id,nextBucket)),observed:Math.round(mean(flows[i].arrivals)*3600/data.step)}));
  return {
    round:(previous?.round||0)+1,samples:(previous?.samples||0)+n,minutes:(previous?.minutes||0)+Math.round(n*data.step/60),
    flows:flowsModel,forecast,error:forecastError(data,flows,previous?.flows),
    greens,greenChanges:changes,links:linkList,waste,
    // What the engine takes (option `learned`).
    learned:{greens,links:linkList,bins:Object.fromEntries(Object.entries(waste.bins).map(([id,b])=>[id,{rate:b.rate,lead:waste.lead}]))},
  };
}

// The same day with the rules alone and with the model, for the before/after comparison.
// A model over test days (seeds), averaged: one day alone is too noisy to decide on.
export function evaluate(makeEngine,learned,{seconds,seeds,onProgress=()=>{}}){
  const keys=['queueSeconds','backlogSeconds','completed','averageTravel','binFullSeconds','truckTrips'],sum=Object.fromEntries(keys.map(k=>[k,0]));
  seeds.forEach((seed,d)=>{
    const e=makeEngine(learned,seed);let k=0;
    while(e.time<seconds){e.step(0.25);if(++k%2400===0)onProgress((d+e.time/seconds)/seeds.length);}
    const s=e.summary();for(const k of keys)sum[k]+=s[k]/seeds.length;
  });
  onProgress(1);
  return sum;
}
