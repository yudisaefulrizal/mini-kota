import * as THREE from 'three';
import {onThemeChange} from './theme.js';
import {validateMap,emptyMap,DEFAULT_PROFILES} from './map/format.js';
import {buildGeometry,pointAt,polylineLength,CLUSTER_LINK} from './map/geometry.js';
import {buildRoadMeshes,buildGraphOverlay,buildLots,ROAD_COLORS} from './map/mesh.js';
import {miniKotaRoads,miniKotaLengkap} from './map/default-map.js';
import {furnish} from './map/furnish.js';
import {MapCamera} from './map/camera-controls.js';
import {NetworkLayer} from './map/network-layer.js';
import {DEVICE_ICONS,NETWORKS} from './map/network.js';
import {deviceReadings,deviceLinks,legendHtml} from './map/device-info.js';
import * as edit from './map/edit.js';
import {normalize,editScope,describeChanges,mergeNodes} from './map/normalize.js';
import {ObjectLayer} from './map/object-layer.js';
import {smartPlace,gatewayOf,reachOf,SENSOR_ASSETS,CABLE_REACH,LORA_REACH,REACH_LIMITS} from './map/placement.js';
import {suggestSignal,buildPlan,patternsFor,PATTERNS} from './map/signals.js';
import {serializeMap,parseMapFile,fileName,saveDraft,loadDraft,clearDraft} from './map/storage.js';
import {importOSM} from './map/osm.js';
import {TrafficEngine,ZONE} from './traffic/engine.js';
import {ZoneLayer} from './traffic/zones.js';
import {TrafficView} from './traffic/view.js';

// Map editor: load or start a map, draw and edit roads; roads are rebuilt from the data
// after every change. Left mouse is for tools; right drag pans, Shift+right drag rotates.

// Inside the simulation's "Editor peta" tab the page header is hidden.
if(new URLSearchParams(location.search).has('embed'))document.body.classList.add('embed');
const DRAW_PROFILES=['jalan-1x1','jalan-2x2','jalan-3x3','satu-arah-2','akses'];
const $=id=>document.getElementById(id);
const fmt=(n,d=1)=>n.toLocaleString('id-ID',{maximumFractionDigits:d});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------------------------------------------------------------- scene
const stage=$('stage');
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{$('stage-error').hidden=false;$('stage-error').textContent='WebGL tidak tersedia.';throw Error('no webgl');}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));stage.prepend(renderer.domElement);
const canvas=renderer.domElement;
const scene=new THREE.Scene();scene.background=new THREE.Color(0xe4eae0);
onThemeChange(dark=>scene.background.setHex(dark?0x1a2420:0xe4eae0));
const camera=new THREE.PerspectiveCamera(40,1,0.5,5000);
// Navigation: right drag pans, middle drag orbits round the point under the cursor, the
// wheel zooms towards the cursor (src/map/camera-controls.js). The left button edits.
const controls=new MapCamera(camera,canvas,{pickables:()=>[layers,objects.group].filter(Boolean),bounds:()=>map?.bounds||{width:600,depth:400},onChange:updateCompass,onLeaveTop:()=>setTopView(false)});
scene.add(controls.marker);
scene.add(new THREE.HemisphereLight(0xffffff,0x8a9a80,1.7));
const sun=new THREE.DirectionalLight(0xfff4e0,1.6);sun.position.set(-200,400,-150);scene.add(sun);

// Overlays drawn above the roads: drawing preview, snap magnet, selection, handles.
const overlay=new THREE.Group();scene.add(overlay);
const lineMaterial=color=>new THREE.LineBasicMaterial({color,depthTest:false,transparent:true});
const preview=new THREE.Line(new THREE.BufferGeometry(),lineMaterial(0xe8742c));preview.renderOrder=20;overlay.add(preview);
const selectedLine=new THREE.Line(new THREE.BufferGeometry(),lineMaterial(0xe8742c));selectedLine.renderOrder=20;overlay.add(selectedLine);
// Reach of the selected gateway: cable (75 m) and, with a LoRaWAN module, radio (1 km).
const reachRings=[0x1d5fa0,0xd99a1e].map(c=>{const l=new THREE.LineLoop(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:c,dashSize:3,gapSize:2,depthTest:false}));l.renderOrder=20;overlay.add(l);return l;});
function showReach(o){
  const ring=(line,r)=>{line.visible=r>0;if(r>0){line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setFromPoints(Array.from({length:96},(_,i)=>new THREE.Vector3(o.x+r*Math.cos(i/96*Math.PI*2),0.7,o.z+r*Math.sin(i/96*Math.PI*2))));line.computeLineDistances();}};
  const reach=reachOf(map);ring(reachRings[0],o?.asset==='gateway'?reach.cable:0);ring(reachRings[1],o?.asset==='gateway'&&o.lora?reach.lora:0);
}
const magnet=new THREE.Mesh(new THREE.RingGeometry(1,1.35,32),new THREE.MeshBasicMaterial({color:0x2e9e5b,depthTest:false,side:THREE.DoubleSide}));
magnet.rotation.x=-Math.PI/2;magnet.renderOrder=21;magnet.visible=false;overlay.add(magnet);
const handles=new THREE.Group();overlay.add(handles);
const handleGeometry=new THREE.CircleGeometry(1,20);
const handleMaterials={node:new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false}),point:new THREE.MeshBasicMaterial({color:0x2f7fc1,depthTest:false}),
  ring:new THREE.MeshBasicMaterial({color:0x173b37,depthTest:false}),active:new THREE.MeshBasicMaterial({color:0xe8742c,depthTest:false})};

// ---------------------------------------------------------------- state
let map=null,geometry=null,layers=null;
let tool='select',profile='jalan-2x2',drawMode='click';
let drawing=null;             // {points, startTarget, endTarget, dragging}
let selection=null;           // {type:'road'|'node'|'object', id}
let activeHandle=null;        // {kind:'node', id} | {kind:'point', roadId, index}
let dragging=null;            // {handle, recorded}
const history=new edit.History();
const objects=new ObjectLayer(scene);
const network=new NetworkLayer(scene);   // device icons, cables, radio and data packets
const zones=new ZoneLayer(scene);        // camera detection zones
let placeAsset=null;          // asset chosen in the toolbox for click-to-place
const CATEGORY_ICONS={traffic:'🚦',devices:'📡',vehicles:'🚗',buildings:'🏢',nature:'🌳',street:'💡',people:'🚶'};

// ---------------------------------------------------------------- loading & rebuilding
async function load(){
  const source=$('map-select').value;
  if(source==='file')return;
  try{
    const raw=source==='minikota-lengkap'?miniKotaLengkap():source==='minikota'?miniKotaRoads():source==='empty'?emptyMap('Peta baru',600,400):await (await fetch(source)).json();
    setMap(validateMap(raw));
  }catch(error){$('warnings').innerHTML=`<p class="bad">${esc(error.message)}</p>`;console.error(error);}
}
// Replaces the map being edited (history starts afresh).
function setMap(next,{saved=null}={}){
  map=next;selection=null;activeHandle=null;previewPhase=null;cancelDrawing();history.undoStack=[];history.redoStack=[];
  dirty=false;savedAt=saved;$('map-name').value=map.name||'';
  rebuild();frame(true);setTool(tool);showSaveState();
}

