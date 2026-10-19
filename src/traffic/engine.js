import {validateMap} from '../map/format.js';
import {buildGeometry,polylineLength} from '../map/geometry.js';
import {buildPlan,TIMING} from '../map/signals.js';
import {buildLaneGraph,routesFrom,along} from './lanes.js';
import {Pedestrians} from './pedestrians.js';

// Traffic model for any map file: vehicles follow lanes with the Intelligent Driver Model,
// change lanes for their route, obey the junction phase plans (fixed or adaptive) and give
// way at unsignalised junctions. The devices placed on the map take part:
//   cctv / cctv-dome  count vehicles; adaptive lights only adapt where a camera sees
//   bin-sensor        reports its fill level; a garbage truck is sent when it is nearly full
//   bus-stop          minibuses (angkot) stop there
// Pedestrians walk the pavements and cross at the zebra crossings. Deterministic for a
// given seed; no rendering here.

const IDM={a:1.5,b:2.0,T:1.2,s0:2.0};
export const VEHICLE_TYPES={
  car:{length:4.5,a:1.5,speed:1,asset:'car'},
  minibus:{length:5.6,a:1.2,speed:0.9,asset:'minibus'},
  truck:{length:7.4,a:0.9,speed:0.8,asset:'garbage-truck'},
};
const STOPPED=0.3,LOOKAHEAD=90,COMMIT=8;
// Cars wait behind the stop line, which the editor draws 4.5 m before the junction mouth
// (the zebra crossing lies in between).
const STOP_BACK=5.5;
const BIN_CALL=0.8,BIN_DWELL=30,BUS_DWELL=8,TRUCKS=2;

function rng(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
// Nearest point of a segment's polyline to p, as arc length s.
function projectOnSeg(seg,p){
  let best={s:0,distance:Infinity};
  for(let i=1;i<seg.points.length;i++){
    const a=seg.points[i-1],b=seg.points[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz||1;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l2)),q={x:a.x+dx*t,z:a.z+dz*t},d=dist(q,p);
    if(d<best.distance)best={s:seg.cum[i-1]+t*Math.sqrt(l2),distance:d};
  }
  return best;
}

export class TrafficEngine{
  // `offsets`: seconds each member of a simpang gabungan starts after the first one (else
  // signalPlan.offset, else 0). `prepared` lets runs on one map share its geometry and graph.
  constructor(map,{seed=42,demand=900,adaptive=false,minibus=0.12,pedestrians=0,offsets=null,prepared=null}={}){
    this.map=prepared?.map||validateMap(structuredClone(map));
    this.geometry=prepared?.geometry||buildGeometry(this.map);
    this.graph=prepared?.graph||buildLaneGraph(this.map,this.geometry);
    this.seed=seed;this.random=rng(seed);this.demand=demand;this.adaptive=adaptive;this.minibusShare=minibus;
    this.time=0;this.vehicles=[];this.nextId=1;this.backlog=[];this.nextArrival=0;
    this.stats={completed:0,travelSeconds:0,queueSeconds:0,spawned:0,redViolations:0,busStops:0};
    this.routes=prepared?.routes||new Map();
    // Each source keeps the destinations it can actually reach (no U-turns at dead ends).
    this.targets=new Map();
    for(const src of this.graph.sources){
      const to=this.routeFrom(src);
      this.targets.set(src,this.graph.sinks.filter(t=>to(t)&&this.graph.byId.get(t).end!==this.graph.byId.get(src).start));
    }
    this.origins=this.graph.sources.filter(s=>this.targets.get(s).length);
    this.signals=new Map();
    for(const j of this.geometry.junctions){
      const node=this.map.nodes.find(n=>n.id===j.id);
      if(node?.signal!==true||j.legs.some(l=>l.ring))continue;
      const plan=buildPlan(j,node.signalPlan||{});
      this.signals.set(j.id,{plan,j,phase:0,stage:'green',t:0,sensed:new Set()});
    }
    // Simpang gabungan (see geometry.CLUSTER_LINK): signalised junctions joined by a link
    // too short to queue in work as one. Traffic that got green at the first one is not
    // stopped again at the next (it gives way to crossing traffic and people there).
    this.internal=new Set();
    for(const [id,sig] of this.signals)sig.j.legs.filter(l=>!l.ring).forEach((leg,i)=>{if(leg.internal)this.internal.add(`${id}:${i}`);});
    this.clusters=(this.geometry.clusters||[]).filter(c=>c.nodes.every(id=>this.signals.has(id)));
    this.clusterOf=new Map(this.clusters.flatMap(c=>c.nodes.map(id=>[id,c])));
    this.offsets={};
    if(this.clusters.length)this.coordinate(offsets);
    this.onConnector=new Map(this.graph.connectors.map(c=>[c.id,new Set()]));
    this.connectorsInto=new Map();
    for(const c of this.graph.connectors)(this.connectorsInto.get(c.to)||this.connectorsInto.set(c.to,[]).get(c.to)).push(c.id);
    this.vehicleById=new Map();
    this.connectorsByLeg=new Map();
    for(const c of this.graph.connectors)for(const leg of new Set([c.legFrom,c.legTo])){const key=`${c.node}:${leg}`;(this.connectorsByLeg.get(key)||this.connectorsByLeg.set(key,[]).get(key)).push(c.id);}
    this.setupDevices();
    this.pedestrians=pedestrians>0?new Pedestrians(this,pedestrians):null;
  }
  routeFrom(seg){if(!this.routes.has(seg))this.routes.set(seg,routesFrom(this.graph,seg));return this.routes.get(seg);}

