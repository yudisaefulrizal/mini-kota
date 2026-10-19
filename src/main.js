import * as THREE from 'three';
import './theme.js';
import './style.css';
import './scenario.css';
import './app/app.css';
import {MapCamera} from './map/camera-controls.js';
import {miniKotaLengkap} from './map/default-map.js';
import {loadDraft,parseMapFile} from './map/storage.js';
import {importOSM} from './map/osm.js';
import {DEVICE_ICONS} from './map/network.js';
import {deviceReadings,deviceLinks,legendHtml} from './map/device-info.js';
import {City,CITY_NAMES} from './app/city.js';
import {createDriving} from './app/driving.js';
import {createEquipmentView} from './app/equipment.js';
import {DATA_CENTER_DEFAULTS,dataCenterInventory,estimateDataCenter,validateDataCenter} from './app/data-center.js';

// Mini Kota: the same map run twice, side by side. The ordinary city (kota biasa) has
// fixed-time lights and empties its bins on a fixed round; the smart city (kota cerdas)
// adapts its lights to what its cameras count and sends trucks when bin sensors report.
// Maps come from src/map (Mini Kota by default, or a map drawn in the editor / OSM file);
// traffic from src/traffic. Clock starts at 06:00 on day 1.

const $=id=>document.getElementById(id);
const fmt=(n,d=0)=>Number(n).toLocaleString('id-ID',{maximumFractionDigits:d});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const START=6*3600;
const clock=t=>{const s=START+t,day=Math.floor(s/86400)+1,h=Math.floor(s/3600)%24,m=Math.floor(s/60)%60,sec=Math.floor(s)%60;return `HARI ${String(day).padStart(2,'0')} ${[h,m,sec].map(v=>String(v).padStart(2,'0')).join(':')}`;};
const duration=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s/60)%60;return h?`${h} j ${m} mnt`:`${m} mnt ${s%60} dtk`;};

// ---------------------------------------------------------------- renderer & camera
const viewport=$('viewport');
const camera=new THREE.PerspectiveCamera(40,1,0.5,6000);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true});}catch(error){$('loading').textContent='WebGL tidak tersedia. Aktifkan akselerasi grafis browser.';throw error;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));viewport.appendChild(renderer.domElement);
const views={baseline:$('baseline-view'),smart:$('smart-view')};
const manifest=fetch('models/manifest.json').then(r=>r.json());
const cities={baseline:new City('baseline',manifest),smart:new City('smart',manifest)};
let mode='compare',map=null;
const shown=()=>mode==='compare'?['baseline','smart']:mode==='baseline'?['baseline']:['smart'];
// The city under a screen point (each view is a rectangle over the one canvas).
function cityAt(x,y){
  for(const kind of shown()){const r=views[kind].getBoundingClientRect();if(r.width&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)return cities[kind];}
  return cities[shown()[0]];
}
const controls=new MapCamera(camera,renderer.domElement,{
  pickables:()=>shown().flatMap(k=>cities[k].pickables()),bounds:()=>map?.bounds||{width:600,depth:400},keysOnHover:true,
  viewRect:(x,y)=>{const rects=shown().map(k=>views[k].getBoundingClientRect()).filter(r=>r.width>0);return rects.find(r=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)||rects[0];},
  onChange:()=>{const c=$('city-compass');if(c)c.firstElementChild.style.transform=`rotate(${controls.compassAngle()}rad)`;},
  onLeaveTop:()=>setViewButtons(false)});
let topView=false;
function setViewButtons(top){topView=top;$('top').classList.toggle('active',top);$('perspective').classList.toggle('active',!top);}
function view(top=topView){
  if(!map)return;
  setViewButtons(top);const {width,depth}=map.bounds,r=views[shown()[0]].getBoundingClientRect(),aspect=r.width/Math.max(1,r.height)||1.5;
  const fit=Math.max(depth,width/aspect)*1.05,distance=fit/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));
  const center=new THREE.Vector3(width/2,0,depth/2);
  controls.anim=null;controls.topView=top;
  controls.set(top?center.clone().add(new THREE.Vector3(0,distance,0.001)):center.clone().add(new THREE.Vector3(0,distance*0.72,distance*0.72)),center);
}
function lookAt(x,z,distance=60){if(topView)setViewButtons(false);controls.topView=false;controls.flyTo(new THREE.Vector3(x+distance*0.35,distance*0.8,z+distance*0.75),new THREE.Vector3(x,0,z));}

