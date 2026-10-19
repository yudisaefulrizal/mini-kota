import {addTurnSignals,updateTurnSignals,trafficTurnSignal} from './turn-signals.js';
import {toMapUnits,CAR_LENGTH_METRES} from './scale.js';
import * as THREE from 'three';
import {createDriving} from './driving.js';
import { MapCamera } from './map/camera-controls.js';
import { DEFAULTS, GROUPS, GROUP_NAMES, LOTS, GATES, shareKey, entryKey, exitKey } from './simulation.js';
import {SimulationComparison} from './comparison.js';
import {DATA_CENTER_SITE,DATA_CENTER_DEFAULTS,dataCenterInventory,estimateDataCenter,validateDataCenter} from './data-center.js';
import {pedestrianSurfaces} from './pedestrian-surfaces.js';
import {signalTimer} from './signal-timer.js';
import './style.css';
import './scenario.css';
import {organizeForm} from './form-ui.js';
import {createDeviceOverlay,DEVICE_KINDS} from './device-overlay.js';
import {NETWORKS} from './devices.js';
import {createEquipmentView} from './equipment-view.js';

const $=id=>document.getElementById(id);
const updatePopulationEstimate=()=>{
  const inputs=GROUPS.map(k=>document.querySelector(`[name=${k}]`)),size=document.querySelector('[name=householdSize]');
  const valid=inputs.every(e=>e.validity.valid),total=inputs.reduce((sum,e)=>sum+e.valueAsNumber,0);
  $('population-estimate').textContent=valid?`${total.toLocaleString('id-ID')} orang`: '—';
  $('household-estimate').textContent=valid&&total>0&&size.validity.valid?Math.max(1,Math.round(total/size.valueAsNumber)).toLocaleString('id-ID'):'—';
  $('demography-shares').textContent=valid&&total>0?GROUP_NAMES.map((name,i)=>`${name}: ${(inputs[i].valueAsNumber/total*100).toLocaleString('id-ID',{maximumFractionDigits:1})}%`).join(' · '):'Persentase dihitung setelah jumlah penduduk diisi.';
};
const fields=(target,items)=>{$(target).innerHTML=items.map(([key,label,min=0,max=100,step=1])=>`<label class="field">${label}<input type="number" name="${key}" value="${DEFAULTS[key]}" min="${min}" max="${max}" step="${step}" required></label>`).join('');};
// One row per gate, so the shares for a gate sit together instead of in separate lists.
const shareBox=key=>`<input type="number" name="${key}" value="${DEFAULTS[key]}" min="0" max="100" step="1" required>`;
const gateShares=(target,heads,keys)=>{$(target).style.setProperty('--share-cols',keys.length);
  $(target).innerHTML=`<div class="gate-share-head"><span>Gerbang</span>${heads.map(h=>`<span>${h}</span>`).join('')}</div>`
  +GATES.map(g=>`<div class="gate-share-row"><span>${g.name}</span>${keys.map(k=>shareBox(k(g.id))).join('')}</div>`).join('');};
fields('demography-fields',GROUPS.map((k,i)=>[k,`${GROUP_NAMES[i]} (orang)`,0,20000,1]));
for(const name of [...GROUPS,'householdSize'])document.querySelector(`[name=${name}]`).addEventListener('input',updatePopulationEstimate);
updatePopulationEstimate();
fields('ownership-fields',[['noCar','Tanpa mobil (%)'],['oneCar','Satu mobil (%)'],['twoCars','Dua mobil (%)'],['usage','Peluang mobil dipakai hari ini (%)']]);
$('form-error').insertAdjacentHTML('beforebegin','<details open><summary>Komuter & gerbang kota</summary><div id="commuter-fields"></div><div id="commuter-gates"></div></details>');
fields('commuter-fields',[['outboundWorkers','Pekerja lokal bekerja di luar (%)'],['outboundUniversity','Mahasiswa kuliah di luar (%)'],['incomingFill','Lowongan diisi pekerja luar (%)'],['incomingCar','Pekerja luar memakai mobil (%)'],['externalMinutes','Perjalanan di luar (menit)',5,600]]);
gateShares('commuter-gates',['Bobot %'],[shareKey]);
fields('schedule-fields',[['schoolStart','Sekolah · masuk',6,21,.25],['schoolEnd','Sekolah · pulang',6,22,.25],['shopStart','Belanja · buka',6,21,.25],['shopEnd','Belanja · tutup',6,22,.25]]);
$('form-error').insertAdjacentHTML('beforebegin','<details open><summary>Peluang jumlah tujuan</summary><div id="destination-fields"></div></details>');
fields('destination-fields',[['oneDestination','1 tujuan (%)'],['twoDestinations','2 tujuan (%)'],['threeDestinations','3 tujuan (%)']]);
$('form-error').insertAdjacentHTML('beforebegin','<details open><summary>Kendaraan melintas acak</summary><div id="through-fields"></div><div id="through-gates"></div></details>');
fields('through-fields',[['throughRate','Arus dasar (kendaraan/jam)',0,5000]]);
$('through-fields').insertAdjacentHTML('beforeend','<p>Rata-rata kedatangan seluruh gerbang per jam simulasi, bukan jumlah mobil di jalan. Pukul 07–09 dan 16–19: ×1,6; pukul 21–06: ×0,35; jam lainnya: ×1. Jumlah aktual berfluktuasi secara acak. Nilai 0 menghentikan kedatangan baru.</p>');
gateShares('through-gates',['Masuk %','Keluar %'],[entryKey,exitKey]);
organizeForm();