  // ------------------------------------------------------------ devices
  setupDevices(){
    const kerbLanes=this.graph.segs.filter(s=>s.kind==='lane'&&s.index===0&&!s.ring&&s.length>=14);
    // The kerb lane beside a roadside object, and how far along it the object stands.
    const kerbSpot=(o,max=14)=>{
      let best=null;
      for(const seg of kerbLanes){const hit=projectOnSeg(seg,o);if(hit.distance<max&&(!best||hit.distance<best.distance))best={seg:seg.id,s:Math.min(Math.max(hit.s,6),seg.length-6),distance:hit.distance};}
      return best;
    };
    // Cameras: a dome at a signalised junction sees every approach; a pole camera sees the
    // approach it stands beside.
    this.sensors=[];
    for(const o of this.map.objects){
      if(o.asset!=='cctv-dome'&&o.asset!=='cctv')continue;
      let best=null;
      for(const [id,sig] of this.signals){
        const legs=sig.j.legs.filter(l=>!l.ring);
        if(o.asset==='cctv-dome'){const d=dist(sig.j,o);if(d<40&&(!best||d<best.d))best={node:id,legs:legs.map((_,i)=>i),d};}
        else legs.forEach((leg,i)=>{const at={x:sig.j.x+leg.dir.x*(leg.setback+15),z:sig.j.z+leg.dir.z*(leg.setback+15)},d=dist(at,o);if(d<30&&(!best||d<best.d))best={node:id,legs:[i],d};});
      }
      if(!best)continue;
      const sensor={id:o.id,asset:o.asset,node:best.node,legs:new Set(best.legs),count:0,also:[]};
      this.sensors.push(sensor);for(const i of sensor.legs)this.signals.get(best.node).sensed.add(i);
      // A dome at a simpang gabungan watches the outer approaches of every member.
      if(o.asset==='cctv-dome')for(const id of this.clusterOf.get(best.node)?.nodes||[]){
        if(id===best.node)continue;const sig=this.signals.get(id);
        sig.j.legs.filter(l=>!l.ring).forEach((leg,i)=>{if(!leg.internal){sig.sensed.add(i);sensor.also.push({node:id,leg:i});}});
      }
    }
    this.sensorsByNode=new Map();
    for(const s of this.sensors)for(const node of new Set([s.node,...s.also.map(a=>a.node)]))(this.sensorsByNode.get(node)||this.sensorsByNode.set(node,[]).get(node)).push(s);
    // Bus stops on a kerb lane.
    this.busStops=this.map.objects.filter(o=>o.asset==='bus-stop').map(o=>({id:o.id,...kerbSpot(o)})).filter(s=>s.seg!==undefined);
    // Bins with a sensor, filling up; the depot is the waste facility (or any entry).
    this.bins=this.map.objects.filter(o=>o.asset==='bin-sensor').map(o=>{const spot=kerbSpot(o,16);
      return spot&&{id:o.id,x:o.x,z:o.z,seg:spot.seg,s:spot.s,fill:0.25+this.random()*0.55,rate:1/(1500+this.random()*1500),truck:null,emptied:0,fullSeconds:0};}).filter(Boolean);
    const depot=this.map.objects.find(o=>o.asset==='tps3r');
    const end=(id,first)=>{const pts=this.graph.byId.get(id).points;return first?pts[0]:pts.at(-1);};
    const byDepot=(list,first)=>depot?[...list].sort((a,b)=>dist(end(a,first),depot)-dist(end(b,first),depot)):list;
    this.depot={sources:byDepot(this.origins,true),sinks:byDepot(this.graph.sinks,false)};
    this.binTimer=0;
  }
  // Route through a given lane: start → via → end, with the index of via in it; or null.
  routeVia(src,via,dst){
    const a=this.routeFrom(src)(via);if(!a)return null;
    const b=this.routeFrom(via)(dst);if(!b)return null;
    return {route:[...a,...b.slice(1)],idx:a.length-1};
  }
  travelTime(route){let t=0;for(const id of route){const seg=this.graph.byId.get(id);t+=seg.length/seg.speed;}return t;}
  updateBins(dt){
    for(const b of this.bins){if(!b.truck||b.truck==='called')b.fill=Math.min(1.2,b.fill+b.rate*dt);if(b.fill>=1)b.fullSeconds+=dt;}
    this.binTimer-=dt;if(this.binTimer>0||!this.bins.length)return;
    this.binTimer=5;
    const busy=this.bins.filter(b=>b.truck&&b.truck!=='unreachable').length;
    // The fullest bins get the free trucks.
    const waiting=this.bins.filter(b=>!b.truck&&b.fill>=BIN_CALL).sort((a,b)=>b.fill-a.fill);
    for(const bin of waiting.slice(0,Math.max(0,TRUCKS-busy))){
      let trip=null;
      for(const src of this.depot.sources.slice(0,4)){
        for(const dst of this.depot.sinks.slice(0,6)){trip=this.routeVia(src,bin.seg,dst);if(trip)break;}
        if(trip){trip.src=src;break;}
      }
      if(!trip){bin.truck='unreachable';continue;}
      bin.truck='called';
      this.backlog.push({src:trip.src,route:trip.route,requested:this.time,type:'truck',stops:[{idx:trip.idx,s:bin.s,dwell:BIN_DWELL,bin:bin.id}]});
    }
  }

