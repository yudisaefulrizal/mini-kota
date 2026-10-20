import {labels,context} from './calendar.js';
import {gbtFit,gbtPredict,ridgeFit,ridgePredict,gpFit,gpPredict,lcb} from './ml.js';

// The smart city learns from its own history (see tujuan-analisis.md). While it runs, a record
// is taken every 5 s; each record holds one row per id (long format):
//   arah           per camera: junction, camera, vehicles over the stop line, vehicles in zone
//   simpang        per junction: phase on, its green so far, phase whose green ran out (-1)
//   tempat sampah  per bin: fill, truck called, truck arrived, seconds full
//   kota           queue seconds (in the streets + waiting to get in), truck trips
// and each row carries the time, its labels (hour, Masehi, Hijriah) and the version of every
// model in use. Records are kept in chunks (columns per table) for storage (src/analysis/store.js).
// Only counts: no vehicle is followed.
//
// Six models, trained on the history and applied straight away (no test):
//   arus    flow per approach, next 15 min        Gradient Boosted Trees
//   isi     bin fill rate                         linear regression
//   tempuh  travel time between junctions         cross-correlation
//   hijau   green per phase                       Bayesian optimization (with tahan)
//   tahan   holding the green for a platoon       Bayesian optimization (with hijau)
//   truk    when to call a truck                  Bayesian optimization

export const STEP=5;               // seconds between records
export const CHUNK=120;            // records per stored chunk (10 minutes: at most this is lost on leaving)
export const MODELS=['arus','isi','tempuh','hijau','tahan','truk'];
const BUCKET=900;                  // flow forecast: 15 minutes
const LAMPU_SEGMENT=180;           // records per (setting -> queue) observation: 15 minutes
const TRUK_SEGMENT=720;            // records per (setting -> bins full, trips) observation: 1 hour
const MAX_CORR=34560;              // travel times from the last 2 days at most
const MAX_POINTS=200;              // Bayesian optimization: the latest observations
// The settings Bayesian optimization chooses from.
export const GRID={scale:[0.8,0.9,1,1.1,1.2,1.3,1.4],horizon:[0,4,8,12],tau:[0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1]};
const norm={scale:s=>(s-0.8)/0.6,horizon:h=>h/12,tau:t=>(t-0.6)/0.4};
export const BASE_SETTING={scale:1,horizon:0,tau:null};   // aturan dasar

const legsOf=sig=>sig.j.legs.filter(l=>!l.ring);
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;

