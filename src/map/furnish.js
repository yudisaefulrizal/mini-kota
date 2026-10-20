import {crossSection} from './format.js';
import {buildGeometry,pointAt,polylineLength} from './geometry.js';
import {projectOnLine} from './edit.js';
import {facing,cameraSpots,reachOf} from './placement.js';

// Fills a map with assets automatically: traffic lights, CCTV and controllers at signalised
// junctions, buildings in the lots, street lights and trees along the roads, bus stops,
// bin sensors, as few gateways as reach all of them, and a few people. Existing objects are kept and nothing
// is placed on top of them. Deterministic for a given seed.

const left=d=>({x:d.z,z:-d.x}),right=d=>({x:-d.z,z:d.x});
const add=(a,b,k=1)=>({x:a.x+b.x*k,z:a.z+b.z*k}),norm=a=>{const l=Math.hypot(a.x,a.z)||1;return {x:a.x/l,z:a.z/l};};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const round=v=>Math.round(v*100)/100;
const armTowards=d=>Math.atan2(-d.z,d.x)*180/Math.PI;
function rng(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}

// Footprints in metres [width, depth] of the asset models (front faces +Z), and clear radius.
export const FOOTPRINT={house:[9,11.7],'house-two-storey':[8,10.5],shophouse:[13.8,13.6],office:[22,24],school:[45.2,20.4],
  campus:[47,24],mall:[64,43],factory:[42,27],'data-center':[33.5,28.5],tps3r:[28,28.3]};
const RADIUS={'traffic-light':0.8,'traffic-light-arm':1,'traffic-light-arrow-right':0.8,'pedestrian-light':0.6,controller:1,'cctv-dome':0.8,cctv:0.8,
  gateway:0.6,'bin-sensor':1,'street-light':0.8,'bus-stop':3.5,bench:1,'tree-shade':3,'tree-column':1.4,'tree-palm':2.5,shrub:1,person:0.5,'person-walking':0.5,'person-carrying-bag':0.5};

const KINDS=[[/home|rumah|permukiman|resid/i,'home'],[/school|sekolah/i,'school'],[/univ|kampus|campus/i,'campus'],[/industr|pabrik|factory/i,'industry'],
  [/business|bisnis|kantor|office/i,'business'],[/shop|belanja|mall|pasar/i,'shop'],[/data/i,'datacenter'],[/waste|tps|sampah/i,'waste'],
  [/park|taman/i,'park'],[/center|pusat/i,'center']];
export const lotKind=lot=>KINDS.find(([re])=>re.test(`${lot.id} ${lot.name||''}`))?.[1]||'home';
// What each kind of lot holds: one main building, or a row of repeated ones.
const LOT_PLAN={home:{fill:['house','house-two-storey']},school:{single:'school'},campus:{single:'campus'},industry:{single:'factory'},
  business:{fill:['office']},shop:{single:'mall',fallback:['shophouse']},datacenter:{single:'data-center'},waste:{single:'tps3r'},
  center:{fill:['office','shophouse']},park:{park:true}};
const BUS_STOP_KINDS=new Set(['school','campus','shop','business','center']);
const BIN_KINDS={home:3,shop:2,school:1,campus:1,business:1,center:2,park:1};