// ---------------------------------------------------------------- settings & loading
let settings=null,paused=false,multiplier=10,fastForward=0,accumulator=0;
function readSettings(){
  const f=$('scenario'),n=name=>Number(f.elements.namedItem(name).value);
  for(const el of f.querySelectorAll('input[type=number]'))if(!el.checkValidity())throw Error(`${el.closest('label').firstChild.textContent.trim()}: ${el.validationMessage}`);
  const population=n('population'),waste=n('wastePerPerson');
  return {demand:n('demand'),pedestrians:n('pedestrians'),green:n('green'),seed:n('seed'),idle:n('idleLitersPerHour'),population,wastePerPerson:waste,
    truckRoundHours:n('truckRoundHours'),
    // Fill per second of each of the map's bins (about 120 kg each).
    binFill:null,dailyWasteKg:population*waste};
}
let mapFile=null;   // {name, map} chosen with "Buka file peta…"
function chosenMap(){
  const source=$('map-source').value;
  if(source==='draft'){const draft=loadDraft();if(draft)return {map:draft.map,label:`draf editor "${draft.map.name||'peta'}"`};$('map-source').value='minikota';throw Error('Belum ada draf di editor peta. Gambar atau buka peta di tab Editor peta dulu.');}
  if(source==='file'&&mapFile)return {map:mapFile.map,label:mapFile.name};
  return {map:miniKotaLengkap(),label:'Mini Kota lengkap'};
}
let loading=null;
async function restart(){
  const run=Symbol();loading=run;
  try{settings=readSettings();$('form-error').textContent='';}catch(error){$('form-error').textContent=error.message;return;}
  let chosen;try{chosen=chosenMap();}catch(error){$('form-error').textContent=error.message;return;}
  const bins=chosen.map.objects.filter(o=>o.asset==='bin-sensor').length;
  settings.binFill=bins?settings.dailyWasteKg/bins/120/86400:null;
  const first=!map;map=chosen.map;
  $('loading').hidden=false;$('loading').textContent='Menyiapkan dua kota…';
  try{await Promise.all(Object.values(cities).map(c=>c.load(map,settings)));}
  catch(error){$('loading').textContent=`Peta tidak bisa dijalankan: ${error.message}`;return;}
  if(loading!==run)return;
  $('loading').hidden=true;accumulator=0;fastForward=0;
  $('map-status').textContent=`${chosen.label}: ${map.roads.length} jalan, ${cities.smart.engine.signals.size} simpang berlampu, ${map.objects.length} aset.`;
  if(!cities.smart.engine.origins.length)$('map-status').textContent+=' Peta belum punya ujung jalan untuk kendaraan masuk.';
  if(first)view(false);
  driving.reload();equipment.reset();if(mode==='equipment')equipment.open();
  hideDeviceCard();renderLegend();renderDataCenter();ui();
}
let inputTimer;
$('scenario').addEventListener('input',e=>{if(e.target.id==='map-source')return;clearTimeout(inputTimer);inputTimer=setTimeout(()=>{$('apply-status').textContent='Pengaturan diterapkan; kedua kota dimulai ulang.';restart();},450);});
$('scenario').onsubmit=e=>{e.preventDefault();restart();};
$('map-source').onchange=()=>restart();
$('open-map').onclick=()=>$('map-file').click();
$('map-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{
    const text=await file.text(),osm=/\.osm$/i.test(file.name)||/^\s*(<\?xml[^>]*>\s*)?<osm[\s>]/.test(text);
    mapFile={name:file.name,map:osm?importOSM(text,{name:file.name.replace(/\.osm$/i,'')}).map:parseMapFile(text)};
    const opt=$('map-source').querySelector('option[value=file]');opt.hidden=false;opt.textContent=`File: ${file.name}`;$('map-source').value='file';
    restart();
  }catch(error){$('form-error').textContent=`Gagal membuka ${file.name}: ${error.message}`;}
};

