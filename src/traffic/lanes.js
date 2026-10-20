import {crossSection} from '../map/format.js';
import {offsetLine,polylineLength,pointAt} from '../map/geometry.js';

// Lane graph for the traffic model, built from the same geometry the editor draws.
//   lane       one lane of a road in one direction, from junction mouth to junction mouth
//   connector  a path through a junction from one lane to another (one per allowed move)
// Lanes are numbered from the kerb: index 0 is the kerb-side (left) lane. Traffic keeps
// left, so left turns use lane 0 and right turns the lane next to the centre.

const sub=(a,b)=>({x:a.x-b.x,z:a.z-b.z}),norm=a=>{const l=Math.hypot(a.x,a.z)||1;return {x:a.x/l,z:a.z/l};};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export const SPEED={road:11.1,lurus:9,kiri:5.5,kanan:6.5,ring:7};   // m/s (40 km/h on roads)

function withLengths(seg){
  const cum=[0];for(let i=1;i<seg.points.length;i++)cum.push(cum[i-1]+dist(seg.points[i-1],seg.points[i]));
  seg.cum=cum;seg.length=Math.max(cum.at(-1),0.1);return seg;
}
// Position and heading at arc length s along a segment.
export function along(seg,s){
  const pts=seg.points,cum=seg.cum,t=Math.min(Math.max(s,0),seg.length);
  let i=1;while(i<pts.length-1&&cum[i]<t)i++;
  const a=pts[i-1],b=pts[i],l=cum[i]-cum[i-1]||1,k=(t-cum[i-1])/l;
  return {x:a.x+(b.x-a.x)*k,z:a.z+(b.z-a.z)*k,heading:Math.atan2(b.x-a.x,b.z-a.z)};
}

function bezier(p0,t0,p3,t3,samples=12){
  const d=dist(p0,p3)*0.42,c1={x:p0.x+t0.x*d,z:p0.z+t0.z*d},c2={x:p3.x-t3.x*d,z:p3.z-t3.z*d},out=[];
  for(let i=0;i<=samples;i++){const u=i/samples,a=(1-u)**3,b=3*(1-u)**2*u,c=3*(1-u)*u*u,e=u**3;
    out.push({x:a*p0.x+b*c1.x+c*c2.x+e*p3.x,z:a*p0.z+b*c1.z+c*c2.z+e*p3.z});}
  return out;
}
function cross([a,b],[c,d]){
  const r=sub(b,a),s=sub(d,c),den=r.x*s.z-r.z*s.x;if(Math.abs(den)<1e-9)return false;
  const t=((c.x-a.x)*s.z-(c.z-a.z)*s.x)/den,u=((c.x-a.x)*r.z-(c.z-a.z)*r.x)/den;
  return t>0.05&&t<0.95&&u>0.05&&u<0.95;
}
function pathsCross(p,q){
  for(let i=1;i<p.length;i++)for(let k=1;k<q.length;k++)if(cross([p[i-1],p[i]],[q[k-1],q[k]]))return true;
  return false;
}

