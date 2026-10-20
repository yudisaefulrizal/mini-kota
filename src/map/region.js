// The city's area and its gates, worked out from what is on the map: there is no fixed
// rectangle. The area is the convex polygon around every road, lot and asset, widened by
// REGION_MARGIN; drawing a road further out widens it. Road ends are of three kinds:
//   gate     a road end on the edge of the city: traffic from and to outside enters here
//   kawasan  the end of an access road (into a school, housing, offices…): vehicles come
//            and go there too
//   dead end any other end (a cul-de-sac): a road like any other, no vehicle appears there
// A road end is on the edge when, continuing straight out of it, nothing else on the map
// (another road or a lot) is in the way.
export const REGION_MARGIN=30;
const EMPTY={x0:0,z0:0,width:600,depth:400};

function convexHull(points){
  const p=[...points].sort((a,b)=>a.x-b.x||a.z-b.z),cross=(o,a,b)=>(a.x-o.x)*(b.z-o.z)-(a.z-o.z)*(b.x-o.x);
  if(p.length<3)return p;
  const lower=[],upper=[];
  for(const q of p){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),q)<=0)lower.pop();lower.push(q);}
  for(const q of [...p].reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),q)<=0)upper.pop();upper.push(q);}
  return [...lower.slice(0,-1),...upper.slice(0,-1)];
}
// Each road as a polyline of its nodes and control points.
function roadLines(map){
  const nodes=new Map(map.nodes.map(n=>[n.id,n]));
  return map.roads.map(r=>{
    const a=nodes.get(r.from),b=nodes.get(r.to);
    return {road:r,line:[a,...(r.points||[]).map(([x,z])=>({x,z})),b].filter(Boolean)};
  });
}

// {hull: polygon [{x,z}] (counter-clockwise in x/z), box: {x0, z0, width, depth}}.
export function cityRegion(map){
  const pts=[];
  for(const {line} of roadLines(map))pts.push(...line);
  for(const l of map.lots||[])pts.push({x:l.x,z:l.z},{x:l.x+l.w,z:l.z},{x:l.x,z:l.z+l.d},{x:l.x+l.w,z:l.z+l.d});
  for(const o of map.objects||[])pts.push(o);
  if(!pts.length){const {x0,z0,width,depth}=EMPTY;return {hull:[{x:x0,z:z0},{x:x0+width,z:z0},{x:x0+width,z:z0+depth},{x:x0,z:z0+depth}],box:{...EMPTY}};}
  // Widen: a ring of points around each corner of the tight hull, then wrap again.
  const wide=[];
  for(const q of convexHull(pts))for(let i=0;i<16;i++){const a=i/16*Math.PI*2;wide.push({x:q.x+Math.cos(a)*REGION_MARGIN,z:q.z+Math.sin(a)*REGION_MARGIN});}
  const hull=convexHull(wide),xs=hull.map(p=>p.x),zs=hull.map(p=>p.z);
  const x0=Math.min(...xs),z0=Math.min(...zs);
  return {hull,box:{x0,z0,width:Math.max(...xs)-x0,depth:Math.max(...zs)-z0}};
}

// Does the ray from p in direction d (unit) cross segment a–b?
function rayHits(p,d,a,b){
  const e={x:b.x-a.x,z:b.z-a.z},den=d.x*e.z-d.z*e.x;if(Math.abs(den)<1e-9)return false;
  const w={x:a.x-p.x,z:a.z-p.z},t=(w.x*e.z-w.z*e.x)/den,u=(w.x*d.z-w.z*d.x)/den;
  return t>0.5&&u>=0&&u<=1;
}
// Road ends by kind: {gates:[{id, name, node, x, z}], kawasan:Set(nodeIds), deadEnds:Set(nodeIds)}.
export function roadEnds(map){
  const lines=roadLines(map),degree=new Map();
  for(const r of map.roads)for(const id of [r.from,r.to])degree.set(id,(degree.get(id)||0)+1);
  const walls=[];
  for(const {road,line} of lines)for(let i=1;i<line.length;i++)walls.push({road:road.id,a:line[i-1],b:line[i]});
  for(const l of map.lots||[]){const c=[{x:l.x,z:l.z},{x:l.x+l.w,z:l.z},{x:l.x+l.w,z:l.z+l.d},{x:l.x,z:l.z+l.d}];for(let i=0;i<4;i++)walls.push({road:null,a:c[i],b:c[(i+1)%4]});}
  const gates=[],kawasan=new Set(),deadEnds=new Set();
  for(const {road,line} of lines){
    for(const atStart of [true,false]){
      const id=atStart?road.from:road.to;if(degree.get(id)!==1||line.length<2)continue;
      if(map.profiles?.[road.profile]?.access){kawasan.add(id);continue;}
      const end=atStart?line[0]:line.at(-1),before=atStart?line[1]:line.at(-2);
      const len=Math.hypot(end.x-before.x,end.z-before.z)||1,d={x:(end.x-before.x)/len,z:(end.z-before.z)/len};
      const blocked=walls.some(w=>w.road!==road.id&&rayHits(end,d,w.a,w.b));
      if(blocked)deadEnds.add(id);else gates.push({node:id,x:end.x,z:end.z});
    }
  }
  // Named around the city clockwise, starting from the north.
  const cx=gates.reduce((s,g)=>s+g.x,0)/(gates.length||1),cz=gates.reduce((s,g)=>s+g.z,0)/(gates.length||1);
  const bearing=g=>(Math.atan2(g.x-cx,-(g.z-cz))+Math.PI*2)%(Math.PI*2);
  gates.sort((a,b)=>bearing(a)-bearing(b));
  return {gates:gates.map((g,i)=>({id:`gerbang${i+1}`,name:`Gerbang ${i+1}`,...g})),kawasan,deadEnds};
}

// Is p inside the city's area?
export function insideRegion(region,p){
  const h=region.hull;let inside=false;
  for(let i=0,j=h.length-1;i<h.length;j=i++){
    const a=h[i],b=h[j];
    if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside;
}
