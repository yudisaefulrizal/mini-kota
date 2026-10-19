import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Lists every asset from public/models/manifest.json, written by the Blender scripts
// (npm run assets). Lamps can be switched on and tintable materials recoloured.
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const stage=$('stage');
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;stage.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0xeef3ec);
const camera=new THREE.PerspectiveCamera(35,1,.05,2000);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xffffff,0x9aa894,1.6));
const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(40,80,60);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0005;sun.shadow.normalBias=.02;
Object.assign(sun.shadow.camera,{left:-60,right:60,top:60,bottom:-60,far:300});scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(400,400),new THREE.MeshStandardMaterial({color:0xd9e2d5,roughness:1}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
const grid=new THREE.GridHelper(100,100,0x9fb19b,0xc3cfbf);grid.position.y=.002;scene.add(grid);
// Front of every asset is +Z.
const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(0,.02,0),1.5,0x2f7fc1,.25,.15);scene.add(arrow);

const loader=new GLTFLoader();let current=null,assets=[];

async function init(){
  try{
    const manifest=await (await fetch('models/manifest.json')).json();assets=manifest.assets;
    const groups=Object.entries(manifest.categories).map(([key,label])=>[label,assets.filter(a=>a.category===key)]).filter(([,list])=>list.length);
    $('asset').innerHTML=groups.map(([label,list])=>`<optgroup label="${esc(label)} (${list.length})">${list.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</optgroup>`).join('');
    $('asset').onchange=()=>show($('asset').value);
    const wanted=new URLSearchParams(location.search).get('id');
    await show(assets.some(a=>a.id===wanted)?wanted:assets[0].id);
  }catch(error){$('info').innerHTML=`<p class="bad">Manifest aset tidak terbaca. Jalankan <code>npm run assets</code>. (${esc(error.message)})</p>`;}
}

async function show(id){
  const asset=assets.find(a=>a.id===id);$('asset').value=id;
  if(current)scene.remove(current);current=null;
  $('info').innerHTML='<p>Memuat…</p>';$('controls').innerHTML='';
  try{
    const gltf=await loader.loadAsync(asset.file);current=gltf.scene;scene.add(current);
    let triangles=0;const names=[];
    current.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;names.push(o.name);}});
    const box=new THREE.Box3().setFromObject(current),size=box.getSize(new THREE.Vector3());
    const missing=asset.parts.filter(part=>!names.some(n=>n.startsWith(part)));
    $('info').innerHTML=`<h2>${esc(asset.name)}</h2><dl>
<dt>Berkas</dt><dd><code>public/${esc(asset.file)}</code></dd>
<dt>Ukuran</dt><dd>${size.x.toFixed(2)} × ${size.z.toFixed(2)} m, tinggi ${size.y.toFixed(2)} m</dd>
<dt>Segitiga</dt><dd>${Math.round(triangles).toLocaleString('id-ID')}</dd>
<dt>Bagian bernama</dt><dd>${asset.parts.length?asset.parts.map(part=>`<code class="${missing.includes(part)?'bad':''}">${esc(part)}</code>`).join(' '):'—'}</dd>
<dt>Status</dt><dd>${missing.length?`<span class="bad">Bagian hilang: ${missing.map(esc).join(', ')}</span>`:'Semua bagian bernama ditemukan'}</dd></dl>`;
    const lights=Object.keys(asset.lights||{}),tints=asset.tint||[];
    $('controls').innerHTML=(lights.length?`<h3>Nyalakan bagian</h3>${lights.map(n=>`<label class="toggle"><input type="checkbox" data-part="${n}"> ${esc(n)}</label>`).join('')}`:'')
      +(tints.length?`<h3>Warna</h3>${tints.map(t=>`<label class="toggle"><input type="color" data-tint="${t}" value="${hexOf(t)}"> ${esc(t)}</label>`).join('')}`:'');
    for(const input of $('controls').querySelectorAll('[data-part]'))input.onchange=()=>light(asset,input.dataset.part,input.checked);
    for(const input of $('controls').querySelectorAll('[data-tint]'))input.oninput=()=>tint(input.dataset.tint,input.value);
    const center=box.getCenter(new THREE.Vector3()),reach=Math.max(size.x,size.y,size.z);
    arrow.setLength(Math.max(1.5,reach*.35),Math.max(.25,reach*.06),Math.max(.15,reach*.04));
    controls.target.copy(center);camera.position.set(center.x+reach*1.1,center.y+reach*.45,center.z+reach*1.6);controls.update();
    history.replaceState(null,'',`?id=${id}`);
    return {missing,triangles:Math.round(triangles)};
  }catch(error){$('info').innerHTML=`<p class="bad">Gagal memuat ${esc(asset.file)}: ${esc(error.message)}</p>`;throw error;}
}
function hexOf(materialName){let hex='#888888';current?.traverse(o=>{if(o.isMesh&&o.material.name===materialName)hex=`#${o.material.color.getHexString()}`;});return hex;}
function light(asset,part,on){
  current.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.name.startsWith(part))return;
    mesh.material=mesh.material.clone();
    mesh.material.emissive=new THREE.Color(on?asset.lights[part]:0x000000);mesh.material.emissiveIntensity=on?2.2:0;
  });
}
function tint(materialName,hex){current.traverse(o=>{if(o.isMesh&&o.material.name===materialName)o.material.color.set(hex);});}
const resize=()=>{const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
new ResizeObserver(resize).observe(stage);resize();
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
init();
window.assetPreview={get loaded(){return !!current;},get ids(){return assets.map(a=>a.id);},show};