// ---------------------------------------------------------------- recording
// origin: the time (s since 1970) of engine time 0; versions(): the versions in use (MODELS
// order); onChunk(chunk) for each full chunk.
export function recorder(engine,{origin,versions,onChunk=()=>{}}){
  const cams=engine.sensors.map(s=>s.id),camNode=engine.sensors.map(s=>s.node);
  const nodes=[...engine.signals.keys()],sigs=nodes.map(id=>engine.signals.get(id)),bins=engine.bins.map(b=>b.id);
  const C=cams.length,S=nodes.length,B=bins.length;
  let next=engine.time,buf,k;
  const prev={count:engine.sensors.map(s=>s.count),maxouts:sigs.map(sig=>(sig.log||[]).map(l=>l.maxouts)),truck:engine.bins.map(b=>b.truck),emptied:engine.bins.map(b=>b.emptied),full:engine.bins.map(b=>b.fullSeconds),queue:engine.stats.queueSeconds+engine.stats.backlogSeconds,trips:engine.stats.truckTrips};
  const fresh=()=>{k=0;buf={n:0,cams,camNode,nodes,bins,t:new Float64Array(CHUNK),lab:new Int16Array(CHUNK*7),ver:new Int32Array(CHUNK*MODELS.length),
    lewat:new Uint16Array(CHUNK*C),zona:new Uint16Array(CHUNK*C),fase:new Int8Array(CHUNK*S),hijau:new Uint8Array(CHUNK*S),habis:new Int8Array(CHUNK*S),
    isi:new Float32Array(CHUNK*B),panggil:new Uint8Array(CHUNK*B),tiba:new Uint8Array(CHUNK*B),penuh:new Float32Array(CHUNK*B),antre:new Float32Array(CHUNK),trips:new Uint16Array(CHUNK)};};
  fresh();
  function tick(){
    if(engine.time<next)return false;
    next+=STEP;
    const t=origin+Math.round(engine.time);buf.t[k]=t;buf.lab.set(labels(t),k*7);buf.ver.set(versions(),k*MODELS.length);
    engine.sensors.forEach((s,i)=>{buf.lewat[k*C+i]=s.count-prev.count[i];prev.count[i]=s.count;buf.zona[k*C+i]=engine.sensorState(s.id)?.inZone??0;});
    sigs.forEach((sig,i)=>{
      buf.fase[k*S+i]=sig.phase;buf.hijau[k*S+i]=sig.stage==='green'?Math.min(255,Math.round(sig.t)):0;
      const m=(sig.log||[]).map(l=>l.maxouts),p=m.findIndex((v,j)=>v>(prev.maxouts[i][j]||0));
      buf.habis[k*S+i]=p;prev.maxouts[i]=m;
    });
    engine.bins.forEach((b,i)=>{
      buf.isi[k*B+i]=b.fill;
      buf.panggil[k*B+i]=b.truck==='called'&&prev.truck[i]!=='called'?1:0;prev.truck[i]=b.truck;
      buf.tiba[k*B+i]=b.emptied>prev.emptied[i]?1:0;prev.emptied[i]=b.emptied;
      buf.penuh[k*B+i]=b.fullSeconds-prev.full[i];prev.full[i]=b.fullSeconds;
    });
    const q=engine.stats.queueSeconds+engine.stats.backlogSeconds;buf.antre[k]=q-prev.queue;prev.queue=q;
    buf.trips[k]=engine.stats.truckTrips-prev.trips;prev.trips=engine.stats.truckTrips;
    buf.n=++k;
    if(k===CHUNK){const full=buf;fresh();onChunk(full);}
    return true;
  }
  return {
    tick,
    get n(){return k;},
    get time(){return origin+Math.round(engine.time);},
    // The records not yet in a full chunk (a copy, trimmed).
    partial(){return k?trim(buf,k):null;},
    // Hands over the partial chunk (on leaving or restarting) and starts a new one.
    flush(){const p=k?trim(buf,k):null;fresh();return p;},
  };
}
function trim(c,n){
  const out={...c,n};
  for(const [f,v] of Object.entries(c))if(ArrayBuffer.isView(v))out[f]=v.slice(0,n*(v.length/CHUNK));
  return out;
}