// ---------------------------------------------------------------- modes (tabs)
const MAP_MODES={compare:'Perbandingan lalu lintas',baseline:'Kota biasa',smart:'Kota cerdas',equipment:'Perangkat kota cerdas',editor:'Editor peta'};
function setMapMode(next){
  mode=next;viewport.dataset.mode=mode;$('map-title').textContent=MAP_MODES[mode];
  for(const b of document.querySelectorAll('.map-tabs [data-mode]'))b.setAttribute('aria-selected',String(b.dataset.mode===mode));
  $('equipment-view').hidden=mode!=='equipment';$('editor-view').hidden=mode!=='editor';
  if(mode==='equipment')equipment.open();
  if(mode==='editor'&&!$('editor-frame').src)$('editor-frame').src='./editor-peta.html?embed=1';
  if(mode!=='smart')hideDeviceCard();
  renderLegend();layout();
}
document.querySelector('.map-tabs').addEventListener('click',e=>{const tab=e.target.closest('[data-mode]');if(tab)setMapMode(tab.dataset.mode);});

// ---------------------------------------------------------------- devices (shown in the smart city tab)
function renderLegend(){
  const box=$('net-legend'),html=mode==='smart'&&cities.smart.map?legendHtml(cities.smart.map,{live:true}):'';
  box.hidden=!html;if(html)box.querySelector('div').innerHTML=html;
}
let cardDevice=null;
function showDeviceCard(id){cardDevice=id;if(cities.smart.network)cities.smart.network.selected=id;renderDeviceCard();}
function hideDeviceCard(){cardDevice=null;if(cities.smart.network)cities.smart.network.selected=null;$('device-card').hidden=true;}
function renderDeviceCard(){
  const card=$('device-card'),c=cities.smart,o=cardDevice&&c.map?.objects.find(x=>x.id===cardDevice);
  if(!o||!c.engine){card.hidden=true;return;}
  if(!card.querySelector('.card-body')){
    card.innerHTML=`<button type="button" class="close" id="device-card-close" aria-label="Tutup">×</button><div class="card-body"></div>`;
    $('device-card-close').onclick=hideDeviceCard;
  }
  const icon=DEVICE_ICONS[o.asset],links=deviceLinks(c.network,c.map,o.id);
  card.hidden=false;
  card.querySelector('.card-body').innerHTML=`<h3><i class="${icon.square?'square':''}" style="background:${icon.color}">${icon.glyph}</i>${esc(icon.label)} · ${esc(o.id)}</h3>
<dl>${deviceReadings(c.engine,c.network,o).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
<div class="net-rows"><strong>Jaringan</strong>${links.length?links.map(l=>`<span><b class="net-swatch ${l.network}" style="--c:#${l.color.toString(16).padStart(6,'0')}"></b>${esc(l.direction)} ${esc(l.otherLabel)} ${esc(l.other)} · ${esc(l.label)} (${esc(l.latency)})</span>`).join(''):'<span>Belum tersambung</span>'}</div>
<p class="hint">Angka dari simulasi kota cerdas.</p>`;
}
// A left click (without dragging) on a device icon opens its card; a left drag pans.
let leftPan=null;
renderer.domElement.addEventListener('pointerdown',e=>{if(e.button===0&&!driving.active)leftPan={x:e.clientX,y:e.clientY,id:e.pointerId};});
renderer.domElement.addEventListener('pointermove',e=>{
  if(!leftPan||e.pointerId!==leftPan.id||Math.hypot(e.clientX-leftPan.x,e.clientY-leftPan.y)<5)return;
  controls.beginDrag('pan',e,leftPan);leftPan=null;
});
renderer.domElement.addEventListener('pointerup',e=>{
  const click=leftPan;leftPan=null;
  if(!click||e.button!==0||mode!=='smart'||!cities.smart.network)return;
  controls.ray(e.clientX,e.clientY);const id=cities.smart.network.pick(controls.raycaster);
  if(id)showDeviceCard(id);else hideDeviceCard();
});
window.addEventListener('pointerup',()=>{leftPan=null;});
window.addEventListener('keydown',e=>{
  if(driving.active||e.ctrlKey||e.metaKey||e.altKey||e.target.closest?.('input,select,textarea'))return;
  if(!controls.hover)return;
  const key=e.key.toLowerCase();
  if(key==='home'){e.preventDefault();view();return;}
  if(controls.keyDown(key))e.preventDefault();
});
$('city-compass').onclick=()=>controls.northUp();

