import {toMetres} from './scale.js';
import {LiveSimulation} from './live-simulation.js';

// A deterministic traffic heuristic, not a trained AI or a field forecast.
// Planning still uses the same distance estimates as the baseline; only actual
// driving decisions use live traffic, preserving identical initial demand.
export class SmartSimulation extends LiveSimulation {
  constructor(config={}){
    super(config);
    this.adaptiveSignals=new Map(this.nodes.filter(n=>this.hasSignal(n)).map(n=>[n.id,{axis:'x',stage:'green',since:this.time}]));
    this.trafficCosts=null;this.nextRouting=this.time;this.reroutes=0;
  }
  phase(node,axis){
    const signal=this.adaptiveSignals?.get(node.id);
    if(!signal)return super.phase(node,axis);
    return signal.axis===axis?signal.stage:'red';
  }
  updateSignals(at){
    const demand=new Map([...this.adaptiveSignals.keys()].map(id=>[id,{x:0,z:0}]));
    for(const car of this.cars){
      if(car.state!=='driving')continue;
      const edge=this.edges[car.edge],queue=demand.get(edge.to);
      if(queue&&toMetres(edge.length-car.s)<=100)queue[this.approach(edge).axis]+=car.v<.3?2:1;
    }
    for(const [id,signal] of this.adaptiveSignals){
      const other=signal.axis==='x'?'z':'x',elapsed=at-signal.since;
      if(signal.stage==='green'){
        const q=demand.get(id),maximum=Math.min(90,Math.max(10,this.config.green*2));
        if(elapsed>=maximum||(elapsed>=10&&q[other]>0&&(q[signal.axis]===0||q[other]>q[signal.axis]*1.25))||(elapsed>=this.config.green&&q.x+q.z===0)){
          signal.stage='yellow';signal.since=at;
        }
      }else if(signal.stage==='yellow'&&elapsed>=3){signal.stage='red';signal.since=at;}
      else if(signal.stage==='red'&&elapsed>=1){signal.axis=other;signal.stage='green';signal.since=at;}
    }
  }
  updateTrafficCosts(){
    const counts=this.edges.map(()=>({moving:0,stopped:0}));
    for(const car of this.cars)if(car.state==='driving')counts[car.edge][car.v<.3?'stopped':'moving']++;
    this.trafficCosts=this.edges.map(e=>toMetres(e.length)/8.33+counts[e.id].moving*1.5+counts[e.id].stopped*5);
    this.smartRouteCache=new Map();
  }
  drivingRoute(from,to,avoidFirst=null){
    if(!this.trafficCosts)return super.drivingRoute(from,to);
    const key=`${from}:${to}:${avoidFirst}`;
    if(this.smartRouteCache.has(key))return [...this.smartRouteCache.get(key)];
    const distance=this.nodes.map(()=>Infinity),previous=[],seen=new Set();distance[from]=0;
    while(seen.size<this.nodes.length){
      let at=-1;
      for(let i=0;i<distance.length;i++)if(!seen.has(i)&&(at<0||distance[i]<distance[at]))at=i;
      if(at<0||at===to||!Number.isFinite(distance[at]))break;
      seen.add(at);
      for(const id of this.nodes[at].edges){
        const edge=this.edges[id];if(at===from&&edge.to===avoidFirst)continue;
        const cost=distance[at]+this.trafficCosts[id];
        if(cost<distance[edge.to]){distance[edge.to]=cost;previous[edge.to]=id;}
      }
    }
    if(!Number.isFinite(distance[to]))return null;
    const result=[];for(let at=to;at!==from;){const id=previous[at];result.unshift(id);at=this.edges[id].from;}
    this.smartRouteCache.set(key,result);return [...result];
  }
  rerouteCars(){
    for(const car of this.cars){
      if(car.state!=='driving'||car.claimed||!car.path.length)continue;
      const edge=this.edges[car.edge];
      // Keep an already claimed turn intact and never turn around mid-road.
      if(edge.length-car.s<=45)continue;
      const path=this.drivingRoute(edge.to,this.lots[car.jobs[car.job].to].node,edge.from);
      if(!path)continue;
      const cost=p=>p.reduce((sum,id)=>sum+this.trafficCosts[id],0),old=cost(car.path),next=cost(path);
      if(next+5<old*.85){car.path=path;this.reroutes++;}
    }
  }
  step(dt=.25){
    this.updateSignals(this.time+dt);
    if(this.time>=this.nextRouting){this.updateTrafficCosts();this.rerouteCars();this.nextRouting=this.time+5;}
    super.step(dt);
  }
  get stats(){return {...super.stats,reroutes:this.reroutes??0,adaptiveSignals:this.adaptiveSignals?.size??0};}
}
