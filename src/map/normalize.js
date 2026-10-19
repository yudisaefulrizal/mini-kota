import {polylineLength} from './geometry.js';
import {roadLine,splitRoad,snapTarget,halfWidth} from './edit.js';

// Automatic tidying after an edit (docs/rancangan-editor-peta.md, "Aturan normalisasi").
// Rules only look at the roads and nodes in `scope` (what the edit touched), so editing
// one corner never rearranges the rest of the map. Pass scope=null to tidy everything.
//
//   crossing      two roads cross without a node      -> split both, one shared node (+)
//   node-merge    two nodes closer than nodeMerge     -> one node
//   attach        a loose road end beside a road body -> T-junction
//   junction-gap  two junctions joined by a very short road -> one junction
//   short-road    a tiny road between two nodes      -> collapsed; a tiny dead-end spur is removed

export const NORMALIZE_DEFAULTS={nodeMerge:4,attach:2,junctionGap:10,shortRoad:5,endClearance:1.5};

const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const round=v=>Math.round(v*100)/100;

function degree(map,id){return map.roads.filter(r=>r.from===id||r.to===id).length;}
function isGate(map,id){return map.gates.some(g=>g.node===id);}

// Moves every road end from `drop` to `keep`, removes roads that collapse onto one node.
export function mergeNodes(map,keepId,dropId,at=null){
  if(keepId===dropId)return;
  for(const r of map.roads){if(r.from===dropId)r.from=keepId;if(r.to===dropId)r.to=keepId;}
  map.roads=map.roads.filter(r=>r.from!==r.to);
  for(const g of map.gates)if(g.node===dropId)g.node=keepId;
  const keep=map.nodes.find(n=>n.id===keepId),drop=map.nodes.find(n=>n.id===dropId);
  if(drop?.signal)keep.signal=true;
  if(at){keep.x=round(at.x);keep.z=round(at.z);}
  map.nodes=map.nodes.filter(n=>n.id!==dropId);
}

function segmentHit(a,b,c,d){
  const r={x:b.x-a.x,z:b.z-a.z},s={x:d.x-c.x,z:d.z-c.z},den=r.x*s.z-r.z*s.x;
  if(Math.abs(den)<1e-9)return null;
  const t=((c.x-a.x)*s.z-(c.z-a.z)*s.x)/den,u=((c.x-a.x)*r.z-(c.z-a.z)*r.x)/den;
  return t>=0&&t<=1&&u>=0&&u<=1?{x:a.x+r.x*t,z:a.z+r.z*t,t,u}:null;
}

// First crossing between two centre lines away from both roads' ends.
function crossing(map,ra,rb,clearance){
  const la=roadLine(map,ra),lb=roadLine(map,rb);
  const lenA=polylineLength(la),lenB=polylineLength(lb);
  let walkedA=0;
  for(let i=1;i<la.length;i++){
    const segA=dist(la[i-1],la[i]);let walkedB=0;
    for(let j=1;j<lb.length;j++){
      const segB=dist(lb[j-1],lb[j]),hit=segmentHit(la[i-1],la[i],lb[j-1],lb[j]);
      if(hit){
        const alongA=walkedA+segA*hit.t,alongB=walkedB+segB*hit.u;
        if(alongA>clearance&&alongA<lenA-clearance&&alongB>clearance&&alongB<lenB-clearance)return {x:hit.x,z:hit.z};
      }
      walkedB+=segB;
    }
    walkedA+=segA;
  }
  return null;
}