export function furnish(input,{seed=7,signals=true,buildings=true,street=true}={}){
  const map=input,geometry=buildGeometry(map),random=rng(seed),before=[...map.objects];
  const placed=map.objects.map(o=>({x:o.x,z:o.z,r:RADIUS[o.asset]??(FOOTPRINT[o.asset]?Math.max(...FOOTPRINT[o.asset])/2:1)}));
  const rects=map.objects.filter(o=>FOOTPRINT[o.asset]).map(o=>rectOf(o.asset,o,o.rotation||0));
  const added={};
  const nodes=new Map(map.nodes.map(n=>[n.id,n]));
  const roads=map.roads.map(r=>{const prof=map.profiles[r.profile],gr=geometry.roads.find(g=>g.id===r.id);return {r,prof,cs:crossSection(prof),gr};}).filter(x=>x.gr);

  // Distance from p to the paved area (carriageway, kerb and pavement) of any road.
  const clearOfRoads=(p,margin=0)=>roads.every(({cs,prof,gr})=>projectOnLine(gr.line,p).distance>Math.max(cs.left,cs.right)+prof.curb+prof.sidewalk+margin);
  const onRoad=p=>roads.some(({cs,gr})=>projectOnLine(gr.line,p).distance<Math.max(cs.left,cs.right)+0.3);
  const inLot=(p,m=0)=>map.lots.some(l=>p.x>l.x-m&&p.x<l.x+l.w+m&&p.z>l.z-m&&p.z<l.z+l.d+m);
  const inRect=p=>rects.some(q=>p.x>q.x0&&p.x<q.x1&&p.z>q.z0&&p.z<q.z1);
  const free=(p,r)=>placed.every(q=>dist(q,p)>q.r+r)&&!inRect(p);
  const put=(asset,p,rotation,{force=false,extra={}}={})=>{
    const r=RADIUS[asset]??1;
    if(!force&&!free(p,r))return null;
    if(onRoad(p))return null;   // never on a carriageway (e.g. a lot entrance right beside a junction)
    const object={id:nextObjectId(map),asset,x:round(p.x),z:round(p.z),rotation:Math.round(((rotation%360)+360)%360),...extra};
    map.objects.push(object);placed.push({x:p.x,z:p.z,r});added[asset]=(added[asset]||0)+1;return object;
  };

  // ---------------------------------------------------------------- junctions
  const gatewaySpots=[];   // a corner of each equipped junction, where a gateway may go
  if(signals)for(const j of geometry.junctions){
    const node=nodes.get(j.id);if(node?.signal!==true||j.legs.some(l=>l.ring))continue;
    // Already equipped by hand: a light stands at one of its approaches.
    const reach=Math.max(...j.legs.map(l=>l.setback))+12;
    if(before.some(o=>/^traffic-light/.test(o.asset)&&dist(o,j)<reach))continue;
    const arrow=/panah/.test(node.signalPlan?.pattern||'');
    // A simpang gabungan has one set of devices, at its first junction; the link between
    // its junctions gets no lights (vehicles there are not stopped again).
    const member=j.cluster&&j.cluster!==j.id;
    for(const leg of j.legs){
      if(leg.internal)continue;
      if(leg.access)continue;
      const kerb=leg.curb+(leg.sidewalk>0?leg.sidewalk*0.6:1);
      const asset=arrow?'traffic-light-arrow-right':leg.lanes>=2?'traffic-light-arm':'traffic-light';
      // Along the road itself (it may curve away from the mouth); at a sharp fork the usual
      // spot can fall on the next road, so step back along the kerb.
      const gr=geometry.roads.find(r=>r.id===leg.road),outward=gr?(leg.atStart?gr.line:[...gr.line].reverse()):null;
      const spot=(back,side,offset)=>{
        if(!outward)return {p:add(add(j,leg.dir,leg.setback+back),side(leg.dir),offset),t:leg.dir};
        const at=pointAt(outward,Math.min(back,polylineLength(outward)));return {p:add(at.p,side(at.t),offset),t:at.t};
      };
      for(const back of [6,10,14,18]){const {p,t}=spot(back,right,leg.right+kerb);if(put(asset,p,facing(t),{force:true}))break;}
      for(const back of [2,5,8]){const {p,t}=spot(back,left,leg.left+kerb);if(put('pedestrian-light',p,facing(right(t)),{force:true}))break;}
      // One camera per outer approach, across the junction, facing the arriving traffic.
      for(const c of cameraSpots(j,leg,80,geometry))if(put('cctv',c,c.rotation))break;
    }
    const corners=cornersOf(j);
    const at=(i,asset)=>{const c=corners[i%corners.length];if(c)put(asset,c.at,facing({x:-c.bis.x,z:-c.bis.z}),{force:true});};
    if(!member){at(0,'controller');const c=corners[1%corners.length];if(c)gatewaySpots.push({at:c.at,rotation:facing({x:-c.bis.x,z:-c.bis.z})});}
  }

  // ---------------------------------------------------------------- lots
  const nearestRoadPoint=p=>{
    let best=null;
    for(const x of roads){
      if(x.prof.access||x.prof.ring)continue;
      const hit=projectOnLine(x.gr.line,p),length=polylineLength(x.gr.line);
      let along=0;for(let i=1;i<=hit.index;i++)along+=dist(x.gr.line[i-1],x.gr.line[i]);
      along+=dist(x.gr.line[hit.index],hit.point);
      if(!best||hit.distance<best.distance)best={...x,distance:hit.distance,along,length};
    }
    return best;
  };
  // A spot on the pavement (or just behind it) of the road nearest to p, on p's side.
  const vergeSpot=(p,{shift=0,behind=false}={})=>{
    const near=nearestRoadPoint(p);if(!near||near.length<20)return null;
    const d=Math.min(Math.max(near.along+shift,9),near.length-9),{p:q,t}=pointAt(near.gr.line,d);
    const side=((p.x-q.x)*left(t).x+(p.z-q.z)*left(t).z)>=0?1:-1,out=side>0?left(t):right(t);
    const half=side>0?near.cs.left:near.cs.right;
    const offset=half+near.prof.curb+(behind?near.prof.sidewalk+1.2:Math.max(near.prof.sidewalk,1.2)*0.6);
    return {at:add(q,out,offset),toRoad:{x:-out.x,z:-out.z},along:t};
  };

  if(buildings||street)for(const lot of map.lots){
    const kind=lotKind(lot),center={x:lot.x+lot.w/2,z:lot.z+lot.d/2};
    if(street&&BUS_STOP_KINDS.has(kind)){
      const spot=vergeSpot(center);
      if(spot&&put('bus-stop',spot.at,facing(spot.toRoad))){
        const back={x:-spot.toRoad.x,z:-spot.toRoad.z};
        put('person',add(add(spot.at,spot.along,2),back,-0.6),facing(spot.toRoad));
        put('person-carrying-bag',add(add(spot.at,spot.along,-1.5),back,-0.8),facing(spot.along));
      }
    }
    if(street&&BIN_KINDS[kind]){
      const n=BIN_KINDS[kind],step=Math.min(18,Math.max(lot.w,lot.d)/(n+1));
      let bins=0;
      for(let i=0;i<n;i++){const spot=vergeSpot(center,{shift:(i-(n-1)/2)*step+7});if(spot&&put('bin-sensor',spot.at,facing(spot.toRoad)))bins++;}
    }
    if(!buildings)continue;
    const plan=LOT_PLAN[kind];
    if(plan.park){fillPark(lot);continue;}
    const toward=frontOf(center);
    if(plan.single){
      if(!placeSingle(lot,plan.single,toward)&&plan.fallback)fillRow(lot,plan.fallback,toward);
    }else fillRow(lot,plan.fill,toward);
  }

  function frontOf(center){
    const near=nearestRoadPoint(center);if(!near)return {x:0,z:1};
    const hit=projectOnLine(near.gr.line,center),d=norm({x:hit.point.x-center.x,z:hit.point.z-center.z});
    // Snap to the nearest compass direction so rows line up with the lot.
    return Math.abs(d.x)>Math.abs(d.z)?{x:Math.sign(d.x),z:0}:{x:0,z:Math.sign(d.z)||1};
  }
  function fits(asset,p,rotation){
    const q=rectOf(asset,p,rotation);
    const samples=[];for(const fx of [0,0.5,1])for(const fz of [0,0.5,1])samples.push({x:q.x0+(q.x1-q.x0)*fx,z:q.z0+(q.z1-q.z0)*fz});
    return samples.every(s=>clearOfRoads(s,0.5))&&placed.every(o=>o.x<q.x0-o.r||o.x>q.x1+o.r||o.z<q.z0-o.r||o.z>q.z1+o.r)
      &&rects.every(o=>q.x1<=o.x0||q.x0>=o.x1||q.z1<=o.z0||q.z0>=o.z1);
  }
  function putBuilding(asset,p,rotation){
    const object={id:nextObjectId(map),asset,x:round(p.x),z:round(p.z),rotation:Math.round(((rotation%360)+360)%360)};
    map.objects.push(object);rects.push(rectOf(asset,p,rotation));added[asset]=(added[asset]||0)+1;return object;
  }
  function placeSingle(lot,asset,toward){
    // Front towards the road if it fits that way, otherwise turned a quarter (side to the road).
    const center={x:lot.x+lot.w/2,z:lot.z+lot.d/2},spots=[];
    for(let dx=-12;dx<=12;dx+=2)for(let dz=-12;dz<=12;dz+=2)spots.push({x:center.x+dx,z:center.z+dz});
    spots.sort((a,b)=>dist(a,center)-dist(b,center));
    for(const dir of [toward,right(toward),left(toward)]){
      const rotation=facing(dir),q=rectOf(asset,{x:0,z:0},rotation);
      if(q.x1-q.x0>lot.w+6||q.z1-q.z0>lot.d+6)continue;
      const spot=spots.find(s=>fits(asset,s,rotation));
      if(spot){putBuilding(asset,spot,rotation);return true;}
    }
    return false;
  }
  function fillRow(lot,assets,toward){
    const rotation=facing(toward),sizes=assets.map(a=>{const q=rectOf(a,{x:0,z:0},rotation);return [q.x1-q.x0,q.z1-q.z0];});
    const cw=Math.max(...sizes.map(s=>s[0]))+2,cd=Math.max(...sizes.map(s=>s[1]))+2;
    const nx=Math.max(1,Math.floor(lot.w/cw)),nz=Math.max(1,Math.floor(lot.d/cd));
    const x0=lot.x+(lot.w-nx*cw)/2+cw/2,z0=lot.z+(lot.d-nz*cd)/2+cd/2;
    let k=0;
    for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
      const asset=assets[k++%assets.length],p={x:x0+ix*cw,z:z0+iz*cd};
      if(fits(asset,p,rotation))putBuilding(asset,p,rotation);
    }
  }
  function fillPark(lot){
    const trees=['tree-shade','tree-shade','tree-palm','tree-column'];
    for(let z=lot.z+5;z<lot.z+lot.d-3;z+=11)for(let x=lot.x+5;x<lot.x+lot.w-3;x+=11){
      const p={x:x+(random()-0.5)*4,z:z+(random()-0.5)*4};
      if(clearOfRoads(p,2))put(trees[Math.floor(random()*trees.length)],p,Math.floor(random()*360));
    }
    const c={x:lot.x+lot.w/2,z:lot.z+lot.d/2};
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2,p=add(c,{x:Math.cos(a),z:Math.sin(a)},6);
      if(clearOfRoads(p,1))put('bench',p,facing({x:c.x-p.x,z:c.z-p.z}));
    }
    for(let i=0;i<3;i++){const p={x:lot.x+lot.w*(0.25+0.25*i),z:c.z+(i-1)*3};if(clearOfRoads(p,1))put(i===1?'person':'person-walking',p,Math.floor(random()*360));}
    for(let i=0;i<8;i++){const p={x:lot.x+3+random()*(lot.w-6),z:lot.z+3+random()*(lot.d-6)};if(clearOfRoads(p,1))put('shrub',p,Math.floor(random()*360));}
  }

  // ---------------------------------------------------------------- gateways
  // As few as possible: junction corners are tried, the one reaching the most cameras and
  // controllers not yet reached first, until every one is within cable reach. Then LoRaWAN
  // modules go on the fewest gateways that hear every bin sensor.
  const gateways=()=>map.objects.filter(o=>o.asset==='gateway'),{cable:CABLE_REACH,lora:LORA_REACH}=reachOf(map);
  let open=map.objects.filter(o=>/^cctv/.test(o.asset)||o.asset==='controller').filter(o=>!o.gateway&&!gateways().some(g=>dist(g,o)<=CABLE_REACH));
  while(open.length){
    let best=null;
    for(const s of gatewaySpots){const k=open.filter(o=>dist(o,s.at)<=CABLE_REACH).length;if(k&&(!best||k>best.k))best={s,k};}
    if(!best)break;
    put('gateway',best.s.at,best.s.rotation,{force:true});gatewaySpots.splice(gatewaySpots.indexOf(best.s),1);
    open=open.filter(o=>dist(o,best.s.at)>CABLE_REACH);
  }
  const bins=map.objects.filter(o=>o.asset==='bin-sensor');
  if(bins.length){
    const middle={x:bins.reduce((a,b)=>a+b.x,0)/bins.length,z:bins.reduce((a,b)=>a+b.z,0)/bins.length};
    if(!gateways().length){const spot=vergeSpot(middle,{behind:true});if(spot)put('gateway',spot.at,facing(spot.toRoad));}
    let deaf=bins.filter(b=>!gateways().some(g=>g.lora&&dist(g,b)<=LORA_REACH));
    while(deaf.length){
      let best=null;
      for(const g of gateways())if(!g.lora){const k=deaf.filter(b=>dist(g,b)<=LORA_REACH).length,d=dist(g,middle);if(k&&(!best||k>best.k||(k===best.k&&d<best.d)))best={g,k,d};}
      if(!best)break;
      best.g.lora=true;added['lora']=(added['lora']||0)+1;
      deaf=deaf.filter(b=>dist(best.g,b)>LORA_REACH);
    }
  }

  // ---------------------------------------------------------------- along roads
  if(street){
    const degree=new Map();for(const r of map.roads)for(const id of [r.from,r.to])degree.set(id,(degree.get(id)||0)+1);
    for(const {r,prof,cs,gr} of roads){
      if(prof.access||prof.ring)continue;
      const length=polylineLength(gr.line);if(length<24)continue;
      // Keep clear of junction mouths; road ends at the map edge need less room.
      const startClear=(degree.get(r.from)||0)>=3?14:6,endClear=(degree.get(r.to)||0)>=3?14:6;
      let side=1;
      for(let d=startClear+4;d<=length-endClear;d+=36,side=-side){
        const {p,t}=pointAt(gr.line,d),out=side>0?left(t):right(t),half=side>0?cs.left:cs.right;
        const at=add(p,out,half+prof.curb+0.5);
        if(!inLot(at)&&!onRoad(at))put('street-light',at,armTowards({x:-out.x,z:-out.z}));
      }
      for(let d=startClear+18;d<=length-endClear;d+=26){
        for(const s of [1,-1]){
          const {p,t}=pointAt(gr.line,d+(s>0?0:9)),out=s>0?left(t):right(t),half=s>0?cs.left:cs.right;
          const at=add(p,out,half+prof.curb+prof.sidewalk+2.2);
          if(inLot(at,1)||!clearOfRoads(at,1))continue;
          put(random()<0.7?'tree-shade':'tree-column',at,Math.floor(random()*360));
        }
      }
    }
  }
  return {added,total:Object.values(added).reduce((a,b)=>a+b,0)};
}