const comparison=new SimulationComparison();
let dataCenterConfig={...DATA_CENTER_DEFAULTS};
let dataCenterDevices=dataCenterInventory(comparison.smart);
let sim=comparison.baseline,paused=false,multiplier=60,fastForward=0;
const scene=new THREE.Scene();scene.background=new THREE.Color('#e4eae0');
const viewport=$('viewport');const camera=new THREE.PerspectiveCamera(40,1,1,6000);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true});}catch(error){$('loading').textContent='WebGL tidak tersedia. Aktifkan akselerasi grafis browser.';throw error;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;viewport.appendChild(renderer.domElement);
// Same navigation as the map editor, complete with the mouse: right drag turns and tilts
// round the point under the cursor, left or middle drag pans, the wheel zooms towards the
// cursor (src/map/camera-controls.js). Both cities share one camera.
const mapViewEls=()=>[$('baseline-view'),$('smart-view')];
const controls=new MapCamera(camera,renderer.domElement,{pickables:()=>[city],bounds:()=>({x0:-768,z0:-512,width:1536,depth:1024}),maxDistance:3500,keysOnHover:true,
  viewRect:(x,y)=>{const rects=mapViewEls().map(el=>el.getBoundingClientRect()).filter(r=>r.width>0);return rects.find(r=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)||rects[0];},
  onChange:()=>{const c=document.getElementById('city-compass');if(c)c.firstElementChild.style.transform=`rotate(${controls.compassAngle()}rad)`;},
  onLeaveTop:()=>setViewButtons(false)});
controls.minDistance=180;
scene.add(controls.marker);
let topView=false;
function setViewButtons(top){topView=top;$('top').classList.toggle('active',top);$('perspective').classList.toggle('active',!top);}
function view(top=topView){
  setViewButtons(top);const scale=Math.max(1,1.4/camera.aspect);
  controls.anim=null;controls.topView=top;
  controls.set(new THREE.Vector3(top?0:370*scale,top?1650*scale:1250*scale,top?0.001:1100*scale),new THREE.Vector3(0,0,0));
}
// Fly to a spot (device, data centre) and look at it from the given offset.
function lookAt(x,y,z,offset){if(topView)setViewButtons(false);controls.topView=false;controls.flyTo(new THREE.Vector3(x+offset[0],offset[1],z+offset[2]),new THREE.Vector3(x,y,z));}
scene.add(new THREE.HemisphereLight(0xffffff,0x89977c,2));
const sun=new THREE.DirectionalLight(0xfff4e0,2);sun.position.set(-450,900,-350);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-1000,right:1000,top:850,bottom:-850,far:2200});sun.shadow.bias=-.001;scene.add(sun);
const city=new THREE.Group();let fleet=new THREE.Group();scene.add(city,fleet);
const materials=new Map(),cube=new THREE.BoxGeometry(1,1,1),crownGeo=new THREE.IcosahedronGeometry(1,1),bulbGeo=new THREE.SphereGeometry(2,8,6);
function mat(color){if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.85}));return materials.get(color);}
function box(w,h,d,color,x,y,z,parent=city){const m=new THREE.Mesh(cube,mat(color));m.scale.set(w,h,d);m.position.set(x-768,y,z-512);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function label(text,x,z,size=16){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='#f8faf2e8';ctx.roundRect(0,0,512,64,12);ctx.fill();ctx.fillStyle='#294c40';ctx.font='600 27px sans-serif';ctx.textAlign='center';ctx.fillText(text,256,42);const texture=new THREE.CanvasTexture(canvas);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));s.position.set(x-768,32,z-512);s.scale.set(size*8,size,1);city.add(s);return s;}
const mapTexture=await new THREE.TextureLoader().loadAsync(new URL('../map-mini-kota.png',import.meta.url).href).catch(error=>{$('loading').textContent='Peta gagal dimuat. Muat ulang halaman.';throw error;});
mapTexture.colorSpace=THREE.SRGBColorSpace;mapTexture.anisotropy=renderer.capabilities.getMaxAnisotropy();
const ground=new THREE.Mesh(new THREE.PlaneGeometry(1536,1024),new THREE.MeshStandardMaterial({map:mapTexture,roughness:1}));
ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;city.add(ground);
box(1540,12,1028,'#c5d1bc',768,-7,512);
// Buildings overlay the original reference; road geometry lives in the simulation graph.
const buildings=[[797,133,43,49,57],[861,117,42,47,94],[914,141,31,37,65],[846,250,32,39,42],[919,257,63,35,35],[300,254,39,32,24],[372,252,34,32,27],[234,308,28,30,21],[374,308,29,29,23],[450,315,28,31,28],[1101,265,51,51,60],[1164,308,31,50,87],[1180,326,36,29,36],[853,574,141,42,50],[806,611,48,42,31],[553,594,29,26,30],[598,582,40,38,39],[531,677,33,22,25],[482,677,26,26,21],[455,851,32,32,28],[549,851,35,30,29],[593,851,29,29,28],[463,917,33,28,25],[580,952,32,31,30],[636,904,35,29,24],[854,858,35,27,28],[926,897,33,29,27],[1366,643,47,68,57],[1449,656,77,55,45]];
for(const [x,z,w,d,h] of buildings){box(w,h,d,'#e1e7dc',x,h/2,z);box(w+2,2,d+2,'#92a89b',x,h+1,z);for(let y=9;y<h-4;y+=12)for(let dx=-w/2+8;dx<w/2-5;dx+=12)box(5,5,.6,'#86a3a2',x+dx,y,z+d/2+.5);}
// Data center occupies the unassigned riverside block south of the business area.
const dataCenterBuilding=new THREE.Group();city.add(dataCenterBuilding);
const dcBox=(...args)=>box(...args,dataCenterBuilding);
const dc=DATA_CENTER_SITE,dcX=dc.x+dc.w/2,dcZ=dc.z+dc.h/2;
dcBox(dc.w,1,dc.h,'#aec4c6',dcX,.7,dcZ);
dcBox(70,26,62,'#365960',dcX,14,dcZ);
dcBox(74,2,66,'#173d48',dcX,28,dcZ);
for(let i=0;i<4;i++){
  dcBox(10,5,14,'#95b5bd',dcX-25+i*16,31,dcZ-14);
  dcBox(9,12,1,'#6ec8cf',dcX-25+i*16,15,dcZ+31.6);
}
dcBox(12,16,2,'#193b45',dc.x+17,9,dcZ+20);
dcBox(18,8,12,'#789a9d',dcX+30,5,dc.z+dc.h-10);
const dataCenterSign=label('DATA CENTER',dcX,dc.z+dc.h+4,22);dataCenterSign.position.y=46;
box(90,2,115,'#c7c2ae',345,1,911);
box(65,23,65,'#80977a',342,13,916);
box(70,3,70,'#436a50',342,26,916);
for(let i=0;i<3;i++)box(12,10,15,['#6f9959','#dfb755','#687f91'][i],320+i*20,6,865);
const treeLocations=[[793,39],[829,26],[879,36],[920,54],[783,225],[807,334],[912,324],[947,347],[234,238],[338,250],[409,266],[451,234],[204,346],[393,350],[100,273],[73,497],[230,480],[279,507],[374,483],[419,515],[228,579],[270,569],[309,595],[355,626],[321,657],[594,478],[626,509],[524,630],[609,272],[596,348],[1073,214],[1225,347],[814,494],[901,495],[1086,475],[1122,516],[1169,474],[1090,566],[1058,610],[814,720],[934,720],[449,864],[384,850],[386,918],[528,945],[638,840],[865,906],[947,950],[1297,714],[1394,562]];
treeLocations.filter(([x,z])=>x<dc.x-8||x>dc.x+dc.w+8||z<dc.z-8||z>dc.z+dc.h+8).forEach(([x,z],i)=>{box(2,10,2,'#8c8368',x,5,z);const tree=new THREE.Mesh(crownGeo,mat(['#8fad72','#9dbb7e','#759b60'][i%3]));tree.position.set(x-768,17,z-512);tree.scale.set(8,12,8);tree.castShadow=true;city.add(tree);});
// Render the same sidewalks and crossings that pedestrians use for routing.
function pathStrip(a,b,width,color,height=.25){
  const length=Math.hypot(b.x-a.x,b.z-a.z);
  const mesh=box(width,.25,length,color,(a.x+b.x)/2,height,(a.z+b.z)/2);
  mesh.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);mesh.castShadow=false;
}
for(const {a,b,kind} of pedestrianSurfaces(sim.pedestrianNetwork,sim)){
    if(kind==='crossing'){
      const length=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
      for(let at=0;at<length;at+=4){const p={x:a.x+dx*at,z:a.z+dz*at},stripe=Math.min(2,length-at);pathStrip(p,{x:p.x+dx*stripe,z:p.z+dz*stripe},5,'#fff9df',.4);}
    }else pathStrip(a,b,kind==='access'?4:6,'#d4c7ac');
}
const walkerBody=new THREE.InstancedMesh(new THREE.CylinderGeometry(.85,1,2.7,6),mat('#bd6542'),20000);
const walkerHead=new THREE.InstancedMesh(new THREE.SphereGeometry(.8,6,4),mat('#f0c6a0'),20000);
walkerBody.count=walkerHead.count=0;walkerBody.frustumCulled=walkerHead.frustumCulled=false;
scene.add(walkerBody,walkerHead);
const walkerTransform=new THREE.Object3D();
function renderPedestrians(){
  const walkers=sim.pedestrians;walkerBody.count=walkerHead.count=walkers.length;
  walkers.forEach((trip,i)=>{
    const p=sim.pedestrianPosition(trip),bob=Math.sin((sim.time-trip.depart)*5)*.04;
    walkerTransform.position.set(p.x-768,toMapUnits(1+bob),p.z-512);walkerTransform.rotation.set(0,p.angle,0);walkerTransform.scale.setScalar(toMapUnits(.3));walkerTransform.updateMatrix();walkerBody.setMatrixAt(i,walkerTransform.matrix);
    walkerTransform.position.y=toMapUnits(1.65+bob);walkerTransform.updateMatrix();walkerHead.setMatrixAt(i,walkerTransform.matrix);
  });
  walkerBody.instanceMatrix.needsUpdate=true;walkerHead.instanceMatrix.needsUpdate=true;
}
const lamps=[];
// A lot access may branch off a road and therefore have degree three in the graph;
// it is a driveway, not an intersection that warrants a traffic signal.
for(const edge of sim.edges.filter(e=>sim.hasSignal(sim.nodes[e.to]))){
  const node=sim.nodes[edge.to],{dx,dz,axis,stop}=sim.approach(edge);
  // Local +Z faces approaching traffic; the pole stands on its left verge.
  const assembly=new THREE.Group();assembly.position.set(node.x-dx*stop+dz*24-768,0,node.z-dz*stop-dx*24-512);
  assembly.rotation.y=Math.atan2(-dx,-dz);assembly.scale.setScalar(.45);city.add(assembly);
  const part=(w,h,d,color,x,y,z)=>{const m=new THREE.Mesh(cube,mat(color));m.scale.set(w,h,d);m.position.set(x,y,z);m.castShadow=true;assembly.add(m);return m;};
  part(1.2,17,1.2,'#566b60',0,8.5,0);
  part(7,14,3,'#15251f',0,21,0);
  part(8,1,6,'#15251f',0,28,1.5);
  const bulbs=['#ef6c63','#ffd173','#a9e778'].map((color,i)=>{
    const b=new THREE.Mesh(bulbGeo,new THREE.MeshStandardMaterial({color:'#34473c',emissive:color,emissiveIntensity:0}));
    b.scale.set(.8,.8,.22);b.position.set(0,25-i*4,1.65);assembly.add(b);
    part(4,.5,2.5,'#15251f',0,27-i*4,2.3);return b;
  });
  const timers=['baseline','smart'].map(()=>{
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false}));
    sprite.position.copy(assembly.position);sprite.position.y=20;sprite.scale.set(22,11,1);
    sprite.visible=false;city.add(sprite);
    return {sprite,last:'',phase:null};
  });
  lamps.push({id:node.id,axis,bulbs,timers});
  // The stop line sits ahead of the stopped vehicle's centre, on the incoming lane only.
  const line=box(9,.15,1.2,'#f7f5df',node.x-dx*(stop-5)+dz*5,.12,node.z-dz*(stop-5)-dx*5);
  line.rotation.y=Math.atan2(dx,dz);
}
// Gate markers: the number sits on the gate itself, nudged inward so an edge gate stays on screen.
for(const g of GATES){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#2f6b4f';ctx.beginPath();ctx.arc(64,64,58,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#f8faf2';ctx.lineWidth=7;ctx.stroke();
  ctx.fillStyle='#f8faf2';ctx.font='700 68px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(g.number,64,68);
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false}));
  const [gx,gz]=g.gate,[rx,rz]=g.road,len=Math.hypot(rx-gx,rz-gz)||1;
  sprite.position.set(gx+(rx-gx)/len*34-768,46,gz+(rz-gz)/len*34-512);
  sprite.scale.set(52,52,1);city.add(sprite);
}
// Each bin sits beside the vehicle access, with a short footpath into its area.
const wasteBins=sim.waste.sources.map(l=>{
  const {bin,route}=l.waste;
  const binGroup=new THREE.Group();binGroup.position.set(bin.x-768,0,bin.z-512);binGroup.scale.setScalar(.35);city.add(binGroup);
  const binBox=(w,h,d,color,x,y,z)=>{const part=box(w,h,d,color,768+x-bin.x,y,512+z-bin.z,binGroup);return part;};
  pathStrip(route.points[0],bin,3,'#d4c7ac');
  binBox(14,.6,14,'#c5c5b6',bin.x,.5,bin.z);
  binBox(10,1,9,'#42694f',bin.x,1.5,bin.z);
  for(const dx of [-4.5,4.5])binBox(1,9,9,'#42694f',bin.x+dx,6,bin.z);
  for(const dz of [-4,4])binBox(10,9,1,'#547e5a',bin.x,6,bin.z+dz);
  for(const dx of [-3,3])binBox(2,2,2,'#35423c',bin.x+dx,1,bin.z+4);
  const fill=binBox(8,1,7,'#aaa477',bin.x,3,bin.z);
  binBox(11,1,3,'#355e45',bin.x,11,bin.z-4);
  const sprite=label('',bin.x,bin.z-24,22);sprite.position.y=30;

  return {id:l.id,fill,sprite,last:''};
});
const depotLabel=label('',342,916,15);
const parkingLabels=LOTS.filter(l=>l.id!=='dataCenter').map(l=>({id:l.id,sprite:label('',l.x+l.w/2,l.z+l.h/2,19),last:''}));
function paintMapLabel(sprite,text,color='#294c40',fontSize=27){
  const texture=sprite.material.map,ctx=texture.image.getContext('2d');
  ctx.clearRect(0,0,512,64);ctx.fillStyle='#f8faf2ed';ctx.fillRect(0,0,512,64);
  ctx.fillStyle=color;ctx.font=`600 ${fontSize}px sans-serif`;ctx.textAlign='center';ctx.fillText(text,256,46,492);texture.needsUpdate=true;
}
function updateParkingLabels(){
  for(const item of parkingLabels){
    const lot=sim.lots[item.id],text=`${lot.name} · P ${lot.occupied.size}`;
    if(text!==item.last){item.last=text;paintMapLabel(item.sprite,text);}
  }
  for(const item of wasteBins){
    const w=sim.lots[item.id].waste,full=w.amount>=w.capacity;
    const text=`Sampah ${w.amount.toLocaleString('id-ID',{maximumFractionDigits:1})} kg${full?' · PENUH':''}`;
    if(text!==item.last){item.last=text;paintMapLabel(item.sprite,text,full?'#a33b25':'#426546',40);}
    const level=Math.min(1,w.amount/w.capacity);
    item.fill.visible=w.amount>0;item.fill.scale.y=Math.max(.3,level*8);item.fill.position.y=2+level*4;
    item.fill.material=mat(full?'#ae6748':level>.5?'#c3ab65':'#aaa477');
  }
  const text=`Stok ${sim.waste.storage.toLocaleString('id-ID',{maximumFractionDigits:1})} kg`;
  if(depotLabel.userData.text!==text){depotLabel.userData.text=text;paintMapLabel(depotLabel,text);}
}
const wasteWalkers=sim.waste.sources.map(l=>{
  const group=new THREE.Group();scene.add(group);
  box(1.8,2.8,1.4,'#4d8579',768,3.5,512,group);
  const head=new THREE.Mesh(bulbGeo,mat('#efc39b'));head.scale.setScalar(.5);head.position.y=6;group.add(head);
  const legs=[-0.55,.55].map(x=>box(.7,2,.8,'#3d515b',768+x,1.2,512,group));
  const arm=box(.6,2,.6,'#efc39b',769.4,3.5,512,group);
  const bag=new THREE.Mesh(crownGeo,mat('#454c42'));bag.position.set(1.6,2.1,0);bag.scale.set(.9,1.3,.9);group.add(bag);
  group.scale.setScalar(toMapUnits(.25));group.visible=false;
  return {id:l.id,group,legs,arm,bag};
});
function renderWasteWalkers(){
  for(const item of wasteWalkers){
    const trip=sim.waste.walkers.find(t=>t.lot===item.id);item.group.visible=!!trip;if(!trip)continue;
    const p=sim.waste.walkPosition(trip),atBin=sim.time>=trip.depositAt-4&&sim.time<trip.depositAt;
    const stride=atBin?0:Math.sin((sim.time-trip.depart)*7)*.55;
    item.group.position.set(p.x-768,.3,p.z-512);item.group.rotation.y=p.angle;
    item.legs[0].rotation.x=stride;item.legs[1].rotation.x=-stride;
    item.arm.rotation.x=atBin?-1.1:0;item.bag.visible=p.carrying;item.bag.position.y=atBin?3.4:2.1;
  }
}