// ---------------------------------------------------------------- saving
let dirty=false,savedAt=null,draftTimer=null,draftAt=null;
const time=iso=>iso?new Date(iso).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'';
function markDirty(){
  dirty=true;clearTimeout(draftTimer);
  // Debounced: a burst of edits writes one draft.
  draftTimer=setTimeout(()=>{if(saveDraft(map))draftAt=new Date().toISOString();showSaveState();},400);
  showSaveState();
}
function showSaveState(){
  const parts=[];
  if(savedAt)parts.push(`Diunduh ${time(savedAt)}`);
  if(dirty)parts.push(draftAt?`perubahan tersimpan sebagai draf di browser (${time(draftAt)})`:'ada perubahan yang belum diunduh');
  const text=parts.join(' · ');$('save-state').textContent=text?text[0].toUpperCase()+text.slice(1)+'.':'Belum ada perubahan.';
}
function download(){
  const at=new Date().toISOString();
  const blob=new Blob([serializeMap(map,{savedAt:at})],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=fileName(map);a.click();URL.revokeObjectURL(a.href);
  savedAt=at;dirty=false;showSaveState();status(`Peta diunduh sebagai ${fileName(map)}.`);
}
async function openFile(file){
  if(sim)stopSim();
  try{
    const text=await file.text(),isOSM=/\.osm$/i.test(file.name)||/^\s*(<\?xml[^>]*>\s*)?<osm[\s>]/.test(text);
    if(isOSM){
      const {map:next,report}=importOSM(text,{name:file.name.replace(/\.osm$/i,'')});
      let option=$('map-select').querySelector('option[value=file]');
      if(!option){option=document.createElement('option');option.value='file';$('map-select').append(option);}
      option.textContent=`OSM: ${file.name}`;$('map-select').value='file';
      setMap(next,{saved:null});markDirty();
      status(`${file.name} diimpor dari OpenStreetMap: ${report.roads} jalan, ${report.junctions} simpang, ${report.signals} berlampu.${report.clipped?' Jalan di luar batas area dipotong.':''} Periksa jumlah lajur, karena data OSM tidak selalu lengkap. Data © OpenStreetMap contributors (ODbL).`);
      return;
    }
    const next=parseMapFile(text);
    let option=$('map-select').querySelector('option[value=file]');
    if(!option){option=document.createElement('option');option.value='file';$('map-select').append(option);}
    option.textContent=`File: ${file.name}`;$('map-select').value='file';
    setMap(next,{saved:next.meta?.savedAt||null});
    const unknown=[...new Set(next.objects.map(o=>o.asset).filter(id=>objects.assets.size&&!objects.assets.has(id)))];
    status(`${file.name} dibuka: ${next.roads.length} jalan, ${next.objects.length} aset.${unknown.length?` Aset tidak dikenal: ${unknown.join(', ')}.`:''}`,unknown.length>0);
  }catch(error){status(`Gagal membuka ${file.name}: ${error.message}`,true);}
}
function offerDraft(){
  const draft=loadDraft(),card=$('draft-card');
  if(!draft){card.hidden=true;return;}
  card.hidden=false;
  card.innerHTML=`<h2>Draf tersimpan</h2><p><strong>${esc(draft.map.name||'Peta')}</strong> · ${draft.map.roads.length} jalan · ${draft.map.objects.length} aset · ${esc(time(draft.savedAt))}</p>
<div class="row"><button type="button" class="secondary" id="draft-restore">Pulihkan</button><button type="button" class="danger" id="draft-discard">Buang</button></div>
<p>Draf hanya tersimpan di browser ini dan akan tertimpa bila Anda mulai mengedit peta lain. Unduh file .json untuk menyimpan permanen.</p>`;
  $('draft-restore').onclick=()=>{
    let option=$('map-select').querySelector('option[value=file]');
    if(!option){option=document.createElement('option');option.value='file';$('map-select').append(option);}
    option.textContent='Draf dipulihkan';$('map-select').value='file';
    setMap(draft.map);dirty=true;draftAt=draft.savedAt;showSaveState();card.hidden=true;status('Draf dipulihkan.');
  };
  $('draft-discard').onclick=()=>{clearDraft();card.hidden=true;status('Draf dibuang.');};
}

function rebuild(){
  try{geometry=buildGeometry(validateMap(map));}catch(error){$('warnings').innerHTML=`<p class="bad">${esc(error.message)}</p>`;return;}
  if(layers)scene.remove(layers);
  layers=new THREE.Group();scene.add(layers);
  const {width,depth}=map.bounds;
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),new THREE.MeshStandardMaterial({color:ROAD_COLORS.ground,roughness:1}));
  ground.rotation.x=-Math.PI/2;ground.position.set(width/2,0,depth/2);layers.add(ground);
  layers.add(buildRoadMeshes(geometry,{markings:$('layer-markings').checked,sidewalks:$('layer-sidewalks').checked}));
  if($('layer-lots').checked)layers.add(buildLots(map));
  if($('layer-graph').checked)layers.add(buildGraphOverlay(map));
  objects.group.visible=$('layer-objects').checked;objects.sync(map);objects.updateLinks(false);
  network.visible=$('layer-links').checked;network.sync(map);renderLegend();
  const s=geometry.stats;
  $('stats').innerHTML=[['Simpul',s.nodes],['Jalan',s.roads],['Simpang',s.junctions],['Berlampu',geometry.junctions.filter(j=>j.signal).length],['Panjang jalan',`${fmt(s.km,2)} km`],['Aset',map.objects.length],['Sensor',map.objects.filter(o=>SENSOR_ASSETS.has(o.asset)).length],['Ukuran',`${fmt(map.bounds.width)} × ${fmt(map.bounds.depth)} m`]]
    .map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('');
  const orphans=map.objects.filter(o=>SENSOR_ASSETS.has(o.asset)&&!gatewayOf(map,o)).length;
  const far=map.objects.filter(o=>{const g=gatewayOf(map,o);return g?.auto&&!g.inReach;}).length;
  const warnings=[...geometry.warnings.map(w=>w.message),...(orphans?[`${orphans} sensor belum tersambung ke gateway; pasang aset Gateway edge.`]:[]),
    ...(far?[`${far} perangkat di luar jangkauan gateway (kabel ${fmt(reachOf(map).cable,0)} m, LoRaWAN ${fmt(reachOf(map).lora,0)} m); pasang gateway lebih dekat atau ubah jangkauan.`]:[])];
  const reach=reachOf(map);$('reach-cable').value=reach.cable;$('reach-lora').value=reach.lora;
  $('warnings').innerHTML=warnings.length?`<h3>Peringatan (${warnings.length})</h3><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:'<p>Tidak ada peringatan.</p>';
  const exists={road:id=>map.roads.some(r=>r.id===id),node:id=>map.nodes.some(n=>n.id===id),object:id=>map.objects.some(o=>o.id===id)};
  if(selection&&!exists[selection.type](selection.id))selection=null;
  zonePreview=null;zonesKey=null;
  renderSelection();updateButtons();
}

// Camera detection zones. While simulating: every camera, coloured by its readings (with the
// device layer). Otherwise: only the selected camera's zone, from a traffic model of the map
// without vehicles, so its placement and aim can be checked while editing.
let zonePreview=null,zonesKey=null;
function previewEngine(){
  if(!zonePreview)try{zonePreview=new TrafficEngine(map,{demand:0});}catch{zonePreview=false;}
  return zonePreview||null;
}
function refreshZones(){
  const camera=!sim&&selection?.type==='object'&&map?.objects.find(o=>o.id===selection.id&&o.asset==='cctv');
  const key=sim?'sim':camera?camera.id:null;
  if(key!==zonesKey){
    zonesKey=key;
    if(sim)zones.build(sim.engine);
    else if(camera&&previewEngine())zones.build(zonePreview,{only:camera.id});
    else zones.clear();
  }
  zones.visible=sim?$('layer-links').checked:!!camera;
}


// One undoable step: snapshot, change, tidy what the change touched, rebuild.
// A failed change is rolled back. `lastTidy` describes what tidying did.
let lastTidy='';
function tidyAfter(){
  lastTidy='';
  if(!$('auto-tidy').checked)return;
  const before=JSON.parse(history.undoStack.at(-1));
  lastTidy=describeChanges(normalize(map,editScope(before,map)));
  // New junctions of main roads get a traffic light, unless the user already decided.
  const scope=new Set(editScope(before,map).nodes);let lit=0;
  for(const j of buildGeometry(validateMap(map)).junctions){
    const node=map.nodes.find(n=>n.id===j.id);
    if(scope.has(j.id)&&node.signal===undefined&&suggestSignal(j)){node.signal=true;lit++;}
  }
  if(lit)lastTidy=[lastTidy,`${lit} simpang diberi lampu`].filter(Boolean).join(', ');
}
function change(fn,{tidy=true}={}){
  if(sim){status('Hentikan simulasi dulu untuk mengedit peta.',true);return false;}
  history.record(map);
  try{fn();if(tidy)tidyAfter();else lastTidy='';rebuild();markDirty();return true;}
  catch(error){map=history.undo(map);history.redoStack.pop();lastTidy='';rebuild();status(error.message,true);return false;}
}
function statusAfter(text){status(lastTidy?`${text} Dirapikan otomatis: ${lastTidy}.`:text);}

// ---------------------------------------------------------------- camera
let topView=true;
function setTopView(top){
  topView=top;$('view-top').setAttribute('aria-pressed',String(top));$('view-perspective').setAttribute('aria-pressed',String(!top));
  $('nav-hint').textContent=`Putar & miringkan: klik kanan + seret${top?' (keluar dari tampilan atas)':''} · Geser: klik kiri + seret di area kosong, atau klik tengah + seret · Zoom: roda, ke arah kursor · Dobel klik kanan: terbang ke titik`;
}
// Whole map in view; animated when asked from a button.
function frame(top=topView,animate=false){
  setTopView(top);
  const {width,depth}=map.bounds,center=new THREE.Vector3(width/2,0,depth/2);
  const fit=Math.max(depth,width/camera.aspect)*1.08;
  const distance=fit/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));
  const position=top?center.clone().add(new THREE.Vector3(0,distance,0.001)):center.clone().add(new THREE.Vector3(0,distance*0.75,distance*0.75));
  if(animate){controls.topView=false;controls.flyTo(position,center,0.7,()=>{controls.topView=top;controls.apply();});}
  else{controls.anim=null;controls.topView=top;controls.set(position,center);}
}
function focus(x,z,distance=60){
  setTopView(false);controls.topView=false;controls.anim=null;controls.follow=null;
  controls.set(new THREE.Vector3(x+distance*0.35,distance*0.8,z+distance*0.75),new THREE.Vector3(x,0,z));
}
// F: fly to the selection, or to the point under the cursor.
function focusSelection(){
  let p=null;
  if(selection?.type==='object'){const o=map.objects.find(o=>o.id===selection.id);if(o)p=new THREE.Vector3(o.x,0,o.z);}
  else if(selection?.type==='node'){const n=map.nodes.find(n=>n.id===selection.id);if(n)p=new THREE.Vector3(n.x,0,n.z);}
  else if(selection?.type==='road'){const r=geometry.roads.find(r=>r.id===selection.id);if(r){const m=pointAt(r.line,polylineLength(r.line)/2).p;p=new THREE.Vector3(m.x,0,m.z);}}
  if(!p&&controls.lastPointer)p=controls.pick(controls.lastPointer.x,controls.lastPointer.y);
  if(p)controls.focusOn(p,Math.min(controls.distance,topView?120:60));
}
// North arrow: shows where north is; a click turns the map north-up again.
function updateCompass(){const c=document.getElementById('compass');if(c)c.firstElementChild.style.transform=`rotate(${controls.compassAngle()}rad)`;}

// ---------------------------------------------------------------- pointer helpers
const raycaster=new THREE.Raycaster(),groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0),ndc=new THREE.Vector2();
function groundPoint(event){
  const r=canvas.getBoundingClientRect();
  ndc.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
  raycaster.setFromCamera(ndc,camera);
  const hit=new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane,hit)?{x:hit.x,z:hit.z}:null;
}
// Metres per screen pixel near a point, so handles and pick radii feel constant on screen.
function metresPerPixel(p){
  const d=camera.position.distanceTo(new THREE.Vector3(p.x,0,p.z));
  return 2*d*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/canvas.clientHeight;
}
function snapFor(p,event){
  if(!$('snap').checked||event.altKey)return null;
  return edit.snapTarget(map,p,Number($('snap-distance').value)||10);
}
function showMagnet(target,p){
  magnet.visible=!!target;if(!target)return;
  magnet.position.set(target.point.x,0.6,target.point.z);magnet.scale.setScalar(Math.max(1.2,metresPerPixel(p)*9));
  magnet.material.color.set(target.type==='node'?0x2e9e5b:0x2f7fc1);
}
function setLine(line,points,y=0.6){line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p.x,y,p.z)));}

// ---------------------------------------------------------------- tools
const TOOL_HELP={
  select:'Klik jalan, simpul, atau aset untuk memilih. Tarik titik atau aset untuk memindah; klik ganda di jalan untuk menambah titik.',
  place:()=>`Klik di peta untuk memasang ${objects.assets.get(placeAsset)?.name||'aset'}. Tahan Alt untuk penempatan bebas, Esc untuk selesai.`,
  road:()=>drawMode==='click'?'Klik untuk menambah titik. Enter atau klik ganda untuk selesai, Esc untuk batal. Tahan Alt agar tidak menempel.':'Tahan dan seret untuk menggambar jalan. Tahan Alt agar tidak menempel.',
  junction:'Klik di badan jalan untuk menambah simpang (jalan dipotong menjadi dua).',
  erase:'Klik jalan, simpul, atau aset untuk menghapusnya.',
};
function setTool(next){
  tool=next;cancelDrawing();activeHandle=null;
  if(tool!=='place'){placeAsset=null;objects.hideGhost();}
  for(const b of document.querySelectorAll('[data-asset]'))b.setAttribute('aria-pressed',String(b.dataset.asset===placeAsset));
  for(const b of document.querySelectorAll('[data-tool]'))b.setAttribute('aria-pressed',String(b.dataset.tool===tool));
  $('road-tool').hidden=tool!=='road';
  canvas.style.cursor=tool==='select'?'default':tool==='place'?'copy':'crosshair';
  const help=TOOL_HELP[tool];status(typeof help==='function'?help():help);
  $('road-hint').textContent='Ujung jalan menempel ke simpul atau badan jalan terdekat (tanda lingkaran). Menempel di badan jalan membuat pertigaan.';
  renderSelection();
}
function cancelDrawing(){drawing=null;setLine(preview,[]);magnet.visible=false;}
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('bad',error);}

function finishDrawing(){
  if(!drawing)return;
  const pts=drawing.points.filter((p,i,a)=>!i||Math.hypot(p.x-a[i-1].x,p.z-a[i-1].z)>0.5);
  const {startTarget,endTarget}=drawing,mode=drawing.dragging?'drag':'click';cancelDrawing();
  if(pts.length<2){status('Jalan membutuhkan minimal dua titik.',true);return;}
  const points=mode==='drag'?edit.simplify(pts,3):pts;
  if(change(()=>{const road=edit.addRoad(map,points,{profile,shape:'spline',startTarget,endTarget});selection={type:'road',id:road.id};}))
    statusAfter(`Jalan ditambahkan: ${map.profiles[profile].name}.`);
}

// Handles: the selected road's end nodes and control points, otherwise every node.
function handleList(){
  if(!map||sim)return [];
  const list=[];
  if(selection?.type==='road'){
    const r=map.roads.find(r=>r.id===selection.id);if(!r)return [];
    for(const id of [r.from,r.to]){const n=map.nodes.find(n=>n.id===id);list.push({kind:'node',id,p:n});}
    (r.points||[]).forEach(([x,z],index)=>list.push({kind:'point',roadId:r.id,index,p:{x,z}}));
  }else if(tool==='select'||tool==='erase'){
    for(const n of map.nodes)list.push({kind:'node',id:n.id,p:n});
  }
  return list;
}
const sameHandle=(a,b)=>a&&b&&a.kind===b.kind&&(a.kind==='node'?a.id===b.id:a.roadId===b.roadId&&a.index===b.index);
function hitHandle(p){
  const tolerance=metresPerPixel(p)*10;let best=null;
  for(const h of handleList()){const d=Math.hypot(h.p.x-p.x,h.p.z-p.z);if(d<=tolerance&&(!best||d<best.d))best={...h,d};}
  return best;
}
// A pole camera: which approach it watches, and how far back its detection zone reaches.
function cameraPanel(o){
  const st=previewEngine()?.sensorState(o.id),a=st?.approaches?.[0];
  return `<label class="field">Panjang zona deteksi (m)<input type="number" id="sel-zone" min="20" max="200" step="10" value="${o.zone||ZONE}"></label>
