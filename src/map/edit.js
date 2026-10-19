import {centerline,polylineLength,pointAt} from './geometry.js';

// Editing operations on a map (format.js). Each operation mutates the map passed in;
// the editor keeps undo history as snapshots (History below), so operations stay simple.
// Points are {x,z} in metres.

const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const round=v=>Math.round(v*100)/100;

export function nextId(list,prefix){
  let i=list.length+1;const used=new Set(list.map(o=>o.id));
  while(used.has(`${prefix}${i}`))i++;
  return `${prefix}${i}`;
}

function nodeMap(map){return new Map(map.nodes.map(n=>[n.id,n]));}

export function addNode(map,p){
  const node={id:nextId(map.nodes,'n'),x:round(p.x),z:round(p.z)};
  map.nodes.push(node);return node;
}

// Closest point on a polyline: {point, distance, along (arc length), index (segment)}.
export function projectOnLine(pts,p){
  let best=null,walked=0;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz||1;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l2));
    const q={x:a.x+dx*t,z:a.z+dz*t},d=dist(q,p),seg=Math.sqrt(l2);
    if(!best||d<best.distance)best={point:q,distance:d,along:walked+seg*t,index:i-1};
    walked+=seg;
  }
  return best;
}

export function roadLine(map,road,nodes=nodeMap(map)){return centerline(map,road,nodes);}

// Half the paved width of a road (carriageway only), used so that "near a road" is
// measured from its edge rather than its centre line.
export function halfWidth(map,road){
  const p=map.profiles[road.profile];
  return (p.lanes[0]+p.lanes[1])*p.laneWidth/2+p.median/2;
}

// What a point would attach to: an existing node first, then the body of a road.
// `radius` is measured from the road edge (or from the edge of the widest road at a node).
export function snapTarget(map,p,radius,{exclude=new Set(),excludeNodes=new Set()}={}){
  const nodes=nodeMap(map),widest=new Map();
  for(const r of map.roads)for(const id of [r.from,r.to])widest.set(id,Math.max(widest.get(id)||0,halfWidth(map,r)));
  let best=null;
  for(const n of map.nodes){
    if(excludeNodes.has(n.id))continue;
    const d=dist(n,p);
    if(d<=radius+(widest.get(n.id)||0)&&(!best||d<best.distance))best={type:'node',id:n.id,point:{x:n.x,z:n.z},distance:d};
  }
  if(best)return best;
  for(const r of map.roads){
    if(exclude.has(r.id))continue;
    const line=roadLine(map,r,nodes),hit=projectOnLine(line,p);
    // Ends of a road are its nodes, already handled above.
    if(hit&&hit.distance<=radius+halfWidth(map,r)&&hit.along>1&&hit.along<polylineLength(line)-1&&(!best||hit.distance<best.distance))
      best={type:'road',id:r.id,point:hit.point,distance:hit.distance};
  }
  return best;
}

// Splits a road at the point on it closest to p; returns the new middle node.
// Spline control points stay on the side of the split they belong to.
export function splitRoad(map,roadId,p){
  const road=map.roads.find(r=>r.id===roadId),line=roadLine(map,road),hit=projectOnLine(line,p);
  const node=addNode(map,hit.point);
  const at=pt=>projectOnLine(line,{x:pt[0],z:pt[1]}).along;
  const before=(road.points||[]).filter(pt=>at(pt)<hit.along-0.01),after=(road.points||[]).filter(pt=>at(pt)>hit.along+0.01);
  const second={...structuredClone(road),id:nextId(map.roads,'r'),from:node.id,points:after};
  road.to=node.id;road.points=before;
  map.roads.splice(map.roads.indexOf(road)+1,0,second);
  return node;
}

// Resolves a snap target into a node id (creating or splitting as needed).
export function attach(map,target,p){
  if(target?.type==='node')return target.id;
  if(target?.type==='road')return splitRoad(map,target.id,target.point).id;
  return addNode(map,p).id;
}

// Adds a road through `points` (first and last become nodes). Snap targets for the
// ends are resolved here so a road can start on another road (making a junction).
export function addRoad(map,points,{profile,shape='spline',startTarget=null,endTarget=null}={}){
  if(points.length<2)throw Error('Jalan membutuhkan minimal dua titik.');
  const from=attach(map,startTarget,points[0]);
  const end=endTarget?.type==='road'&&endTarget.id===startTarget?.id?snapTarget(map,endTarget.point,0.5):endTarget;
  const to=attach(map,end,points.at(-1));
  if(from===to)throw Error('Ujung jalan tidak boleh di simpul yang sama.');
  const road={id:nextId(map.roads,'r'),from,to,profile,shape,points:points.slice(1,-1).map(p=>[round(p.x),round(p.z)])};
  map.roads.push(road);return road;
}

export function moveNode(map,id,p){const n=map.nodes.find(n=>n.id===id);n.x=round(p.x);n.z=round(p.z);}
export function movePoint(map,roadId,index,p){map.roads.find(r=>r.id===roadId).points[index]=[round(p.x),round(p.z)];}

