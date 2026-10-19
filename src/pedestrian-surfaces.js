// Clip walking paths against the road surface, including curved road segments.
// Sidewalk centres are 18 units from the road centre; their half-width is 3.
const ROAD_HALF_WIDTH=14;
export function pedestrianSurfaces(walking,roads){
  const segments=[],seen=new Set();
  for(const road of roads.edges){
    if([road.from,road.to].some(id=>roads.nodes[id].lot&&!roads.nodes[id].external))continue;
    const key=[road.from,road.to].sort((a,b)=>a-b).join(':');
    if(seen.has(key))continue;seen.add(key);
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],length=Math.hypot(b.x-a.x,b.z-a.z);
      if(length)segments.push({a,dx:(b.x-a.x)/length,dz:(b.z-a.z)/length,length});
    }
  }
  const result=[];
  for(const edge of walking.edges){
    if(edge.kind==='boundary')continue;
    for(let i=1;i<edge.points.length;i++){
      const a=edge.points[i-1],b=edge.points[i],intervals=[];
      for(const road of segments){
        const x=a.x-road.a.x,z=a.z-road.a.z,vx=b.x-a.x,vz=b.z-a.z;
        let lo=0,hi=1;
        for(const [origin,delta,min,max] of [
          [x*road.dx+z*road.dz,vx*road.dx+vz*road.dz,0,road.length],
          [-x*road.dz+z*road.dx,-vx*road.dz+vz*road.dx,-ROAD_HALF_WIDTH,ROAD_HALF_WIDTH],
        ]){
          if(Math.abs(delta)<1e-9){if(origin<min||origin>max){hi=-1;break;}}
          else{const t0=(min-origin)/delta,t1=(max-origin)/delta;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
        }
        if(hi-lo>1e-8)intervals.push([lo,hi]);
      }
      intervals.sort((a,b)=>a[0]-b[0]);
      const merged=[];
      for(const range of intervals){
        if(merged.length&&range[0]<=merged.at(-1)[1]+1e-8)merged.at(-1)[1]=Math.max(merged.at(-1)[1],range[1]);
        else merged.push([...range]);
      }
      const point=t=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
      const emit=(lo,hi,kind)=>{if(hi-lo>1e-8)result.push({a:point(lo),b:point(hi),kind});};
      if(edge.kind==='crossing'){emit(0,1,'crossing');continue;}
      let at=0;
      for(const [lo,hi] of merged){emit(at,lo,edge.kind);emit(lo,hi,'crossing');at=hi;}
      emit(at,1,edge.kind);
    }
  }
  return result;
}