// ---------------------------------------------------------------- training
// chunks: the history in time order (array or async iterable). reg: the registry (settings
// per version, previous params). engine: an engine on the same map (for the road layout).
export async function train(chunks,{reg,engine,onProgress=()=>{}}){
  const acc=accumulators(engine);let n=0;
  for await(const c of chunks){feed(acc,c,reg);n+=c.n;onProgress(n);}
  if(!n)return {records:0,params:{},summary:{}};
  const params={},summary={};
  // arus: per camera, 15-minute arrivals from labels and the two previous quarters.
  const arus={cams:{}};
  for(const [id,b] of acc.buckets){
    const keys=[...b.keys()].sort((x,y)=>x-y),X=[],y=[];
    for(const q of keys){const l1=b.get(q-1),l2=b.get(q-2);if(l1==null||l2==null)continue;X.push(features(q*BUCKET,l1,l2));y.push(b.get(q));}
    if(y.length>=8)arus.cams[id]=gbtFit(X,y);
  }
  if(Object.keys(arus.cams).length){
    params.arus=arus;
    const q=Math.floor(acc.lastT/BUCKET);
    summary.arus=Object.entries(arus.cams).map(([id,m])=>{const b=acc.buckets.get(id),l1=b.get(q-1)??0,l2=b.get(q-2)??0;return {id,node:acc.camNode.get(id),next:Math.max(0,gbtPredict(m,features(q*BUCKET,l1,l2))),last:l1};});
  }
  // isi: per bin, fill rate (per second) from labels; and how long a called truck takes.
  const isi={bins:{},lead:acc.leads.length?mean(acc.leads):reg.params?.isi?.lead??300};
  for(const [id,s] of acc.rates)if(s.y.length>=3)isi.bins[id]=ridgeFit(s.X,s.y);
  if(Object.keys(isi.bins).length){params.isi=isi;summary.isi={fill:Object.fromEntries(acc.lastFill)};}
  // tempuh: cross-correlation of departures upstream with arrivals downstream.
  if(acc.corr.n>=720)params.tempuh={links:links(engine,acc.corr)};   // at least an hour
  // hijau: per phase, the share of greens that ran out sets its part of the plan.
  const split={},changes=[];
  for(const [node,ph] of acc.phases){
    if(engine.clusterOf?.get(node))continue;
    const shares=[...ph].map(p=>p&&p.greens>=3?p.maxouts/p.greens:null);if(shares.every(v=>v==null))continue;
    const avg=mean(shares.filter(v=>v!=null));
    split[node]=shares.map(v=>v==null?1:Math.round(Math.max(0.7,Math.min(1.5,1+(v-avg)))*100)/100);
    changes.push({node,maxouts:shares.map(v=>v==null?null:Math.round(v*100)),split:split[node]});
  }
  // hijau + tahan: the queue each setting gave (seconds per vehicle) in each context.
  const lampu=acc.lampu.filter(s=>s.n>=LAMPU_SEGMENT/2&&s.passed>0).slice(-MAX_POINTS);
  if(Object.keys(split).length&&lampu.length){
    const X=lampu.map(s=>[norm.scale(s.x.scale),norm.horizon(s.x.horizon),...s.ctx]),y=lampu.map(s=>s.queue/s.passed);
    params.hijau={split,gp:gpFit(X,y),points:lampu.length};
    summary.hijau={changes};
  }
  // truk: bins full and trips (per hour) each target fill gave; trips of the rules alone.
  const truk=acc.truk.filter(s=>s.n>=TRUK_SEGMENT/2),tried=truk.filter(s=>s.x!=null).slice(-MAX_POINTS),base=truk.filter(s=>s.x==null);
  if(truk.length){
    const X=tried.map(s=>[norm.tau(s.x),...s.ctx]),perHour=s=>3600/(s.n*STEP);
    params.truk={full:gpFit(X,tried.map(s=>s.full*perHour(s))),trips:gpFit(X,tried.map(s=>s.trips*perHour(s))),
      baseTrips:base.length?mean(base.map(s=>s.trips*perHour(s))):reg.params?.truk?.baseTrips??null,points:tried.length};
  }
  return {records:n,params,summary};
}
function features(t,l1,l2){const l=labels(t);return [...context(t),l[1],l[4],l1,l2];}