  // ------------------------------------------------------------ signals
  allows(c){
    // 'go' | 'yield' | 'stop' for a vehicle wanting to use connector c.
    const sig=this.signals.get(c.node);
    if(!sig)return 'yield';
    if(c.legFrom<0||c.legTo<0||this.internal.has(`${c.node}:${c.legFrom}`))return 'yield';
    if(sig.stage!=='green')return sig.stage==='yellow'?'yellow':'stop';
    const m=sig.plan.phases[sig.phase].movements.find(x=>x.from===c.legFrom&&x.to===c.legTo);
    return !m?'stop':m.mode==='protected'?'go':'yield';
  }
  // Vehicles the cameras see waiting or approaching (within 80 m) for a phase; null when
  // one of its approaches has no camera (unknown demand).
  demandFor(sig,phaseIndex){
    const legs=new Set(sig.plan.phases[phaseIndex].movements.filter(m=>m.mode!=='free'&&!this.internal.has(`${sig.j.id}:${m.from}`)).map(m=>m.from));
    for(const l of legs)if(!sig.sensed.has(l))return null;
    let n=0;for(const l of legs)n+=this.approaching.get(`${sig.j.id}:${l}`)||0;
    return n;
  }
  // Vehicles heading for each signal approach within 80 m along their route, also those
  // still waiting at a junction just before it (close pairs of signals see each other's queue).
  countApproaching(){
    const counts=new Map();
    for(const v of this.vehicles){
      let ahead=-v.s;
      for(let k=v.idx;k<v.route.length&&ahead<80;k++){
        const seg=this.graph.byId.get(v.route[k]);
        if(seg.kind==='connector'&&k>v.idx&&this.signals.has(seg.node)){const key=`${seg.node}:${seg.legFrom}`;counts.set(key,(counts.get(key)||0)+1);}
        ahead+=seg.length;
      }
    }
    this.approaching=counts;
  }
  updateSignals(dt){
    if(this.adaptive)this.countApproaching();
    for(const sig of this.signals.values())this.stepSignal(sig,dt);
  }
  stepSignal(sig,dt,fixedOnly=false){
    {
      sig.t+=dt;const phase=sig.plan.phases[sig.phase];
      // Adaptive control needs eyes: without a camera at the junction it runs the fixed plan.
      const adaptive=!fixedOnly&&this.adaptive&&sig.sensed.size>0;
      if(sig.stage==='green'){
        let end=sig.t>=phase.green;
        if(adaptive){
          // Keep the green while traffic keeps coming, up to twice the planned green (90 s at
          // most); end it after 8 s once its approaches are empty and another phase waits.
          const here=this.demandFor(sig,sig.phase);
          if(here!==null){
            const others=sig.plan.phases.some((_,i)=>{if(i===sig.phase)return false;const d=this.demandFor(sig,i);return d===null||d>0;});
            const maxGreen=Math.min(phase.green*2,TIMING.maxGreen);
            end=sig.t>=maxGreen||(sig.t>=8&&here===0&&others);
          }
        }
        if(end){sig.stage='yellow';sig.t=0;}
      }else if(sig.stage==='yellow'&&sig.t>=TIMING.yellow){sig.stage='allRed';sig.t=0;}
      else if(sig.stage==='allRed'&&sig.t>=TIMING.allRed){
        let next=(sig.phase+1)%sig.plan.phases.length;
        if(adaptive)for(let k=0;k<sig.plan.phases.length;k++){const i=(sig.phase+1+k)%sig.plan.phases.length,d=this.demandFor(sig,i);if(d===null||d>0){next=i;break;}}
        sig.phase=next;sig.stage='green';sig.t=0;
      }
    }
  }
  cycleOf(sig){return sig.plan.phases.reduce((t,p)=>t+p.green+TIMING.yellow+TIMING.allRed,0);}
  // One controller per simpang gabungan: every member runs the same cycle (the longest one;
  // the others' green times are stretched evenly), starting at an offset from the first
  // member (signalPlan.offset, default 0). Trial runs with ten traffic patterns showed the
  // offset hardly matters on Mini Kota (±3%), so it is not searched automatically.
  coordinate(given){
    for(const c of this.clusters){
      const sigs=c.nodes.map(id=>this.signals.get(id)),cycle=Math.max(...sigs.map(s=>this.cycleOf(s)));
      for(const sig of sigs){
        const extra=cycle-this.cycleOf(sig);if(extra<=0)continue;
        const each=extra/sig.plan.phases.length;for(const p of sig.plan.phases)p.green+=each;
      }
      c.cycle=cycle;
    }
    const offsets={};
    for(const c of this.clusters)for(const id of c.nodes.slice(1)){
      const set=given?.[id]??this.map.nodes.find(n=>n.id===id)?.signalPlan?.offset;
      offsets[id]=Number.isFinite(set)?((set%c.cycle)+c.cycle)%c.cycle:0;
    }
    for(const [id,offset] of Object.entries(offsets)){
      const sig=this.signals.get(id);
      for(let t=0;t<offset;t+=0.25)this.stepSignal(sig,0.25,true);
    }
    this.offsets=offsets;
  }
  // Per signal leg: 'green' | 'arrow' | 'yellow' | 'red' (for lamps and overlays).
  signalState(nodeId){
    const sig=this.signals.get(nodeId);if(!sig)return null;
    const phase=sig.plan.phases[sig.phase],legs=sig.plan.legs.map(()=>'red');
    for(const m of phase.movements)if(m.mode!=='free')legs[m.from]=sig.stage==='green'?(phase.arrow?'arrow':'green'):sig.stage==='yellow'?(phase.arrow?'red':'yellow'):'red';
    return {phase:sig.phase,stage:sig.stage,legs,remaining:Math.max(0,(sig.stage==='green'?phase.green:sig.stage==='yellow'?TIMING.yellow:TIMING.allRed)-sig.t)};
  }