// Inserts a control point where p projects onto the road, keeping the point order.
export function insertPoint(map,roadId,p){
  const road=map.roads.find(r=>r.id===roadId),nodes=nodeMap(map);
  const ctrl=[nodes.get(road.from),...(road.points||[]).map(([x,z])=>({x,z})),nodes.get(road.to)];
  const hit=projectOnLine(ctrl,p);
  road.points=road.points||[];
  road.points.splice(hit.index,0,[round(p.x),round(p.z)]);
  return hit.index;
}
export function deletePoint(map,roadId,index){map.roads.find(r=>r.id===roadId).points.splice(index,1);}

// Removes roads and any node left without roads (gate nodes are kept).
export function deleteRoad(map,roadId){
  map.roads=map.roads.filter(r=>r.id!==roadId);
  removeOrphans(map);
}
export function deleteNode(map,id){
  map.roads=map.roads.filter(r=>r.from!==id&&r.to!==id);
  map.nodes=map.nodes.filter(n=>n.id!==id);
  removeOrphans(map);
}
function removeOrphans(map){
  const used=new Set([...map.roads.flatMap(r=>[r.from,r.to]),...map.gates.map(g=>g.node)]);
  map.nodes=map.nodes.filter(n=>used.has(n.id));
}
export function setProfile(map,roadId,profile){map.roads.find(r=>r.id===roadId).profile=profile;}
export function setShape(map,roadId,shape){map.roads.find(r=>r.id===roadId).shape=shape;}

// Nearest road to p within radius (for clicking on a road), using its drawn width.
export function pickRoad(map,p,extra=1.5){
  const nodes=nodeMap(map);let best=null;
  for(const r of map.roads){
    const half=halfWidth(map,r),hit=projectOnLine(roadLine(map,r,nodes),p);
    if(hit&&hit.distance<=half+extra&&(!best||hit.distance<best.distance))best={id:r.id,distance:hit.distance,point:hit.point};
  }
  return best;
}

// Freehand strokes: drop points that add no shape (Ramer–Douglas–Peucker).
export function simplify(points,epsilon=1.5){
  if(points.length<3)return points;
  const keep=new Array(points.length).fill(false);keep[0]=keep[points.length-1]=true;
  const stack=[[0,points.length-1]];
  while(stack.length){
    const [a,b]=stack.pop();let index=-1,max=0;
    for(let i=a+1;i<b;i++){const d=projectOnLine([points[a],points[b]],points[i]).distance;if(d>max){max=d;index=i;}}
    if(max>epsilon){keep[index]=true;stack.push([a,index],[index,b]);}
  }
  return points.filter((_,i)=>keep[i]);
}

// Length along a road's drawn centre line (handy for the info panel).
export function roadLength(map,road){return polylineLength(roadLine(map,road));}
export {pointAt};

// Undo/redo by snapshots: every edit is one step, automatic fixes included.
export class History{
  constructor(limit=100){this.undoStack=[];this.redoStack=[];this.limit=limit;}
  record(map){this.undoStack.push(JSON.stringify(map));if(this.undoStack.length>this.limit)this.undoStack.shift();this.redoStack=[];}
  undo(map){if(!this.undoStack.length)return null;this.redoStack.push(JSON.stringify(map));return JSON.parse(this.undoStack.pop());}
  redo(map){if(!this.redoStack.length)return null;this.undoStack.push(JSON.stringify(map));return JSON.parse(this.redoStack.pop());}
  get canUndo(){return this.undoStack.length>0;}
  get canRedo(){return this.redoStack.length>0;}
}

// ---------------------------------------------------------------- placed assets (objects)
export function addObject(map,asset,placed){
  const object={id:nextId(map.objects,'o'),asset,x:round(placed.x),z:round(placed.z),rotation:Math.round(placed.rotation||0)};
  map.objects.push(object);return object;
}
export function moveObject(map,id,placed){
  const o=map.objects.find(o=>o.id===id);o.x=round(placed.x);o.z=round(placed.z);
  if(placed.rotation!==undefined)o.rotation=Math.round(placed.rotation);
}
export function rotateObject(map,id,degrees){const o=map.objects.find(o=>o.id===id);o.rotation=Math.round((((o.rotation||0)+degrees)%360+360)%360);}
export function deleteObject(map,id){
  map.objects=map.objects.filter(o=>o.id!==id);
  for(const o of map.objects)if(o.gateway===id)delete o.gateway;
}
// gatewayId null = automatic (nearest gateway).
export function setGateway(map,id,gatewayId){const o=map.objects.find(o=>o.id===id);if(gatewayId)o.gateway=gatewayId;else delete o.gateway;}
export function pickObject(map,p,radius){
  let best=null;
  for(const o of map.objects){const d=dist(o,p);if(d<=radius&&(!best||d<best.d))best={id:o.id,d};}
  return best;
}