function accumulators(engine){
  return {buckets:new Map(),camNode:new Map(),rates:new Map(),leads:[],called:new Map(),lastFill:new Map(),phases:new Map(),lampu:[],truk:[],lastT:0,
    corr:{n:0,cams:engine.sensors.map(s=>s.id),dep:engine.sensors.map(()=>[]),arr:engine.sensors.map(()=>[])},prevZona:new Map(),prevT:null,prevFase:new Map(),prevIsi:new Map(),hour:new Map()};
}
const vOf=(c,k,m)=>c.ver[k*MODELS.length+MODELS.indexOf(m)];
function feed(acc,c,reg){
  const C=c.cams.length,S=c.nodes.length,B=c.bins.length,log=reg.settingLog||{};
  const camIndex=new Map(acc.corr.cams.map((id,i)=>[id,i]));
  c.cams.forEach((id,i)=>{acc.camNode.set(id,c.camNode[i]);if(!acc.buckets.has(id))acc.buckets.set(id,new Map());});
  for(let k=0;k<c.n;k++){
    const t=c.t[k],gap=acc.prevT==null||t-acc.prevT>STEP*1.5;acc.prevT=t;acc.lastT=t;
    const q=Math.floor(t/BUCKET),ctx=context(t);
    // arah: arrivals = in the zone now - before + over the stop line.
    let passed=0;
    for(let i=0;i<C;i++){
      const id=c.cams[i],l=c.lewat[k*C+i],z=c.zona[k*C+i],pz=gap?null:acc.prevZona.get(id);acc.prevZona.set(id,z);
      const a=pz==null?l:Math.max(0,z-pz+l);passed+=l;
      const b=acc.buckets.get(id);b.set(q,(b.get(q)||0)+a);
      const j=camIndex.get(id);if(j!=null){acc.corr.dep[j].push(l);acc.corr.arr[j].push(a);}
    }
    acc.corr.n++;
    if(acc.corr.n>MAX_CORR*1.25){const cut=acc.corr.n-MAX_CORR;for(const a of acc.corr.dep)a.splice(0,cut);for(const a of acc.corr.arr)a.splice(0,cut);acc.corr.n=MAX_CORR;}
    // simpang: greens given (a new phase came on) and greens that ran out, per phase.
    for(let i=0;i<S;i++){
      const node=c.nodes[i],f=c.fase[k*S+i],h=c.habis[k*S+i];
      const ph=acc.phases.get(node)||acc.phases.set(node,[]).get(node);
      const at=p=>ph[p]||(ph[p]={greens:0,maxouts:0});
      if(acc.prevFase.get(node)!==f)at(f).greens++;acc.prevFase.set(node,f);
      if(h>=0)at(h).maxouts++;
    }
    // tempat sampah: fill rate per hour of filling, truck lead times.
    for(let i=0;i<B;i++){
      const id=c.bins[i],v=c.isi[k*B+i],pv=gap?null:acc.prevIsi.get(id);acc.prevIsi.set(id,v);acc.lastFill.set(id,v);
      if(c.panggil[k*B+i])acc.called.set(id,t);
      if(c.tiba[k*B+i]&&acc.called.has(id)){acc.leads.push(t-acc.called.get(id));acc.called.delete(id);}
      if(pv!=null&&v>pv&&!c.tiba[k*B+i]){
        const hk=`${id}:${Math.floor(t/3600)}`;let h=acc.hour.get(hk);
        if(!h){h={sum:0,n:0,ctx};acc.hour.set(hk,h);(acc.rates.get(id)||acc.rates.set(id,{X:[],y:[],open:[]}).get(id)).open.push(h);}
        h.sum+=(v-pv)/STEP;h.n++;
      }
    }
    // kota: one observation per setting and quarter (lampu) or hour (truk).
    const hv=vOf(c,k,'hijau'),tv=vOf(c,k,'tahan'),kv=vOf(c,k,'truk');
    let seg=acc.lampu.at(-1);
    if(!seg||gap||seg.n>=LAMPU_SEGMENT||seg.hv!==hv||seg.tv!==tv){
      seg={hv,tv,n:0,queue:0,passed:0,ctx,x:{scale:log.hijau?.[hv]?.scale??1,horizon:log.tahan?.[tv]?.horizon??0}};acc.lampu.push(seg);
    }
    seg.n++;seg.queue+=c.antre[k];seg.passed+=passed;
    let ts=acc.truk.at(-1);
    if(!ts||gap||ts.n>=TRUK_SEGMENT||ts.kv!==kv){ts={kv,n:0,full:0,trips:0,ctx,x:log.truk?.[kv]?.tau??null};acc.truk.push(ts);}
    ts.n++;ts.trips+=c.trips[k];for(let i=0;i<B;i++)ts.full+=c.penuh[k*B+i];
  }
  // Hourly fill rates become regression samples.
  for(const r of acc.rates.values()){for(const h of r.open){r.X.push(h.ctx);r.y.push(h.sum/h.n);}r.open=[];}
  acc.hour.clear();
}