  // Seconds until each approach's light changes colour, like the timers on real lights.
  // Adaptive lights cannot know their future, so they count down to the longest green they
  // may give (estimated: true), the same convention as the old city view.
  signalCountdown(nodeId){
    const sig=this.signals.get(nodeId);if(!sig)return null;
    const {plan}=sig,adaptive=this.adaptive&&sig.sensed.size>0;
    const green=i=>adaptive?Math.min(plan.phases[i].green*2,TIMING.maxGreen):plan.phases[i].green;
    const duration=(phase,stage)=>stage==='green'?green(phase):stage==='yellow'?TIMING.yellow:TIMING.allRed;
    const look=(phase,stage)=>{
      const p=plan.phases[phase],legs=plan.legs.map(()=>'red');
      for(const m of p.movements)if(m.mode!=='free')legs[m.from]=stage==='green'?(p.arrow?'arrow':'green'):stage==='yellow'?(p.arrow?'red':'yellow'):'red';
      return legs;
    };
    const now=look(sig.phase,sig.stage),found=now.map(()=>null);
    let phase=sig.phase,stage=sig.stage,elapsed=Math.max(0,duration(phase,stage)-sig.t);
    for(let k=0;k<plan.phases.length*3+3&&found.some(f=>f===null);k++){
      if(stage==='green')stage='yellow';else if(stage==='yellow')stage='allRed';else{stage='green';phase=(phase+1)%plan.phases.length;}
      const legs=look(phase,stage);
      legs.forEach((l,i)=>{if(found[i]===null&&l!==now[i])found[i]=elapsed;});
      elapsed+=duration(phase,stage);
    }
    return now.map((state,i)=>({state,seconds:Math.max(1,Math.ceil(found[i]??elapsed)),estimated:adaptive,internal:this.internal.has(`${nodeId}:${i}`)}));
  }

