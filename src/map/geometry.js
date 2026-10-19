import {crossSection} from './format.js';

// Turns a map (format.js) into flat geometry: ribbons (two edge polylines), polygons and
// quads, each tagged with a kind (asphalt, sidewalk, marking). No three.js here, so it is
// testable in Node; mesh.js converts the result into meshes.
//
// Conventions: points are {x,z} in metres. For a direction d, left = (d.z, -d.x) and
// right = (-d.z, d.x). Offsets are positive to the left. Traffic keeps left (Indonesia).

const DASH=3,GAP=5,LINE=0.15,STOP=0.4;
const ZEBRA_FROM=0.5,ZEBRA_TO=3.5,STOP_AT=4.5,MARK_CLEAR=5.5;   // metres from the junction mouth
const SIDEWALK_HEIGHT=0.15;
// Two signalised junctions joined by a link shorter than this (between the mouths) are run
// as one junction (simpang gabungan): one controller, no stop line or zebra on the link,
// a yellow box instead (keep clear). A node with signalPlan.separate opts out.
export const CLUSTER_LINK=20;

const sub=(a,b)=>({x:a.x-b.x,z:a.z-b.z}),add=(a,b)=>({x:a.x+b.x,z:a.z+b.z}),mul=(a,k)=>({x:a.x*k,z:a.z*k});
const len=a=>Math.hypot(a.x,a.z),norm=a=>{const l=len(a)||1;return {x:a.x/l,z:a.z/l};};
const left=d=>({x:d.z,z:-d.x});
const cross=(a,b)=>a.x*b.z-a.z*b.x;

export function polylineLength(pts){let s=0;for(let i=1;i<pts.length;i++)s+=len(sub(pts[i],pts[i-1]));return s;}

// Point and unit tangent at arc length d from the start.
export function pointAt(pts,d){
  let walked=0;
  for(let i=1;i<pts.length;i++){
    const seg=sub(pts[i],pts[i-1]),l=len(seg);
    if(walked+l>=d||i===pts.length-1){const t=l?Math.min(1,Math.max(0,(d-walked)/l)):0;return {p:add(pts[i-1],mul(seg,t)),t:norm(seg)};}
    walked+=l;
  }
  return {p:pts[0],t:{x:1,z:0}};
}

// Sub-polyline between arc lengths a and b.
export function cut(pts,a,b){
  const out=[pointAt(pts,a).p];let walked=0;
  for(let i=1;i<pts.length;i++){walked+=len(sub(pts[i],pts[i-1]));if(walked>a&&walked<b)out.push(pts[i]);}
  out.push(pointAt(pts,b).p);
  return out.filter((p,i)=>!i||len(sub(p,out[i-1]))>1e-6);
}

function catmullRom(pts,spacing=2){
  if(pts.length<3)return pts;
  const ext=[sub(mul(pts[0],2),pts[1]),...pts,sub(mul(pts.at(-1),2),pts.at(-2))],out=[pts[0]];
  for(let i=1;i<ext.length-2;i++){
    const [p0,p1,p2,p3]=[ext[i-1],ext[i],ext[i+1],ext[i+2]],steps=Math.max(2,Math.ceil(len(sub(p2,p1))/spacing));
    for(let s=1;s<=steps;s++){
      const t=s/steps,t2=t*t,t3=t2*t;
      const f=(a,b,c,d)=>0.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);
      out.push({x:f(p0.x,p1.x,p2.x,p3.x),z:f(p0.z,p1.z,p2.z,p3.z)});
    }
  }
  return out;
}

export function centerline(map,road,nodes){
  const pts=[nodes.get(road.from),...(road.points||[]).map(([x,z])=>({x,z})),nodes.get(road.to)].map(p=>({x:p.x,z:p.z}));
  return road.shape==='spline'?catmullRom(pts):pts;
}

