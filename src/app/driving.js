import * as THREE from 'three';
import {FOOTPRINT} from '../map/furnish.js';
import '../driving.css';
import {insideRegion} from '../map/region.js';

// "Jelajahi Kota": drive a car yourself through either city, chased by the camera. The car
// stops at buildings, the map edge and the simulated vehicles; it is not part of the traffic
// model (other vehicles do not see it) and is not counted in the statistics. Map units are
// metres, x east and z south.

// One step of the car: throttle, brake, steering, collision. Returns true when blocked.
export function stepCar(car,input,dt,blocked){
  const throttle=Number(input.has('forward'))-Number(input.has('reverse'));
  const drag=input.has('brake')?12:throttle?0.8:2.8;
  car.speed+=throttle*6.5*dt;
  car.speed=Math.sign(car.speed)*Math.max(0,Math.abs(car.speed)-drag*dt);
  car.speed=Math.max(-5,Math.min(16,car.speed));
  car.angle+=(Number(input.has('left'))-Number(input.has('right')))*Math.min(Math.abs(car.speed)/5,1)*1.4*dt*Math.sign(car.speed);
  const x=car.x+Math.sin(car.angle)*car.speed*dt,z=car.z+Math.cos(car.angle)*car.speed*dt;
  if(blocked(x,z)){car.speed=0;return true;}
  car.x=x;car.z=z;return false;
}
// Obstacles of a city: building footprints (with a margin) and the vehicles near the car.
export function obstaclesOf(city){
  const rects=city.map.objects.filter(o=>FOOTPRINT[o.asset]).map(o=>{
    const [w,d]=FOOTPRINT[o.asset],q=Math.round(((o.rotation||0)%360+360)%360/90)%2===1;
    return {x:o.x,z:o.z,hw:(q?d:w)/2+1.2,hd:(q?w:d)/2+1.2};
  });
  return (x,z)=>!insideRegion(city.region,{x,z})||rects.some(r=>Math.abs(x-r.x)<r.hw&&Math.abs(z-r.z)<r.hd)
    ||city.engine.vehicles.some(v=>{const p=city.engine.position(v,v.len/2);return Math.hypot(p.x-x,p.z-z)<v.len/2+1.6;});
}

function buildCar(){
  const car=new THREE.Group(),part=(w,h,d,color,x,y,z)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.65}));m.position.set(x,y,z);m.castShadow=true;car.add(m);return m;};
  part(1.9,0.7,4.4,'#e89532',0,0.65,0);part(1.6,0.6,2.1,'#264c59',0,1.3,-0.2);part(1.65,0.12,2.2,'#ffbd55',0,1.65,-0.2);
  for(const x of [-0.9,0.9])for(const z of [-1.4,1.4])part(0.3,0.65,0.65,'#23312f',x,0.33,z);
  for(const x of [-0.6,0.6]){part(0.35,0.2,0.06,'#fff3ba',x,0.8,2.21);part(0.35,0.2,0.06,'#c94236',x,0.8,-2.21);}
  // Indicators: local +X is the car's left (it faces +Z).
  const off=new THREE.MeshStandardMaterial({color:'#9c5915',roughness:.5}),on=new THREE.MeshBasicMaterial({color:'#ffb521',toneMapped:false});
  const lamps=[];
  for(const side of [-1,1])for(const z of [2.23,-2.23]){const m=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.14,0.06),off);m.position.set(side*0.82,0.8,z);car.add(m);lamps.push({m,side});}
  car.userData.signal=(direction,time)=>{const lit=time%0.8<0.4;for(const {m,side} of lamps)m.material=lit&&side===direction?on:off;};
  return car;
}