  // ------------------------------------------------------------ vehicles
  newTrip(){
    const src=this.origins[Math.floor(this.random()*this.origins.length)],targets=this.targets.get(src);
    const dst=targets[Math.floor(this.random()*targets.length)];
    if(this.random()<this.minibusShare){
      // An angkot calls at the bus stop that costs the smallest detour (at most a quarter
      // longer than the direct trip); otherwise it drives straight through.
      const direct=this.routeFrom(src)(dst),base=this.travelTime(direct);
      let best=null;
      for(const stop of this.busStops){
        const trip=this.routeVia(src,stop.seg,dst);if(!trip)continue;
        const time=this.travelTime(trip.route);
        if(time<=base*1.25+10&&(!best||time<best.time))best={...trip,time,stop};
      }
      return {src,route:best?best.route:direct,type:'minibus',stops:best?[{idx:best.idx,s:best.stop.s,dwell:BUS_DWELL,busStop:best.stop.id}]:[]};
    }
    return {src,route:this.routeFrom(src)(dst),type:'car',stops:[]};
  }
  spawn(dt){
    if(this.origins.length&&this.demand>0){
      this.nextArrival-=dt;
      while(this.nextArrival<=0){
        this.nextArrival+=-Math.log(Math.max(1e-9,1-this.random()))*3600/this.demand;
        this.backlog.push({...this.newTrip(),requested:this.time});
      }
    }
    // Enter when the first lane has room; otherwise wait outside the map.
    for(let i=0;i<this.backlog.length;i++){
      const b=this.backlog[i];let first=null;
      for(const v of this.vehicles)if(!v.bay&&v.route[v.idx]===b.src&&(!first||v.s<first.s))first=v;
      if(first&&first.s-first.len<IDM.s0+2)continue;
      const seg=this.graph.byId.get(b.src),type=VEHICLE_TYPES[b.type];
      const vehicle={id:this.nextId++,type:b.type,len:type.length,accel:type.a,route:b.route,idx:0,s:0,
        v:Math.min(seg.speed*type.speed,first?Math.max(0,(first.s-first.len-6)/2):seg.speed),born:this.time,waited:this.time-b.requested,
        color:Math.floor(this.random()*7),shift:0,commits:new Set(),stops:b.stops||[],dwell:0,dwelling:false};
      this.vehicles.push(vehicle);this.vehicleById.set(vehicle.id,vehicle);
      this.stats.spawned++;this.backlog.splice(i--,1);
    }
  }