// Corners between neighbouring legs of a junction, on the pavement.
function cornersOf(j){
  const legs=[...j.legs].sort((a,b)=>Math.atan2(a.dir.z,a.dir.x)-Math.atan2(b.dir.z,b.dir.x)),out=[];
  legs.forEach((a,i)=>{
    const b=legs[(i+1)%legs.length],bis=norm(add(a.dir,b.dir));
    let angle=Math.atan2(b.dir.z,b.dir.x)-Math.atan2(a.dir.z,a.dir.x);if(angle<=0)angle+=Math.PI*2;
    if(angle>=Math.PI*0.98||a.access||b.access)return;
    const kerb=l=>l.curb+(l.sidewalk>0?l.sidewalk*0.6:1);
    const clear=Math.max(a.right+kerb(a),b.left+kerb(b))+1.5;
    out.push({at:add(j,bis,clear/Math.max(Math.sin(angle/2),0.3)),bis});
  });
  return out;
}
function rectOf(asset,p,rotation){
  const [w,d]=FOOTPRINT[asset]||[2,2],quarter=Math.round(((rotation%360)+360)%360/90)%2===1;
  const hw=(quarter?d:w)/2,hd=(quarter?w:d)/2;
  return {x0:p.x-hw,x1:p.x+hw,z0:p.z-hd,z1:p.z+hd};
}
// Faster than edit.nextId for many additions: one scan per call is fine for a few hundred.
function nextObjectId(map){
  let max=0;for(const o of map.objects){const m=/^o(\d+)$/.exec(o.id);if(m)max=Math.max(max,+m[1]);}
  return `o${max+1}`;
}
