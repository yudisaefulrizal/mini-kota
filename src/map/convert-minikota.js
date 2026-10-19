import {makeNetwork,LOTS,GATES} from '../simulation.js';
import {hasTrafficSignal} from '../pedestrians.js';
import {MAP_FORMAT,MAP_VERSION,DEFAULT_PROFILES} from './format.js';

// Converts the current Mini Kota road graph (map units, directed edges) into the map file
// format (metres, undirected roads). The simulation is unchanged; this is the bridge until
// it reads map files directly.
const M=0.4;   // metres per map unit, as in scale.js
const r2=v=>Math.round(v*M*100)/100;

export function convertMiniKota({profile='jalan-1x1'}={}){
  const {nodes,edges,lotNodes}=makeNetwork();
  const id=n=>`n${n}`;
  const lotOf=new Map(Object.entries(lotNodes).map(([lot,node])=>[node,lot]));
  const mapNodes=nodes.map(n=>({id:id(n.id),x:r2(n.x),z:r2(n.z),
    ...(hasTrafficSignal(n)?{signal:true}:{}),...(n.roundabout?{roundabout:true}:{}),...(n.access?{access:true}:{}),...(lotOf.has(n.id)?{lot:lotOf.get(n.id)}:{})}));
  const roads=[],seen=new Set();
  for(const e of edges){
    const a=Math.min(e.from,e.to),b=Math.max(e.from,e.to);
    // A two-way road is two directed edges; keep the one running from the lower node id.
    if(!e.roundabout&&e.from!==a)continue;
    const key=e.roundabout?`ring:${e.id}`:`${a}-${b}`;
    if(seen.has(key))continue;seen.add(key);
    const toLot=nodes[e.to].lot&&!nodes[e.to].external,fromLot=nodes[e.from].lot&&!nodes[e.from].external;
    roads.push({id:`r${roads.length+1}`,from:id(e.from),to:id(e.to),
      profile:e.roundabout?'bundaran':(toLot||fromLot)?'akses':profile,shape:'polyline',
      points:e.points.slice(1,-1).map(p=>[r2(p.x),r2(p.z)]),...(e.roundabout?{oneway:true}:{})});
  }
  return {
    format:MAP_FORMAT,version:MAP_VERSION,name:'Mini Kota',
    bounds:{width:r2(1536),depth:r2(1024)},
    reference:{image:'map-mini-kota.png',width:r2(1536),depth:r2(1024)},
    profiles:structuredClone(DEFAULT_PROFILES),
    nodes:mapNodes,roads,
    lots:LOTS.map(l=>({id:l.id,name:l.name,x:r2(l.x),z:r2(l.z),w:r2(l.w),d:r2(l.h)})),
    gates:GATES.map(g=>({id:g.id,name:g.name,node:id(lotNodes[g.id])})),
    objects:[],
  };
}
