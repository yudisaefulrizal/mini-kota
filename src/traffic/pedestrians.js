import {crossSection} from '../map/format.js';
import {offsetLine,polylineLength} from '../map/geometry.js';
import {along} from './lanes.js';

// Pedestrians on the pavements of a map. They walk along the sidewalks, round the corners
// of junctions and cross at the zebra crossings:
//   with a traffic light  only while the vehicles of that approach have red
//   without one           when no vehicle is about to drive over the crossing
// Vehicles give way to people on (or waiting at) a crossing they would drive over; see
// TrafficEngine.mayEnter.

const left=d=>({x:d.z,z:-d.x});
const add=(a,b,k=1)=>({x:a.x+b.x*k,z:a.z+b.z*k}),norm=a=>{const l=Math.hypot(a.x,a.z)||1;return {x:a.x/l,z:a.z/l};};
const sub=(a,b)=>({x:a.x-b.x,z:a.z-b.z}),dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const CROSS_CHANCE=0.4,GIVE_UP=90,ZEBRA=2;

function withLengths(points){
  const cum=[0];for(let i=1;i<points.length;i++)cum.push(cum[i-1]+dist(points[i-1],points[i]));
  return {points,cum,length:Math.max(cum.at(-1),0.1)};
}
function curve(a,ta,b,tb){
  // Quadratic curve through the meeting point of the two sidewalk directions.
  const den=ta.x*tb.z-ta.z*tb.x,mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
  let c=mid;
  if(Math.abs(den)>0.15){const t=((b.x-a.x)*tb.z-(b.z-a.z)*tb.x)/den,q=add(a,ta,t);if(dist(q,mid)<25)c=q;}
  const out=[];for(let i=0;i<=6;i++){const u=i/6;out.push({x:(1-u)**2*a.x+2*(1-u)*u*c.x+u*u*b.x,z:(1-u)**2*a.z+2*(1-u)*u*c.z+u*u*b.z});}
  return out;
}

export function buildWalkGraph(map,geometry){
  const nodes=[],edges=[];
  const node=p=>{nodes.push({x:p.x,z:p.z,edges:[]});return nodes.length-1;};
  const edge=(a,b,points,extra={})=>{const e={id:edges.length,a,b,...withLengths(points),...extra};edges.push(e);nodes[a].edges.push(e.id);nodes[b].edges.push(e.id);return e;};
  const endsAt=new Map(),degree=new Map();
  for(const r of map.roads)for(const id of [r.from,r.to])degree.set(id,(degree.get(id)||0)+1);
  for(const gr of geometry.roads){
    const prof=map.profiles[gr.profile];
    if(!prof.sidewalk||prof.ring||gr.from===gr.to||polylineLength(gr.line)<4)continue;
    const cs=crossSection(prof),ends={};
    for(const side of [1,-1]){
      const offset=side>0?cs.left+prof.curb+prof.sidewalk/2:-(cs.right+prof.curb+prof.sidewalk/2);
      const pts=offsetLine(gr.line,offset,gr.ends[0],gr.ends[1]);
      const a=node(pts[0]),b=node(pts.at(-1));edge(a,b,pts,{kind:'walk'});
      ends[side]={a,b};
    }
    const t0=norm(sub(gr.line[1],gr.line[0])),t1=norm(sub(gr.line.at(-2),gr.line.at(-1)));
    // Seen from the junction looking down the road (outward): which sidewalk is on which side.
    const push=(id,end)=>(endsAt.get(id)||endsAt.set(id,[]).get(id)).push(end);
    push(gr.from,{road:gr.id,atStart:true,dir:t0,left:ends[1].a,right:ends[-1].a});
    push(gr.to,{road:gr.id,atStart:false,dir:t1,left:ends[-1].b,right:ends[1].b});
  }
  const junctions=new Map(geometry.junctions.map(j=>[j.id,j]));
  for(const [id,list] of endsAt){
    const deg=degree.get(id)||0,j=junctions.get(id);
    if(deg===2&&list.length===2){
      const [a,b]=list;
      edge(a.right,b.left,[nodes[a.right],nodes[b.left]],{kind:'walk'});
      edge(a.left,b.right,[nodes[a.left],nodes[b.right]],{kind:'walk'});
      continue;
    }
    if(deg<3||!j)continue;
    const sorted=[...list].sort((a,b)=>Math.atan2(a.dir.z,a.dir.x)-Math.atan2(b.dir.z,b.dir.x));
    if(sorted.length>=2)sorted.forEach((a,i)=>{
      const b=sorted[(i+1)%sorted.length];if(sorted.length===2&&i===1&&a===b)return;
      const pa=nodes[a.right],pb=nodes[b.left];
      edge(a.right,b.left,curve(pa,{x:-a.dir.x,z:-a.dir.z},pb,{x:-b.dir.x,z:-b.dir.z}),{kind:'corner'});
    });
    // A zebra crossing over each approach, a little back from the junction mouth.
    const signalLegs=j.legs.filter(l=>!l.ring);
    for(const end of list){
      const leg=signalLegs.findIndex(l=>l.road===end.road&&l.atStart===end.atStart);
      if(leg<0||signalLegs[leg].access||signalLegs[leg].internal)continue;   // a simpang gabungan's link has a yellow box, no zebra
      const L=nodes[end.left],R=nodes[end.right];
      edge(end.left,end.right,[L,add(L,end.dir,ZEBRA),add(R,end.dir,ZEBRA),R],{kind:'cross',node:id,leg});
    }
  }
  return {nodes,edges};
}