export function createDriving({getCity,camera,controls,viewport,onChange=()=>{}}){
  const $=id=>document.getElementById(id),keys=new Set();
  let active=false,saved=null,collision=false,city=null,blocked=null;
  const car={x:0,z:0,angle:0,speed:0},mesh=buildCar();mesh.visible=false;
  viewport.insertAdjacentHTML('beforeend',`<section id="drive-ui" hidden aria-label="Mode berkendara"><div class="drive-top"><div><strong>JELAJAHI KOTA</strong><label>Kota <select id="drive-city"><option value="baseline">Biasa</option><option value="smart">Cerdas</option></select></label></div><button id="drive-exit">Kembali ke Simulasi · Esc</button></div><div class="drive-bottom"><div class="drive-dashboard"><strong id="drive-speed">0</strong> km/jam <span id="drive-status" role="status">Siap berkendara</span><p>WASD / panah: berkendara · Spasi: rem · R: posisi awal<br>Mobil jelajah tidak dihitung dalam statistik.</p><button id="drive-reset">Kembali ke jalan</button></div><div class="drive-touch" aria-label="Kontrol sentuh"><button data-drive="left" aria-label="Belok kiri">←</button><button data-drive="forward" aria-label="Gas">↑</button><button data-drive="right" aria-label="Belok kanan">→</button><button data-drive="reverse" aria-label="Mundur">↓</button><button data-drive="brake">Rem</button></div></div></section>`);
  const ui=$('drive-ui');
  // Start on the longest entry lane of an ordinary road (not a lot entrance), a few metres
  // in, facing along it.
  function reset(){
    const e=city.engine,ordinary=id=>{const seg=e.graph.byId.get(id),p=city.map.profiles[city.map.roads.find(r=>r.id===seg.road)?.profile];return !p?.access;};
    const start=[...e.origins].filter(ordinary).sort((a,b)=>e.graph.byId.get(b).length-e.graph.byId.get(a).length)[0]??e.origins[0];
    const seg=e.graph.byId.get(start),a=seg.points[0],b=seg.points[Math.min(1,seg.points.length-1)];
    const angle=Math.atan2(b.x-a.x,b.z-a.z),k=Math.min(8,seg.length/2);
    Object.assign(car,{x:a.x+Math.sin(angle)*k,z:a.z+Math.cos(angle)*k,angle,speed:0});keys.clear();update(0,true);
  }
  function useCity(){
    city=getCity($('drive-city').value);blocked=obstaclesOf(city);
    mesh.parent?.remove(mesh);city.scene.add(mesh);
  }
  function enter(){
    if(active)return;
    saved={position:camera.position.clone(),target:controls.target.clone(),fov:camera.fov,near:camera.near};
    active=true;controls.enabled=false;mesh.visible=true;ui.hidden=false;document.body.classList.add('driving');
    // Keep keyboard navigation inside the driving view while it fills the screen.
    $('settings').inert=true;for(const el of viewport.parentElement.children)if(el!==viewport)el.inert=true;
    camera.fov=65;camera.near=0.2;camera.updateProjectionMatrix();useCity();reset();onChange(true);$('drive-exit').focus();
  }
  function leave(){
    if(!active)return;active=false;keys.clear();car.speed=0;mesh.visible=false;ui.hidden=true;document.body.classList.remove('driving');
    $('settings').inert=false;for(const el of viewport.parentElement.children)el.inert=false;
    controls.enabled=true;camera.fov=saved.fov;camera.near=saved.near;camera.updateProjectionMatrix();
    controls.set(saved.position,saved.target);onChange(false);$('explore').focus();
  }
  function update(dt,snap=false){
    if(!active)return;
    collision=stepCar(car,keys,dt,blocked);
    mesh.userData.signal(Number(keys.has('left'))-Number(keys.has('right')),performance.now()/1000);
    mesh.position.set(car.x,0.02,car.z);mesh.rotation.y=car.angle;
    const target=mesh.position.clone().add(new THREE.Vector3(0,1.5,0));
    const desired=target.clone().add(new THREE.Vector3(-Math.sin(car.angle)*9,3.8,-Math.cos(car.angle)*9));
    // Pull the chase camera forward when a building blocks its view.
    const ray=new THREE.Raycaster(target,desired.clone().sub(target).normalize(),0,target.distanceTo(desired));
    const hits=ray.intersectObjects(city.objects.group.children,true).filter(h=>h.object.isMesh);
    if(hits.length)desired.copy(ray.ray.at(Math.max(2,hits[0].distance-1),new THREE.Vector3()));
    camera.position.lerp(desired,snap?1:1-Math.exp(-8*dt));camera.lookAt(target);camera.updateMatrixWorld();
    $('drive-speed').textContent=Math.round(Math.abs(car.speed)*3.6);
    $('drive-status').textContent=collision?'Terhalang · mundur atau belok':car.speed<-.1?'Mundur':Math.abs(car.speed)>.1?'Berkendara':'Siap berkendara';
  }
  const mapping={KeyW:'forward',ArrowUp:'forward',KeyS:'reverse',ArrowDown:'reverse',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',Space:'brake'};
  window.addEventListener('keydown',e=>{if(!active)return;if(e.code==='Escape'){leave();return;}if(e.target.matches('select,input'))return;if(e.code==='KeyR'){reset();e.preventDefault();}if(mapping[e.code]){e.preventDefault();keys.add(mapping[e.code]);}});
  window.addEventListener('keyup',e=>{if(active&&mapping[e.code]){keys.delete(mapping[e.code]);e.preventDefault();}});
  window.addEventListener('blur',()=>keys.clear());document.addEventListener('visibilitychange',()=>keys.clear());
  for(const button of ui.querySelectorAll('[data-drive]')){
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(button.dataset.drive);});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>keys.delete(button.dataset.drive));
  }
  $('explore').onclick=enter;$('drive-exit').onclick=leave;$('drive-reset').onclick=()=>reset();
  $('drive-city').onchange=()=>{useCity();reset();onChange(true);};
  return {get active(){return active;},get city(){return $('drive-city').value;},get state(){return {active,city:this.city,...car,collision};},update,leave,
    // A new map was loaded: start again on it.
    reload(){if(active){useCity();reset();}}};
}