export function normalize(map,scope=null,options={}){
  const o={...NORMALIZE_DEFAULTS,...options},changes=[];
  const roads=new Set(scope?.roads??map.roads.map(r=>r.id)),nodes=new Set(scope?.nodes??map.nodes.map(n=>n.id));
  const inRoads=id=>roads.has(id),touch=(...ids)=>ids.forEach(id=>roads.add(id));
  const nodeOf=id=>map.nodes.find(n=>n.id===id);
  const addSplitRoads=before=>{for(const r of map.roads)if(!before.has(r.id))roads.add(r.id);};

  for(let pass=0;pass<20;pass++){
    let changed=false;

    // Crossings: split both roads at the crossing and join them in one node.
    outer:for(const a of map.roads){
      if(!inRoads(a.id))continue;
      for(const b of map.roads){
        if(a===b)continue;
        const hit=crossing(map,a,b,o.endClearance);if(!hit)continue;
        const before=new Set(map.roads.map(r=>r.id));
        const na=splitRoad(map,a.id,hit),nb=splitRoad(map,b.id,hit);
        mergeNodes(map,na.id,nb.id,hit);
        addSplitRoads(before);touch(a.id,b.id);nodes.add(na.id);
        changes.push({type:'crossing',message:'Jalan bersilangan dijadikan perempatan.',at:hit});
        changed=true;break outer;
      }
    }
    if(changed)continue;

    // Nodes very close together become one (the busier node keeps its place).
    for(const id of [...nodes]){
      const n=nodeOf(id);if(!n)continue;
      const other=map.nodes.find(m=>m.id!==id&&dist(m,n)<=o.nodeMerge);
      if(!other)continue;
      const [keep,drop]=degree(map,other.id)>=degree(map,id)?[other,n]:[n,other];
      mergeNodes(map,keep.id,drop.id);nodes.add(keep.id);
      for(const r of map.roads)if(r.from===keep.id||r.to===keep.id)roads.add(r.id);
      changes.push({type:'node-merge',message:'Dua simpul berdekatan digabung.',at:{x:keep.x,z:keep.z}});
      changed=true;break;
    }
    if(changed)continue;

    // A loose road end just beside another road attaches to it (T-junction).
    for(const id of [...nodes]){
      const n=nodeOf(id);if(!n||degree(map,id)!==1||isGate(map,id))continue;
      const own=new Set(map.roads.filter(r=>r.from===id||r.to===id).map(r=>r.id));
      const target=snapTarget(map,n,o.attach,{exclude:own,excludeNodes:new Set([id])});
      if(target?.type!=='road')continue;
      const before=new Set(map.roads.map(r=>r.id));
      const joint=splitRoad(map,target.id,target.point);
      mergeNodes(map,joint.id,id,target.point);
      addSplitRoads(before);nodes.add(joint.id);nodes.delete(id);
      changes.push({type:'attach',message:'Ujung jalan ditempelkan ke jalan di sebelahnya.',at:target.point});
      changed=true;break;
    }
    if(changed)continue;

    // Very short roads: between two junctions they merge the junctions; elsewhere they collapse.
    for(const r of map.roads){
      if(!inRoads(r.id))continue;
      const length=polylineLength(roadLine(map,r)),da=degree(map,r.from),db=degree(map,r.to);
      const junctions=da>=3&&db>=3;
      if(length>=(junctions?o.junctionGap:o.shortRoad))continue;
      if(isGate(map,r.from)||isGate(map,r.to))continue;
      if(da===1||db===1){
        map.roads=map.roads.filter(x=>x!==r);
        map.nodes=map.nodes.filter(n=>degree(map,n.id)>0||isGate(map,n.id));
        changes.push({type:'short-road',message:'Potongan jalan yang sangat pendek dihapus.',at:nodeOf(r.from)||nodeOf(r.to)});
      }else{
        const a=nodeOf(r.from),b=nodeOf(r.to),mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
        const [keep,drop]=da>=db?[a,b]:[b,a];
        mergeNodes(map,keep.id,drop.id,mid);nodes.add(keep.id);
        for(const x of map.roads)if(x.from===keep.id||x.to===keep.id)roads.add(x.id);
        changes.push({type:junctions?'junction-gap':'short-road',message:junctions?'Dua simpang yang terlalu dekat digabung.':'Ruas yang sangat pendek digabung.',at:mid});
      }
      changed=true;break;
    }
    if(!changed)break;
  }
  return changes;
}

// Which roads and nodes differ between two snapshots: the scope of an edit.
export function editScope(before,after){
  const key=o=>JSON.stringify(o);
  const oldRoads=new Map(before.roads.map(r=>[r.id,key(r)])),oldNodes=new Map(before.nodes.map(n=>[n.id,key(n)]));
  const roads=after.roads.filter(r=>oldRoads.get(r.id)!==key(r)).map(r=>r.id);
  const nodes=after.nodes.filter(n=>oldNodes.get(n.id)!==key(n)).map(n=>n.id);
  for(const r of after.roads)if(roads.includes(r.id))nodes.push(r.from,r.to);
  return {roads,nodes:[...new Set(nodes)]};
}

// Short summary for the status line, e.g. "2 perempatan dibuat, 1 simpul digabung".
export function describeChanges(changes){
  const count=t=>changes.filter(c=>c.type===t).length;
  return [[count('crossing'),'perempatan dibuat'],[count('node-merge'),'simpul digabung'],[count('attach'),'ujung ditempelkan'],
    [count('junction-gap'),'simpang digabung'],[count('short-road'),'ruas pendek dirapikan']].filter(([n])=>n).map(([n,t])=>`${n} ${t}`).join(', ');
}
export {halfWidth};