export class Pedestrians{
  constructor(engine,count){
    this.engine=engine;this.random=engine.random;
    const {nodes,edges}=buildWalkGraph(engine.map,engine.geometry);
    this.nodes=nodes;this.edges=edges;
    this.agents=[];this.crossings=0;this.crossingNow=new Map();this.requests=new Set();this.hot=new Set();
    const walks=edges.filter(e=>e.kind==='walk'&&e.length>5),total=walks.reduce((n,e)=>n+e.length,0);
    if(!walks.length)return;
    for(let i=0;i<count;i++){
      let pick=this.random()*total,e=walks[0];
      for(const w of walks){pick-=w.length;if(pick<=0){e=w;break;}}
      this.agents.push({id:i,edge:e.id,s:this.random()*e.length,forward:this.random()<0.5,speed:1.05+this.random()*0.5,state:'walk',waited:0,
        look:Math.floor(this.random()*3)});
    }
  }
  // Legs (node:leg) where a vehicle is about to drive over, or is driving over, the crossing.
  updateHot(){
    const e=this.engine,hot=new Set();
    for(const v of e.vehicles){
      const seg=e.graph.byId.get(v.route[v.idx]);
      if(seg.kind==='connector'){hot.add(`${seg.node}:${seg.legFrom}`);hot.add(`${seg.node}:${seg.legTo}`);continue;}
      const next=e.graph.byId.get(v.route[v.idx+1]),prev=e.graph.byId.get(v.route[v.idx-1]);
      if(next?.kind==='connector'&&seg.length-v.s<16&&v.v>2)hot.add(`${next.node}:${next.legFrom}`);
      if(prev?.kind==='connector'&&v.s-v.len<6)hot.add(`${prev.node}:${prev.legTo}`);
    }
    this.hot=hot;
  }
  mayCross(edge){
    const e=this.engine,key=`${edge.node}:${edge.leg}`;
    const sig=e.signals.get(edge.node);
    if(sig&&e.signalState(edge.node).legs[edge.leg]!=='red')return false;
    return !this.hot.has(key)&&!e.legBusy(edge.node,edge.leg);
  }
  // Vehicles must not start a move over this crossing.
  blocks(node,leg){
    const key=`${node}:${leg}`;
    return (this.crossingNow.get(key)||0)>0||this.requests.has(key);
  }
  choose(agent,at,from){
    const options=this.nodes[at].edges.filter(id=>id!==from);
    if(!options.length)return from;   // dead end: turn round
    const cross=options.filter(id=>this.edges[id].kind==='cross'),other=options.filter(id=>this.edges[id].kind!=='cross');
    const list=cross.length&&(this.random()<CROSS_CHANCE||!other.length)?cross:other.length?other:cross;
    return list[Math.floor(this.random()*list.length)];
  }
  step(dt){
    this.updateHot();
    const crossing=new Map(),requests=new Set();
    for(const a of this.agents){
      let edge=this.edges[a.edge];
      if(a.state==='wait'){
        if(this.mayCross(edge)){a.state='walk';a.waited=0;}
        else{
          a.waited+=dt;
          if(a.waited>GIVE_UP){a.state='walk';a.waited=0;const at=a.forward?edge.a:edge.b;a.edge=this.choose(a,at,edge.id);edge=this.edges[a.edge];
            if(edge.kind==='cross'){a.state='wait';}a.forward=edge.a===at;a.s=a.forward?0:edge.length;}
          continue;
        }
      }
      // A little quicker on a zebra crossing; `walked` drives the steps in the view.
      const pace=a.speed*(edge.kind==='cross'?1.2:1);
      a.s+=(a.forward?1:-1)*pace*dt;a.walked=(a.walked||0)+pace*dt;
      if(a.s<0||a.s>edge.length){
        if(edge.kind==='cross')this.crossings++;
        const at=a.s>edge.length?edge.b:edge.a,next=this.edges[this.choose(a,at,edge.id)];
        a.edge=next.id;a.forward=next.a===at;a.s=a.forward?0:next.length;
        if(next.kind==='cross')a.state=this.mayCross(next)?'walk':'wait';
      }
    }
    for(const a of this.agents){
      const edge=this.edges[a.edge];if(edge.kind!=='cross')continue;
      const key=`${edge.node}:${edge.leg}`;
      if(a.state==='walk')crossing.set(key,(crossing.get(key)||0)+1);
      else{const sig=this.engine.signals.get(edge.node);if(!sig||this.engine.signalState(edge.node).legs[edge.leg]==='red')requests.add(key);}
    }
    this.crossingNow=crossing;this.requests=requests;
  }
  position(a){
    const edge=this.edges[a.edge],p=along(edge,a.s);
    // Keep to the left of the walking direction so people pass each other.
    const t={x:Math.sin(p.heading),z:Math.cos(p.heading)},side=left(t),k=a.forward?0.35:-0.35;
    return {x:p.x+side.x*k,z:p.z+side.z*k,heading:a.forward?p.heading:p.heading+Math.PI,walking:a.state==='walk',walked:a.walked||0,pace:a.speed*(edge.kind==='cross'?1.2:1)};
  }
  summary(){return {count:this.agents.length,crossings:this.crossings,waiting:this.agents.filter(a=>a.state==='wait').length};}
}
