import {crossSection} from './format.js';
import {projectOnLine,roadLine} from './edit.js';

// Smart placement for assets dropped on the map (docs/rancangan-editor-peta.md, tahap 4).
// Given the asset, the cursor and the built geometry, returns where the asset should stand
// and which way it faces. Rotation is in degrees about the vertical axis; 0 means the
// asset's front (+Z) points south (+z). Traffic keeps left (Indonesia).

const deg=r=>r*180/Math.PI;
const left=d=>({x:d.z,z:-d.x}),right=d=>({x:-d.z,z:d.x});
const add=(a,b,k=1)=>({x:a.x+b.x*k,z:a.z+b.z*k}),norm=a=>{const l=Math.hypot(a.x,a.z)||1;return {x:a.x/l,z:a.z/l};};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const round=v=>Math.round(v*100)/100;
// Rotation that turns the asset front (+Z) towards direction d.
export const facing=d=>deg(Math.atan2(d.x,d.z));
// Rotation that turns the asset's +X axis (e.g. a lamp arm) towards direction d.
const armTowards=d=>deg(Math.atan2(-d.z,d.x));

// How each asset is placed. Categories give the default; specific ids override.
export const PLACEMENT_RULES={
  'traffic-light':'approach','traffic-light-arm':'approach','traffic-light-arrow-right':'approach','traffic-light-arrow-left':'approach',
  'warning-light':'approach','sign-left-turn':'approach-sign','pedestrian-light':'crossing',
  cctv:'verge-watch','cctv-dome':'corner',controller:'corner',gateway:'corner','bin-sensor':'verge-face',
  'street-light':'verge-arm','bus-stop':'verge-face',bench:'verge-face',
  buildings:'lot',nature:'verge-back',people:'sidewalk',vehicles:'lane',
};
export function ruleFor(asset){return PLACEMENT_RULES[asset.id]||PLACEMENT_RULES[asset.category]||'free';}

const kerb=leg=>leg.curb+(leg.sidewalk>0?leg.sidewalk*0.6:1.0);

function nearestJunction(geometry,p,max){
  let best=null;
  for(const j of geometry.junctions){const d=dist(j,p);if(d<=max&&(!best||d<best.d))best={j,d};}
  return best?.j||null;
}
function nearestLeg(j,p){
  let best=null;
  for(const leg of j.legs){if(leg.access||leg.ring)continue;const mouth=add(j,leg.dir,leg.setback),d=dist(mouth,p);if(!best||d<best.d)best={leg,d};}
  return best?.leg||null;
}
function nearestRoad(map,p,max){
  let best=null;
  for(const r of map.roads){
    const line=roadLine(map,r),hit=projectOnLine(line,p);
    if(hit.distance>max||(best&&hit.distance>=best.hit.distance))continue;
    const a=line[Math.min(hit.index,line.length-2)],b=line[Math.min(hit.index+1,line.length-1)];
    best={road:r,hit,t:norm({x:b.x-a.x,z:b.z-a.z})};
  }
  return best;
}

function onVerge(map,p,{max=30,behind=false,sidewalkMiddle=false}={}){
  const near=nearestRoad(map,p,max);if(!near)return null;
  const prof=map.profiles[near.road.profile],cs=crossSection(prof),q=near.hit.point,t=near.t;
  const side=((p.x-q.x)*left(t).x+(p.z-q.z)*left(t).z)>=0?1:-1;
  const half=side>0?cs.left:cs.right,leg={curb:prof.curb,sidewalk:prof.sidewalk};
  const offset=half+(behind?leg.curb+leg.sidewalk+1.5:sidewalkMiddle?leg.curb+Math.max(prof.sidewalk,1.2)/2:kerb(leg));
  const outward=side>0?left(t):right(t);
  return {road:near.road,point:add(q,outward,offset),toRoad:{x:-outward.x,z:-outward.z},t,side,prof,cs,q};
}

function onCarriageway(map,pt){
  return map.roads.some(r=>{const cs=crossSection(map.profiles[r.profile]);return projectOnLine(roadLine(map,r),pt).distance<Math.max(cs.left,cs.right);});
}

export function smartPlace(map,geometry,asset,p){
  const rule=ruleFor(asset);
  const placed=place(map,geometry,asset,p,rule);
  // Safety net: a junction or corner position that still lands on asphalt (e.g. a curved
  // leg) falls back to the nearest kerb.
  if(rule!=='lane'&&rule!=='lot'&&rule!=='free'&&onCarriageway(map,placed)){
    const verge=onVerge(map,p);
    if(verge)return {x:round(verge.point.x),z:round(verge.point.z),rotation:Math.round(((facing(verge.toRoad)%360)+360)%360),label:`Di tepi jalan ${verge.road.id}`};
  }
  return placed;
}