  // Free road ahead of v: distance to the next vehicle, a stop it has to make, or the stop
  // line it must respect.
  gapAhead(v,byLane){
    const seg=this.graph.byId.get(v.route[v.idx]);
    let best={gap:Infinity,speed:0};
    for(const o of byLane.get(seg.id)||[])if(o!==v&&o.s>v.s){const g=o.s-o.len-v.s;if(g<best.gap)best={gap:g,speed:o.v};}
    const stop=v.stops[0];
    if(stop){
      let d=stop.s-v.s;
      for(let k=v.idx;k<stop.idx;k++)d+=this.graph.byId.get(v.route[k]).length;
      if(d>-2&&d<LOOKAHEAD&&d<best.gap)best={gap:Math.max(0,d),speed:0,stop:true};
    }
    const beyond=this.beyondLane(v,seg,byLane);
    return beyond.gap<best.gap?beyond:best;
  }
  beyondLane(v,seg,byLane){
    let ahead=seg.length-v.s;
    for(let k=v.idx+1;k<v.route.length&&ahead<LOOKAHEAD;k++){
      const next=this.graph.byId.get(v.route[k]),prev=this.graph.byId.get(v.route[k-1]);
      if(next.kind==='lane'&&prev.kind==='lane'&&(next.id===prev.left||next.id===prev.right))break;   // lane change, handled separately
      if(next.kind==='connector'&&!v.commits.has(next.id)){
        // Between two junctions so close that no vehicle can wait in between, go only when
        // the second junction can be crossed too; otherwise it would stop inside the first.
        const exit=this.graph.byId.get(next.to),after=this.graph.byId.get(v.route[k+2]);
        const chained=exit.length<STOP_BACK+2&&after?.kind==='connector'&&!v.commits.has(after.id)?after:null;
        // On a link inside a pair of signals there is no stop line: wait close to the mouth.
        const back=this.internal.has(`${next.node}:${next.legFrom}`)?1:STOP_BACK;
        if(!this.mayEnter(v,next,ahead-back)||(chained&&!this.mayEnter(v,chained,Infinity))||!this.ringExitClear(v,k,next))return {gap:Math.max(0,ahead-back),speed:0,stopLine:next.id};
        if(ahead<COMMIT+v.v*v.v/(2*IDM.b))for(const c of chained?[next,chained]:[next]){v.commits.add(c.id);this.onConnector.get(c.id).add(v.id);}
      }
      let rear=null;
      for(const o of byLane.get(next.id)||[])if(!rear||o.s<rear.s)rear=o;
      if(rear)return {gap:ahead+rear.s-rear.len,speed:rear.v};
      ahead+=next.length;
    }
    return {gap:Infinity,speed:0};
  }
  mayEnter(v,c,distance){
    const rule=this.allows(c);
    if(rule==='stop')return false;
    if(rule==='yellow'&&distance>v.v*v.v/(2*4)+1)return false;
    // People on (or about to step onto) a zebra crossing of this move go first.
    if(this.pedestrians&&(this.pedestrians.blocks(c.node,c.legFrom)||this.pedestrians.blocks(c.node,c.legTo)))return false;
    // Nobody may use a crossing or merging path at the same time.
    for(const id of c.conflicts)for(const other of this.onConnector.get(id))if(other!==v.id)return false;
    // Do not block the junction: the exit lane needs room for this vehicle, after the
    // vehicles already on their way into it (on any move that ends in that lane).
    const exit=this.graph.byId.get(c.to);let room=Infinity;
    for(const o of this.vehicles)if(!o.bay&&o.route[o.idx]===exit.id)room=Math.min(room,o.s-o.len);
    // (A link too short to wait in is passed straight through; see the chained check.)
    if(exit.length>=STOP_BACK+2){
      if(room===Infinity)room=exit.length;
      for(const id of this.connectorsInto.get(exit.id)||[])for(const other of this.onConnector.get(id))
        if(other!==v.id)room-=(this.vehicleById.get(other)?.len||4.5)+IDM.s0;
    }
    // Room for the whole vehicle, so that it does not stay half inside the junction. Not
    // around a roundabout ring: traffic on the ring has right of way and must keep flowing,
    // or a full ring locks itself (every car waiting for a car-length on the next stretch).
    if(this.graph.byId.get(c.from).ring&&exit.ring)return room>=IDM.s0;
    return room>=Math.min(v.len+IDM.s0,exit.length);
  }
  // Do not enter a roundabout while the road it will leave by is full: the ring would fill
  // up with vehicles that cannot get out and lock.
  ringExitClear(v,k,c){
    const into=this.graph.byId.get(c.to),from=this.graph.byId.get(c.from);
    if(!into.ring||from.ring)return true;
    for(let i=k+1;i<v.route.length;i++){
      const seg=this.graph.byId.get(v.route[i]);
      if(seg.kind!=='lane'||seg.ring)continue;
      let room=seg.length;
      for(const o of this.vehicles)if(!o.bay&&o.route[o.idx]===seg.id)room=Math.min(room,o.s-o.len);
      return room>=v.len+IDM.s0;
    }
    return true;
  }
  // True while a vehicle is committed to a move through the given junction leg.
  legBusy(node,leg){
    for(const id of this.connectorsByLeg.get(`${node}:${leg}`)||[])if(this.onConnector.get(id).size)return true;
    return false;
  }
  tryLaneChange(v,byLane){
    const seg=this.graph.byId.get(v.route[v.idx]),next=this.graph.byId.get(v.route[v.idx+1]);
    if(!next||next.kind!=='lane'||(next.id!==seg.left&&next.id!==seg.right))return false;
    if(v.stops[0]?.idx===v.idx)return false;   // stay in the lane of the stop
    const s=v.s*next.length/seg.length;
    // In a stopped queue vehicles merge zip-wise, with a car length less room than in motion.
    const blockers=(byLane.get(next.id)||[]).filter(o=>{const d=o.s-s,still=v.v<1&&o.v<1;return d>-(v.len+(still?1:6+o.v))&&d<o.len+(still?1:4);});
    if(blockers.length){
      // Two stopped vehicles side by side, each wanting the other's lane: they swap.
      const o=blockers[0];
      if(blockers.length>1||v.v>1||o.v>1||o.route[o.idx+1]!==seg.id||o.stops[0]?.idx===o.idx)return false;
      if((byLane.get(seg.id)||[]).some(x=>x!==v&&Math.abs(x.s-o.s*seg.length/next.length)<x.len+2))return false;
      this.shiftLane(o,next,seg,o.s*seg.length/next.length);
    }
    this.shiftLane(v,seg,next,s);return true;
  }
  // Moves a vehicle to the neighbouring lane; the view slides it across over 1.5 s.
  shiftLane(v,from,to,s){
    v.laneDir=to.id===from.left?'left':'right';   // lane 0 is the kerb lane, on the left
    const before=along(from,v.s),after=along(to,s);
    v.idx++;v.s=s;v.shift=1;v.offset={x:before.x-after.x,z:before.z-after.z};
  }