let meshes=[];
const baselineFleet={group:fleet,meshes,visiblePedestrians:0,visibleWasteWalkers:0};
const smartFleet={group:new THREE.Group(),meshes:[]};scene.add(smartFleet.group);
// Map menu: both cities, one city, or the smart city with its planned devices.
const MAP_MODES={compare:'Perbandingan lalu lintas',baseline:'Kota biasa',smart:'Kota cerdas',devices:'Kota cerdas × perangkat',equipment:'Perangkat kota cerdas',editor:'Editor peta'};
let mapMode='compare';
// "Perangkat" replaces the map with the device diagram and live device list.
const DEVICE_MODES=new Set(['devices']),SMART_MODES=new Set(['smart','devices','equipment']);
const showsDevices=()=>DEVICE_MODES.has(mapMode);
const deviceOverlay=createDeviceOverlay(comparison.smart);scene.add(deviceOverlay.group);
const escapeHtml=text=>String(text).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const deviceCounts=deviceOverlay.counts();
$('device-legend').innerHTML=`<details${matchMedia('(max-width: 650px)').matches?'':' open'}><summary>Perangkat</summary><div>`+Object.entries(DEVICE_KINDS).map(([k,v])=>`<span><i class="${k==='gw'?'square':''}" style="background:${v.color}">${v.glyph}</i>${v.label} · ${deviceCounts[k]}</span>`).join('')+`<strong class="legend-sub">Jaringan</strong>${['lan','fiber','lora'].map(k=>`<span><b style="background:#${NETWORKS[k].color.toString(16).padStart(6,'0')}"></b>${NETWORKS[k].label}</span>`).join('')}<small>Klik ikon untuk detail.</small></div></details>`;
function renderDeviceCard(){
  const site=deviceOverlay.selected,card=$('device-card');
  if(!site||!showsDevices()){card.hidden=true;return;}
  const d=deviceOverlay.describe(site,comparison.smart,dataCenterConfig.sampleSeconds);
  card.hidden=false;
  card.innerHTML=`<button type="button" class="device-card-close" aria-label="Tutup detail perangkat">×</button><p class="device-card-kind" style="color:${d.kind.color}">${escapeHtml(d.kind.label)}</p><h3>${escapeHtml(d.location)}</h3>
<dl class="device-card-readings">${readingRows(d.rows)}</dl>
<p class="device-card-note">Pembacaan berasal dari model simulasi kota cerdas, sebagai pengganti data perangkat.</p>
<h4>Alur data</h4><p class="device-card-flow">${d.flow.filter(Boolean).map(escapeHtml).join(' → ')}</p>
<h4>Jaringan</h4><ul class="device-card-networks">${d.networks.map(n=>`<li><strong>${escapeHtml(n.to)}:</strong> ${escapeHtml(n.label)}</li>`).join('')}</ul>
<h4>Isi perangkat</h4><dl class="device-card-spec"><dt>Perangkat</dt><dd>${escapeHtml(d.device.name)}</dd><dt>Sistem operasi</dt><dd>${escapeHtml(d.device.os)}</dd><dt>Perangkat lunak</dt><dd>${escapeHtml(d.device.software)}</dd></dl>
<details><summary>Proses yang dijalankan</summary><ol>${d.process.map(p=>`<li>${escapeHtml(p)}</li>`).join('')}</ol></details>
<div class="device-card-actions"><button type="button" class="device-card-zoom">Lihat dekat</button><a href="./diagram-3d.html" target="_blank" rel="noopener">Lihat di diagram 3D ↗</a></div>`;
  card.querySelector('.device-card-zoom').onclick=()=>lookAt(site.x-768,6,site.z-512,[38,48,60]);
  card.querySelector('.device-card-close').onclick=()=>{deviceOverlay.select(null);renderDeviceCard();};
}
const readingRows=rows=>rows.map(([k,v])=>`<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
// Live values refresh in place so an open "Proses" section and scroll position survive.
function updateDeviceReadings(){
  const site=deviceOverlay.selected,list=$('device-card').querySelector('.device-card-readings');
  if(!site||!list||!showsDevices())return;
  const html=readingRows(deviceOverlay.describe(site,comparison.smart,dataCenterConfig.sampleSeconds).rows);
  if(list.innerHTML!==html)list.innerHTML=html;
}
const equipmentView=createEquipmentView({root:$('equipment-view'),overlay:deviceOverlay,getCity:()=>comparison.smart,getSampleSeconds:()=>dataCenterConfig.sampleSeconds,
  onShowOnMap:site=>{setMapMode('devices');deviceOverlay.select(site);renderDeviceCard();lookAt(site.x-768,6,site.z-512,[38,48,60]);viewport.scrollIntoView({behavior:'smooth',block:'center'});}});
function setMapMode(mode){
  mapMode=mode;viewport.dataset.mode=mode;$('equipment-view').hidden=mode!=='equipment';if(mode==='equipment')equipmentView.open();$('map-title').textContent=MAP_MODES[mode];
  // The map editor lives in its own page; it is loaded into the tab the first time it opens.
  $('editor-view').hidden=mode!=='editor';
  if(mode==='editor'&&!$('editor-frame').src)$('editor-frame').src='./editor-peta.html?embed=1';
  for(const tab of document.querySelectorAll('.map-tabs [data-mode]'))tab.setAttribute('aria-selected',String(tab.dataset.mode===mode));
  $('device-legend').hidden=!DEVICE_MODES.has(mode);
  if(!DEVICE_MODES.has(mode))deviceOverlay.select(null);
  // Devices are a few metres tall; allow a closer camera only in this view.
  controls.minDistance=DEVICE_MODES.has(mode)?45:180;
  renderDeviceCard();layoutMaps();ui();
}
document.querySelector('.map-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-mode]');if(tab)setMapMode(tab.dataset.mode);});
function buildFleet(){
  fleet.clear();meshes.length=0;
  ensureFleet();
}
function ensureFleet(){
  for(const car of sim.cars.slice(meshes.length)){const group=new THREE.Group(),color=car.wasteTruck?'#e8a52b':car.service?'#309bc1':['#d9915f','#ead077','#f4efe1','#73a099','#7496b4','#b6c77d','#cf7e70'][car.id%7];
    // Metric vehicle sizes: passenger cars are 4.5 m long, trucks about 7 m.
    box(3.3,1.5,6.8,color,768,1.6,512,group);box(2.8,1.3,3.2,'#cee3df',768,3,511.6,group);box(2.6,.4,2.7,color,768,3.8,511.6,group);
    for(const dx of [-1.65,1.65])for(const dz of [-2,2])box(.7,1.3,1.4,'#35423c',768+dx,.9,512+dz,group);
    if(car.wasteTruck){box(4.2,4,7,'#567b48',768,3,513,group);box(4.4,.7,7.2,'#e8a52b',768,5.2,513,group);}
    group.scale.set(toMapUnits(car.wasteTruck?.6:.5),toMapUnits(car.wasteTruck?.6:.4),toMapUnits(car.wasteTruck?.875:CAR_LENGTH_METRES/6.8));
    addTurnSignals(group,car.wasteTruck?{width:4.4,front:4.6,rear:-3.4,height:2}:undefined);
    fleet.add(group);meshes.push(group);
  }
}
function renderCars(){ensureFleet();for(const c of sim.cars){meshes[c.id].visible=c.state==='driving';if(!meshes[c.id].visible)continue;const p=sim.position(c);meshes[c.id].position.set(p.x-768,.3,p.z-512);meshes[c.id].rotation.y=p.angle;updateTurnSignals(meshes[c.id],trafficTurnSignal(sim,c),performance.now()/1000);}}
const duration=seconds=>{const total=Math.floor(seconds);return `${Math.floor(total/3600).toLocaleString('id-ID')} j ${Math.floor(total/60)%60} m ${total%60} d`;};
const liters=n=>n.toLocaleString('id-ID',{minimumFractionDigits:4,maximumFractionDigits:4});
function updateDataCenter(){
  const d=estimateDataCenter(comparison.smart,dataCenterConfig,dataCenterDevices);
  const num=(n,digits=1)=>n.toLocaleString('id-ID',{maximumFractionDigits:digits});
  $('data-center-summary').innerHTML=[['Sensor direncanakan',`${d.totalSensors} unit`],['Pengendali simpang',`${d.signalControllers} unit`],['Pesan sensor',`${num(d.eventsPerSecond)} / detik`]].map(([name,value])=>`<div><span>${name}</span><strong>${value}</strong></div>`).join('');
  $('data-center-load').textContent=`Kendaraan di jalan kota cerdas: ${d.activeVehicles}. Kapasitas dihitung untuk ${d.sizingVehicles} kendaraan serentak (rencana puncak ${d.config.peakVehicles}).`;
  const sensorHtml=d.sensors.map(s=>`<tr><th scope="row">${s.name}</th><td class="sensor-description"><strong>${s.device}</strong><small>${s.method}</small></td><td>${s.count}</td></tr>`).join('');
  if($('data-center-sensors').innerHTML!==sensorHtml)$('data-center-sensors').innerHTML=sensorHtml;
  $('data-center-controllers').textContent=`Terpisah dari total sensor: ${d.signalControllers} pengendali simpang dan ${d.signalHeads} kepala lampu. Cakupan ${d.roadDirections} ruas terarah dan ${d.sites} akses kawasan.`;
  const compute=[
    ['CPU aplikasi',`${d.vcpu} vCPU`,`Estimasi beban ${num(d.cpuCores,3)} inti CPU; target utilisasi maksimal 60%.`],
    ['RAM aplikasi',`${d.ramGB} GB`,'Termasuk memori dasar, sensor, dan kendaraan dalam skenario.'],
    ['Node komputasi',`${d.totalNodes} node`,`${d.activeNodes} aktif + 1 cadangan; tiap node ${d.nodeVcpu} vCPU / ${d.nodeRamGB} GB RAM.`],
    ['Penyimpanan telemetri',`${num(d.storageGB)} GB`,`${num(d.dailyGB,2)} GB/hari mentah × ${d.config.retentionDays} hari × 2 salinan × 1,3.`],
    ['Lalu lintas jaringan',`${num(d.networkMbps,3)} Mbps`,'Telemetri sensor dengan cadangan 30%; tanpa aliran video.'],
    ['Evaluasi kontrol & rute',`${num(d.signalEvaluationsPerSecond)} + ${num(d.routeEvaluationsPerSecond)} / detik`,'Evaluasi lampu + estimasi evaluasi rute pada beban rencana.'],
  ];
  $('data-center-compute').innerHTML=compute.map(([name,value])=>`<article><span>${name}</span><strong>${value}</strong></article>`).join('');
}
$('data-center-form').addEventListener('input',()=>{
  try{
    if(!$('data-center-form').checkValidity())throw Error('Lengkapi angka dalam rentang yang tersedia. Estimasi terakhir tetap ditampilkan.');
    const input=Object.fromEntries([...new FormData($('data-center-form'))].map(([key,value])=>[key,Number(value)]));
    dataCenterConfig=validateDataCenter(input);$('data-center-error').textContent='';updateDataCenter();
  }catch(error){$('data-center-error').textContent=error.message;}
});
$('data-center-form').addEventListener('submit',event=>event.preventDefault());
$('focus-data-center').onclick=()=>{
  lookAt(dcX-768,0,dcZ-512,[190,410,290]);
};
function updateComparison(){
  updateDataCenter();
  const {baseline,smart,queueSavedSeconds,fuelSavedLiters}=comparison.stats;
  $('smart-clock').textContent=comparison.smart.clock();$('smart-day-label').textContent=`HARI ${String(Math.floor(comparison.smart.time/86400)+1).padStart(2,'0')}`;
  for(const [name,state] of [['baseline',baseline],['smart',smart]]){
    $(`${name}-map-queue`).textContent=`${state.waiting} dalam · ${state.gateWaiting} luar`;
    $(`${name}-map-fuel`).textContent=`${liters(state.idleFuelLiters)} L`;
  }
  $('comparison-results').innerHTML=[
    ['Total waktu antre (dalam + luar)',duration(baseline.totalQueueSeconds),duration(smart.totalQueueSeconds)],
    ['Waktu antre di jalan',duration(baseline.queueSeconds),duration(smart.queueSeconds)],
    ['Waktu antre di gerbang luar',duration(baseline.gateQueueSeconds),duration(smart.gateQueueSeconds)],
    ['BBM idle di jalan',`${liters(baseline.idleFuelLiters)} L`,`${liters(smart.idleFuelLiters)} L`],
    ['Sedang mengantre di jalan',baseline.waiting,smart.waiting],
    ['Menunggu di gerbang luar',baseline.gateWaiting,smart.gateWaiting],
    ['Kendaraan di jalan',baseline.driving,smart.driving],
    ['Perjalanan selesai',baseline.completed,smart.completed],
    ['Pelintas selesai',baseline.throughCompleted,smart.throughCompleted],
    ['Rata-rata perjalanan selesai',`${baseline.averageMinutes.toFixed(1)} menit`,`${smart.averageMinutes.toFixed(1)} menit`],
  ].map(([label,a,b])=>`<tr><th scope="row">${label}</th><td>${a}</td><td>${b}</td></tr>`).join('');
  const difference=(value,format)=>Math.abs(value)<1e-9?'sama':`${format(Math.abs(value))} ${value>0?'lebih rendah':'lebih tinggi'}`;
  $('comparison-saving').textContent=`Cerdas dibanding biasa — waktu antre dalam + luar ${difference(queueSavedSeconds,duration)}; BBM idle di jalan ${difference(fuelSavedLiters,n=>`${liters(n)} L`)}.`;
  $('smart-status').textContent=`${smart.adaptiveSignals} persimpangan adaptif · ${smart.reroutes} perubahan rute aktif.`;
}
function ui(){
  // Detail sections follow the city on screen; comparison mode keeps the baseline (left map).
  const previous=sim;sim=SMART_MODES.has(mapMode)?comparison.smart:comparison.baseline;
  try{uiFor();}finally{sim=previous;}
  const smartDetails=SMART_MODES.has(mapMode);
  $('details-title').innerHTML=smartDetails?'RINCIAN KOTA CERDAS <span>peta yang ditampilkan</span>':`RINCIAN KOTA BIASA <span>${mapMode==='compare'?'kota kiri':'peta yang ditampilkan'}</span>`;
  updateDeviceReadings();if(mapMode==='equipment')equipmentView.refresh();
}
function uiFor(){
  const waste=sim.waste.stats,kg=n=>n.toLocaleString('id-ID',{maximumFractionDigits:1});
  $('waste-summary').innerHTML=[['Dihasilkan hari ini',waste.today.generated],['Diangkut hari ini',waste.today.collected],['Diterima TPS3R hari ini',waste.today.delivered],['Masih di bangunan',waste.inBuildings],['Dibawa orang',waste.carried],['Di tempat sampah',waste.waiting],['Dalam truk',waste.inTrucks],['Tersimpan di TPS3R',waste.storage]].map(([label,value])=>`<div class="mode-row"><span>${label}</span><strong>${kg(value)} kg</strong></div>`).join('')+`<p class="hint">${waste.overflowing} lokasi melebihi kapasitas · ${waste.active}/2 truk aktif · TPS3R ${kg(waste.storage)} / ${kg(waste.storageCapacity)} kg.</p>`;
  $('waste-locations').innerHTML=waste.locations.map(l=>`<div class="parking-row"><div><span>${l.name}${l.amount>l.capacity?' · PENUH':''}</span><strong>${kg(l.amount)} / ${kg(l.capacity)} kg</strong></div><small>${kg(l.rate)} kg/hari · Di bangunan ${kg(l.building)} kg · Terakhir diangkut: ${l.lastCollection===null?'belum':`hari ${Math.floor(l.lastCollection/86400)+1}, ${String(Math.floor(l.lastCollection/3600)%24).padStart(2,'0')}:${String(Math.floor(l.lastCollection/60)%60).padStart(2,'0')}`}</small></div>`).join('');
  $('waste-trucks').textContent=`${waste.walkers} perwakilan kawasan sedang membuang sampah / kembali. Truk hijau-kuning: `+waste.trucks.map(t=>`#${t.number} ${t.status} (${kg(t.load)}/${t.capacity} kg)`).join(' · ');

  updateComparison();const s=sim.stats;$('clock').textContent=sim.clock();$('cars-stat').textContent=s.driving;$('fleet-total').textContent='termasuk melintas';$('waiting-stat').textContent=`${s.waiting} sedang mengantre`;
  const queueSeconds=Math.floor(s.queueSeconds);
  $('queue-time-stat').textContent=`${Math.floor(queueSeconds/3600).toLocaleString('id-ID')} jam ${Math.floor(queueSeconds/60)%60} menit ${queueSeconds%60} detik`;
  $('idle-fuel-stat').textContent=`${s.idleFuelLiters.toLocaleString('id-ID',{minimumFractionDigits:4,maximumFractionDigits:4})} liter`;
  $('parked-stat').textContent=`${s.atHome} / ${s.parked}`;$('internal-stat').textContent=`${s.internal} di akses parkir`;$('completed-stat').textContent=s.completed;$('late-stat').textContent=`${s.late} kedatangan melewati jam masuk`;$('speed-stat').textContent=s.speed.toFixed(0);$('travel-stat').textContent=`Rata-rata perjalanan: ${s.averageMinutes.toFixed(1)} menit`;
  $('population-summary').innerHTML=`<span><strong>${s.population}</strong> penduduk aktual / target <strong>${s.targetPopulation}</strong></span><span><strong>${s.households}</strong> rumah tangga aktual</span><span><strong>${s.localCars}</strong> mobil lokal</span><span><strong>${s.externalCars}</strong> mobil komuter luar</span><div class="demography-counts">${GROUP_NAMES.map((name,i)=>`${name}: ${sim.demography[i]} / ${sim.target[GROUPS[i]]}`).join(' · ')} (aktual / target)</div><div class="demography-counts">${s.incomingResidents} sedang masuk · ${s.outgoingResidents} menunggu / sedang keluar · ${s.serviceVehicles} kendaraan pindahan bersama</div><div class="demography-counts">${s.outbound} penduduk beraktivitas di luar · ${s.visitors} pekerja dari luar · ${s.inside} mobil dalam wilayah · ${s.commuterOutside} mobil lokal/komuter di luar</div>`;
  $('parking-summary').innerHTML=Object.values(sim.lots).filter(l=>!l.home&&!l.external).map(l=>{const n=l.occupied.size,r=l.reserved.size,q=sim.cars.filter(c=>c.state==='driving'&&c.jobs[c.job]?.to===l.id&&c.wait>0).length;return `<div class="parking-row"><div><span>${l.name}</span><strong>${n}</strong></div><small>${r} menuju petak · ${q} pernah menunggu akses</small></div>`;}).join('');
  $('commuter-summary').innerHTML=GATES.map(g=>`<div class="mode-row"><span>${g.name}</span><strong>${sim.crossings[g.id].in} masuk / ${sim.crossings[g.id].out} keluar</strong></div>`).join('')+`<p class="hint">${sim.visitors.filter(p=>p.mode==='transit').length} pekerja luar memakai angkutan umum abstrak.</p>`+Object.entries(sim.workplaces).map(([id,w])=>`<div class="mode-row"><span>${sim.lots[id].name}</span><span>${w.local} lokal + ${w.incoming} luar + ${w.vacant} kosong = ${w.total} pekerjaan</span></div>`).join('');
  $('through-summary').textContent=`${s.throughActive} di jalan · ${s.throughWaiting} menunggu masuk · ${s.throughCompleted} selesai · ${s.throughPlanned} kedatangan sejak mulai`;
  $('mode-summary').innerHTML=[['car','Mobil / penumpang'],['walk','Jalan kaki'],['transit','Angkutan umum'],['home','Tidak bepergian']].map(([key,label])=>`<div class="mode-row"><span>${label}</span><strong>${sim.modeCounts[key]}</strong></div>`).join('');
  $('virtual-summary').textContent=`${sim.pedestrians.length} orang sedang berjalan kaki di peta · ${s.virtualActive-sim.pedestrians.length} dalam perjalanan angkutan umum (tanpa animasi).`;
  $('events').innerHTML=sim.events.length?sim.events.map(e=>`<p>${e}</p>`).join(''):'<p>Mobil menunggu jadwal keberangkatan di rumah.</p>';
  $('day-label').textContent=`HARI ${String(Math.floor(sim.time/86400)+1).padStart(2,'0')}`;
  $('run-status').textContent=paused?'Simulasi dijeda':fastForward?'Memproses +1 jam':'Kota berjalan · perubahan otomatis';
  $('activity-summary').textContent=`Rencana terakhir 1 / 2 / 3 tujuan: ${[1,2,3].map(n=>sim.people.filter(p=>p.residency!=='departed'&&p.activities?.length===n).length).join(' / ')} penduduk. ${sim.skippedStops} kunjungan tambahan dibatalkan karena waktu tidak cukup.`;
  $('pause').textContent=paused?'▶ Lanjutkan simulasi':'Ⅱ Jeda simulasi';
  $('pause').disabled=sim.finished;$('next-hour').disabled=sim.finished;
}
const timerRefresh=new WeakMap();
function updateLamps(){
  const now=performance.now(),previous=timerRefresh.get(sim);
  const refresh=!previous||now-previous.wall>=100||sim.time<previous.time;
  const slot=sim===comparison.smart?1:0,colors={red:'#ef6c63',yellow:'#ffd173',green:'#a9e778'};
  for(const l of lamps){
    const node=sim.nodes[l.id],phase=sim.phase(node,l.axis),active={red:0,yellow:1,green:2}[phase];
    l.bulbs.forEach((b,i)=>{b.material.emissiveIntensity=i===active?2:0;b.material.color.set(i===active?colors[phase]:'#34473c');});
    l.timers.forEach((timer,i)=>{timer.sprite.visible=i===slot;});
    const timer=l.timers[slot];
    // Refresh immediately on colour changes, otherwise at most ten times/sec.
    if(!refresh&&timer.phase===phase)continue;
    const value=signalTimer(sim,node,l.axis),text=`${value.estimated?'~':''}${value.seconds}`;
    if(timer.last===text&&timer.phase===phase)continue;
    const texture=timer.sprite.material.map,ctx=texture.image.getContext('2d');
    ctx.clearRect(0,0,128,64);ctx.fillStyle='#15251ff2';ctx.beginPath();ctx.roundRect(0,0,128,64,10);ctx.fill();
    ctx.fillStyle=colors[phase];ctx.font='700 46px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,64,34,120);
    texture.needsUpdate=true;timer.last=text;timer.phase=phase;
  }
  if(refresh)timerRefresh.set(sim,{wall:now,time:sim.time});
}
function populateForm(config){for(const [key,value] of Object.entries(config)){const field=$('scenario').elements.namedItem(key);if(field)field.value=value;}updatePopulationEstimate();}
let inputTimer;
function applyInputs(){try{
  if(!$('scenario').checkValidity())throw Error('Lengkapi angka yang valid. Pengaturan valid terakhir tetap berjalan.');
  const input={...DEFAULTS};for(const [k,v] of new FormData($('scenario')))input[k]=Number(v);
  comparison.applyConfig(input);$('form-error').textContent='';
  $('apply-status').textContent='Tersimpan · berlaku untuk kedua kota. Progres tetap berjalan.';
  ui();
}catch(error){$('form-error').textContent=error.message;$('apply-status').textContent='Isian belum diterapkan. Simulasi memakai pengaturan valid terakhir.';}}
$('scenario').addEventListener('input',()=>{clearTimeout(inputTimer);inputTimer=setTimeout(applyInputs,350);});
$('scenario').onsubmit=e=>{e.preventDefault();clearTimeout(inputTimer);applyInputs();};
function restart(config){comparison.reset(config);dataCenterDevices=dataCenterInventory(comparison.smart);sim=comparison.baseline;smartFleet.group.clear();smartFleet.meshes.length=0;populateForm(sim.target);paused=false;fastForward=0;accumulator=0;buildFleet();renderCars();renderPedestrians();renderWasteWalkers();ui();$('form-error').textContent='';$('apply-status').textContent='Kedua simulasi dimulai ulang pada 05.30 dengan kondisi awal dan target yang sama.';}
$('pause').onclick=()=>{paused=!paused;ui();};$('speed').oninput=e=>{multiplier=+e.target.value;$('speed-value').textContent=`${multiplier}×`;};
$('next-hour').onclick=()=>{if(!sim.finished){fastForward=Math.min(sim.end,sim.time+3600);paused=false;ui();}};
$('reset').onclick=()=>{clearTimeout(inputTimer);applyInputs();restart(sim.target);};$('top').onclick=()=>view(true);$('perspective').onclick=()=>view(false);$('home').onclick=()=>view();
const driving=createDriving({scene,camera,controls,viewport,obstacles:[...buildings,[dcX,dcZ,74,66],[342,916,70,70],...treeLocations.map(([x,z])=>[x,z,2,2])]});
window.cityDriving={get state(){return driving.state;}};
window.cityCamera=controls;
const mapViews=[$('baseline-view'),$('smart-view')];
const dataCenterRay=new THREE.Raycaster();let mapPointerStart=null;
// A left drag pans (a left click still picks devices and the data centre).
let leftPan=null;
renderer.domElement.addEventListener('pointerdown',event=>{mapPointerStart={x:event.clientX,y:event.clientY};if(event.button===0&&!driving.active)leftPan={x:event.clientX,y:event.clientY,id:event.pointerId};});
renderer.domElement.addEventListener('pointermove',event=>{
  if(!leftPan||event.pointerId!==leftPan.id||Math.hypot(event.clientX-leftPan.x,event.clientY-leftPan.y)<5)return;
  controls.beginDrag('pan',event,leftPan);leftPan=null;
});
window.addEventListener('pointerup',()=>{leftPan=null;});
window.addEventListener('keydown',event=>{
  if(driving.active||event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,select,textarea'))return;
  const key=event.key.toLowerCase();
  if(!controls.hover)return;
  if(key==='home'){event.preventDefault();view();return;}
  if(controls.keyDown(key))event.preventDefault();
});
$('city-compass').onclick=()=>controls.northUp();
renderer.domElement.addEventListener('pointerup',event=>{
  if(driving.active||!mapPointerStart||Math.hypot(event.clientX-mapPointerStart.x,event.clientY-mapPointerStart.y)>5)return;
  mapPointerStart=null;
  const rect=mapViews.map(el=>el.getBoundingClientRect()).find(r=>event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom);
  if(!rect)return;
  camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();
  dataCenterRay.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
  if(showsDevices()){
    deviceOverlay.group.visible=true;const hit=dataCenterRay.intersectObjects(deviceOverlay.pickables,false)[0];
    const site=hit&&(hit.object.userData.site??hit.object.userData.sites?.[hit.instanceId]);
    if(site){deviceOverlay.select(site);renderDeviceCard();return;}
  }
  if(dataCenterRay.intersectObjects([...dataCenterBuilding.children,dataCenterSign],true).length){$('data-center-details').open=true;$('data-center-panel').scrollIntoView({behavior:'smooth',block:'start'});}
});
let mapRects=[];
let lastLayout='';
function layoutMaps(){
  const width=viewport.clientWidth,height=viewport.clientHeight;
  if(!width||!height)return; // hidden ("Perangkat" tab): keep the last size and camera
  renderer.setSize(width,height);
  mapRects=mapViews.map(el=>({x:el.offsetLeft,y:height-el.offsetTop-el.clientHeight,width:el.clientWidth,height:el.clientHeight}));
  const shown=mapRects.find(r=>r.width>0&&r.height>0);
  // Reset the camera only when the map size changes, so returning to a map keeps the view.
  if(!driving.active&&shown){camera.aspect=shown.width/shown.height;camera.updateProjectionMatrix();const key=`${shown.width}x${shown.height}`;if(key!==lastLayout){lastLayout=key;view();}}
}
new ResizeObserver(layoutMaps).observe(viewport);
function renderMap(simulation,assets,rect){
  sim=simulation;fleet=assets.group;meshes=assets.meshes;
  baselineFleet.group.visible=assets===baselineFleet;smartFleet.group.visible=assets===smartFleet;
  deviceOverlay.group.visible=assets===smartFleet&&showsDevices()&&!driving.active;
  renderCars();renderPedestrians();renderWasteWalkers();updateParkingLabels();updateLamps();
  assets.visiblePedestrians=walkerBody.count;assets.visibleWasteWalkers=wasteWalkers.filter(w=>w.group.visible).length;
  camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();
  renderer.setViewport(rect.x,rect.y,rect.width,rect.height);renderer.setScissor(rect.x,rect.y,rect.width,rect.height);
  renderer.render(scene,camera);
}
function renderComparison(){
  if(mapRects.length!==2)return;
  renderer.setScissorTest(true);
  try{if(driving.active){const smart=driving.city==='smart';renderMap(smart?comparison.smart:comparison.baseline,smart?smartFleet:baselineFleet,{x:0,y:0,width:viewport.clientWidth,height:viewport.clientHeight});}else{if(mapRects[0].width>0)renderMap(comparison.baseline,baselineFleet,mapRects[0]);if(mapRects[1].width>0)renderMap(comparison.smart,smartFleet,mapRects[1]);}}
  finally{sim=comparison.baseline;fleet=baselineFleet.group;meshes=baselineFleet.meshes;renderer.setScissorTest(false);}
}
buildFleet();renderCars();renderPedestrians();renderWasteWalkers();ui();view();$('loading').remove();
let last=performance.now(),accumulator=0,uiTimer=0;
renderer.setAnimationLoop(now=>{
  const delta=Math.min((now-last)/1000,.1);last=now;
  if((driving.active||!paused)&&!sim.finished){
    accumulator+=delta*(driving.active?1:fastForward?720:multiplier);let count=0;
    const step=driving.active?1/60:.25;
    while(accumulator>=step&&count++<320){comparison.step(step);accumulator-=step;if(!driving.active&&fastForward&&sim.time>=fastForward){fastForward=0;accumulator=0;break;}if(sim.finished){accumulator=0;break;}}
  }
  uiTimer+=delta;if(uiTimer>.3){ui();uiTimer=0;}if(driving.active)driving.update(delta);else controls.update(delta);if(showsDevices())deviceOverlay.update(paused?0:delta,camera);renderComparison();
});
window.citySimulation={get state(){return {...sim.stats,time:sim.time,paused,finished:sim.finished,green:sim.config.green,target:{...sim.target},modes:{...sim.modeCounts},demography:[...sim.demography],visibleWasteWalkers:baselineFleet.visibleWasteWalkers,wasteBins:wasteBins.length,visiblePedestrians:baselineFleet.visiblePedestrians,walking:sim.pedestrians.length,sidewalkEdges:sim.pedestrianNetwork.edges.length,visibleCars:meshes.filter(m=>m.visible).length,crossings:structuredClone(sim.crossings),workplaces:structuredClone(sim.workplaces)};}};

window.cityComparison={get state(){return {...comparison.stats,dataCenter:estimateDataCenter(comparison.smart,dataCenterConfig,dataCenterDevices),dataCenterSite:{...DATA_CENTER_SITE},paused,time:comparison.baseline.time,smartTime:comparison.smart.time,target:{...comparison.baseline.target},smartTarget:{...comparison.smart.target}};}};
window.cityDevices={
  get state(){return {mode:mapMode,sites:deviceOverlay.sites.length,counts:deviceOverlay.counts(),selected:deviceOverlay.selected?.kind??null};},
  // Page coordinates of a device icon in the smart view, for browser tests.
  screenPoint(index){const rect=$('smart-view').getBoundingClientRect(),p=deviceOverlay.sites[index].sprite.position.clone();camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();p.project(camera);return {x:rect.left+(p.x+1)/2*rect.width,y:rect.top+(1-p.y)/2*rect.height};},
};
