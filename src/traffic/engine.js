import {validateMap} from '../map/format.js';
import {buildGeometry,polylineLength} from '../map/geometry.js';
import {buildPlan,TIMING,compass} from '../map/signals.js';
import {buildLaneGraph,routesFrom,along} from './lanes.js';
import {Pedestrians} from './pedestrians.js';
import {planRoutes,START,END} from './waste-routes.js';
import {zoneCentre} from '../map/placement.js';
import {roadEnds} from '../map/region.js';

// Traffic model for any map file: vehicles follow lanes with the Intelligent Driver Model,
// change lanes for their route, obey the junction phase plans (fixed or adaptive) and give
// way at unsignalised junctions. The devices placed on the map take part:
//   cctv / cctv-dome  count vehicles; adaptive lights only adapt where a camera sees
//   bin-sensor        reports its fill level; a garbage truck is sent when it is nearly full
//   bus-stop          minibuses (angkot) stop there
// Pedestrians walk the pavements and cross at the zebra crossings. Deterministic for a
// given seed; no rendering here.
//
// Randomness comes in separate streams so that two runs on the same map and seed (the
// ordinary and the smart city) get the same trips: arrival times, origin, destination,
// vehicle type and the driver (preferred speed, following distance) are drawn when the trip
// is made, from the demand stream only. Bins and pedestrians have streams of their own, so
// what happens on the road never shifts the draws for the next trip.
//
// Drivers differ: each keeps a preferred speed (a factor on the speed limit, spread
// `speedSpread`) and following time. On roads with two or more lanes per direction a faster
// driver overtakes on the lane away from the kerb (the right lane; traffic keeps left) and
// moves back after passing, not close before a junction and only when the route still works
// from the new lane.