<p class="hint ${st?'':'bad'}">${st?(st.approaches.length===1?`Memantau arah datang dari ${esc(a.from.toLowerCase())} (${esc(a.road)}) di simpang ${esc(st.node)}.`:`Memantau ${st.approaches.length} arah simpang ${esc(st.node)}.`)+' Zona dihitung dari garis henti ke belakang.'
    :'Belum menghadap arah datang di simpang berlampu. Putar kamera ke arah kendaraan yang datang, dari seberang simpang.'}</p>`;
}

function renderSelection(){
  handles.clear();refreshZones();
  if(previewPhase&&!(selection?.type==='node'&&selection.id===previewPhase.node))previewPhase=null;
  objects.select(selection?.type==='object'?selection.id:null);
  const road=selection?.type==='road'&&map?.roads.find(r=>r.id===selection.id);
  setLine(selectedLine,road?edit.roadLine(map,road):[],0.65);
  showReach(selection?.type==='object'?map?.objects.find(o=>o.id===selection.id):null);
  if(map){
    const mpp=metresPerPixel(controls.target);
    for(const h of handleList()){
      const highlighted=sameHandle(activeHandle,h)||(selection?.type==='node'&&h.kind==='node'&&selection.id===h.id);
      const size=mpp*(h.kind==='node'?6:5);
      const ring=new THREE.Mesh(handleGeometry,handleMaterials.ring);ring.scale.setScalar(size*1.35);
      const dot=new THREE.Mesh(handleGeometry,highlighted?handleMaterials.active:handleMaterials[h.kind]);dot.scale.setScalar(size);
      for(const [m,y,o] of [[ring,0.7,22],[dot,0.72,23]]){m.rotation.x=-Math.PI/2;m.position.set(h.p.x,y,h.p.z);m.renderOrder=o;handles.add(m);}
    }
  }
  renderPanel();renderPhaseArrows();
}

function renderPanel(){
  const box=$('selection');
  if(!selection||!map){box.hidden=true;return;}
  box.hidden=false;
  if(selection.type==='road'){
    const r=map.roads.find(r=>r.id===selection.id);if(!r){box.hidden=true;return;}
    box.innerHTML=`<h2>Jalan ${esc(r.id)}</h2>
