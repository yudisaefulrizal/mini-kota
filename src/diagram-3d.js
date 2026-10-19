import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {CSS2DRenderer,CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import {DEVICES,ZONES,SHORT_NAMES,PROCESSES,FLOW_TYPES,FLOWS,TOUR,NETWORKS} from './devices.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const byId=Object.fromEntries(DEVICES.map(d=>[d.id,d]));
const zoneName=Object.fromEntries(ZONES);
const flowId=f=>`${f.from}-${f.to}`;
const hex=c=>`#${c.toString(16).padStart(6,'0')}`;
// Embedded in the simulation's "Perangkat" tab: no page header.
if(new URLSearchParams(location.search).has('embed'))document.body.classList.add('embed');
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

// Layout in scene units: zones run left to right in data-flow order.
const ZONE_LAYOUT={field:{x:-47,w:22,color:0xdbe8d6},edge:{x:-20,w:14,color:0xe3ead9},network:{x:2,w:14,color:0xdde6e8},dc:{x:44,w:48,color:0xe2e0ea}};
const POS={cam:[-49,-11],ctrl:[-49,0],ultra:[-49,11],gw:[-20,0],net:[2,0],kafka:[27,0],spark:[41,0],db:[54,-9],lake:[54,9],dash:[64,-9]};
// Home view frames the whole layout (x −58…68) for the current aspect ratio.
const HOME_TARGET=new THREE.Vector3(5,0,2),HOME_DIR=new THREE.Vector3(0,.62,.78).normalize();

// ---------- Panel (works without WebGL) ----------
let scene3d=null,selected=null,tourIndex=-1;

function flowItem(f,dir){
  const other=dir==='in'?f.from:f.to;
  return `<li><i style="background:${hex(colorOf(f))}"></i><button type="button" class="chip" data-id="${other}">${dir==='in'?'dari':'ke'} ${esc(SHORT_NAMES[other])}</button><small>${esc(f.label)}</small><small class="net">Jaringan: ${esc(NETWORKS[f.network].label)}${f.alt?`; ${esc(f.alt.who)}: ${esc(NETWORKS[f.alt.network].label)}`:''}</small></li>`;
}
function renderDevice(id){
  const info=$('device-info');
  if(!id){info.innerHTML=`<p class="eyebrow">Mulai</p><h2>Klik perangkat</h2><p>Pilih perangkat di diagram atau di daftar untuk melihat isinya, proses yang dijalankan, dan dari mana ke mana datanya mengalir. Tekan <strong>Ikuti alur data</strong> untuk menelusuri satu event dari kamera sampai dashboard.</p>`;return;}
  const d=byId[id],incoming=FLOWS.filter(f=>f.to===id),outgoing=FLOWS.filter(f=>f.from===id);
  info.innerHTML=`<p class="eyebrow">${esc(zoneName[d.zone])}</p><h2><i aria-hidden="true">${d.icon}</i>${esc(d.name)}</h2><p class="count">${esc(d.count)}</p><p>${esc(d.role)}</p>
<h3>Isi perangkat</h3><dl><dt>Perangkat keras</dt><dd>${esc(d.hardware)}</dd><dt>Sistem operasi</dt><dd>${esc(d.os)}</dd><dt>Perangkat lunak</dt><dd>${esc(d.software)}</dd><dt>Koneksi &amp; protokol</dt><dd>${esc(d.protocol)}</dd></dl>
<h3>Proses yang dijalankan</h3><ol>${PROCESSES[id].map(p=>`<li>${esc(p)}</li>`).join('')}</ol>
<h3>Alur data</h3>${incoming.length?`<ul class="flows">${incoming.map(f=>flowItem(f,'in')).join('')}</ul>`:'<p>Tidak ada data masuk; perangkat ini sumber data.</p>'}
${outgoing.length?`<ul class="flows" style="margin-top:6px">${outgoing.map(f=>flowItem(f,'out')).join('')}</ul>`:'<p>Tidak ada data keluar; perangkat ini tujuan akhir.</p>'}`;
}
function select(id,{fly=true}={}){
  selected=id;renderDevice(id);
  if(!scene3d)return;
  if(!id){scene3d.highlight(null,null);return;}
  const flows=FLOWS.filter(f=>f.from===id||f.to===id);
  scene3d.highlight(new Set([id,...flows.flatMap(f=>[f.from,f.to])]),new Set(flows.map(flowId)),id);
  if(fly)scene3d.flyTo([id]);
}
function showTour(i){
  tourIndex=i;const box=$('tour-box');
  if(i<0){box.hidden=true;$('tour-start').hidden=false;select(null);if(scene3d)scene3d.home();return;}
  const step=TOUR[i];box.hidden=false;$('tour-start').hidden=true;
  $('tour-step').textContent=`Langkah ${i+1} dari ${TOUR.length}`;$('tour-title').textContent=step.title;$('tour-text').textContent=step.text;
  $('tour-devices').innerHTML=step.devices.map(id=>`<button type="button" class="chip" data-id="${id}">${esc(SHORT_NAMES[id])}</button>`).join('');
  $('tour-prev').disabled=i===0;$('tour-next').textContent=i===TOUR.length-1?'Selesai':'Berikutnya →';
  selected=null;renderDevice(step.devices[step.devices.length-1]);
  if(scene3d){scene3d.highlight(new Set(step.devices),new Set(step.flows),null);scene3d.flyTo(step.devices);}
}
$('device-buttons').innerHTML=DEVICES.map(d=>`<button type="button" class="chip" data-id="${d.id}">${esc(SHORT_NAMES[d.id])}</button>`).join('');
// Lines are coloured by network type by default; "Jenis data" switches to what is carried.
let colorMode='network';
function colorOf(f){return colorMode==='network'?NETWORKS[f.network].color:FLOW_TYPES[f.type].color;}
function renderLegend(){
  const items=colorMode==='network'?Object.values(NETWORKS):Object.values(FLOW_TYPES);
  $('legend').innerHTML=items.map(t=>`<li><i style="background:${hex(t.color)}"></i>${esc(t.label)}</li>`).join('');
}
function setColorMode(mode){
  colorMode=mode;renderLegend();scene3d?.recolor();
  for(const b of document.querySelectorAll('[data-color]'))b.setAttribute('aria-pressed',String(b.dataset.color===mode));
  if(selected)renderDevice(selected);else if(tourIndex>=0)renderDevice(TOUR[tourIndex].devices.at(-1));
}
document.querySelector('.color-mode').addEventListener('click',e=>{const b=e.target.closest('[data-color]');if(b)setColorMode(b.dataset.color);});
renderLegend();
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-id]');
  if(b){if(tourIndex>=0&&!b.closest('#tour-box'))showTour(-1);if(tourIndex<0)select(b.dataset.id);else{renderDevice(b.dataset.id);scene3d?.flyTo([b.dataset.id]);}}
});
$('tour-start').onclick=()=>showTour(0);
$('tour-prev').onclick=()=>showTour(Math.max(0,tourIndex-1));
$('tour-next').onclick=()=>showTour(tourIndex===TOUR.length-1?-1:tourIndex+1);
$('tour-close').onclick=()=>showTour(-1);
renderDevice(null);