const IDM={a:1.5,b:2.0,T:1.2,s0:2.0};
// Overtaking: not within this distance of the lane's end; gain needed to pull out (m/s²);
// the most the vehicle behind in the new lane may have to brake (m/s²).
// `back`: room kept at the lane's end to move back in after passing.
const OVERTAKE={clear:60,back:35,gain:0.4,safe:2.5,keep:0.15};
export const VEHICLE_TYPES={
  car:{length:4.5,a:1.5,speed:1,asset:'car'},
  minibus:{length:5.6,a:1.2,speed:0.9,asset:'minibus'},
  truck:{length:7.4,a:0.9,speed:0.8,asset:'garbage-truck'},
};
const STOPPED=0.3,LOOKAHEAD=90,COMMIT=8;
// Cars wait behind the stop line, which the editor draws 4.5 m before the junction mouth
// (the zebra crossing lies in between).
const STOP_BACK=5.5;
// Camera detection zone: metres back from the stop line, one value for all cameras (`zone`).
export const ZONE=80;const ZONE_MAX=200;
const BIN_CALL=0.8,BIN_DWELL=30,BUS_DWELL=8,TRUCKS=2,BIN_KG=120,TRUCK_KG=1000;

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
  // `green`: green seconds for signals without their own plan. Bins: `binMode` 'sensor'
  // (a truck is called when a bin is nearly full) or 'schedule' (each bin is visited every
  // `binSchedule` seconds whatever its fill, as without sensors); `binFill` is the fill
  // fraction added per second (from population × waste per person), else a random rate.
  constructor(map,{seed=42,demand=900,adaptive=false,minibus=0.12,pedestrians=0,offsets=null,prepared=null,
    green=null,speedSpread=0.1,overtaking=true,zone=ZONE,learned=null,binMode='sensor',binFill=null,binSchedule=3600}={}){
    this.map=prepared?.map||validateMap(structuredClone(map));
    this.geometry=prepared?.geometry||buildGeometry(this.map);
    this.graph=prepared?.graph||buildLaneGraph(this.map,this.geometry);
    this.seed=seed;this.random=rng(seed);this.binRandom=rng(seed+1000);this.walkRandom=rng(seed+2000);
    this.speedSpread=Math.min(0.3,Math.max(0,speedSpread));this.overtaking=overtaking;
    // Detection zone (m) of every camera.
    this.zone=Math.min(ZONE_MAX,Math.max(20,Number(zone)||ZONE));this.demand=demand;this.adaptive=adaptive;this.minibusShare=minibus;
    this.time=0;this.vehicles=[];this.nextId=1;this.backlog=[];this.nextArrival=0;
    this.binMode=binMode;this.binFill=binFill;this.binSchedule=binSchedule;
    this.stats={completed:0,travelSeconds:0,queueSeconds:0,backlogSeconds:0,spawned:0,redViolations:0,busStops:0,truckTrips:0,overtakes:0};
    this.routes=prepared?.routes||new Map();
    // Vehicles appear and leave only at the city's gates and at the ends of access roads
    // (kawasan); a cul-de-sac is a road like any other. Each source keeps the destinations it
    // can actually reach (no U-turns at dead ends).
    const ends=roadEnds(this.map);
    this.gates=ends.gates;this.gateNodes=new Set(ends.gates.map(g=>g.node));
    const open=node=>this.gateNodes.has(node)||ends.kawasan.has(node);
    this.exits=this.graph.sinks.filter(t=>open(this.graph.byId.get(t).end));
    this.targets=new Map();
    for(const src of this.graph.sources.filter(s=>open(this.graph.byId.get(s).start))){
      const to=this.routeFrom(src);
      this.targets.set(src,this.exits.filter(t=>to(t)&&this.graph.byId.get(t).end!==this.graph.byId.get(src).start));
    }
    this.origins=[...this.targets.keys()].filter(s=>this.targets.get(s).length);
    this.signals=new Map();
    for(const j of this.geometry.junctions){
      const node=this.map.nodes.find(n=>n.id===j.id);
      if(node?.signal!==true||j.legs.some(l=>l.ring))continue;
      const plan=buildPlan(j,{...(green?{green:Array(8).fill(green)}:{}),...(node.signalPlan||{})});
      this.signals.set(j.id,{plan,base:plan.phases.map(p=>p.green),j,phase:0,stage:'green',t:0,sensed:new Set()});
    }
    // Simpang gabungan (see geometry.CLUSTER_LINK): signalised junctions joined by a link
    // too short to queue in work as one. Traffic that got green at the first one is not
    // stopped again at the next (it gives way to crossing traffic and people there).
    this.internal=new Set();
    for(const [id,sig] of this.signals)sig.j.legs.filter(l=>!l.ring).forEach((leg,i)=>{if(leg.internal)this.internal.add(`${id}:${i}`);});
    this.clusters=(this.geometry.clusters||[]).filter(c=>c.nodes.every(id=>this.signals.has(id)));
    this.clusterOf=new Map(this.clusters.flatMap(c=>c.nodes.map(id=>[id,c])));
    this.offsets={};
    this.setLearned(learned);
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
    // Cameras. A pole camera (cctv) watches the one approach it faces, usually from across
    // the junction: its detection zone runs back `zone` metres (default 80) from the stop
    // line. A dome (cctv-dome, older maps) watches every approach of its junction.
    this.sensors=[];
    for(const o of this.map.objects){
      if(o.asset!=='cctv-dome'&&o.asset!=='cctv')continue;
      const zone=this.zone;
      let best=null;
      for(const [id,sig] of this.signals){
        const legs=sig.j.legs.filter(l=>!l.ring);
        if(o.asset==='cctv-dome'){const d=dist(sig.j,o);if(d<40&&(!best||d<best.score))best={node:id,legs:legs.map((_,i)=>i),score:d};}
        else legs.forEach((leg,i)=>{
          if(leg.internal||leg.access)return;
          // The camera must look at the middle of the zone (within 30°) from close enough.
          const c=zoneCentre(this.geometry,sig.j,leg,zone),to={x:c.x-o.x,z:c.z-o.z},d=Math.hypot(to.x,to.z);
          const r=(o.rotation||0)*Math.PI/180,cos=(Math.sin(r)*to.x+Math.cos(r)*to.z)/(d||1);
          if(cos<Math.cos(Math.PI/6)||d>zone+80)return;
          // Aim first; then the junction the camera stands at (it watches that junction's
          // approaches, even when another junction's zone lies on the same straight road).
          const score=(1-cos)*4000+dist(o,sig.j)*2+d*0.2;if(!best||score<best.score)best={node:id,legs:[i],score};
        });
      }
      if(!best)continue;
      const sensor={id:o.id,asset:o.asset,node:best.node,legs:new Set(best.legs),count:0,also:[],zone};
      this.sensors.push(sensor);for(const i of sensor.legs)this.signals.get(best.node).sensed.add(i);
      // A dome at a simpang gabungan watches the outer approaches of every member.
      if(o.asset==='cctv-dome')for(const id of this.clusterOf.get(best.node)?.nodes||[]){
        if(id===best.node)continue;const sig=this.signals.get(id);
        sig.j.legs.filter(l=>!l.ring).forEach((leg,i)=>{if(!leg.internal){sig.sensed.add(i);sensor.also.push({node:id,leg:i});}});
      }
    }
    this.sensorsByNode=new Map();
    for(const s of this.sensors)for(const node of new Set([s.node,...s.also.map(a=>a.node)]))(this.sensorsByNode.get(node)||this.sensorsByNode.set(node,[]).get(node)).push(s);
    // How far back each watched approach is counted: the longest zone of its cameras.
    this.zoneOf=new Map();
    for(const s of this.sensors)for(const {node,leg} of [...[...s.legs].map(leg=>({node:s.node,leg})),...s.also]){const key=`${node}:${leg}`;this.zoneOf.set(key,Math.max(this.zoneOf.get(key)||0,s.zone));}
    // Bus stops on a kerb lane.
    this.busStops=this.map.objects.filter(o=>o.asset==='bus-stop').map(o=>({id:o.id,...kerbSpot(o)})).filter(s=>s.seg!==undefined);
    // Bins with a sensor, filling up; the depot is the waste facility (or any entry).
    this.bins=this.map.objects.filter(o=>o.asset==='bin-sensor').map(o=>{const spot=kerbSpot(o,16);
      return spot&&{id:o.id,x:o.x,z:o.z,seg:spot.seg,s:spot.s,fill:0.25+this.binRandom()*0.55,rate:this.binFill??1/(1500+this.binRandom()*1500),truck:null,emptied:0,fullSeconds:0};}).filter(Boolean);
    // Without sensors the round is fixed: bins are visited in turn, spread over the schedule.
    this.bins.forEach((b,i)=>{b.nextVisit=(i+1)*this.binSchedule/this.bins.length;});
    const depot=this.map.objects.find(o=>o.asset==='tps3r');
    const end=(id,first)=>{const pts=this.graph.byId.get(id).points;return first?pts[0]:pts.at(-1);};
    const byDepot=(list,first)=>depot?[...list].sort((a,b)=>dist(end(a,first),depot)-dist(end(b,first),depot)):list;
    this.depot={sources:byDepot(this.origins,true),sinks:byDepot(this.exits,false)};
    this.binTimer=0;
  }
  // Route through a given lane: start → via → end, with the index of via in it; or null.
  routeVia(src,via,dst){
    const a=this.routeFrom(src)(via);if(!a)return null;
    const b=this.routeFrom(via)(dst);if(!b)return null;
    return {route:[...a,...b.slice(1)],idx:a.length-1};
  }
  travelTime(route){let t=0;for(const id of route){const seg=this.graph.byId.get(id);t+=seg.length/seg.speed;}return t;}
  // A learned model (src/analysis): it can be swapped while the city runs. Only counts are
  // used (cameras and bin sensors), no vehicle is followed.
  //   greens        {node:[green per phase]}: set outright, or
  //   greenScale    times the plan's green, greenSplit {node:[factor per phase]}
  //   links         [{node,leg,from,exclude,travel,share}]: a platoon released upstream
  //                 reaches this approach `travel` seconds later, `share` of it
  //   horizon       seconds ahead a platoon holds the green (default 8; 0: no holding)
  // A simpang gabungan keeps its common cycle (its greens are not changed).
  setLearned(learned){
    this.learned=learned||null;
    for(const [id,sig] of this.signals){
      if(this.clusterOf.get(id))continue;
      const g=learned?.greens?.[id],split=learned?.greenSplit?.[id],scale=learned?.greenScale??1;
      sig.plan.phases.forEach((p,i)=>{
        const v=g&&Number.isFinite(g[i])?g[i]:sig.base[i]*scale*(split?.[i]??1);
        p.green=Math.max(TIMING.minGreen,Math.min(TIMING.maxGreen,Math.round(v)));
      });
    }
    this.links=new Map();for(const l of learned?.links||[])this.links.set(`${l.node}:${l.leg}`,l);
  }
  updateBins(dt){
    for(const b of this.bins){if(!b.truck||b.truck==='called')b.fill=Math.min(1.2,b.fill+b.rate*dt);if(b.fill>=1)b.fullSeconds+=dt;}
    this.binTimer-=dt;if(this.binTimer>0||!this.bins.length)return;
    this.binTimer=5;
    const busy=this.vehicles.filter(v=>v.type==='truck').length+this.backlog.filter(b=>b.type==='truck').length;
    if(this.binMode==='sensor'){this.routeTrucks(TRUCKS-busy);return;}
    // Without sensors the bins due on the round, one truck each.
    const waiting=this.bins.filter(b=>!b.truck&&this.time>=b.nextVisit).sort((a,b)=>a.nextVisit-b.nextVisit);
    for(const bin of waiting.slice(0,Math.max(0,TRUCKS-busy))){
      let trip=null;
      for(const src of this.depot.sources.slice(0,4)){
        for(const dst of this.depot.sinks.slice(0,6)){trip=this.routeVia(src,bin.seg,dst);if(trip)break;}
        if(trip){trip.src=src;break;}
      }
      if(!trip){bin.truck='unreachable';continue;}
      bin.truck='called';this.stats.truckTrips++;bin.nextVisit+=this.binSchedule;
      this.backlog.push({src:trip.src,route:trip.route,requested:this.time,type:'truck',stops:[{idx:trip.idx,s:bin.s,dwell:BIN_DWELL,bin:bin.id}]});
    }
  }
  // With sensors: the bins that reached BIN_CALL and wait for a truck are shared over the free
  // trucks along the quickest routes (src/traffic/waste-routes.js), planned again each time.
  routeTrucks(free){
    const due=this.bins.filter(b=>!b.truck&&b.fill>=BIN_CALL);
    if(free<=0||!due.length)return;
    // Bins on the same lane are one stop, served in their order along it.
    const stops=[];
    for(const b of due){const s=stops.find(x=>x.seg===b.seg);if(s)s.bins.push(b);else stops.push({seg:b.seg,bins:[b]});}
    for(const s of stops)s.bins.sort((a,b)=>a.s-b.s);
    for(const src of this.depot.sources.slice(0,4))for(const dst of this.depot.sinks.slice(0,6)){
      const at=i=>i===START?src:i===END?dst:stops[i].seg;
      const cost=(a,b)=>this.routeFrom(at(a)).time(at(b));
      const load=stops.map(s=>s.bins.reduce((n,b)=>n+Math.min(1,b.fill)*BIN_KG,0));
      const {trips,unreachable}=planRoutes(load,{cost,capacity:TRUCK_KG});
      if(unreachable.length===stops.length)continue;
      for(const i of unreachable)for(const b of stops[i].bins)b.truck='unreachable';
      // The trips with most bins go first.
      trips.sort((a,b)=>b.reduce((n,i)=>n+stops[i].bins.length,0)-a.reduce((n,i)=>n+stops[i].bins.length,0));
      for(const trip of trips.slice(0,free)){
        let route=[src];const list=[];
        for(const i of trip){
          const leg=this.routeFrom(route.at(-1))(stops[i].seg);
          route=[...route,...leg.slice(1)];
          for(const b of stops[i].bins){list.push({idx:route.length-1,s:b.s,dwell:BIN_DWELL,bin:b.id});b.truck='called';}
        }
        route=[...route,...this.routeFrom(route.at(-1))(dst).slice(1)];
        this.stats.truckTrips++;
        this.backlog.push({src,route,requested:this.time,type:'truck',stops:list});
      }
      return;
    }
    for(const b of due)b.truck='unreachable';
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
  // Each counts within its camera's detection zone (measured back from the stop line).
  countApproaching(){
    const counts=new Map();
    for(const v of this.vehicles){
      let ahead=-v.s;
      for(let k=v.idx;k<v.route.length&&ahead<ZONE_MAX+STOP_BACK;k++){
        const seg=this.graph.byId.get(v.route[k]);
        if(seg.kind==='connector'&&k>v.idx&&this.signals.has(seg.node)){
          const key=`${seg.node}:${seg.legFrom}`;
          if(ahead<=(this.zoneOf.get(key)??this.zone)+STOP_BACK)counts.set(key,(counts.get(key)||0)+1);
        }
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
          let here=this.demandFor(sig,sig.phase);
          if(here===0&&this.links.size)here=this.platoonFor(sig,sig.phase,this.learned?.horizon??8);
          if(here!==null){
            const others=sig.plan.phases.some((_,i)=>{if(i===sig.phase)return false;const d=this.demandFor(sig,i);return d===null||d>0;});
            const maxGreen=Math.min(phase.green*2,TIMING.maxGreen);
            end=sig.t>=maxGreen||(sig.t>=8&&here===0&&others);
            // The controller's log: how often a green ran out while vehicles still waited.
            if(end){const log=sig.log||(sig.log=sig.plan.phases.map(()=>({greens:0,maxouts:0,seconds:0})));log[sig.phase].greens++;log[sig.phase].seconds+=sig.t;if(sig.t>=maxGreen&&here>0)log[sig.phase].maxouts++;}
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
  // Vehicles expected to reach a phase's approaches within the next few seconds, from the
  // counts that left the upstream signal one learned travel time ago (coordination).
  platoonFor(sig,phaseIndex,horizon=8){
    let n=0;
    for(const m of sig.plan.phases[phaseIndex].movements){
      const link=this.links.get(`${sig.j.id}:${m.from}`);if(!link)continue;
      let left=0;
      for(const sensor of this.sensorsByNode.get(link.from)||[]){
        if([...sensor.legs].some(l=>l===link.exclude))continue;
        const p=sensor.passes||[];while(p.length&&p[0]<this.time-240)p.shift();
        for(const t of p)if(t>this.time-link.travel&&t<=this.time-link.travel+horizon)left++;
      }
      n+=left*link.share;
    }
    return n>=1?Math.round(n):0;
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
  // The driver of a trip: preferred speed (factor on the limit, about normal around 1 and
  // within two spreads), following time and car colour. Always the same four draws.
  driver(){
    const u=Math.max(1e-9,this.random()),w=this.random(),h=this.random(),color=Math.floor(this.random()*7),k=this.speedSpread;
    const normal=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*w);
    return {pref:1+k*Math.max(-2,Math.min(2,normal)),headway:IDM.T*(1+k*3*(h-0.5)),color};
  }
  newTrip(){
    const driver=this.driver();
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
      return {src,driver,route:best?best.route:direct,type:'minibus',stops:best?[{idx:best.idx,s:best.stop.s,dwell:BUS_DWELL,busStop:best.stop.id}]:[]};
    }
    return {src,driver,route:this.routeFrom(src)(dst),type:'car',stops:[]};
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
      const seg=this.graph.byId.get(b.src),type=VEHICLE_TYPES[b.type],d=b.driver||{pref:1,headway:IDM.T,color:0};
      const vehicle={id:this.nextId++,type:b.type,len:type.length,accel:type.a,route:b.route,idx:0,s:0,pref:d.pref,headway:d.headway,
        v:Math.min(seg.speed*type.speed*d.pref,first?Math.max(0,(first.s-first.len-6)/2):seg.speed),born:this.time,waited:this.time-b.requested,
        color:d.color,shift:0,commits:new Set(),stops:b.stops||[],dwell:0,dwelling:false};
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
    // Overtaking: move back only once the passed vehicle is behind (or the lane runs out).
    if(v.passing?.seg===seg.id&&seg.length-v.s>OVERTAKE.back){
      const o=this.vehicleById.get(v.passing.id);
      if(o&&o.route[o.idx]===next.id&&o.s>s-v.len-4)return false;
    }
    // In a stopped queue vehicles merge zip-wise, with a car length less room than in motion.
    const blockers=(byLane.get(next.id)||[]).filter(o=>{const d=o.s-s,still=v.v<1&&o.v<1;return d>-(v.len+(still?1:6+o.v))&&d<o.len+(still?1:4);});
    if(blockers.length){
      // Two stopped vehicles side by side, each wanting the other's lane: they swap.
      const o=blockers[0];
      if(blockers.length>1||v.v>1||o.v>1||o.route[o.idx+1]!==seg.id||o.stops[0]?.idx===o.idx)return false;
      if((byLane.get(seg.id)||[]).some(x=>x!==v&&Math.abs(x.s-o.s*seg.length/next.length)<x.len+2))return false;
      this.shiftLane(o,next,seg,o.s*seg.length/next.length);
    }
    if(next.index<seg.index)v.passing=null;
    this.shiftLane(v,seg,next,s);return true;
  }
  desired(v,seg){return seg.speed*VEHICLE_TYPES[v.type].speed*v.pref;}
  // IDM acceleration of v behind a vehicle `gap` metres ahead moving at `speed`.
  follow(v,seg,gap,speed){
    const v0=this.desired(v,seg),sStar=IDM.s0+v.v*v.headway+v.v*(v.v-speed)/(2*Math.sqrt(v.accel*IDM.b));
    return v.accel*(1-(v.v/v0)**4-(gap===Infinity?0:(Math.max(sStar,0)/Math.max(gap,0.1))**2));
  }
  // Nearest vehicles ahead of and behind position s on a lane.
  neighbours(lane,s,byLane,skip){
    let ahead=null,behind=null;
    for(const o of byLane.get(lane)||[]){if(o===skip)continue;if(o.s>s){if(!ahead||o.s<ahead.s)ahead=o;}else if(!behind||o.s>behind.s)behind=o;}
    return {ahead,behind};
  }
  // A lane change by choice (MOBIL-like): pull out to pass a slower vehicle, move back towards
  // the kerb when that costs nothing. Only well before the end of the lane, never for vehicles
  // with a stop to make. If the route needs the old lane again (to turn), the lane must be
  // long enough to get past and back in.
  tryOvertake(v,byLane){
    if(!this.overtaking||v.stops.length||v.shift>0||v.v<3||this.time<(v.nextChoice||0))return false;
    const seg=this.graph.byId.get(v.route[v.idx]),next=this.graph.byId.get(v.route[v.idx+1]);
    if(seg.kind!=='lane'||seg.ring||(next&&next.kind!=='connector')||seg.length-v.s<OVERTAKE.clear)return false;
    v.nextChoice=this.time+1;   // drivers weigh it about once a second
    const own=this.neighbours(seg.id,v.s,byLane,v),here=own.ahead?this.follow(v,seg,own.ahead.s-own.ahead.len-v.s,own.ahead.v):this.follow(v,seg,Infinity,0);
    for(const id of [seg.right,seg.left]){
      if(id===null)continue;
      const lane=this.graph.byId.get(id),s=v.s*lane.length/seg.length,kerbward=lane.index<seg.index;
      // Back towards the kerb only after passing; otherwise both lanes stay in use (at a stop
      // line two queues are shorter than one).
      if(kerbward&&v.passing?.seg!==seg.id)continue;
      const {ahead,behind}=this.neighbours(id,s,byLane,null);
      const gapAhead=ahead?ahead.s-ahead.len-s:Infinity,gapBehind=behind?s-v.len-behind.s:Infinity;
      if(gapAhead<IDM.s0+v.v*0.5||gapBehind<IDM.s0+(behind?behind.v*0.5:0))continue;
      if(behind&&behind.shift===0&&this.follow(behind,lane,gapBehind,v.v)<-OVERTAKE.safe)continue;
      const there=this.follow(v,lane,gapAhead,ahead?ahead.v:0);
      // Out: a clear gain behind a slower vehicle. Back towards the kerb: no real loss.
      if(kerbward?there<here-OVERTAKE.keep:!(own.ahead&&own.ahead.v<this.desired(v,seg)-1&&there-here>OVERTAKE.gain))continue;
      const rest=this.routeFrom(id)(v.route.at(-1));if(!rest)continue;
      // Leaving the map, any lane of the last road will do: drop changes at the very end.
      while(rest.length>1){const last=this.graph.byId.get(rest.at(-1)),prev=this.graph.byId.get(rest.at(-2));
        if(last.next.length||prev.kind!=='lane'||prev.road!==last.road||prev.next.length)break;rest.pop();}
      const goBack=rest[1]!==undefined&&this.graph.byId.get(rest[1]).kind==='lane';
      if(goBack){
        if(kerbward||rest[1]!==seg.id)continue;
        // Distance to get a car length past the slower vehicle at the speed difference.
        const o=own.ahead,dv=Math.max(0.5,this.desired(v,seg)-o.v),need=(o.s-v.s+v.len+6)*this.desired(v,seg)/dv;
        if(seg.length-v.s-OVERTAKE.back<need)continue;
      }
      // Not a detour: the rest of the trip beyond this road takes no longer.
      const beyond=r=>this.travelTime(r.filter(x=>this.graph.byId.get(x).road!==seg.road||this.graph.byId.get(x).kind!=='lane'));
      if(beyond(rest)>beyond(v.route.slice(v.idx))+5)continue;
      v.route=[...v.route.slice(0,v.idx+1),...rest];
      v.passing=kerbward?null:{id:own.ahead.id,seg:id};
      this.shiftLane(v,seg,lane,s);v.nextChoice=this.time+4;
      if(!kerbward)this.stats.overtakes++;
      return true;
    }
    return false;
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
    // Waiting to get in: at a gate that is outside the city; at a kawasan it is inside.
    const outside=this.backlog.filter(b=>this.gateNodes.has(this.graph.byId.get(b.src).start)).length;
    this.stats.backlogSeconds+=outside*dt;this.stats.queueSeconds+=(this.backlog.length-outside)*dt;
    this.pedestrians?.step(dt);
    // Vehicles in a bus bay are out of the lane: others drive past.
    const byLane=new Map(),fill=()=>{byLane.clear();for(const o of this.vehicles){if(o.bay)continue;const id=o.route[o.idx];(byLane.get(id)||byLane.set(id,[]).get(id)).push(o);}};
    fill();
    for(const v of this.vehicles)if(!v.bay&&(this.tryLaneChange(v,byLane)||this.tryOvertake(v,byLane)))fill();
    const done=[];
    for(const v of this.vehicles){
      const seg=this.graph.byId.get(v.route[v.idx]);
      let {gap,speed,stop}=this.gapAhead(v,byLane);
      // A pending lane change must happen before the lane ends.
      const next=this.graph.byId.get(v.route[v.idx+1]);
      if(next&&next.kind==='lane'&&(next.id===seg.left||next.id===seg.right))gap=Math.min(gap,Math.max(0,seg.length-v.s-2));
      const v0=this.desired(v,seg),dv=v.v-speed;
      const sStar=(stop?0.3:IDM.s0)+v.v*v.headway+v.v*dv/(2*Math.sqrt(v.accel*IDM.b));
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
          for(const sensor of this.sensorsByNode.get(nxt.node)||[])if(sensor.legs.has(nxt.legFrom)){sensor.count++;(sensor.passes||(sensor.passes=[])).push(this.time);}
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
  // In its zone: vehicles, how many are stopped, and how far back the queue reaches from
  // the stop line. `count` is every vehicle that crossed the stop line so far.
  sensorState(id){
    const sensor=this.sensors.find(s=>s.id===id);if(!sensor)return null;
    const sig=this.signals.get(sensor.node),watched=new Set([...[...sensor.legs].map(l=>`${sensor.node}:${l}`),...sensor.also.map(a=>`${a.node}:${a.leg}`)]);
    let inZone=0,stopped=0,queueLength=0;
    for(const v of this.vehicles){
      let ahead=-v.s;
      for(let k=v.idx;k<v.route.length&&ahead<sensor.zone+STOP_BACK;k++){
        const seg=this.graph.byId.get(v.route[k]);
        if(seg.kind==='connector'&&k>v.idx){
          if(watched.has(`${seg.node}:${seg.legFrom}`)){
            inZone++;
            if(v.v<STOPPED&&!v.dwelling){stopped++;queueLength=Math.max(queueLength,Math.min(sensor.zone,ahead-STOP_BACK+v.len));}
          }
          break;
        }
        ahead+=seg.length;
      }
    }
    const legs=sig.j.legs.filter(l=>!l.ring),approaches=[...sensor.legs].map(i=>({road:legs[i].road,from:compass(legs[i].dir)}));
    return {node:sensor.node,legs:[...sensor.legs],approaches,zone:sensor.zone,count:sensor.count,inZone,stopped,queueLength,queue:stopped,adaptive:this.adaptive&&sig.sensed.size>0};
  }
  // The zone of a camera as lane centre lines (each from the far end of the zone up to the
  // junction mouth, following the road back through bends), for drawing.
  zonePaths(id){
    const sensor=this.sensors.find(s=>s.id===id);if(!sensor)return [];
    const watched=[...[...sensor.legs].map(leg=>({node:sensor.node,leg})),...sensor.also];
    // What feeds each lane: the lane before it, or else the straightest connector through the
    // junction upstream (a short approach's zone carries on past that junction).
    const heading=(p,q)=>Math.atan2(q.z-p.z,q.x-p.x),turn=c=>{const n=c.points.length,d=Math.abs(heading(c.points[0],c.points[1])-heading(c.points[n-2],c.points[n-1]));return Math.min(d,2*Math.PI-d);};
    const before=new Map(),score=new Map();
    for(const s of this.graph.segs)for(const n of s.next){
      const t=this.graph.byId.get(n);if(!t||s.points.length<2)continue;
      const k=s.kind==='lane'?-1:turn(s);if(!score.has(n)||k<score.get(n)){before.set(n,s.id);score.set(n,k);}
    }
    const paths=[];
    for(const seg of this.graph.segs){
      if(seg.kind!=='lane')continue;
      const w=watched.find(w=>seg.end===w.node&&seg.next.some(id=>{const c=this.graph.byId.get(id);return c.kind==='connector'&&c.node===w.node&&c.legFrom===w.leg;}));
      if(!w)continue;
      // Walk back from the mouth, collecting points until the zone length is covered.
      let left=sensor.zone+STOP_BACK,cur=seg,pts=[seg.points.at(-1)];
      while(cur&&left>0){
        for(let i=cur.points.length-1;i>0&&left>0;i--){
          const a=cur.points[i],b=cur.points[i-1],l=dist(a,b);
          if(l>=left){const t=left/l;pts.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});left=0;}else{pts.push(b);left-=l;}
        }
        cur=left>0&&before.has(cur.id)?this.graph.byId.get(before.get(cur.id)):null;
      }
      // The zone starts at the stop line, STOP_BACK before the mouth.
      pts.reverse();let cut=STOP_BACK;
      while(pts.length>1&&cut>0){const a=pts.at(-1),b=pts.at(-2),l=dist(a,b);if(l>cut){pts[pts.length-1]={x:a.x+(b.x-a.x)*cut/l,z:a.z+(b.z-a.z)*cut/l};cut=0;}else{pts.pop();cut-=l;}}
      const road=this.map.roads.find(r=>r.id===seg.road);
      paths.push({node:w.node,leg:w.leg,points:pts,width:this.map.profiles[road.profile].laneWidth});
    }
    return paths;
  }
  summary(){
    const s=this.stats,bins=this.bins;
    return {time:this.time,active:this.vehicles.length,waiting:this.vehicles.filter(v=>v.v<STOPPED&&!v.dwelling).length+this.backlog.filter(b=>!this.gateNodes.has(this.graph.byId.get(b.src).start)).length,backlog:this.backlog.filter(b=>this.gateNodes.has(this.graph.byId.get(b.src).start)).length,
      completed:s.completed,averageTravel:s.completed?s.travelSeconds/s.completed:0,queueSeconds:s.queueSeconds,
      throughput:this.time?s.completed*3600/this.time:0,signals:this.signals.size,redViolations:s.redViolations,overtakes:s.overtakes,
      sensors:this.sensors.length,sensedSignals:[...this.signals.values()].filter(x=>x.sensed.size).length,
      vehicleTypes:Object.fromEntries(Object.keys(VEHICLE_TYPES).map(t=>[t,this.vehicles.filter(v=>v.type===t).length])),
      backlogSeconds:s.backlogSeconds,truckTrips:s.truckTrips,
      busStops:s.busStops,bins:bins.length,binsEmptied:bins.reduce((n,b)=>n+b.emptied,0),binsFull:bins.filter(b=>b.fill>=1).length,binFullSeconds:bins.reduce((n,b)=>n+b.fullSeconds,0),
      pedestrians:this.pedestrians?this.pedestrians.summary():null};
  }
}