// tempuh: for each signal approach fed straight from another signal, the delay at which
// vehicles leaving the upstream junction show up at this camera, and what share of them.
function links(engine,corr){
  const out=[],idx=new Map(corr.cams.map((c,i)=>[c,i])),roads=engine.map.roads,nodes=new Map(engine.map.nodes.map(n=>[n.id,n]));
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
      const ups=engine.sensors.filter(s=>s.node===up.node&&!s.legs.has(exclude)).map(s=>corr.dep[idx.get(s.id)]);
      if(!ups.length)continue;
      const dep=ups[0].map((_,k)=>ups.reduce((s,d)=>s+d[k],0)),arr=corr.arr[idx.get(cam.id)];
      const md=mean(dep),ma=mean(arr);let best=null;
      for(let lag=1;lag<=Math.round(120/STEP);lag++){
        let sxy=0,sxx=0,syy=0;
        for(let k=lag;k<arr.length;k++){const x=dep[k-lag]-md,y=arr[k]-ma;sxy+=x*y;sxx+=x*x;syy+=y*y;}
        const r=sxy/Math.sqrt(sxx*syy||1);if(!best||r>best.r)best={r,lag};
      }
      // A platoon that reaches the camera's zone within 10 s is seen by the camera itself.
      if(!best||best.r<0.15||best.lag*STEP<10)continue;
      const share=Math.min(1,Math.max(0.05,arr.reduce((s,x)=>s+x,0)/Math.max(1,dep.reduce((s,x)=>s+x,0))));
      out.push({node:cam.node,leg,from:up.node,exclude,travel:best.lag*STEP,share:Math.round(share*100)/100,fit:Math.round(best.r*100)/100,distance:Math.round(Math.hypot(nodes.get(cam.node).x-nodes.get(up.node).x,nodes.get(cam.node).z-nodes.get(up.node).z))});
    }
  }
  return out;
}

// ---------------------------------------------------------------- applying
// Bayesian optimization: the setting with the lowest lower confidence bound in this context.
export function chooseSetting(params,t){
  const ctx=context(t),out={...BASE_SETTING};
  const gp=params.hijau?.gp;
  if(gp){
    let best=null;
    for(const scale of GRID.scale)for(const horizon of (params.tempuh?.links?.length?GRID.horizon:[0])){
      const v=lcb(gpPredict(gp,[norm.scale(scale),norm.horizon(horizon),...ctx]));
      if(!best||v<best.v-1e-9)best={v,scale,horizon};
    }
    out.scale=best.scale;out.horizon=best.horizon;
  }
  const truk=params.truk;
  if(truk&&params.isi){
    if(!truk.points)out.tau=0.8;   // nothing tried yet: start where the rules call
    else{
      let best=null;
      for(const tau of GRID.tau){
        const x=[norm.tau(tau),...ctx],full=gpPredict(truk.full,x),trips=gpPredict(truk.trips,x);
        // Fewer bins full, without more trips than the rules alone make.
        const ok=truk.baseTrips==null||trips.mean-trips.sd<=truk.baseTrips;
        const v=(ok?0:1e6)+lcb(full)+1e-3*trips.mean;
        if(!best||v<best.v)best={v,tau};
      }
      out.tau=best.tau;
    }
  }
  return out;
}
// What the engine takes (TrafficEngine option `learned` / setLearned) from the params and the
// chosen setting; null: the rules alone.
export function compose(params,setting,t){
  const l={};
  if(params.hijau){l.greenSplit=params.hijau.split;l.greenScale=setting.scale;}
  if(params.tempuh&&setting.horizon>0){l.links=params.tempuh.links;l.horizon=setting.horizon;}
  if(params.isi&&setting.tau!=null){
    const ctx=context(t);
    l.bins=Object.fromEntries(Object.entries(params.isi.bins).map(([id,m])=>[id,{rate:Math.max(0,ridgePredict(m,ctx)),lead:params.isi.lead}]));
    l.binTarget=setting.tau;
  }
  return Object.keys(l).length?l:null;
}