const equipment=createEquipmentView({root:$('equipment-view'),getCity:()=>cities.smart,
  onShowOnMap:o=>{setMapMode('smart');showDeviceCard(o.id);lookAt(o.x,o.z,50);viewport.scrollIntoView({behavior:'smooth',block:'center'});}});

// ---------------------------------------------------------------- numbers
const fuel=s=>(s.queueSeconds+s.backlogSeconds)*settings.idle/3600;
function ui(){
  if(!cities.baseline.engine||!cities.smart.engine)return;
  const b=cities.baseline.engine.summary(),s=cities.smart.engine.summary();
  for(const [kind,sum] of [['baseline',b],['smart',s]]){
    $(`${kind}-clock`).textContent=clock(sum.time);
    $(`${kind}-map-queue`).textContent=`${sum.waiting} dalam · ${sum.backlog} luar`;
    $(`${kind}-map-fuel`).textContent=`${fmt(fuel(sum),2)} L`;
  }
  const rows=[
    ['Waktu antre di jalan',duration(b.queueSeconds),duration(s.queueSeconds)],
    ['Waktu antre masuk kota',duration(b.backlogSeconds),duration(s.backlogSeconds)],
    ['BBM terbuang saat idle',`${fmt(fuel(b),2)} L`,`${fmt(fuel(s),2)} L`],
    ['Perjalanan selesai',fmt(b.completed),fmt(s.completed)],
    ['Rata-rata waktu tempuh',b.completed?`${fmt(b.averageTravel)} dtk`:'—',s.completed?`${fmt(s.averageTravel)} dtk`:'—'],
    ['Perjalanan truk sampah',fmt(b.truckTrips),fmt(s.truckTrips)],
    ['Tempat sampah penuh (akumulasi)',duration(b.binFullSeconds),duration(s.binFullSeconds)],
    ['Simpang adaptif (punya CCTV)','—',`${s.sensedSignals} dari ${s.signals}`],
  ];
  $('comparison-results').innerHTML=rows.map(([k,x,y])=>`<tr><th scope="row">${k}</th><td>${x}</td><td>${y}</td></tr>`).join('');
  const pct=(x,y)=>x>0?Math.round((1-y/x)*100):0;
  const q=pct(b.queueSeconds+b.backlogSeconds,s.queueSeconds+s.backlogSeconds),f=fuel(b)-fuel(s),t=b.truckTrips-s.truckTrips;
  $('comparison-saving').textContent=b.time<60?'Kedua kota baru dimulai…':
    `Cerdas dibanding biasa: waktu antre ${q>=0?`${q}% lebih rendah`:`${-q}% lebih tinggi`}; BBM idle ${fmt(Math.abs(f),2)} L ${f>=0?'lebih hemat':'lebih boros'}; truk sampah ${t>=0?`${t} perjalanan lebih sedikit`:`${-t} perjalanan lebih banyak`}.`;
  const detail=[
    ['Kendaraan di peta',b.active,s.active],['Sedang berhenti',b.waiting,s.waiting],['Antre di luar peta',b.backlog,s.backlog],
    ['Angkot · truk sampah di jalan',`${b.vehicleTypes.minibus} · ${b.vehicleTypes.truck}`,`${s.vehicleTypes.minibus} · ${s.vehicleTypes.truck}`],
    ['Arus keluar',`${fmt(b.throughput)} /jam`,`${fmt(s.throughput)} /jam`],['Angkot singgah di halte',b.busStops,s.busStops],
    ['Tempat sampah dikosongkan',b.binsEmptied,s.binsEmptied],['Tempat sampah penuh sekarang',`${b.binsFull} dari ${b.bins}`,`${s.binsFull} dari ${s.bins}`],
    ['Pejalan kaki menyeberang',b.pedestrians?.crossings??0,s.pedestrians?.crossings??0],['Pelanggaran lampu merah',b.redViolations,s.redViolations],
  ];
  $('city-details-rows').innerHTML=detail.map(([k,x,y])=>`<tr><th scope="row">${k}</th><td>${x}</td><td>${y}</td></tr>`).join('');
  $('run-status').textContent=paused?'Simulasi dijeda':fastForward?'Mempercepat 1 jam…':'Simulasi aktif';
  if(mode==='equipment')equipment.refresh();
  if(mode==='smart')renderDeviceCard();
  if($('data-center-details').open)renderDataCenterLoad();
}