// Offset polyline with mitred joints. startT/endT override the end tangents so that two
// roads meeting at a bend share exactly the same cross-section.
export function offsetLine(pts,offset,startT=null,endT=null){
  const n=pts.length;
  return pts.map((p,i)=>{
    const tPrev=i>0?norm(sub(p,pts[i-1])):null,tNext=i<n-1?norm(sub(pts[i+1],p)):null;
    let t;
    if(i===0&&startT)t=startT;else if(i===n-1&&endT)t=endT;
    else if(tPrev&&tNext){t=norm(add(tPrev,tNext));const k=Math.max(0.35,tPrev.x*t.x+tPrev.z*t.z);return add(p,mul(left(t),offset/k));}
    else t=tPrev||tNext;
    return add(p,mul(left(t),offset));
  });
}

function dashes(line,width,dash=DASH,gap=GAP){
  // Quads along a line: dash length, then gap. Each dash follows the polyline.
  const total=polylineLength(line),out=[];
  for(let d=gap/2;d<total;d+=dash+gap){
    const seg=cut(line,d,Math.min(total,d+dash));
    if(polylineLength(seg)>0.3)out.push({kind:'marking',left:offsetLine(seg,width/2),right:offsetLine(seg,-width/2)});
  }
  return out;
}

function quadAt(pts,along,across,lengthAlong,widthAcross){
  // Rectangle centred `across` metres to the left of the line, from `along` to along+length.
  const a=pointAt(pts,along),b=pointAt(pts,along+lengthAlong),n=left(a.t),h=widthAcross/2;
  const pa=add(a.p,mul(n,across)),pb=add(b.p,mul(n,across));
  return {kind:'marking',points:[add(pa,mul(n,h)),add(pb,mul(n,h)),add(pb,mul(n,-h)),add(pa,mul(n,-h))]};
}

function corner(pa,da,pb,db,samples=8){
  // Curve from pa (edge running along da) to pb (along db), bending towards their crossing.
  const det=cross(da,db);
  if(Math.abs(det)<0.08)return [pa,pb];
  const d=sub(pb,pa),s=cross(d,db)/det,t=cross(d,da)/det;
  if(s>0||t>0)return [pa,pb];
  const c=add(pa,mul(da,s)),out=[];
  for(let i=0;i<=samples;i++){const u=i/samples,a=(1-u)*(1-u),b=2*(1-u)*u,e=u*u;out.push({x:a*pa.x+b*c.x+e*pb.x,z:a*pa.z+b*c.z+e*pb.z});}
  return out;
}