  step(dt=0.25){
    this.time+=dt;
    this.updateSignals(dt);
    this.updateBins(dt);
    this.spawn(dt);
    this.pedestrians?.step(dt);
    // Vehicles in a bus bay are out of the lane: others drive past.
    const byLane=new Map(),fill=()=>{byLane.clear();for(const o of this.vehicles){if(o.bay)continue;const id=o.route[o.idx];(byLane.get(id)||byLane.set(id,[]).get(id)).push(o);}};
    fill();
    for(const v of this.vehicles)if(!v.bay&&this.tryLaneChange(v,byLane))fill();
    const done=[];
    for(const v of this.vehicles){
      const seg=this.graph.byId.get(v.route[v.idx]);
      let {gap,speed,stop}=this.gapAhead(v,byLane);
      // A pending lane change must happen before the lane ends.
      const next=this.graph.byId.get(v.route[v.idx+1]);
      if(next&&next.kind==='lane'&&(next.id===seg.left||next.id===seg.right))gap=Math.min(gap,Math.max(0,seg.length-v.s-2));
      const v0=seg.speed*VEHICLE_TYPES[v.type].speed,dv=v.v-speed;
      const sStar=(stop?0.3:IDM.s0)+v.v*IDM.T+v.v*dv/(2*Math.sqrt(v.accel*IDM.b));
      let acc=v.accel*(1-(v.v/v0)**4-(gap===Infinity?0:(Math.max(sStar,0)/Math.max(gap,0.1))**2));
      acc=Math.max(acc,-9);
      v.v=Math.max(0,v.v+acc*dt);v.acc=acc;   // (the view shows brake lights from it)
      if(gap<0.5&&v.v>0)v.v=0;
      v.s+=v.v*dt;v.shift=Math.max(0,v.shift-dt/1.5);
      this.serveStop(v,dt);
      if(v.v<STOPPED&&!v.dwelling)this.stats.queueSeconds+=dt;
      while(v.s>=this.graph.byId.get(v.route[v.idx]).length){
        const cur=this.graph.byId.get(v.route[v.idx]),nxt=this.graph.byId.get(v.route[v.idx+1]);
        if(!nxt){done.push(v);break;}
        if(nxt.kind==='lane'&&(nxt.id===cur.left||nxt.id===cur.right)){v.s=cur.length-0.01;v.v=0;break;}
        if(nxt.kind==='connector'){
          if(!v.commits.has(nxt.id)){
            // Should not happen (the stop line holds it); count it and hold the car.
            if(this.allows(nxt)==='stop'){
              this.stats.redViolations++;
              (this.stats.violations||(this.stats.violations=[])).push({time:this.time,vehicle:v.id,node:nxt.node,connector:nxt.id,speed:v.v,signal:this.signalState(nxt.node)});
            }
            v.commits.add(nxt.id);this.onConnector.get(nxt.id).add(v.id);
          }
          for(const sensor of this.sensorsByNode.get(nxt.node)||[])if(sensor.legs.has(nxt.legFrom))sensor.count++;
        }
        if(cur.kind==='connector'){this.onConnector.get(cur.id).delete(v.id);v.commits.delete(cur.id);}
        v.s-=cur.length;v.idx++;
        if(v.stops[0]&&v.stops[0].idx<v.idx)this.missStop(v);
      }
    }
    for(const v of done){
      for(const id of v.commits)this.onConnector.get(id)?.delete(v.id);
      while(v.stops.length)this.missStop(v);
      this.stats.completed++;this.stats.travelSeconds+=this.time-v.born;
    }
    if(done.length){this.vehicles=this.vehicles.filter(v=>!done.includes(v));for(const v of done)this.vehicleById.delete(v.id);}
  }
  // Waiting at a bus stop or a bin; the stop is done after its dwell time.
  serveStop(v,dt){
    const stop=v.stops[0];v.dwelling=false;
    v.bayShift=Math.max(0,Math.min(1,(v.bayShift||0)+(v.bay?dt:-dt)/1.5));
    if(!stop||stop.idx!==v.idx)return;
    if(v.s>stop.s+2){this.missStop(v);return;}
    if(Math.abs(stop.s-v.s)>2||v.v>0.5)return;
    v.dwelling=true;v.dwell+=dt;
    if(stop.busStop)v.bay=true;   // pulls into the bus bay, out of the lane
    const bin=stop.bin&&this.bins.find(b=>b.id===stop.bin);
    if(bin){bin.truck=v.id;bin.fill=Math.max(0,bin.fill-dt/stop.dwell*1.2);}
    if(v.dwell>=stop.dwell){
      // Leave the bay only when the lane beside it is clear.
      if(v.bay&&this.vehicles.some(o=>o!==v&&!o.bay&&o.route[o.idx]===v.route[v.idx]&&o.s>v.s-12&&o.s-o.len<v.s+3))return;
      v.dwell=0;v.stops.shift();v.bay=false;
      if(bin){bin.fill=0;bin.emptied++;bin.truck=null;}
      if(stop.busStop)this.stats.busStops++;
    }
  }
  // A stop that could not be made (e.g. the lane was joined too late): a bin gets a new call.
  missStop(v){
    const stop=v.stops.shift(),bin=stop?.bin&&this.bins.find(b=>b.id===stop.bin);
    if(bin)bin.truck=null;
  }