<label class="field">Jenis<select id="sel-profile">${Object.entries(map.profiles).map(([id,p])=>`<option value="${id}" ${id===r.profile?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
<label class="field">Bentuk<select id="sel-shape"><option value="spline" ${r.shape==='spline'?'selected':''}>Lengkung halus</option><option value="polyline" ${r.shape!=='spline'?'selected':''}>Garis lurus antar titik</option></select></label>
<p class="hint">Panjang ${fmt(edit.roadLength(map,r))} m · ${(r.points||[]).length} titik bentuk · ${esc(r.from)} → ${esc(r.to)}</p>
<button type="button" class="danger" id="sel-delete">Hapus jalan</button>`;
    $('sel-profile').onchange=e=>change(()=>edit.setProfile(map,r.id,e.target.value),{tidy:false});
    $('sel-shape').onchange=e=>change(()=>edit.setShape(map,r.id,e.target.value));
    $('sel-delete').onclick=()=>change(()=>{edit.deleteRoad(map,r.id);selection=null;});
  }else if(selection.type==='object'){
    const o=map.objects.find(o=>o.id===selection.id);if(!o){box.hidden=true;return;}
    const asset=objects.assets.get(o.asset),gateways=map.objects.filter(g=>g.asset==='gateway'),gw=gatewayOf(map,o);
    const served=o.asset==='gateway'?map.objects.filter(x=>gatewayOf(map,x)?.id===o.id).length:0,far=gw?.auto&&!gw.inReach;
    box.innerHTML=`<h2>${esc(asset?.name||o.asset)} · ${esc(o.id)}</h2>
<p class="hint">x ${fmt(o.x)} m, z ${fmt(o.z)} m</p>
<div class="field">Arah<div class="rotate"><button type="button" id="rot-l" title="Putar kiri (Q)">⟲ 15°</button><input type="number" id="sel-rot" value="${o.rotation||0}" step="15"> °<button type="button" id="rot-r" title="Putar kanan (E)">⟳ 15°</button></div></div>
${SENSOR_ASSETS.has(o.asset)?(gateways.length?`<label class="field">Gateway<select id="sel-gw"><option value="">Otomatis (dalam jangkauan${gw?.auto?`: ${esc(gw.id)}`:''})</option>${gateways.map(g=>`<option value="${g.id}" ${o.gateway===g.id?'selected':''}>${esc(g.id)} · ${fmt(Math.hypot(g.x-o.x,g.z-o.z),0)} m</option>`).join('')}</select></label>`:'<p class="hint bad">Belum ada gateway di peta. Pasang aset Gateway edge.</p>'):''}
${far?`<p class="hint bad">Di luar jangkauan gateway terdekat (${fmt(gw.distance,0)} m; ${o.asset==='bin-sensor'?`LoRaWAN ${fmt(reachOf(map).lora,0)} m`:`kabel ${fmt(reachOf(map).cable,0)} m`}). Pasang gateway lebih dekat atau ubah jangkauan.</p>`:''}
${o.asset==='gateway'?`<label class="inline"><input type="checkbox" id="sel-lora" ${o.lora?'checked':''}> Modul LoRaWAN (sensor sampah)</label><p class="hint">Melayani ${served} perangkat. Lingkaran: jangkauan kabel ${fmt(reachOf(map).cable,0)} m${o.lora?` dan radio ${fmt(reachOf(map).lora,0)} m`:''}.</p>`:''}
${o.asset==='cctv'?cameraPanel(o):''}
${networkRows(o.id)}
<button type="button" class="danger" id="sel-delete">Hapus aset</button>`;
    $('rot-l').onclick=()=>change(()=>edit.rotateObject(map,o.id,-15),{tidy:false});
    $('rot-r').onclick=()=>change(()=>edit.rotateObject(map,o.id,15),{tidy:false});
    $('sel-rot').onchange=e=>change(()=>{map.objects.find(x=>x.id===o.id).rotation=Math.round(Number(e.target.value)||0);},{tidy:false});
    $('sel-gw')?.addEventListener('change',e=>change(()=>edit.setGateway(map,o.id,e.target.value||null),{tidy:false}));
    $('sel-lora')?.addEventListener('change',e=>change(()=>{const g=map.objects.find(x=>x.id===o.id);if(e.target.checked)g.lora=true;else delete g.lora;},{tidy:false}));
    $('sel-zone')?.addEventListener('change',e=>change(()=>{const x=map.objects.find(c=>c.id===o.id),v=Math.round(Number(e.target.value)||ZONE);
      if(v===ZONE)delete x.zone;else x.zone=Math.min(200,Math.max(20,v));},{tidy:false}));
    $('sel-delete').onclick=()=>change(()=>{edit.deleteObject(map,o.id);selection=null;},{tidy:false});
  }else{
    const n=map.nodes.find(n=>n.id===selection.id);if(!n){box.hidden=true;return;}
    const degree=map.roads.filter(r=>r.from===n.id||r.to===n.id).length;
    box.innerHTML=`<h2>Simpul ${esc(n.id)}</h2>
<p class="hint">${degree>=3?`Simpang ${degree} lengan`:degree===2?'Sambungan / tikungan':'Ujung jalan'} · x ${fmt(n.x)} m, z ${fmt(n.z)} m</p>
${degree>=3?`<label class="inline"><input type="checkbox" id="sel-signal" ${n.signal?'checked':''}> Lampu lalu lintas</label>`:''}
${degree>=3&&n.signal?signalPanel(n):''}
<button type="button" class="danger" id="sel-delete">Hapus simpul &amp; jalannya</button>`;
    // Unticking stores an explicit "no", so automatic suggestions leave this junction alone.
    $('sel-signal')?.addEventListener('change',e=>change(()=>{const node=map.nodes.find(x=>x.id===n.id);node.signal=e.target.checked;},{tidy:false}));
    if(degree>=3&&n.signal)bindSignalPanel(n);
    $('sel-delete').onclick=()=>change(()=>{edit.deleteNode(map,n.id);selection=null;});
  }
}