export function buildGeometry(map){
  const nodes=new Map(map.nodes.map(n=>[n.id,n])),warnings=[];
  const roads=map.roads.map(r=>{
    const profile=map.profiles[r.profile],line=centerline(map,r,nodes);
    return {road:r,profile,cs:crossSection(profile),line,length:polylineLength(line),setback:[0,0],tangent:[null,null]};
  });
  // Incident arms per node, with the direction pointing away from the node.
  const arms=new Map(map.nodes.map(n=>[n.id,[]]));
  for(const g of roads){
    const out0=norm(sub(g.line[1],g.line[0])),out1=norm(sub(g.line.at(-2),g.line.at(-1)));
    for(const [atStart,id,dir] of [[true,g.road.from,out0],[false,g.road.to,out1]]){
      const side=atStart?{left:g.cs.left,right:g.cs.right}:{left:g.cs.right,right:g.cs.left};
      const outer=g.profile.curb+g.profile.sidewalk;
      arms.get(id).push({g,atStart,dir,angle:Math.atan2(dir.z,dir.x),left:side.left,right:side.right,outer,access:!!g.profile.access,ring:!!g.profile.ring});
    }
  }
  const junctions=[];
  for(const [id,list] of arms){
    const node=nodes.get(id);
    if(list.length===2){
      // Bend: both roads share the bisecting cross-section.
      const [a,b]=list,T=norm(sub(b.dir,a.dir));
      for(const [arm,u] of [[a,mul(T,-1)],[b,T]])arm.g.tangent[arm.atStart?0:1]=arm.atStart?u:mul(u,-1);
      if(a.g.road.profile!==b.g.road.profile)warnings.push({type:'profile',message:`Profil berbeda bersambung di ${id}; peralihan lajur belum dibentuk.`,at:node});
      continue;
    }
    if(list.length<3)continue;
    list.sort((p,q)=>p.angle-q.angle);
    const widest=arm=>Math.max(arm.left,arm.right)+arm.outer;
    list.forEach((arm,i)=>{
      const prev=list[(i+list.length-1)%list.length],next=list[(i+1)%list.length];
      const gap=a=>{let d=a;while(d<=0)d+=Math.PI*2;return d;};
      const minAngle=Math.min(gap(arm.angle-prev.angle),gap(next.angle-arm.angle));
      if(minAngle<Math.PI/7)warnings.push({type:'angle',message:`Sudut lengan di ${id} sangat lancip (${Math.round(minAngle*180/Math.PI)}°).`,at:node});
      const others=Math.max(...list.filter(o=>o!==arm).map(widest));
      arm.setback=others/Math.max(Math.sin(Math.min(minAngle,Math.PI/2)),0.4)+1;
    });
    junctions.push({node,arms:list});
  }
  // Apply setbacks; keep at least 10% of a road between two junctions.
  for(const j of junctions)for(const arm of j.arms)arm.g.setback[arm.atStart?0:1]=arm.setback;
  for(const g of roads){
    const need=g.setback[0]+g.setback[1];
    if(need>g.length*0.9){
      // A stub to a dead end (a lot entrance) may simply be taken up by the junction mouth.
      const between=g.setback[0]>0&&g.setback[1]>0;
      const k=g.length*0.9/need;g.setback=g.setback.map(s=>s*k);
      if(between)warnings.push({type:'short',road:g.road.id,message:`Jalan ${g.road.id} terlalu pendek di antara simpang (${g.length.toFixed(1)} m).`,at:pointAt(g.line,g.length/2).p});
    }
    g.trimmed=cut(g.line,g.setback[0],g.length-g.setback[1]);
    const [ts,te]=[g.setback[0]?null:g.tangent[0],g.setback[1]?null:g.tangent[1]];
    g.ends=[ts,te];
    const p=g.profile;
    g.edges={
      left:offsetLine(g.trimmed,g.cs.left,ts,te),right:offsetLine(g.trimmed,-g.cs.right,ts,te),
      walkLeft:offsetLine(g.trimmed,g.cs.left+p.curb+p.sidewalk,ts,te),walkRight:offsetLine(g.trimmed,-(g.cs.right+p.curb+p.sidewalk),ts,te),
    };
  }

  // Clustered signals: links shorter than CLUSTER_LINK between two signalised junctions.
  const isJunction=new Set(junctions.map(j=>j.node.id));
  const joinable=id=>nodes.get(id)?.signal===true&&isJunction.has(id)&&!nodes.get(id).signalPlan?.separate;
  const internal=new Set(roads.filter(g=>g.road.from!==g.road.to&&joinable(g.road.from)&&joinable(g.road.to)&&!g.profile.access&&!g.profile.ring
    &&polylineLength(g.trimmed)<CLUSTER_LINK).map(g=>g.road.id));
  const parent=new Map();
  const find=id=>{while(parent.get(id)&&parent.get(id)!==id)id=parent.get(id);return id;};
  for(const g of roads)if(internal.has(g.road.id)){
    const a=find(g.road.from),b=find(g.road.to);parent.set(a,a);parent.set(b,b);
    if(a!==b)parent.set(a<b?b:a,a<b?a:b);
  }
  const groups=new Map();
  for(const id of parent.keys()){const root=find(id);(groups.get(root)||groups.set(root,[]).get(root)).push(id);}
  const clusters=[...groups.values()].map(list=>{const ids=[...list].sort();return {id:ids[0],nodes:ids,roads:roads.filter(g=>internal.has(g.road.id)&&ids.includes(g.road.from)).map(g=>g.road.id)};});
  const clusterOf=new Map(clusters.flatMap(c=>c.nodes.map(id=>[id,c.id])));
  // Inside a simpang gabungan a short link is intended, not a problem to report.
  for(let i=warnings.length-1;i>=0;i--)if(warnings[i].type==='short'&&internal.has(warnings[i].road))warnings.splice(i,1);

  const ribbons=[],polygons=[],quads=[];
  for(const g of roads){
    const p=g.profile,e=g.edges;
    ribbons.push({kind:'asphalt',left:e.left,right:e.right});
    if(p.sidewalk>0){
      ribbons.push({kind:'sidewalk',left:e.walkLeft,right:e.left,height:SIDEWALK_HEIGHT});
      ribbons.push({kind:'sidewalk',left:e.right,right:e.walkRight,height:SIDEWALK_HEIGHT});
    }
    if(p.access)continue;
    // Lane markings stop short of junction mouths so they do not cross the zebra.
    const a=g.setback[0]?MARK_CLEAR:0,b=g.length-g.setback[0]-g.setback[1]-(g.setback[1]?MARK_CLEAR:0);
    if(b-a<2)continue;
    const mid=cut(g.trimmed,a,b),[fwd,back]=p.lanes,w=p.laneWidth;
    if(fwd&&back){
      if(p.median>0)for(const o of [p.median/2,-p.median/2])ribbons.push({kind:'marking',left:offsetLine(mid,o+LINE/2),right:offsetLine(mid,o-LINE/2)});
      else ribbons.push(...dashes(offsetLine(mid,0),LINE));
      for(let k=1;k<fwd;k++)ribbons.push(...dashes(offsetLine(mid,g.cs.center+k*w),LINE));
      for(let k=1;k<back;k++)ribbons.push(...dashes(offsetLine(mid,-(g.cs.center+k*w)),LINE));
    }else{
      const n=fwd||back;for(let k=1;k<n;k++)ribbons.push(...dashes(offsetLine(mid,g.cs.left-k*w),LINE));
    }
    if(p.sidewalk>0)for(const o of [g.cs.left-0.3,-(g.cs.right-0.3)])ribbons.push({kind:'marking',left:offsetLine(mid,o+LINE/2),right:offsetLine(mid,o-LINE/2)});
  }

  for(const j of junctions){
    const mouths=j.arms.map(arm=>{
      const e=arm.g.edges,i=arm.atStart?0:e.left.length-1;
      return arm.atStart?{L:e.left[i],R:e.right[i],WL:e.walkLeft[i],WR:e.walkRight[i]}:{L:e.right[i],R:e.left[i],WL:e.walkRight[i],WR:e.walkLeft[i]};
    });
    const outline=[];
    j.arms.forEach((arm,i)=>{
      const k=(i+1)%j.arms.length,next=j.arms[k],m=mouths[i],n=mouths[k];
      const curve=corner(m.R,arm.dir,n.L,next.dir);
      outline.push(m.L,m.R,...curve.slice(1,-1));
      if(arm.outer>0||next.outer>0){
        // Pavement around the corner, between the kerb line and the outer walkway edge.
        const outerCurve=corner(m.WR,arm.dir,n.WL,next.dir),count=Math.max(curve.length,outerCurve.length);
        const resample=c=>Array.from({length:count},(_,s)=>pointAt(c,polylineLength(c)*s/(count-1)).p);
        ribbons.push({kind:'sidewalk',left:resample(curve),right:resample(outerCurve),height:SIDEWALK_HEIGHT,corner:true});
      }
    });
    polygons.push({kind:'asphalt',points:outline,node:j.node.id});
    // Zebra crossing and stop line on each public arm of a real junction.
    const publicArms=j.arms.filter(a=>!a.access);
    if(publicArms.length<3)continue;
    for(const arm of publicArms){
      if(arm.ring||internal.has(arm.g.road.id))continue;   // the link inside a cluster is a yellow box
      // `path` runs outward from the junction mouth; offsets are left of that direction.
      const g=arm.g,path=arm.atStart?g.trimmed:[...g.trimmed].reverse();
      if(polylineLength(path)<STOP_AT+1)continue;
      for(let u=-arm.right+0.4;u<arm.left-0.4;u+=1)quads.push({...quadAt(path,ZEBRA_FROM,u+0.25,ZEBRA_TO-ZEBRA_FROM,0.5),zebra:true});
      const [fwd,back]=g.profile.lanes;
      let from,to;
      if(fwd&&back){
        // Traffic heading into the junction keeps left of its own direction, which is the
        // right-hand side of the outward path: from the kerb up to the centre divider.
        from=-arm.right+0.2;to=-g.cs.center-0.1;
      }else{
        // One-way: a stop line only where the flow enters the junction, across all lanes.
        const enters=fwd?!arm.atStart:arm.atStart;
        if(!enters)continue;
        from=-arm.right+0.2;to=arm.left-0.2;
      }
      if(to-from>0.5)quads.push(quadAt(path,STOP_AT,(from+to)/2,STOP,to-from));
    }
  }
  // Yellow box ("kotak kuning", keep clear) over each internal link, reaching 2 m into
  // both junction mouths: an outline and diagonal hatching.
  for(const g of roads){
    if(!internal.has(g.road.id))continue;
    const s0=Math.max(0,g.setback[0]-2),s1=Math.min(g.length,g.length-g.setback[1]+2),L=s1-s0;
    if(L<1)continue;
    const at=(s,u)=>{const a=pointAt(g.line,s0+Math.max(0,Math.min(L,s)));return add(a.p,mul(left(a.t),u));};
    const bar=(p,q,w=0.18)=>{const d=norm(sub(q,p)),n=mul(left(d),w/2);quads.push({kind:'marking',box:true,points:[add(p,n),add(q,n),sub(q,n),sub(p,n)]});};
    const lo=-g.cs.right+0.3,hi=g.cs.left-0.3;
    for(const [s,t] of [[0,0],[L,L]])bar(at(s,lo),at(t,hi));
    for(const u of [lo,hi])for(let s=0;s<L;s+=1)bar(at(s,u),at(Math.min(L,s+1),u));
    const W=hi-lo;
    for(let k=-W;k<L;k+=1.6){
      // Two diagonals through (k, lo): rising and falling, clipped to the box.
      const s0a=Math.max(0,k),s1a=Math.min(L,k+W);if(s1a-s0a>0.3)bar(at(s0a,lo+(s0a-k)),at(s1a,lo+(s1a-k)),0.14);
      const s0b=Math.max(0,k),s1b=Math.min(L,k+W);if(s1b-s0b>0.3)bar(at(s0b,hi-(s0b-k)),at(s1b,hi-(s1b-k)),0.14);
    }
  }
  // Per-leg data lets other modules (asset placement) find kerbs and approaches.
  const legs=j=>j.arms.map(a=>({road:a.g.road.id,profile:a.g.road.profile,lanes:Math.min(...a.g.profile.lanes.filter(n=>n>0)),atStart:a.atStart,dir:a.dir,left:a.left,right:a.right,curb:a.g.profile.curb,sidewalk:a.g.profile.sidewalk,setback:a.setback,access:a.access,ring:a.ring,internal:internal.has(a.g.road.id)}));
  // Trimmed centre lines (between junction mouths) let the traffic model lay lanes exactly
  // where they are drawn; `ends` are the shared tangents at bends (null at junctions).
  const roadLines=roads.map(g=>({id:g.road.id,from:g.road.from,to:g.road.to,profile:g.road.profile,line:g.trimmed,ends:g.ends,setback:g.setback,length:g.length}));
  return {roads:roadLines,ribbons,polygons,quads,junctions:junctions.map(j=>({id:j.node.id,x:j.node.x,z:j.node.z,arms:j.arms.length,signal:!!j.node.signal,cluster:clusterOf.get(j.node.id)||null,legs:legs(j)})),clusters,warnings,
    stats:{nodes:map.nodes.length,roads:map.roads.length,junctions:junctions.length,km:roads.reduce((s,g)=>s+g.length,0)/1000}};
}