// ---------------------------------------------------------------- data center
let dataCenterConfig={...DATA_CENTER_DEFAULTS};
function renderDataCenter(){
  const m=cities.smart.map;if(!m)return;
  const inv=dataCenterInventory(m);
  $('data-center-sensors').innerHTML=inv.sensors.length?inv.sensors.map(s=>`<tr><th scope="row">${esc(s.name)}<small>${esc(s.status)}</small></th><td><strong>${esc(s.device)}</strong><br>${esc(s.method)}</td><td>${s.count}<small>${esc(s.basis)}</small></td></tr>`).join('')
    :'<tr><td colspan="3">Belum ada sensor di peta ini. Pasang CCTV atau sensor tempat sampah di editor (atau "Isi aset otomatis").</td></tr>';
  $('data-center-controllers').textContent=`Juga terpasang: ${inv.signalControllers} pengendali simpang dengan ${inv.signalHeads} kepala lampu, ${inv.gateways} gateway edge, ${inv.dataCentres} pusat data.`;
  renderDataCenterLoad();
}
function renderDataCenterLoad(){
  const m=cities.smart.map;if(!m)return;
  let e;try{e=estimateDataCenter(m,dataCenterConfig);$('data-center-error').textContent='';}catch(error){$('data-center-error').textContent=error.message;return;}
  $('data-center-summary').innerHTML=[['Sensor',fmt(e.totalSensors)],['Pesan/detik',fmt(e.eventsPerSecond,1)],['vCPU',e.vcpu],['RAM',`${e.ramGB} GB`],['Penyimpanan',`${fmt(e.storageGB,1)} GB`],['Jaringan',`${fmt(e.networkMbps,2)} Mbps`]]
    .map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('');
  $('data-center-load').textContent=`Beban dari ${fmt(e.totalSensors)} sensor dan ${fmt(e.signalControllers)} pengendali simpang. Hanya data agregat (jumlah kendaraan per pendekat, isi tempat sampah); tidak ada identitas atau pelacakan kendaraan, sehingga jumlah kendaraan tidak menambah beban.`;
  $('data-center-compute').innerHTML=`<p>${fmt(e.eventsPerSecond,1)} pesan sensor/detik, ${fmt(e.signalEvaluationsPerSecond)} evaluasi lampu/detik ≈ ${fmt(e.cpuCores,3)} inti CPU → ${e.vcpu} vCPU (beban 60%).</p>
<p>Data harian ${fmt(e.dailyGB,2)} GB; retensi ${e.config.retentionDays} hari dengan 2 salinan + 30% cadangan → ${fmt(e.storageGB,1)} GB.</p>
<p>${e.activeNodes} node aktif (${e.nodeVcpu} vCPU, ${e.nodeRamGB} GB RAM per node) + 1 cadangan = ${e.totalNodes} node.</p>`;
}
$('data-center-form').addEventListener('input',()=>{
  const f=$('data-center-form'),next={};for(const el of f.elements)if(el.name)next[el.name]=Number(el.value);
  try{dataCenterConfig=validateDataCenter(next);renderDataCenterLoad();}catch(error){$('data-center-error').textContent=error.message;}
});
$('data-center-details').addEventListener('toggle',()=>{if($('data-center-details').open)renderDataCenter();});
$('focus-data-center').onclick=()=>{
  const dc=cities.smart.map?.objects.find(o=>o.asset==='data-center');if(!dc)return;
  setMapMode('smart');lookAt(dc.x,dc.z,90);viewport.scrollIntoView({behavior:'smooth',block:'center'});
};