  run(seconds,dt=0.25){for(let t=0;t<seconds;t+=dt)this.step(dt);return this;}

  // Where a vehicle is drawn; back > 0 moves the point from its front towards its middle.
  position(v,back=0){
    const seg=this.graph.byId.get(v.route[v.idx]),p=along(seg,v.s-back),k=v.shift&&v.offset?v.shift:0;
    // A bus bay lies beside the kerb lane, on the left of the direction of travel.
    const bay=(v.bayShift||0)*2.8,lx=Math.cos(p.heading),lz=-Math.sin(p.heading);
    return {x:p.x+(k?v.offset.x*k:0)+lx*bay,z:p.z+(k?v.offset.z*k:0)+lz*bay,heading:p.heading};
  }
  // What a camera reports: vehicles counted so far and the queue it sees right now.
  sensorState(id){
    const sensor=this.sensors.find(s=>s.id===id);if(!sensor)return null;
    const sig=this.signals.get(sensor.node);let queue=0;
    for(const v of this.vehicles){
      if(v.v>=STOPPED)continue;
      const seg=this.graph.byId.get(v.route[v.idx]),next=this.graph.byId.get(v.route[v.idx+1]);
      if(seg.kind==='lane'&&seg.end===sensor.node&&next?.kind==='connector'&&sensor.legs.has(next.legFrom))queue++;
    }
    return {node:sensor.node,legs:[...sensor.legs],count:sensor.count,queue,adaptive:this.adaptive&&sig.sensed.size>0};
  }
  summary(){
    const s=this.stats,bins=this.bins;
    return {time:this.time,active:this.vehicles.length,waiting:this.vehicles.filter(v=>v.v<STOPPED&&!v.dwelling).length,backlog:this.backlog.length,
      completed:s.completed,averageTravel:s.completed?s.travelSeconds/s.completed:0,queueSeconds:s.queueSeconds,
      throughput:this.time?s.completed*3600/this.time:0,signals:this.signals.size,redViolations:s.redViolations,
      sensors:this.sensors.length,sensedSignals:[...this.signals.values()].filter(x=>x.sensed.size).length,
      vehicleTypes:Object.fromEntries(Object.keys(VEHICLE_TYPES).map(t=>[t,this.vehicles.filter(v=>v.type===t).length])),
      busStops:s.busStops,bins:bins.length,binsEmptied:bins.reduce((n,b)=>n+b.emptied,0),binsFull:bins.filter(b=>b.fill>=1).length,
      pedestrians:this.pedestrians?this.pedestrians.summary():null};
  }
}