// ---------------------------------------------------------------- signal plans
let previewPhase=null;   // {node, index}
const phaseArrows=new THREE.Group();overlay.add(phaseArrows);
const MODE_LABEL={protected:'jalan',yield:'mengalah',free:'jalan terus'};
function junctionOf(id){return geometry?.junctions.find(j=>j.id===id);}
function planOf(n){const j=junctionOf(n.id);return j?buildPlan(j,n.signalPlan||{}):null;}
function signalPanel(n){
  const j=junctionOf(n.id),plan=planOf(n);if(!plan)return '';
  const describe=ph=>{
    const by=mode=>[...new Set(ph.movements.filter(m=>m.mode===mode).map(m=>m.turn))];
    const parts=[['protected','jalan'],['yield','mengalah'],['free','jalan terus']].map(([mode,label])=>by(mode).length?`${by(mode).join(', ')} ${label}`:'').filter(Boolean);
    return parts.join(' · ');
  };
  return `${clusterPanel(n)}<div class="field">Pola fase<select id="sel-pattern">${patternsFor(j.legs.length).map(id=>`<option value="${id}" ${id===plan.pattern?'selected':''}>${esc(PATTERNS[id].name)}</option>`).join('')}</select></div>
<p class="hint">${esc(PATTERNS[plan.pattern].description)}</p>
<label class="inline"><input type="checkbox" id="sel-leftfree" ${plan.leftFree?'checked':''}> Belok kiri jalan terus</label>
<ol class="phases">${plan.phases.map(ph=>`<li><div class="phase-head"><strong>Fase ${ph.index+1}: ${esc(ph.name)}${ph.arrow?' (panah kanan)':''}</strong>
<button type="button" class="chip-btn" data-phase="${ph.index}" aria-pressed="${previewPhase?.node===n.id&&previewPhase.index===ph.index}">Lihat</button></div>
<label class="inline">Hijau <input type="number" data-green="${ph.index}" value="${ph.green}" min="5" max="120"> dtk</label><small>${esc(describe(ph))}</small></li>`).join('')}</ol>
<p class="hint">Siklus ${plan.cycle} detik (hijau + kuning 3 dtk + merah semua 1 dtk per fase).</p>
<button type="button" class="secondary" id="sel-place-lights">Pasang aset lampu di setiap pendekat</button>`;
}
// Simpang gabungan: signalised junctions joined by a link shorter than CLUSTER_LINK are run
// by one controller (geometry.clusters). The panel says so, lets the junctions be run
// separately again, sets the member offsets, and offers to merge very close junctions.
const MERGE_BELOW=12;
function linkLength(roadId){const r=geometry.roads.find(r=>r.id===roadId);return r?polylineLength(r.line):Infinity;}
// Signalised neighbours this junction could join (whether or not it is joined now).
function clusterCandidates(n){
  const out=[];
  for(const r of map.roads){
    if(r.from!==n.id&&r.to!==n.id)continue;
    const other=r.from===n.id?r.to:r.from,o=map.nodes.find(x=>x.id===other),len=linkLength(r.id);
    if(o?.signal===true&&junctionOf(other)&&len<CLUSTER_LINK&&!map.profiles[r.profile]?.access)out.push({node:other,road:r.id,length:len});
  }
  return out;
}
function clusterPanel(n){
  const c=geometry.clusters?.find(c=>c.nodes.includes(n.id)),near=clusterCandidates(n);
  if(!c){
    if(!near.length)return '';
    return `<div class="cluster"><strong>Simpang berdekatan</strong><p class="hint">Berlampu dan hanya ${fmt(Math.min(...near.map(x=>x.length)))} m dari ${near.map(x=>esc(x.node)).join(', ')}; saat ini diatur terpisah.</p>
<label class="inline"><input type="checkbox" id="sel-cluster"> Atur sebagai simpang gabungan</label></div>`;
  }
  const cycle=Math.max(...c.nodes.map(id=>planOf(map.nodes.find(x=>x.id===id))?.cycle||0));
  const lengths=c.roads.map(linkLength),first=c.nodes[0];
  const offset=n.signalPlan?.offset??0;
  return `<div class="cluster"><strong>Simpang gabungan: ${c.nodes.map(esc).join(' + ')}</strong>
<p class="hint">Ruas tengah ${lengths.map(l=>`${fmt(l)} m`).join(', ')}: satu pengendali dan satu siklus ${fmt(cycle,0)} detik untuk semuanya. Kendaraan yang sudah hijau tidak dihentikan lagi di simpang berikutnya; ruas tengah diberi kotak kuning (dilarang berhenti), tanpa garis henti dan zebra cross.</p>
${n.id===first?'<p class="hint">Simpang ini memulai siklus.</p>':`<label class="inline">Mulai <input type="number" id="sel-offset" value="${offset}" min="0" max="${Math.round(cycle)}" step="1"> dtk setelah ${esc(first)}</label>`}
<label class="inline"><input type="checkbox" id="sel-cluster" checked> Atur sebagai simpang gabungan</label>
${Math.min(...lengths)<MERGE_BELOW?`<button type="button" class="secondary" id="sel-merge">Gabung jadi satu simpang</button><p class="hint">Ruas tengah di bawah ${MERGE_BELOW} m: bisa juga dijadikan satu simpang besar (bentuk jalan berubah).</p>`:''}</div>`;
}
function bindClusterPanel(n){
  const c=geometry.clusters?.find(c=>c.nodes.includes(n.id));
  const members=c?c.nodes:[n.id,...clusterCandidates(n).map(x=>x.node)];
  $('sel-cluster')?.addEventListener('change',e=>{
    const join=e.target.checked;
    if(change(()=>{for(const id of members){const node=map.nodes.find(x=>x.id===id);node.signalPlan={...(node.signalPlan||{})};if(join)delete node.signalPlan.separate;else node.signalPlan.separate=true;}},{tidy:false}))
      status(join?`Simpang ${members.join(' + ')} diatur sebagai simpang gabungan.`:`Simpang ${members.join(', ')} diatur terpisah lagi.`);
  });
  $('sel-offset')?.addEventListener('change',e=>change(()=>{const node=map.nodes.find(x=>x.id===n.id);node.signalPlan={...(node.signalPlan||{}),offset:Math.max(0,Number(e.target.value)||0)};},{tidy:false}));
  $('sel-merge')?.addEventListener('click',()=>{
    const ids=c.nodes,pts=ids.map(id=>map.nodes.find(x=>x.id===id)),at={x:pts.reduce((a,p)=>a+p.x,0)/pts.length,z:pts.reduce((a,p)=>a+p.z,0)/pts.length};
    if(change(()=>{for(const id of ids.slice(1))mergeNodes(map,ids[0],id,at);const keep=map.nodes.find(x=>x.id===ids[0]);keep.signal=true;delete keep.signalPlan;selection={type:'node',id:ids[0]};},{tidy:false}))
      status(`${ids.join(' + ')} digabung menjadi satu simpang (${ids[0]}). Pola fase disusun ulang; periksa di panel ini.`);
  });
}
function bindSignalPanel(n){
  bindClusterPanel(n);
  const save=patch=>change(()=>{const node=map.nodes.find(x=>x.id===n.id),plan=planOf(node);
    node.signalPlan={...(node.signalPlan||{}),pattern:plan.pattern,leftFree:plan.leftFree,green:plan.phases.map(p=>p.green),...patch};},{tidy:false});
  $('sel-pattern').onchange=e=>{previewPhase=null;save({pattern:e.target.value,green:undefined});};
  $('sel-leftfree').onchange=e=>save({leftFree:e.target.checked});
  for(const input of document.querySelectorAll('[data-green]'))input.onchange=()=>{const green=planOf(n).phases.map(p=>p.green);green[Number(input.dataset.green)]=Number(input.value);save({green});};
  for(const b of document.querySelectorAll('[data-phase]'))b.onclick=()=>{const index=Number(b.dataset.phase);previewPhase=previewPhase?.node===n.id&&previewPhase.index===index?null:{node:n.id,index};renderSelection();};
  $('sel-place-lights').onclick=()=>placeSignalAssets(n);
}
// Arrows for the previewed phase: green = go, amber = yield, blue = free left turn.
function renderPhaseArrows(){
  phaseArrows.clear();
  if(!previewPhase||selection?.type!=='node'||selection.id!==previewPhase.node)return;
  const node=map.nodes.find(n=>n.id===previewPhase.node),j=junctionOf(previewPhase.node),plan=node&&planOf(node);
  const phase=plan?.phases[previewPhase.index];if(!phase)return;
  const colors={protected:0x2e9e5b,yield:0xe8a52b,free:0x2f7fc1},legs=j.legs.filter(l=>!l.ring);
  for(const m of phase.movements){
    const a=legs[m.from],b=legs[m.to];
    const start={x:j.x+a.dir.x*(a.setback+4)-a.dir.z*Math.max(1,a.right/2),z:j.z+a.dir.z*(a.setback+4)+a.dir.x*Math.max(1,a.right/2)};
    const end={x:j.x+b.dir.x*(b.setback+4)+b.dir.z*Math.max(1,b.left/2),z:j.z+b.dir.z*(b.setback+4)-b.dir.x*Math.max(1,b.left/2)};
    // Bend at the crossing of the entry heading and the exit heading; straight on stays straight.
    const h={x:-a.dir.x,z:-a.dir.z},o=b.dir,det=h.x*o.z-h.z*o.x;
    let c={x:(start.x+end.x)/2,z:(start.z+end.z)/2};
    if(Math.abs(det)>0.2){const t=((end.x-start.x)*o.z-(end.z-start.z)*o.x)/det;c={x:start.x+h.x*t,z:start.z+h.z*t};}
    const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(start.x,1,start.z),new THREE.Vector3(c.x,1,c.z),new THREE.Vector3(end.x,1,end.z));
    const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,20,0.35,6),new THREE.MeshBasicMaterial({color:colors[m.mode],depthTest:false,transparent:true,opacity:0.9}));
    tube.renderOrder=24;phaseArrows.add(tube);
    const tip=curve.getPoint(1),dir=curve.getTangent(1);
    const head=new THREE.Mesh(new THREE.ConeGeometry(1.1,2.6,10),new THREE.MeshBasicMaterial({color:colors[m.mode],depthTest:false}));
    head.position.copy(tip);head.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir);head.renderOrder=25;phaseArrows.add(head);
  }
}
// One traffic light per approach (an arrow light where the plan has a right-turn arrow),
// plus a controller cabinet on a corner; existing lights nearby are kept.
function placeSignalAssets(n){
  const j=junctionOf(n.id),plan=planOf(n);if(!j)return;
  const arrowLegs=new Set(plan.phases.filter(p=>p.arrow).flatMap(p=>p.legs));
  let added=0;
  change(()=>{
    j.legs.filter(l=>!l.ring).forEach((leg,i)=>{
      if(leg.access)return;
      const id=arrowLegs.has(i)?'traffic-light-arrow-right':'traffic-light',asset=objects.assets.get(id);if(!asset)return;
      const placed=smartPlace(map,geometry,asset,{x:j.x+leg.dir.x*(leg.setback+6),z:j.z+leg.dir.z*(leg.setback+6)});
      if(map.objects.some(o=>o.asset.startsWith('traffic-light')&&Math.hypot(o.x-placed.x,o.z-placed.z)<3))return;
      edit.addObject(map,id,placed);added++;
    });
    if(!map.objects.some(o=>o.asset==='controller'&&Math.hypot(o.x-j.x,o.z-j.z)<30)&&objects.assets.get('controller')){
      edit.addObject(map,'controller',smartPlace(map,geometry,objects.assets.get('controller'),{x:j.x+1,z:j.z+1}));added++;
    }
  },{tidy:false});
  status(added?`${added} aset lampu dan pengendali dipasang di simpang ${n.id}.`:'Aset lampu sudah terpasang di simpang ini.');
}

