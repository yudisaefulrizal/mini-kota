import {MAP_FORMAT,MAP_VERSION,DEFAULT_PROFILES,validateMap} from './format.js';
import {normalize,describeChanges} from './normalize.js';

// Imports an OpenStreetMap XML export (.osm, from openstreetmap.org "Export") into the map
// format. Own small reader, no libraries. Map data © OpenStreetMap contributors (ODbL).

const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
const decode=s=>s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,(m,e)=>e[0]==='#'?String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10)):ENTITIES[e]);
function attrs(s){const out={};for(const m of s.matchAll(/([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))out[m[1]]=decode(m[2]??m[3]);return out;}
function tagsOf(body){const out={};for(const m of body.matchAll(/<tag\s+([^>]*?)\/?>/g)){const a=attrs(m[1]);if(a.k!==undefined)out[a.k]=a.v;}return out;}

// Reads <bounds>, <node> and <way> elements.
export function readOSM(text){
  if(!/<osm[\s>]/.test(text))throw Error('File ini bukan data OpenStreetMap (.osm).');
  const nodes=new Map(),ways=[];let bounds=null;
  const b=text.match(/<bounds\s+([^>]*?)\/?>/);if(b){const a=attrs(b[1]);bounds={minlat:+a.minlat,minlon:+a.minlon,maxlat:+a.maxlat,maxlon:+a.maxlon};}
  for(const m of text.matchAll(/<node\s+([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)){
    const a=attrs(m[1]);nodes.set(a.id,{id:a.id,lat:+a.lat,lon:+a.lon,tags:m[3]?tagsOf(m[3]):{}});
  }
  for(const m of text.matchAll(/<way\s+([^>]*?)>([\s\S]*?)<\/way>/g)){
    const a=attrs(m[1]),nds=[...m[2].matchAll(/<nd\s+ref\s*=\s*["']([^"']+)["']/g)].map(x=>x[1]);
    ways.push({id:a.id,nds,tags:tagsOf(m[2])});
  }
  return {bounds,nodes,ways};
}

const MAIN=new Set(['motorway','trunk','primary','secondary']),MINOR=new Set(['tertiary','unclassified','residential','living_street','road']);
const roadClass=h=>{const base=(h||'').replace(/_link$/,'');return MAIN.has(base)?'main':MINOR.has(base)?'minor':base==='service'?'service':null;};

// Profile from the OSM tags: lanes, oneway and road class (main roads default to 2 lanes).
export function profileFor(tags){
  const cls=roadClass(tags.highway);if(!cls)return null;
  if(tags.junction==='roundabout'||tags.junction==='circular')return {profile:'bundaran',oneway:1};
  const oneway=['yes','1','true'].includes(tags.oneway)||tags.highway==='motorway'?1:tags.oneway==='-1'?-1:0;
  if(cls==='service'&&!tags.lanes)return {profile:oneway?'satu-arah-1':'akses',oneway};
  const lanes=parseInt(tags.lanes,10);
  let perDirection=Number.isFinite(lanes)&&lanes>0?(oneway?lanes:Math.max(1,Math.round(lanes/2))):(cls==='main'?2:1);
  perDirection=Math.min(3,perDirection);
  return {profile:oneway?`satu-arah-${perDirection}`:`jalan-${perDirection}x${perDirection}`,oneway};
}

export function importOSM(text,{name='Peta OpenStreetMap',tidy=true}={}){
  const osm=readOSM(text);
  const roads=osm.ways.map(w=>({...w,kind:profileFor(w.tags)})).filter(w=>w.kind&&w.nds.length>=2);
  if(!roads.length)throw Error('Tidak ada jalan di file OSM ini. Pilih area yang berisi jalan saat mengekspor.');
  const used=roads.flatMap(w=>w.nds).map(id=>osm.nodes.get(id)).filter(Boolean);
  const box=osm.bounds||{minlat:Math.min(...used.map(n=>n.lat)),maxlat:Math.max(...used.map(n=>n.lat)),minlon:Math.min(...used.map(n=>n.lon)),maxlon:Math.max(...used.map(n=>n.lon))};
  // Local flat projection around the area (fine for a few kilometres): x east, z south.
  const lat0=(box.minlat+box.maxlat)/2*Math.PI/180;
  const kLat=111132.92-559.82*Math.cos(2*lat0),kLon=111412.84*Math.cos(lat0)-93.5*Math.cos(3*lat0);
  const project=n=>({x:Math.round((n.lon-box.minlon)*kLon*100)/100,z:Math.round((box.maxlat-n.lat)*kLat*100)/100});
  const inside=n=>n&&n.lat>=box.minlat&&n.lat<=box.maxlat&&n.lon>=box.minlon&&n.lon<=box.maxlon;

  // Split ways at the bounds: keep runs of consecutive nodes that lie inside.
  const pieces=[];
  for(const w of roads){
    const ids=w.kind.oneway===-1?[...w.nds].reverse():w.nds;let run=[];
    for(const id of ids){const n=osm.nodes.get(id);if(inside(n))run.push(id);else{if(run.length>=2)pieces.push({...w,nds:run});run=[];}}
    if(run.length>=2)pieces.push({...w,nds:run});
  }
  // Graph nodes: piece ends and nodes shared by several pieces (junctions).
  const count=new Map();for(const p of pieces)for(const id of new Set(p.nds))count.set(id,(count.get(id)||0)+1);
  const isNode=(p,i)=>i===0||i===p.nds.length-1||count.get(p.nds[i])>1;
  const mapNodes=new Map(),mapRoads=[];
  const nodeFor=id=>{if(!mapNodes.has(id))mapNodes.set(id,{id:`n${id}`,...project(osm.nodes.get(id))});return mapNodes.get(id).id;};
  for(const p of pieces){
    let start=0;
    for(let i=1;i<p.nds.length;i++){
      if(!isNode(p,i))continue;
      const from=nodeFor(p.nds[start]),to=nodeFor(p.nds[i]);
      if(from!==to)mapRoads.push({id:`r${mapRoads.length+1}`,from,to,profile:p.kind.profile,shape:'polyline',
        points:p.nds.slice(start+1,i).map(id=>{const q=project(osm.nodes.get(id));return [q.x,q.z];}),osm:p.id});
      start=i;
    }
  }
  const width=Math.round((box.maxlon-box.minlon)*kLon),depth=Math.round((box.maxlat-box.minlat)*kLat);
  const map={format:MAP_FORMAT,version:MAP_VERSION,name,bounds:{width,depth},profiles:structuredClone(DEFAULT_PROFILES),
    nodes:[...mapNodes.values()],roads:mapRoads,lots:[],gates:[],objects:[],
    meta:{source:'OpenStreetMap',attribution:'© OpenStreetMap contributors (ODbL)',bounds:box}};
  for(const r of map.roads)delete r.osm;
  const changes=tidy?normalize(map):[];
  // Traffic signals: OSM tags them on the junction node or just before it on an approach.
  const degree=new Map();for(const r of map.roads)for(const id of [r.from,r.to])degree.set(id,(degree.get(id)||0)+1);
  const junctions=map.nodes.filter(n=>degree.get(n.id)>=3);
  let signals=0;
  for(const n of osm.nodes.values()){
    if(n.tags.highway!=='traffic_signals'||!inside(n))continue;
    const p=project(n);let best=null;
    for(const j of junctions){const d=Math.hypot(j.x-p.x,j.z-p.z);if(d<=30&&(!best||d<best.d))best={j,d};}
    if(best&&!best.j.signal){best.j.signal=true;signals++;}
  }
  return {map:validateMap(map),report:{roads:map.roads.length,nodes:map.nodes.length,junctions:junctions.length,signals,tidy:describeChanges(changes),clipped:roads.length!==pieces.length}};
}