// ---------- 3D scene ----------
function buildScene(){
  const view=$('scene');
  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  view.appendChild(renderer.domElement);
  const labels=new CSS2DRenderer();Object.assign(labels.domElement.style,{position:'absolute',inset:'0',pointerEvents:'none'});view.appendChild(labels.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xeef3ec);
  const camera=new THREE.PerspectiveCamera(40,1,1,1000);
  const homePosition=()=>{const half=Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect);return HOME_TARGET.clone().addScaledVector(HOME_DIR,Math.max(70,66/Math.tan(half)+12));};
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(HOME_TARGET);controls.enableDamping=true;controls.maxPolarAngle=Math.PI/2.15;controls.minDistance=18;controls.maxDistance=320;
  scene.add(new THREE.HemisphereLight(0xffffff,0xb9cbb8,1.7));
  const sun=new THREE.DirectionalLight(0xffffff,1.8);sun.position.set(-40,90,50);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-90,right:90,top:50,bottom:-50,far:250});scene.add(sun);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(260,140),new THREE.MeshStandardMaterial({color:0xe6ece3,roughness:1}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);

  const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.6,metalness:.1,...extra});
  const glow=color=>new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.9});
  const part=(group,geo,material,x,y,z)=>{const o=new THREE.Mesh(geo,material);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;group.add(o);return o;};
  const tag=(text,cls,y,parent)=>{const el=document.createElement(cls==='label'?'button':'div');el.className=cls;el.textContent=text;const o=new CSS2DObject(el);o.position.y=y;parent.add(o);return el;};

  for(const [zone,label] of ZONES){
    const z=ZONE_LAYOUT[zone],slab=new THREE.Mesh(new THREE.BoxGeometry(z.w,.6,40),mat(z.color,{roughness:.9}));
    slab.position.set(z.x,.3,0);slab.receiveShadow=true;scene.add(slab);
    const anchor=new THREE.Object3D();anchor.position.set(z.x,.7,21.5);scene.add(anchor);tag(label,'zone-label',0,anchor);
  }

  const rack=(g,x,z,led,spare=false)=>{
    part(g,new THREE.BoxGeometry(2.6,7,2.6),mat(spare?0x52625b:0x26332e),x,4.1,z);
    for(let i=0;i<6;i++)part(g,new THREE.BoxGeometry(1.8,.14,.06),spare?mat(0x6f7f77):glow(led),x,1.6+i*1.05,z+1.33);
  };
  const lamps=[];let screen=null;
  const MODELS={
    cam:g=>{part(g,new THREE.CylinderGeometry(.25,.3,7),mat(0x8a9a90),0,4,0);part(g,new THREE.BoxGeometry(2.4,1.2,1.3),mat(0xf2f4f1),.5,7.8,0);part(g,new THREE.BoxGeometry(2.9,.15,1.6),mat(0xd8ddd6),.5,8.5,0);const lens=part(g,new THREE.CylinderGeometry(.42,.42,.5,20),mat(0x1d2a25),1.9,7.8,0);lens.rotation.z=Math.PI/2;},
    ultra:g=>{part(g,new THREE.CylinderGeometry(1.6,1.35,3.6,24),mat(0x4f8a5b),0,2.4,0);part(g,new THREE.CylinderGeometry(1.75,1.75,.3,24),mat(0x3b6b45),0,4.35,0);part(g,new THREE.BoxGeometry(.9,.4,.9),mat(0xdfe3dc),0,4.7,0);part(g,new THREE.CylinderGeometry(.06,.06,1.2),mat(0x6f7f77),.3,5.4,.3);},
    ctrl:g=>{part(g,new THREE.BoxGeometry(2.2,3.2,1.4),mat(0x8a9a90),-1,2.2,0);part(g,new THREE.CylinderGeometry(.2,.2,8),mat(0x55655d),1.4,4.6,0);part(g,new THREE.BoxGeometry(1.1,2.9,1),mat(0x1d2a25),1.4,8.2,0);
      for(const [i,c] of [[0,0xd8453b],[1,0xe8b923],[2,0x2e9e5b]].map(([i,c])=>[i,c])){const l=part(g,new THREE.SphereGeometry(.32,16,12),new THREE.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:.1}),1.4,9.1-i*.9,.55);lamps.push(l);}},
    gw:g=>{part(g,new THREE.BoxGeometry(3.2,2.1,2.3),mat(0x2f3b36),0,1.65,0);for(const x of [-1,1])part(g,new THREE.CylinderGeometry(.08,.08,2.4),mat(0x1d2a25),x,3.9,-.6);for(let i=0;i<4;i++)part(g,new THREE.BoxGeometry(.2,.2,.05),glow(0x48c774),-1.1+i*.5,2.1,1.17);},
    net:g=>{part(g,new THREE.BoxGeometry(2.6,1.1,1.8),mat(0x2f3b36),0,1.15,0);part(g,new THREE.CylinderGeometry(.18,.35,12),mat(0x8a9a90),0,6.6,0);for(const y of [9.6,11,12.4]){const r=part(g,new THREE.TorusGeometry(1.1,.07,8,32),mat(0x2f7fc1),0,y,0);r.rotation.x=Math.PI/2;}},
    kafka:g=>{for(const x of [-3,0,3])rack(g,x,0,0x7c5cbf);},
    spark:g=>{rack(g,-1.6,0,0xe8742c);rack(g,1.6,0,0xe8742c,true);},
    db:g=>{for(const y of [1.3,2.9,4.5])part(g,new THREE.CylinderGeometry(2,2,1.3,32),mat(0x3c6e8f),0,y,0);},
    lake:g=>{part(g,new THREE.CylinderGeometry(3.4,3.4,3.4,40),mat(0x2c5d7c),0,2.3,0);for(const y of [1.6,3])part(g,new THREE.TorusGeometry(3.42,.08,8,48),mat(0x9fc3dd),0,y,0).rotation.x=Math.PI/2;},
    dash:g=>{part(g,new THREE.BoxGeometry(.4,3,.4),mat(0x55655d),0,2.1,0);part(g,new THREE.BoxGeometry(6.4,3.9,.3),mat(0x1d2a25),0,5.3,0);
      const c=document.createElement('canvas');c.width=320;c.height=192;const x=c.getContext('2d');x.fillStyle='#16221e';x.fillRect(0,0,320,192);x.fillStyle='#dcefdc';x.font='bold 18px system-ui';x.fillText('Kondisi kota',14,28);
      [['Simpang 7','#c8463c'],['Simpang 3','#e8b923'],['Sampah bisnis','#c8463c'],['Gerbang 2','#2e9e5b']].forEach(([t,col],i)=>{x.fillStyle='#a9bdb0';x.font='14px system-ui';x.fillText(t,14,62+i*30);x.fillStyle=col;x.fillRect(120,50+i*30,40,16);});
      x.strokeStyle='#5fb0e8';x.lineWidth=3;x.beginPath();[0,10,8,22,30,44,60,70].forEach((v,i)=>x.lineTo(185+i*18,170-v*1.6));x.stroke();
      screen=new THREE.Mesh(new THREE.PlaneGeometry(5.9,3.45),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c)}));screen.position.set(0,5.3,.16);g.add(screen);},
  };

  const devices={},pickables=[];
  for(const d of DEVICES){
    const g=new THREE.Group();g.position.set(POS[d.id][0],0,POS[d.id][1]);MODELS[d.id](g);
    g.traverse(o=>{if(o.isMesh){o.userData.id=d.id;o.material=o.material.clone();o.material.transparent=true;o.userData.baseOpacity=1;pickables.push(o);}});
    const box=new THREE.Box3().setFromObject(g),size=box.getSize(new THREE.Vector3());
    const el=tag(SHORT_NAMES[d.id],'label',size.y+1.6,g);el.dataset.id=d.id;el.setAttribute('aria-label',`${d.name}, lihat detail`);
    scene.add(g);devices[d.id]={group:g,label:el,radius:Math.max(size.x,size.z)/2,height:size.y};
  }
  const ring=new THREE.Mesh(new THREE.RingGeometry(1,1.18,48),new THREE.MeshBasicMaterial({color:0x326149,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.visible=false;scene.add(ring);

  const edges=FLOWS.map(f=>{
    const a=devices[f.from].group.position,b=devices[f.to].group.position;
    const dir=new THREE.Vector3().subVectors(b,a),len=dir.length();dir.normalize();
    const side=new THREE.Vector3(-dir.z,0,dir.x).multiplyScalar(1.1);
    const start=a.clone().addScaledVector(dir,devices[f.from].radius+.6).add(side).setY(2.5);
    const end=b.clone().addScaledVector(dir,-(devices[f.to].radius+.6)).add(side).setY(2.5);
    const mid=start.clone().lerp(end,.5).add(side).setY(4+len*.14);
    const curve=new THREE.QuadraticBezierCurve3(start,mid,end),color=colorOf(f);
    const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,48,.13,6),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.55}));scene.add(tube);
    const cone=new THREE.Mesh(new THREE.ConeGeometry(.5,1.3,12),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8}));
    cone.position.copy(curve.getPointAt(.97));cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),curve.getTangentAt(.97));scene.add(cone);
    const n=f.type==='metrics'?2:3,dots=Array.from({length:n},()=>{const s=new THREE.Mesh(new THREE.SphereGeometry(.38,12,10),new THREE.MeshBasicMaterial({color}));scene.add(s);return s;});
    return {id:flowId(f),flow:f,curve,tube,cone,dots,speed:f.type==='control'?.5:f.type==='metrics'?.12:.22};
  });

  let paused=reduceMotion,flight=null,activeFlows=null;
  $('toggle-flow').textContent=paused?'Jalankan aliran':'Jeda aliran';$('toggle-flow').setAttribute('aria-pressed',String(paused));
  $('toggle-flow').onclick=()=>{paused=!paused;$('toggle-flow').textContent=paused?'Jalankan aliran':'Jeda aliran';$('toggle-flow').setAttribute('aria-pressed',String(paused));};

  function highlight(deviceIds,flowIds,focusId){
    activeFlows=flowIds;
    for(const [id,d] of Object.entries(devices)){
      const dim=deviceIds&&!deviceIds.has(id);
      d.group.traverse(o=>{if(o.isMesh)o.material.opacity=dim?.28:1;});
      d.label.classList.toggle('dim',!!dim);d.label.classList.toggle('active',deviceIds?deviceIds.has(id)&&(!focusId||id===focusId):false);
    }
    for(const e of edges){const on=!flowIds||flowIds.has(e.id);e.tube.material.opacity=on?(flowIds?.95:.55):.1;e.cone.material.opacity=on?.85:.12;e.dots.forEach(s=>s.visible=on);}
    const focus=focusId?devices[focusId]:null;ring.visible=!!focus;
    if(focus){ring.position.set(focus.group.position.x,.65,focus.group.position.z);ring.scale.setScalar(focus.radius+1.4);}
  }
  function flyTo(ids){
    const center=new THREE.Vector3();ids.forEach(id=>center.add(devices[id].group.position));center.divideScalar(ids.length).setY(3);
    const spread=Math.max(...ids.map(id=>devices[id].group.position.distanceTo(center)));
    const offset=camera.position.clone().sub(controls.target).normalize().multiplyScalar(Math.min(150,Math.max(42,spread*2.4+30)*Math.max(1,1.2/camera.aspect)));
    moveCamera(center,center.clone().add(offset));
  }
  function moveCamera(target,position){
    if(reduceMotion){controls.target.copy(target);camera.position.copy(position);return;}
    flight={t:0,fromT:controls.target.clone(),fromP:camera.position.clone(),toT:target,toP:position};
  }
  function home(){moveCamera(HOME_TARGET.clone(),homePosition());}
  $('reset-view').onclick=()=>home();

  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
    const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
    raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(pickables,false)[0];
    if(hit){if(tourIndex>=0)showTour(-1);select(hit.object.userData.id);}
    else if(tourIndex<0&&selected)select(null);
  });
  renderer.domElement.addEventListener('pointermove',e=>{
    const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
    raycaster.setFromCamera(pointer,camera);renderer.domElement.style.cursor=raycaster.intersectObjects(pickables,false).length?'pointer':'';
  });

  const resize=()=>{const w=view.clientWidth,h=view.clientHeight;renderer.setSize(w,h);labels.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
  new ResizeObserver(resize).observe(view);resize();camera.position.copy(homePosition());

  const clock=new THREE.Clock();let flowTime=0;
  renderer.setAnimationLoop(()=>{
    const dt=Math.min(clock.getDelta(),.1);
    if(!paused)flowTime+=dt;
    for(const e of edges)e.dots.forEach((s,i)=>s.position.copy(e.curve.getPointAt((flowTime*e.speed+i/e.dots.length)%1)));
    // Fixed-time cycle for the model lamp: green 6 s, yellow 3 s, red 5 s.
    const phase=flowTime%14,lit=phase<6?2:phase<9?1:0;lamps.forEach((l,i)=>l.material.emissiveIntensity=i===lit?1.4:.08);
    if(flight){flight.t=Math.min(1,flight.t+dt/.8);const k=1-Math.pow(1-flight.t,3);controls.target.lerpVectors(flight.fromT,flight.toT,k);camera.position.lerpVectors(flight.fromP,flight.toP,k);if(flight.t===1)flight=null;}
    controls.update();renderer.render(scene,camera);labels.render(scene,camera);
  });
  function recolor(){for(const e of edges){const c=colorOf(e.flow);e.tube.material.color.set(c);e.cone.material.color.set(c);e.dots.forEach(s=>s.material.color.set(c));}}
  return {highlight,flyTo,home,recolor};
}
try{scene3d=buildScene();}catch(error){$('scene-fallback').hidden=false;console.error(error);}