// ---------------------------------------------------------------- pointer events
// A left drag that starts on empty map (nothing to edit under it) pans the view; a left
// click without moving keeps its usual meaning.
let pendingPan=null;
// The device icon under the pointer, if the network layer is shown.
function iconAt(event){
  if(!network.visible)return null;
  controls.ray(event.clientX,event.clientY);return network.pick(controls.raycaster);
}
canvas.addEventListener('pointerdown',event=>{
  if(event.button===0&&sim){
    const id=iconAt(event);if(id){showDeviceCard(id);return;}
    pendingPan={x:event.clientX,y:event.clientY,id:event.pointerId,sim:true};return;
  }
  // A device icon stands for its device: select it and drag it like the model.
  if(event.button===0&&map&&tool==='select'){
    const id=iconAt(event);
    if(id){canvas.setPointerCapture(event.pointerId);selection={type:'object',id};activeHandle=null;dragging={object:id,recorded:false};renderSelection();return;}
  }
  if(event.button!==0||!map||sim)return;
  const p=groundPoint(event);if(!p)return;
  if(tool==='road'){
    const target=snapFor(p,event),at=target?target.point:p;
    if(drawMode==='drag'){canvas.setPointerCapture(event.pointerId);drawing={points:[at],startTarget:target,endTarget:null,dragging:true};return;}
    if(!drawing)drawing={points:[at],startTarget:target,endTarget:null};
    else{drawing.points.push(at);drawing.endTarget=target;}
    setLine(preview,drawing.points);return;
  }
  if(tool==='junction'){
    const hit=edit.pickRoad(map,p);
    if(!hit){status('Klik tepat di badan jalan.',true);return;}
    if(change(()=>{const node=edit.splitRoad(map,hit.id,hit.point);selection={type:'node',id:node.id};}))
      statusAfter('Simpang ditambahkan. Gambar jalan dari titik ini untuk membuat cabang.');
    return;
  }
  if(tool==='place'&&placeAsset){
    placeObject(placeAsset,p,event.altKey);return;
  }
  const objectHit=edit.pickObject(map,p,Math.max(2,metresPerPixel(p)*14));
  if(tool==='erase'){
    if(objectHit){change(()=>edit.deleteObject(map,objectHit.id),{tidy:false});return;}
    const h=hitHandle(p);
    if(h?.kind==='node'){change(()=>edit.deleteNode(map,h.id));return;}
    const hit=edit.pickRoad(map,p);if(hit)change(()=>edit.deleteRoad(map,hit.id));
    return;
  }
  const h=hitHandle(p);
  // Handles of a selected road win; otherwise an asset under the cursor comes before nodes.
  if(objectHit&&!(h&&(h.kind==='point'||selection?.type==='road'))){
    canvas.setPointerCapture(event.pointerId);
    selection={type:'object',id:objectHit.id};activeHandle=null;dragging={object:objectHit.id,recorded:false};
    renderSelection();return;
  }
  if(h){
    canvas.setPointerCapture(event.pointerId);
    activeHandle=h;dragging={handle:h,recorded:false};
    if(h.kind==='node'&&selection?.type!=='road')selection={type:'node',id:h.id};
    renderSelection();return;
  }
  const hit=edit.pickRoad(map,p);
  selection=hit?{type:'road',id:hit.id}:null;activeHandle=null;renderSelection();
  if(tool==='select')pendingPan={x:event.clientX,y:event.clientY,id:event.pointerId};
});
canvas.addEventListener('pointermove',event=>{
  if(!pendingPan||event.pointerId!==pendingPan.id)return;
  if(Math.hypot(event.clientX-pendingPan.x,event.clientY-pendingPan.y)<5)return;
  controls.beginDrag('pan',event,pendingPan);pendingPan=null;
});
canvas.addEventListener('pointerup',event=>{
  const pending=pendingPan;pendingPan=null;
  if(pending?.sim&&event.button===0)followVehicleAt(event);
});

let rebuildQueued=false;
function queueRebuild(){if(rebuildQueued)return;rebuildQueued=true;requestAnimationFrame(()=>{rebuildQueued=false;rebuild();});}

canvas.addEventListener('pointermove',event=>{
  if(!map)return;
  const p=groundPoint(event);if(!p)return;
  if(tool==='road'){
    const target=snapFor(p,event),at=target?target.point:p;showMagnet(target,p);
    if(drawing?.dragging){
      const last=drawing.points.at(-1);
      if(Math.hypot(at.x-last.x,at.z-last.z)>2)drawing.points.push(at);
      drawing.endTarget=target;setLine(preview,[...drawing.points,at]);
    }else if(drawing)setLine(preview,[...drawing.points,at]);
    status(`x ${fmt(p.x)} m · z ${fmt(p.z)} m${target?` · menempel ke ${target.type==='node'?'simpul':'badan jalan'}`:''}`);
    return;
  }
  if(tool==='place'&&placeAsset){
    const placed=placementFor(placeAsset,p,event.altKey);objects.showGhost(placeAsset,placed);
    status(`${placed.label} · Klik untuk memasang.`);return;
  }
  if(dragging?.object){
    if(!dragging.recorded){history.record(map);dragging.recorded=true;}
    const o=map.objects.find(x=>x.id===dragging.object),placed=placementFor(o.asset,p,event.altKey,o.rotation);
    edit.moveObject(map,o.id,placed);objects.sync(map);dragging.label=placed.label;status(placed.label);return;
  }
  if(dragging){
    if(!dragging.recorded){history.record(map);dragging.recorded=true;}
    const h=dragging.handle;
    if(h.kind==='node')edit.moveNode(map,h.id,p);else edit.movePoint(map,h.roadId,h.index,p);
    queueRebuild();
  }
});

canvas.addEventListener('pointerup',event=>{
  if(event.button!==0)return;
  if(tool==='road'&&drawing?.dragging){
    const p=groundPoint(event),target=p?snapFor(p,event):null;
    if(p)drawing.points.push(target?target.point:p);
    drawing.endTarget=target;finishDrawing();return;
  }
  if(dragging?.object){const label=dragging.label,moved=dragging.recorded;dragging=null;rebuild();if(moved)markDirty();if(label)status(`Aset dipindahkan: ${label}.`);return;}
  if(dragging){
    // The drag is one undo step; tidy what it moved within that same step.
    if(dragging.recorded){tidyAfter();if(lastTidy)statusAfter('Titik dipindahkan.');}
    const moved=dragging.recorded;dragging=null;rebuild();if(moved)markDirty();
  }
});

canvas.addEventListener('dblclick',event=>{
  if(!map)return;
  if(tool==='road'&&drawMode==='click'&&drawing){
    // The two clicks of a double click already added the last point twice.
    drawing.points.pop();finishDrawing();return;
  }
  if(tool==='select'&&selection?.type==='road'){
    const p=groundPoint(event);if(!p)return;
    const hit=edit.pickRoad(map,p);
    if(hit?.id===selection.id)change(()=>{const index=edit.insertPoint(map,hit.id,hit.point);activeHandle={kind:'point',roadId:hit.id,index};});
  }
});

// ---------------------------------------------------------------- keyboard & buttons
window.addEventListener('keydown',event=>{
  if(event.target.closest?.('input,select,textarea'))return;
  const key=event.key.toLowerCase();
  if(!event.ctrlKey&&!event.metaKey&&!event.altKey){
    if(key==='home'){event.preventDefault();frame(topView,true);return;}
    if(key==='f'){focusSelection();return;}
    // Q / E turn the selected asset; otherwise they (and WASD, arrows, + -) move the camera.
    const objectTurn=(key==='q'||key==='e')&&selection?.type==='object'&&!sim;
    if(!objectTurn&&!drawing&&controls.keyDown(key)){event.preventDefault();return;}
  }
  if(sim){
    if(key===' '){event.preventDefault();toggleSimPause();}
    else if(key==='escape'){if(controls.follow){controls.follow=null;status('Berhenti mengikuti kendaraan.');}else stopSim();}
    return;
  }
  if((event.ctrlKey||event.metaKey)&&key==='z'&&!event.shiftKey){event.preventDefault();undo();return;}
  if((event.ctrlKey||event.metaKey)&&(key==='y'||(key==='z'&&event.shiftKey))){event.preventDefault();redo();return;}
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  if(key==='escape'){if(tool==='place')setTool('select');else if(drawing)cancelDrawing();else{selection=null;activeHandle=null;renderSelection();}return;}
  if((key==='q'||key==='e')&&selection?.type==='object'){const id=selection.id;change(()=>edit.rotateObject(map,id,key==='q'?-15:15),{tidy:false});return;}
  if(key==='enter'&&drawing){finishDrawing();return;}
  if(key==='backspace'&&drawing){event.preventDefault();drawing.points.pop();if(!drawing.points.length)cancelDrawing();else setLine(preview,drawing.points);return;}
  if(key==='delete'||key==='backspace'){
    event.preventDefault();
    if(activeHandle?.kind==='point'){const h=activeHandle;activeHandle=null;change(()=>edit.deletePoint(map,h.roadId,h.index));return;}
    const target=selection;
    if(target?.type==='road')change(()=>{edit.deleteRoad(map,target.id);selection=null;});
    else if(target?.type==='node')change(()=>{edit.deleteNode(map,target.id);selection=null;});
    else if(target?.type==='object')change(()=>{edit.deleteObject(map,target.id);selection=null;},{tidy:false});
    return;
  }
  const tools={v:'select',r:'road',j:'junction',x:'erase'};
  if(tools[key])setTool(tools[key]);
});
function undo(){const prev=history.undo(map);if(prev){map=prev;cancelDrawing();activeHandle=null;rebuild();markDirty();$('map-name').value=map.name||'';status('Dibatalkan.');}}
function redo(){const next=history.redo(map);if(next){map=next;activeHandle=null;rebuild();markDirty();$('map-name').value=map.name||'';status('Diulangi.');}}
function updateButtons(){$('undo').disabled=!history.canUndo;$('redo').disabled=!history.canRedo;}