function place(map,geometry,asset,p,rule){
  const result=(point,rotation,label)=>({x:round(point.x),z:round(point.z),rotation:Math.round(((rotation%360)+360)%360),label});

  if(rule==='approach'||rule==='approach-sign'||rule==='crossing'){
    const j=nearestJunction(geometry,p,45),leg=j&&nearestLeg(j,p);
    if(leg){
      // The pole stands on the approaching driver's left kerb, which is the right-hand
      // side of the leg seen from the junction; the lamps face the approaching traffic.
      const side=right(leg.dir);
      if(rule==='crossing'){
        const at=add(add(j,leg.dir,leg.setback+2),side,leg.right+kerb(leg));
        return result(at,facing(left(leg.dir)),`Di zebra cross simpang ${j.id}`);
      }
      const back=rule==='approach-sign'?11:6;
      const at=add(add(j,leg.dir,leg.setback+back),side,leg.right+kerb(leg));
      return result(at,facing(leg.dir),`Di pendekat simpang ${j.id}`);
    }
  }
  if(rule==='corner'){
    const j=nearestJunction(geometry,p,45);
    if(j&&j.legs.length>=2){
      // Corner between two neighbouring legs, on the pavement, facing the junction.
      const legs=[...j.legs].sort((a,b)=>Math.atan2(a.dir.z,a.dir.x)-Math.atan2(b.dir.z,b.dir.x));
      let best=null;
      legs.forEach((a,i)=>{
        const b=legs[(i+1)%legs.length],bis=norm(add(a.dir,b.dir));
        let angle=Math.atan2(b.dir.z,b.dir.x)-Math.atan2(a.dir.z,a.dir.x);if(angle<=0)angle+=Math.PI*2;
        if(angle>=Math.PI*0.98)return;   // a straight run has no corner on this side
        const clear=Math.max(a.right+kerb(a),b.left+kerb(b))+1.5;
        const at=add(j,bis,clear/Math.max(Math.sin(angle/2),0.3));
        const d=dist(at,p);if(!best||d<best.d)best={at,bis,d};
      });
      if(best)return result(best.at,facing({x:-best.bis.x,z:-best.bis.z}),`Di sudut simpang ${j.id}`);
    }
  }
  if(rule==='lot'){
    const lot=map.lots.find(l=>p.x>=l.x&&p.x<=l.x+l.w&&p.z>=l.z&&p.z<=l.z+l.d);
    const at=lot?{x:lot.x+lot.w/2,z:lot.z+lot.d/2}:p;
    const near=nearestRoad(map,at,120);
    const rotation=near?facing(norm({x:near.hit.point.x-at.x,z:near.hit.point.z-at.z})):0;
    return result(at,rotation,lot?`Di kawasan ${lot.name}`:near?'Menghadap jalan terdekat':'Bebas');
  }
  if(rule==='lane'){
    const near=nearestRoad(map,p,25);
    if(near){
      const prof=map.profiles[near.road.profile],cs=crossSection(prof),q=near.hit.point,t=near.t;
      const side=((p.x-q.x)*left(t).x+(p.z-q.z)*left(t).z)>=0?1:-1;
      // Left half carries traffic along the road direction; the first lane is next to the divider.
      const offset=(prof.lanes[1]===0||prof.lanes[0]===0)?0:cs.center+prof.laneWidth/2;
      const at=add(q,side>0?left(t):right(t),offset);
      return result(at,facing(side>0?t:{x:-t.x,z:-t.z}),`Di lajur jalan ${near.road.id}`);
    }
  }
  const verge=rule.startsWith('verge')||rule==='sidewalk'||rule==='approach'||rule==='approach-sign'||rule==='crossing'||rule==='corner'
    ?onVerge(map,p,{behind:rule==='verge-back',sidewalkMiddle:rule==='sidewalk'}):null;
  if(verge){
    const label=`Di tepi jalan ${verge.road.id}`;
    if(rule==='verge-watch')return result(verge.point,facing(verge.side>0?{x:-verge.t.x,z:-verge.t.z}:verge.t),label);
    if(rule==='verge-arm')return result(verge.point,armTowards(verge.toRoad),label);
    if(rule==='sidewalk')return result(verge.point,facing(verge.t),`Di trotoar jalan ${verge.road.id}`);
    if(rule==='verge-back')return result(verge.point,0,label);
    return result(verge.point,facing(verge.toRoad),label);
  }
  return result(p,0,'Bebas');
}

// Sensors report to a gateway: the one chosen by hand, otherwise the nearest one.
export const SENSOR_ASSETS=new Set(['cctv','cctv-dome','bin-sensor','controller']);
export function gatewayOf(map,object){
  if(!SENSOR_ASSETS.has(object.asset))return null;
  if(object.gateway)return {id:object.gateway,auto:false};
  let best=null;
  for(const g of map.objects)if(g.asset==='gateway'){const d=dist(g,object);if(!best||d<best.d)best={id:g.id,d};}
  return best?{id:best.id,auto:true,distance:best.d}:null;
}