export function buildLaneGraph(map,geometry){
  const segs=[],byId=new Map(),lanesOf=new Map();   // lanesOf: `${road}:${dir}` -> lanes by index
  const add=seg=>{seg.id=segs.length;segs.push(withLengths(seg));byId.set(seg.id,seg);return seg;};
  for(const gr of geometry.roads){
    const prof=map.profiles[gr.profile],cs=crossSection(prof),[f,b]=prof.lanes,w=prof.laneWidth;
    if(polylineLength(gr.line)<0.5)continue;
    for(const [dir,count] of [[1,f],[-1,b]]){
      const list=[];
      for(let i=0;i<count;i++){
        // Offsets are left of from→to; forward lanes sit left, backward lanes right.
        const offset=dir>0?cs.left-(i+0.5)*w:-(cs.right-(i+0.5)*w);
        let points=offsetLine(gr.line,offset,gr.ends[0],gr.ends[1]);
        if(dir<0)points=[...points].reverse();
        list.push(add({kind:'lane',road:gr.id,dir,index:i,count,points,start:dir>0?gr.from:gr.to,end:dir>0?gr.to:gr.from,next:[],speed:prof.ring?SPEED.ring:SPEED.road,ring:!!prof.ring}));
      }
      list.forEach((l,i)=>{l.left=list[i-1]?.id??null;l.right=list[i+1]?.id??null;});
      lanesOf.set(`${gr.id}:${dir}`,list);
    }
  }
  const incoming=new Map(),outgoing=new Map();
  for(const s of segs){(incoming.get(s.end)||incoming.set(s.end,[]).get(s.end)).push(s);(outgoing.get(s.start)||outgoing.set(s.start,[]).get(s.start)).push(s);}
  const junctionById=new Map(geometry.junctions.map(j=>[j.id,j]));
  const connectors=[],sources=[],sinks=[];
  const degree=new Map();
  for(const r of map.roads)for(const id of [r.from,r.to])degree.set(id,(degree.get(id)||0)+1);

  for(const node of map.nodes){
    const ins=incoming.get(node.id)||[],outs=outgoing.get(node.id)||[],deg=degree.get(node.id)||0;
    if(deg===1){sinks.push(...ins.map(l=>l.id));sources.push(...outs.map(l=>l.id));continue;}
    if(deg===2){
      // A bend: each lane carries on in the lane with the same index (no U-turns).
      for(const l of ins){
        const cont=outs.filter(o=>o.road!==l.road);if(!cont.length)continue;
        const byRoad=new Map();for(const o of cont)(byRoad.get(o.road)||byRoad.set(o.road,[]).get(o.road)).push(o);
        for(const list of byRoad.values()){list.sort((a,b)=>a.index-b.index);l.next.push(list[Math.min(l.index,list.length-1)].id);}
      }
      continue;
    }
    const j=junctionById.get(node.id);if(!j)continue;
    const signalLegs=j.legs.filter(l=>!l.ring);
    const made=[];
    for(const legIn of j.legs){
      // Lanes arriving through this leg end at the node.
      const arriving=ins.filter(l=>l.road===legIn.road&&((l.dir>0)===!legIn.atStart)).sort((a,b)=>a.index-b.index);
      if(!arriving.length)continue;
      for(const legOut of j.legs){
        if(legOut===legIn)continue;
        const leaving=outs.filter(o=>o.road===legOut.road&&((o.dir>0)===legOut.atStart)).sort((a,b)=>a.index-b.index);
        if(!leaving.length)continue;
        const h={x:-legIn.dir.x,z:-legIn.dir.z},o=legOut.dir,dot=h.x*o.x+h.z*o.z,crs=h.x*o.z-h.z*o.x;
        if(dot<-0.9)continue;
        const turn=dot>Math.cos(Math.PI/5)?'lurus':crs<0?'kiri':'kanan';
        // Into a roundabout every lane may enter, onto the ring lane of the same index (the
        // ring has its own lanes; entering is not a turn across traffic).
        const pairs=legOut.ring&&!legIn.ring?arriving.map(l=>[l,leaving[Math.min(l.index,leaving.length-1)]])
          :turn==='kiri'?[[arriving[0],leaving[0]]]
          :turn==='kanan'?[[arriving.at(-1),leaving.at(-1)]]
          :arriving.map(l=>[l,leaving[Math.min(l.index,leaving.length-1)]]);
        for(const [from,to] of pairs){
          const tIn=norm(sub(from.points.at(-1),from.points.at(-2))),tOut=norm(sub(to.points[1],to.points[0]));
          const c=add({kind:'connector',node:node.id,from:from.id,to:to.id,turn,next:[to.id],
            legFrom:signalLegs.indexOf(legIn),legTo:signalLegs.indexOf(legOut),
            points:bezier(from.points.at(-1),tIn,to.points[0],tOut),speed:legIn.ring||legOut.ring?SPEED.ring:SPEED[turn]});
          from.next.push(c.id);made.push(c);
        }
      }
    }
    // Movements that cross or merge into the same lane may not use the junction together.
    for(const c of made)c.conflicts=[];
    for(let a=0;a<made.length;a++)for(let b=a+1;b<made.length;b++){
      const p=made[a],q=made[b];
      if(p.from===q.from)continue;
      if(p.to===q.to||pathsCross(p.points,q.points)){p.conflicts.push(q.id);q.conflicts.push(p.id);}
    }
    connectors.push(...made);
  }
  return {segs,byId,sources,sinks,connectors,lanesOf};
}

// Shortest paths (by travel time) from one segment to every other; a lane change costs a
// few seconds. Returns a function giving the route to a target segment, or null.
const CHANGE_COST=4;
export function routesFrom(graph,start){
  const time=new Map([[start,0]]),prev=new Map(),open=new Set([start]);
  while(open.size){
    let u=null;for(const id of open)if(u===null||time.get(id)<time.get(u))u=id;open.delete(u);
    const seg=graph.byId.get(u),base=time.get(u);
    const edges=seg.next.map(id=>[id,seg.length/seg.speed]);
    // Changing lanes on a short link between close junctions is hard: plan it earlier.
    if(seg.kind==='lane')for(const id of [seg.left,seg.right])if(id!==null)edges.push([id,CHANGE_COST+(seg.length<25?60:0)]);
    for(const [id,cost] of edges){
      const t=base+cost;
      if(t<(time.get(id)??Infinity)){time.set(id,t);prev.set(id,u);open.add(id);}
    }
  }
  const to=target=>{
    if(!time.has(target))return null;
    const route=[target];while(route[0]!==start)route.unshift(prev.get(route[0]));
    return route;
  };
  to.time=target=>time.get(target)??Infinity;   // shortest travel seconds to target
  return to;
}
export {pointAt};
