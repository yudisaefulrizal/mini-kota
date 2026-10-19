import {addTurnSignals,updateTurnSignals} from './turn-signals.js';
import {toMapUnits} from './scale.js';
import * as THREE from 'three';
import './driving.css';

// Positions use the same map coordinates as the traffic simulation.
export function stepCar(car, input, dt, obstacles) {
  const throttle=Number(input.has('forward'))-Number(input.has('reverse'));
  const drag=input.has('brake')?30:throttle?2:7;
  car.speed+=throttle*16*dt;
  car.speed=Math.sign(car.speed)*Math.max(0,Math.abs(car.speed)-drag*dt);
  car.speed=Math.max(-12,Math.min(38,car.speed));
  car.angle+=(Number(input.has('left'))-Number(input.has('right')))*Math.min(Math.abs(car.speed)/12,1)*1.5*dt*Math.sign(car.speed);
  const x=car.x+Math.sin(car.angle)*toMapUnits(car.speed*dt),z=car.z+Math.cos(car.angle)*toMapUnits(car.speed*dt);
  const hit=x<7||x>1529||z<7||z>1017||obstacles.some(([cx,cz,w,d])=>Math.abs(x-cx)<w/2+toMapUnits(2.6)&&Math.abs(z-cz)<d/2+toMapUnits(2.6));
  if(hit)car.speed=0;else {car.x=x;car.z=z;}
  return hit;
}

export function createDriving({scene,camera,controls,viewport,obstacles}) {
  const $=id=>document.getElementById(id),keys=new Set();
  let active=false,saved,collision=false;
  const car={x:600,z:414,angle:Math.PI/2,speed:0};
  const mesh=new THREE.Group();mesh.scale.set(toMapUnits(.32),toMapUnits(.32),toMapUnits(.45));scene.add(mesh);mesh.visible=false;
  function part(w,h,d,color,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.65}));m.position.set(x,y,z);m.castShadow=true;mesh.add(m);}
  part(5.6,2.2,10,'#e89532',0,2,0);part(4.7,2,4.6,'#264c59',0,4,-.5);part(4.9,.5,4.8,'#ffbd55',0,5.2,-.5);
  for(const x of [-2.8,2.8])for(const z of [-3,3])part(1,2,2,'#23312f',x,1.2,z);
  for(const x of [-1.8,1.8]){part(1,.7,.2,'#fff3ba',x,2.4,5.1);part(1,.7,.2,'#c94236',x,2.4,-5.1);}
  addTurnSignals(mesh,{width:5.6,front:5.1,rear:-5.1,height:2.4});
  viewport.insertAdjacentHTML('beforeend',`<section id="drive-ui" hidden aria-label="Mode berkendara"><div class="drive-top"><div><strong>JELAJAHI KOTA</strong><label>Kota <select id="drive-city"><option value="baseline">Biasa</option><option value="smart">Cerdas</option></select></label></div><button id="drive-exit">Kembali ke Simulasi · Esc</button></div><div class="drive-bottom"><div class="drive-dashboard"><strong id="drive-speed">0</strong> km/jam <span id="drive-status" role="status">Siap berkendara</span><p>WASD / panah: berkendara · Spasi: rem · R: posisi awal<br>Waktu lalu lintas 1× · Mobil jelajah tidak dihitung dalam statistik.</p><button id="drive-reset">Kembali ke jalan</button></div><div class="drive-touch" aria-label="Kontrol sentuh"><button data-drive="left" aria-label="Belok kiri">←</button><button data-drive="forward" aria-label="Gas">↑</button><button data-drive="right" aria-label="Belok kanan">→</button><button data-drive="reverse" aria-label="Mundur">↓</button><button data-drive="brake">Rem</button></div></div></section>`);
  const ui=$('drive-ui');
  const cameraObstacles=[];scene.traverse(o=>{if(o.isMesh&&o.geometry?.type==='BoxGeometry'&&o.parent!==mesh)cameraObstacles.push(o);});
  const sprites=[];scene.traverse(o=>{if(o.isSprite)sprites.push(o);});
  function reset(){Object.assign(car,{x:600,z:414,angle:Math.PI/2,speed:0});keys.clear();update(0,true);}
  function enter(){
    if(active)return;
    saved={position:camera.position.clone(),target:controls.target.clone(),fov:camera.fov,near:camera.near,sprites:sprites.map(s=>s.visible)};
    active=true;controls.enabled=false;mesh.visible=true;ui.hidden=false;
    document.body.classList.add('driving');
    // Keep keyboard navigation inside the driving view while it occupies the screen.
    $('settings').inert=true;for(const el of viewport.parentElement.children)if(el!==viewport)el.inert=true;
    sprites.forEach(s=>s.visible=false);camera.fov=65;camera.near=.2;camera.updateProjectionMatrix();reset();$('drive-exit').focus();
  }
  function leave(){
    if(!active)return;active=false;keys.clear();car.speed=0;mesh.visible=false;ui.hidden=true;document.body.classList.remove('driving');
    $('settings').inert=false;for(const el of viewport.parentElement.children)el.inert=false;
    sprites.forEach((s,i)=>s.visible=saved.sprites[i]);controls.enabled=true;
    camera.fov=saved.fov;camera.near=saved.near;camera.position.copy(saved.position);controls.target.copy(saved.target);camera.updateProjectionMatrix();controls.update();$('explore').focus();
  }
  function update(dt,snap=false){
    if(!active)return;
    collision=stepCar(car,keys,dt,obstacles);
    updateTurnSignals(mesh,Number(keys.has('left'))-Number(keys.has('right')),performance.now()/1000);
    mesh.position.set(car.x-768,.3,car.z-512);mesh.rotation.y=car.angle;
    const target=mesh.position.clone().add(new THREE.Vector3(0,toMapUnits(1.5),0));
    const desired=target.clone().add(new THREE.Vector3(-Math.sin(car.angle)*toMapUnits(10),toMapUnits(4.5),-Math.cos(car.angle)*toMapUnits(10)));
    // Pull the chase camera forward when a building blocks its view.
    const ray=new THREE.Raycaster(target,desired.clone().sub(target).normalize(),0,target.distanceTo(desired));
    const hits=ray.intersectObjects(cameraObstacles,false);
    if(hits.length)desired.copy(ray.ray.at(Math.max(2,hits[0].distance-2),new THREE.Vector3()));
    camera.position.lerp(desired,snap?1:1-Math.exp(-8*dt));camera.lookAt(target);camera.updateProjectionMatrix();
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
  $('explore').onclick=enter;$('drive-exit').onclick=leave;$('drive-reset').onclick=reset;$('drive-city').onchange=reset;
  return {get active(){return active;},get city(){return $('drive-city').value;},get state(){return {active,city:this.city,...car,collision};},update};
}