// ---------------------------------------------------------------- controls
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'▶ Lanjutkan simulasi':'Ⅱ Jeda simulasi';ui();};
$('speed').oninput=e=>{multiplier=Number(e.target.value);$('speed-value').textContent=`${multiplier}×`;};
$('next-hour').onclick=()=>{if(cities.smart.engine){fastForward=cities.smart.engine.time+3600;paused=false;$('pause').textContent='Ⅱ Jeda simulasi';ui();}};
$('reset').onclick=()=>restart();
$('top').onclick=()=>view(true);$('perspective').onclick=()=>view(false);$('home').onclick=()=>view();
const driving=createDriving({getCity:kind=>cities[kind],camera,controls,viewport,onChange:()=>layout()});
window.addEventListener('resize',()=>layout());new ResizeObserver(()=>layout()).observe(viewport);
let rects=[];
function layout(){
  const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;
  renderer.setSize(w,h);
  rects=driving.active?[{kind:driving.city,x:0,y:0,width:w,height:h}]
    :shown().map(kind=>{const el=views[kind];return {kind,x:el.offsetLeft,y:h-el.offsetTop-el.clientHeight,width:el.clientWidth,height:el.clientHeight};}).filter(r=>r.width>0&&r.height>0);
}

// ---------------------------------------------------------------- loop
let last=performance.now(),uiTimer=0;
renderer.setAnimationLoop(now=>{
  const dt=Math.min((now-last)/1000,0.1);last=now;
  const ready=cities.baseline.engine&&cities.smart.engine&&$('loading').hidden;
  if(ready&&(!paused||driving.active)){
    accumulator+=dt*(driving.active?1:fastForward?600:multiplier);let steps=0;
    while(accumulator>=0.25&&steps++<480){
      cities.baseline.step(0.25);cities.smart.step(0.25);accumulator-=0.25;
      if(fastForward&&cities.smart.engine.time>=fastForward){fastForward=0;accumulator=0;break;}
    }
    if(steps>=480)accumulator=0;
  }
  if(driving.active)driving.update(dt);else controls.update(dt);
  uiTimer+=dt;if(uiTimer>0.3&&ready){uiTimer=0;ui();}
  if(!rects.length)layout();
  renderer.setScissorTest(true);
  for(const r of rects){
    const city=cities[r.kind];if(!city.view)continue;
    camera.aspect=r.width/r.height;camera.updateProjectionMatrix();
    city.draw(camera,r.height,dt,{network:mode==='smart'&&r.kind==='smart'&&!driving.active,paused,labels:!driving.active});
    city.scene.add(controls.marker);   // the orbit anchor marker shows in whichever view is drawn
    renderer.setViewport(r.x,r.y,r.width,r.height);renderer.setScissor(r.x,r.y,r.width,r.height);
    renderer.render(city.scene,camera);
  }
  renderer.setScissorTest(false);
});

// For tests and inspection.
window.miniKota={cities,get mode(){return mode;},setMapMode,get map(){return map;},camera:controls,driving,restart,view,
  screen(x,z,y=0,kind=shown()[0]){const r=views[kind].getBoundingClientRect(),v=new THREE.Vector3(x,y,z);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();camera.updateMatrixWorld();v.project(camera);return {x:r.left+(v.x+1)/2*r.width,y:r.top+(1-v.y)/2*r.height};}};
restart();