$('profile-buttons').innerHTML=DRAW_PROFILES.map(id=>`<button type="button" data-profile="${id}" aria-pressed="${id===profile}">${esc(DEFAULT_PROFILES[id].name)}</button>`).join('');
$('profile-buttons').onclick=e=>{const b=e.target.closest('[data-profile]');if(!b)return;profile=b.dataset.profile;for(const x of $('profile-buttons').children)x.setAttribute('aria-pressed',String(x===b));};
document.querySelector('[data-mode]').parentElement.onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;drawMode=b.dataset.mode;for(const x of b.parentElement.children)x.setAttribute('aria-pressed',String(x===b));setTool('road');};
for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>setTool(b.dataset.tool);
$('undo').onclick=undo;$('redo').onclick=redo;
$('tidy-all').onclick=()=>{
  history.record(map);
  const result=describeChanges(normalize(map));
  if(!result){history.undoStack.pop();status('Peta sudah rapi; tidak ada yang diubah.');return;}
  rebuild();markDirty();status(`Seluruh peta dirapikan: ${result}.`);
};
$('map-name').onchange=e=>{const name=e.target.value.trim()||'Peta';change(()=>{map.name=name;},{tidy:false});};
$('open-file').onclick=()=>$('file-input').click();
$('file-input').onchange=e=>{const file=e.target.files[0];if(file)openFile(file);e.target.value='';};
$('view-top').onclick=()=>frame(true,true);$('view-perspective').onclick=()=>frame(false,true);
$('compass').onclick=()=>controls.northUp();
$('map-select').onchange=load;
// Gateway reach of this map; the default is not stored.
for(const [id,key,fallback] of [['reach-cable','cableReach',CABLE_REACH],['reach-lora','loraReach',LORA_REACH]])$(id).onchange=e=>{
  const [min,max]=REACH_LIMITS[key],v=Math.round(Number(e.target.value));
  if(!map)return;
  if(!Number.isFinite(v)||v<min||v>max){status(`Jangkauan harus ${min}–${max} m.`,true);e.target.value=reachOf(map)[key==='cableReach'?'cable':'lora'];return;}
  change(()=>{const n={...map.network};if(v===fallback)delete n[key];else n[key]=v;if(Object.keys(n).length)map.network=n;else delete map.network;},{tidy:false});
};
for(const id of ['layer-markings','layer-sidewalks','layer-lots','layer-graph','layer-objects','layer-links'])$(id).onchange=()=>map&&rebuild();
$('download').onclick=download;
// Drop a .json file anywhere on the page to open it.
window.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault();});
window.addEventListener('drop',e=>{const file=e.dataTransfer.files?.[0];if(file&&/\.json$/i.test(file.name)){e.preventDefault();openFile(file);}});

// ---------------------------------------------------------------- assets (toolbox)
// Smart placement unless Alt is held; a free placement keeps the current rotation.
function placementFor(assetId,p,free,rotation=0){
  const asset=objects.assets.get(assetId);
  if(free||!asset)return {x:p.x,z:p.z,rotation,label:'Penempatan bebas'};
  return smartPlace(map,geometry,asset,p);
}
function placeObject(assetId,p,free){
  const placed=placementFor(assetId,p,free);
  if(change(()=>{const o=edit.addObject(map,assetId,placed);selection={type:'object',id:o.id};},{tidy:false}))
    status(`${objects.assets.get(assetId)?.name||assetId} dipasang: ${placed.label}.`);
}
function buildToolbox(manifest){
  const groups=Object.entries(manifest.categories).map(([key,label])=>[key,label,manifest.assets.filter(a=>a.category===key)]).filter(([,,list])=>list.length);
  $('asset-groups').innerHTML=groups.map(([key,label,list],i)=>`<details ${i<2?'open':''}><summary>${CATEGORY_ICONS[key]||''} ${esc(label)} (${list.length})</summary><div class="asset-list">${
    list.map(a=>`<button type="button" class="asset-item" draggable="true" data-asset="${a.id}" aria-pressed="false" title="${esc(a.name)}"><i aria-hidden="true">${CATEGORY_ICONS[key]||'▪'}</i><span>${esc(a.name)}</span></button>`).join('')}</div></details>`).join('');
  for(const b of document.querySelectorAll('[data-asset]')){
    b.onclick=()=>{const same=placeAsset===b.dataset.asset;setTool(same?'select':'place');if(!same){placeAsset=b.dataset.asset;setTool('place');}};
    b.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',b.dataset.asset);e.dataTransfer.effectAllowed='copy';dragAsset=b.dataset.asset;});
    b.addEventListener('dragend',()=>{dragAsset=null;objects.hideGhost();});
  }
}
let dragAsset=null;
canvas.addEventListener('dragover',e=>{
  if(!dragAsset||!map)return;
  e.preventDefault();e.dataTransfer.dropEffect='copy';
  const p=groundPoint(e);if(!p)return;
  const placed=placementFor(dragAsset,p,e.altKey);objects.showGhost(dragAsset,placed);status(placed.label);
});
canvas.addEventListener('dragleave',()=>objects.hideGhost());
canvas.addEventListener('drop',e=>{
  e.preventDefault();const id=e.dataTransfer.getData('text/plain')||dragAsset;objects.hideGhost();dragAsset=null;
  const p=groundPoint(e);if(id&&p&&map)placeObject(id,p,e.altKey);
});
objects.loadManifest().then(buildToolbox).catch(error=>{$('asset-groups').innerHTML=`<p class="hint bad">Daftar aset tidak terbaca (${esc(error.message)}). Jalankan npm run assets.</p>`;});

// ---------------------------------------------------------------- device network
const hexColor=n=>`#${n.toString(16).padStart(6,'0')}`;
function networkRows(id){
  const links=deviceLinks(network,map,id);
  if(!links.length)return DEVICE_ICONS[map.objects.find(o=>o.id===id)?.asset]?'<p class="hint bad">Belum tersambung ke jaringan.</p>':'';
  return `<div class="net-rows"><strong>Jaringan</strong>${links.map(l=>`<span><b class="net-swatch ${l.network}" style="--c:${hexColor(l.color)}"></b>${l.direction} ${esc(l.otherLabel)} ${esc(l.other)} · ${l.label} (${l.latency})</span>`).join('')}</div>`;
}
function renderLegend(){
  const box=$('net-legend');if(!box)return;
  const html=network.visible&&map?legendHtml(map,{live:!!sim}):'';
  box.hidden=!html;if(html)box.querySelector('div').innerHTML=html;
}
// Live readings of one device during the simulation, in a card over the map.
let cardDevice=null;
function showDeviceCard(id){cardDevice=id;network.selected=id;renderDeviceCard();}
function hideDeviceCard(){cardDevice=null;network.selected=null;$('device-card').hidden=true;}
function renderDeviceCard(){
  const card=$('device-card');
  if(!cardDevice||!sim){card.hidden=true;return;}
  const e=sim.engine,o=e.map.objects.find(x=>x.id===cardDevice);if(!o){hideDeviceCard();return;}
  const icon=DEVICE_ICONS[o.asset],rows=deviceReadings(e,network,o);
  // The close button stays; only the readings are redrawn (several times a second).
  if(!card.querySelector('.card-body')){
    card.innerHTML=`<button type="button" class="close" id="device-card-close" aria-label="Tutup">×</button><div class="card-body"></div>`;
    $('device-card-close').onclick=hideDeviceCard;
  }
  card.hidden=false;
  card.querySelector('.card-body').innerHTML=`<h3><i class="${icon.square?'square':''}" style="background:${icon.color}">${icon.glyph}</i>${esc(icon.label)} · ${esc(o.id)}</h3>
<dl>${rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${networkRows(o.id)}
<p class="hint">Angka dari simulasi lalu lintas di peta ini.</p>`;
}

// ---------------------------------------------------------------- simulation
let sim=null;   // {engine, view, paused, accumulator, statsTimer}
async function startSim(){
  if(sim)return;
  let engine;
  try{engine=new TrafficEngine(map,{demand:Number($('sim-demand').value)||0,adaptive:$('sim-adaptive').checked,pedestrians:Math.max(0,Number($('sim-people').value)||0),
    speedSpread:spreadValue(),overtaking:$('sim-overtaking').checked});}
  catch(error){status(`Simulasi tidak bisa dimulai: ${error.message}`,true);return;}
  if(!engine.origins.length){status('Peta belum punya ujung jalan yang tersambung untuk kendaraan masuk dan keluar.',true);return;}
  cancelDrawing();selection=null;activeHandle=null;renderSelection();setTool('select');
  const view=new TrafficView(scene,objects);
  sim={engine,view,paused:false,accumulator:0,statsTimer:0};
  renderSelection();
  document.body.classList.add('simulating');$('sim-people').disabled=true;$('sim-start').hidden=true;$('sim-running').hidden=false;$('sim-stats').hidden=false;
  $('sim-toggle').textContent='■ Hentikan simulasi';$('sim-toggle').setAttribute('aria-pressed','true');
  await view.init(engine);
  const s=engine.summary();
  network.reset();renderLegend();refreshZones();
  status(`Simulasi berjalan: ${s.signals} simpang berlampu (${s.sensedSignals} dengan kamera detektor), ${engine.origins.length} titik masuk, ${engine.busStops.length} halte, ${s.bins} tempat sampah bersensor${engine.pedestrians?`, ${engine.pedestrians.agents.length} pejalan kaki`:''}.`);
  renderSimStats();
}
function stopSim(){
  if(!sim)return;
  sim.view.dispose();sim=null;network.reset();hideDeviceCard();renderLegend();refreshZones();
  // Rebuild the placed assets so their lamp materials return to normal.
  for(const [,holder] of objects.meshes)objects.group.remove(holder);objects.meshes.clear();objects.sync(map);
  document.body.classList.remove('simulating');$('sim-people').disabled=false;$('sim-start').hidden=false;$('sim-running').hidden=true;$('sim-stats').hidden=true;$('sim-pause').textContent='Ⅱ Jeda';
  $('sim-toggle').textContent='▶ Simulasikan';$('sim-toggle').setAttribute('aria-pressed','false');
  status('Simulasi dihentikan. Peta bisa diedit lagi.');
}
// Click a vehicle during the simulation: the camera follows it (Esc or panning stops).
const VEHICLE_NAMES={car:'mobil',minibus:'angkot',truck:'truk sampah'};
function followVehicleAt(event){
  const p=groundPoint(event);if(!p)return;
  const e=sim.engine;let best=null;
  for(const v of e.vehicles){const q=e.position(v,v.len/2),d=Math.hypot(q.x-p.x,q.z-p.z);if(d<6&&(!best||d<best.d))best={v,d};}
  if(!best){if(controls.follow){controls.follow=null;status('Berhenti mengikuti kendaraan.');}return;}
  const id=best.v.id,type=best.v.type;
  controls.follow=()=>{const v=e.vehicles.find(x=>x.id===id);if(!v){status(`${VEHICLE_NAMES[type]} #${id} sudah keluar dari peta.`);return null;}return e.position(v,v.len/2);};
  if(topView)frame(false);
  controls.anim=null;controls.update(0);
  if(controls.distance>45)controls.zoomAt(controls.target.clone(),45/controls.distance);
  status(`Mengikuti ${VEHICLE_NAMES[type]} #${id}. Tekan Esc atau geser peta untuk berhenti.`);
}
function toggleSimPause(){if(!sim)return;sim.paused=!sim.paused;$('sim-pause').textContent=sim.paused?'▶ Lanjutkan':'Ⅱ Jeda';}
function renderSimStats(){
  if(!sim)return;
  const s=sim.engine.summary(),clock=t=>`${String(Math.floor(t/3600)).padStart(2,'0')}:${String(Math.floor(t/60)%60).padStart(2,'0')}:${String(Math.floor(t)%60).padStart(2,'0')}`;
  const t=s.vehicleTypes,rows=[['Waktu simulasi',clock(s.time)],['Kendaraan di peta',s.active],['Angkot · truk sampah',`${t.minibus} · ${t.truck}`],['Sedang berhenti',s.waiting],['Antre di luar peta',s.backlog],
    ['Perjalanan selesai',s.completed],['Rata-rata tempuh',s.completed?`${fmt(s.averageTravel)} dtk`:'—'],['Total waktu antre',`${fmt(s.queueSeconds/60,0)} mnt`],['Arus keluar',`${fmt(s.throughput,0)} /jam`]];
  if(s.signals)rows.push(['Simpang dengan kamera detektor',`${s.sensedSignals} dari ${s.signals}`],['Kendaraan terhitung kamera',fmt(sim.engine.sensors.reduce((n,x)=>n+x.count,0),0)]);
  if(sim.engine.busStops.length)rows.push(['Angkot singgah di halte',s.busStops]);
  rows.push(['Kendaraan menyalip',s.overtakes]);
  if(s.bins)rows.push(['Tempat sampah dikosongkan',s.binsEmptied],['Tempat sampah penuh',s.binsFull]);
  if(s.pedestrians)rows.push(['Pejalan kaki menyeberang',s.pedestrians.crossings],['Menunggu menyeberang',s.pedestrians.waiting]);
  $('sim-stats').innerHTML=rows.map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('');
  showAdaptiveNote();renderDeviceCard();
}
function stepSim(delta){
  if(!sim||sim.paused)return;
  sim.accumulator+=delta*Number($('sim-speed').value);
  let steps=0;while(sim.accumulator>=0.25&&steps++<400){sim.engine.step(0.25);sim.accumulator-=0.25;}
  if(steps>=400)sim.accumulator=0;
  sim.view.update();
  sim.statsTimer+=delta;if(sim.statsTimer>0.3){sim.statsTimer=0;renderSimStats();}
}
$('sim-toggle').onclick=()=>sim?stopSim():startSim();
$('sim-pause').onclick=toggleSimPause;$('sim-stop').onclick=stopSim;$('sim-start').onclick=startSim;
$('sim-demand').onchange=e=>{if(sim)sim.engine.demand=Math.max(0,Number(e.target.value)||0);};
// Both apply at once: the spread to drivers arriving from now on, overtaking to everyone.
function spreadValue(){return Math.min(30,Math.max(0,Number($('sim-spread').value)||0))/100;}
$('sim-spread').onchange=()=>{if(sim)sim.engine.speedSpread=spreadValue();};
$('sim-overtaking').onchange=e=>{if(sim)sim.engine.overtaking=e.target.checked;};
$('sim-adaptive').onchange=e=>{if(sim)sim.engine.adaptive=e.target.checked;showAdaptiveNote();};
// Adaptive lights only work where a camera watches the junction; say so when some lack one.
function showAdaptiveNote(){
  const note=$('sim-adaptive-note');
  if(!$('sim-adaptive').checked||!map){note.hidden=true;return;}
  let signals,sensed;
  if(sim){const s=sim.engine.summary();signals=s.signals;sensed=s.sensedSignals;}
  else{signals=geometry.junctions.filter(j=>map.nodes.find(n=>n.id===j.id)?.signal===true).length;sensed=null;}
  note.hidden=false;
  note.textContent=sensed===null?'Lampu hanya adaptif di arah yang dipantau kamera detektor antrean (di seberang simpang, menghadap arus datang).'
    :sensed<signals?`${signals-sensed} dari ${signals} simpang berlampu belum punya kamera detektor dan tetap memakai waktu tetap. Pasang kamera detektor antrean di seberang simpang itu, menghadap arus datang, atau pakai "Isi aset otomatis".`
    :'Semua simpang berlampu punya kamera detektor.';
}
$('furnish').onclick=()=>{
  let result;
  if(change(()=>{result=furnish(map);if(!result.total)throw Error('Tidak ada aset baru: tempat yang cocok sudah terisi.');},{tidy:false}))
    status(`${result.total} aset dipasang otomatis: ${Object.entries(result.added).map(([id,n])=>`${n} ${objects.assets.get(id)?.name.split(' · ')[0].toLowerCase()||id}`).join(', ')}.`);
};

const resize=()=>{const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
new ResizeObserver(resize).observe(stage);resize();
// Handles keep a constant screen size while zooming.
let lastDistance=0,lastFrame=performance.now();
renderer.setAnimationLoop(now=>{
  const delta=Math.min((now-lastFrame)/1000,0.1);lastFrame=now;
  stepSim(delta);
  network.update(sim?.paused?0:delta,camera,canvas.clientHeight,sim?.engine||null);
  zones.update(sim?.paused?0:delta,camera,canvas.clientHeight,{selected:sim?cardDevice:selection?.id,live:!!sim});
  sim?.view.layoutTimers(camera,canvas.clientHeight);
  controls.update(delta);
  const d=camera.position.distanceTo(controls.target);
  if(Math.abs(d-lastDistance)>d*0.02){lastDistance=d;if(map)renderSelection();}
  renderer.render(scene,camera);
});
offerDraft();load();
window.mapEditor={get map(){return map;},get geometry(){return geometry;},get selection(){return selection;},load,frame,focus,setTool,undo,redo,objects,
  select(sel){selection=sel;renderSelection();},phaseArrows,startSim,stopSim,get sim(){return sim;},
  // For browser tests: screen position of a map point.
  camera:controls,network,zones,
  screen(x,z,y=0){const v=new THREE.Vector3(x,y,z).project(camera),r=canvas.getBoundingClientRect();return {x:r.left+(v.x+1)/2*r.width,y:r.top+(1-v.y)/2*r.height};}};
