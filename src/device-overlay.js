import * as THREE from 'three';
import {toMetres,toMapUnits} from './scale.js';
import {sensorSites,DATA_CENTER_SITE} from './data-center.js';
import {DEVICES,PROCESSES,SHORT_NAMES,NETWORKS,linksOf} from './devices.js';

// Planned devices drawn over the smart city. Readings come from the simulation
// model, standing in for what each device would report; no hardware is connected.
export const DEVICE_KINDS={
  queue:{label:'Detektor antrean',glyph:'A',color:'#2f7fc1',device:'cam',topic:'traffic_events'},
  gate:{label:'Detektor arus gerbang',glyph:'G',color:'#178f9c',device:'cam',topic:'traffic_events'},
  road:{label:'Detektor kepadatan ruas',glyph:'R',color:'#5a6fd1',device:'cam',topic:'traffic_events'},
  access:{label:'Penghitung akses kawasan',glyph:'P',color:'#8a5cc7',device:'cam',topic:'access_events'},
  waste:{label:'Sensor isi tempat sampah',glyph:'S',color:'#c98a12',device:'ultra',topic:'waste_events'},
  ctrl:{label:'Pengendali simpang',glyph:'L',color:'#2e9e5b',device:'ctrl',topic:null},
  gw:{label:'Gateway edge',glyph:'GW',color:'#26332e',device:'gw',topic:null},
};
const world=(x,y,z)=>new THREE.Vector3(x-768,y,z-512);
const fmt=(n,d=0)=>n.toLocaleString('id-ID',{maximumFractionDigits:d});

function pointAt(edge,fraction){
  const pts=edge.points,seg=[];let total=0;
  for(let i=1;i<pts.length;i++){const l=Math.hypot(pts[i].x-pts[i-1].x,pts[i].z-pts[i-1].z);seg.push(l);total+=l;}
  let left=total*fraction;
  for(let i=0;i<seg.length;i++){
    if(left<=seg[i]||i===seg.length-1){const a=pts[i],b=pts[i+1],t=seg[i]?Math.min(1,left/seg[i]):0;return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,dx:(b.x-a.x)/(seg[i]||1),dz:(b.z-a.z)/(seg[i]||1)};}
    left-=seg[i];
  }
}
function icon(kind){
  const {glyph,color}=DEVICE_KINDS[kind],c=document.createElement('canvas');c.width=c.height=128;
  const x=c.getContext('2d');x.fillStyle=color;x.strokeStyle='#ffffff';x.lineWidth=9;
  if(kind==='gw'){x.beginPath();x.roundRect(10,10,108,108,22);x.fill();x.stroke();}else{x.beginPath();x.arc(64,64,54,0,Math.PI*2);x.fill();x.stroke();}
  x.fillStyle='#ffffff';x.font=`700 ${glyph.length>1?50:64}px sans-serif`;x.textAlign='center';x.textBaseline='middle';x.fillText(glyph,64,68);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

export function createDeviceOverlay(sim){
  const {signals,approaches,boundaries,otherRoads,lots,bins}=sensorSites(sim);
  const signalName=new Map(signals.map((n,i)=>[n.id,`Simpang ${i+1}`]));
  const edgeIndex=e=>sim.edges.indexOf(e);
  const sites=[];
  for(const e of approaches){const node=sim.nodes[e.to],{dx,dz,stop}=sim.approach(e);sites.push({kind:'queue',edge:edgeIndex(e),node:node.id,x:node.x-dx*(stop+14)-dz*18,z:node.z-dz*(stop+14)+dx*18,face:[-dx,-dz]});}
  for(const [kind,list] of [['gate',boundaries],['road',otherRoads]])for(const e of list){const p=pointAt(e,.5);sites.push({kind,edge:edgeIndex(e),x:p.x-p.dz*10,z:p.z+p.dx*10,face:[p.dz,-p.dx]});}
  for(const l of lots){const fx=l.road[0]-l.gate[0],fz=l.road[1]-l.gate[1],len=Math.hypot(fx,fz)||1;sites.push({kind:'access',lot:l.id,x:l.gate[0]-fz/len*8,z:l.gate[1]+fx/len*8,face:[fx/len,fz/len]});}
  for(const l of bins)sites.push({kind:'waste',lot:l.id,x:l.waste.bin.x,z:l.waste.bin.z});
  for(const n of signals){sites.push({kind:'ctrl',node:n.id,x:n.x-16,z:n.z+16,face:[Math.SQRT1_2,-Math.SQRT1_2]});sites.push({kind:'gw',node:n.id,x:n.x+16,z:n.z-16,face:[-Math.SQRT1_2,Math.SQRT1_2]});}
  // Each device reports to the nearest intersection gateway in this sketch.
  const gateways=sites.filter(s=>s.kind==='gw');
  for(const s of sites)if(s.kind!=='gw')s.gateway=s.kind==='ctrl'?gateways.find(g=>g.node===s.node):gateways.reduce((best,g)=>Math.hypot(g.x-s.x,g.z-s.z)<Math.hypot(best.x-s.x,best.z-s.z)?g:best);

  const group=new THREE.Group();group.visible=false;
  const textures=Object.fromEntries(Object.keys(DEVICE_KINDS).map(k=>[k,icon(k)]));
  const pickables=[];
  for(const s of sites){
    const big=s.kind==='gw',sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:textures[s.kind],depthTest:false,transparent:true}));
    sprite.position.copy(world(s.x,big?40:30,s.z));sprite.scale.setScalar(big?28:22);sprite.renderOrder=10;sprite.userData.site=s;s.sprite=sprite;group.add(sprite);pickables.push(sprite);
  }
  // 3D device models, slightly larger than real size so they read at city scale.
  // Parts are instanced per geometry/material; instanceId maps back to the site.
  const M=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.6,metalness:.15,...extra});
  const mats={pole:M('#66766d'),body:M('#f1f3ef'),hood:M('#cfd6cd'),lens:M('#1b2722',{roughness:.2}),cabinet:M('#8b9b91'),dark:M('#26332e'),led:M('#4ade80',{emissive:'#4ade80',emissiveIntensity:1.2}),sensor:M('#e6eae3'),wave:M('#f0b429',{emissive:'#f0b429',emissiveIntensity:.6}),antenna:M('#3a4740')};
  const unit=new THREE.BoxGeometry(1,1,1),cylinder=new THREE.CylinderGeometry(.5,.5,1,14),buckets=new Map();
  function model(site,build){
    const g=new THREE.Group();g.position.copy(world(site.x,0,site.z));if(site.face)g.rotation.y=Math.atan2(-site.face[1],site.face[0]);
    const part=(geo,material,[w,h,d],[x,y,z],rot)=>{const m=new THREE.Mesh(geo,material);m.scale.set(w,h,d);m.position.set(x,y,z);if(rot)m.rotation.set(...rot);g.add(m);};
    build(part);g.updateMatrixWorld(true);
    for(const m of g.children){const key=`${m.geometry.uuid}|${m.material.uuid}`;if(!buckets.has(key))buckets.set(key,{geo:m.geometry,mat:m.material,items:[]});buckets.get(key).items.push({matrix:m.matrixWorld.clone(),site});}
  }
  // Local +x faces the monitored road; the lens sits at the end of a short arm.
  const camera=(part,height)=>{
    part(cylinder,mats.pole,[1,height,1],[0,height/2,0]);
    part(unit,mats.pole,[4,.7,.7],[2,height-.4,0]);
    part(unit,mats.body,[4.6,2.2,2.2],[4.4,height-1.8,0]);
    part(unit,mats.hood,[5.4,.35,2.8],[4.6,height-.5,0]);
    part(cylinder,mats.lens,[1.5,.7,1.5],[6.9,height-1.8,0],[0,0,Math.PI/2]);
  };
  for(const s of sites){
    if(['queue','gate','road'].includes(s.kind))model(s,part=>camera(part,s.kind==='queue'?16:14));
    else if(s.kind==='access')model(s,part=>{camera(part,10);part(unit,mats.dark,[1.6,1.6,.3],[0,5,.7]);});
    else if(s.kind==='waste')model(s,part=>{
      // Ultrasonic module on the bin lid with an antenna and a status light.
      part(unit,mats.sensor,[3,1.1,3],[0,4.9,0]);part(cylinder,mats.lens,[1,.3,1],[0,4.3,0]);
      part(cylinder,mats.antenna,[.25,3,.25],[1,6.9,1]);part(unit,mats.wave,[.6,.6,.6],[-1,5.6,-1]);
    });
    else if(s.kind==='ctrl')model(s,part=>{part(unit,mats.dark,[5,.5,3.6],[0,.25,0]);part(unit,mats.cabinet,[4.2,6.5,2.8],[0,3.75,0]);part(unit,mats.dark,[4.4,.4,3],[0,7.2,0]);part(unit,mats.hood,[.15,4.5,2.2],[2.15,3.8,0]);});
    else if(s.kind==='gw')model(s,part=>{
      part(cylinder,mats.pole,[.8,9,.8],[0,4.5,0]);part(unit,mats.dark,[4.6,3,3],[0,10,0]);
      for(const z of [-1,1])part(cylinder,mats.antenna,[.3,4,.3],[-1.2,13.5,z]);
      for(let i=0;i<4;i++)part(unit,mats.led,[.5,.5,.2],[1.2-i*.7,10.6,1.55]);
    });
  }
  const models=[];
  for(const {geo,mat,items} of buckets.values()){
    const mesh=new THREE.InstancedMesh(geo,mat,items.length);items.forEach((it,i)=>mesh.setMatrixAt(i,it.matrix));
    mesh.castShadow=true;mesh.frustumCulled=false;mesh.userData.sites=items.map(it=>it.site);group.add(mesh);models.push(mesh);pickables.push(mesh);
  }
  // Highlighted coverage on the road for the selected device.
  const coverage=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({transparent:true,opacity:.35,depthWrite:false,side:THREE.DoubleSide}));
  coverage.renderOrder=8;coverage.visible=false;group.add(coverage);
  function ribbon(points,width){
    const pos=[],idx=[];
    points.forEach((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],l=Math.hypot(b.x-a.x,b.z-a.z)||1,nx=-(b.z-a.z)/l*width/2,nz=(b.x-a.x)/l*width/2;
      pos.push(p.x+nx-768,1.2,p.z+nz-512,p.x-nx-768,1.2,p.z-nz-512);if(i)idx.push(2*i-2,2*i-1,2*i,2*i-1,2*i+1,2*i);});
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);return g;
  }
  function tail(edge,length){
    // Points covering the last `length` map units of an edge, ending at its stop end.
    const pts=edge.points,out=[pts.at(-1)];let left=length;
    for(let i=pts.length-1;i>0&&left>0;i--){const a=pts[i-1],b=pts[i],l=Math.hypot(b.x-a.x,b.z-a.z);if(l>=left){const t=left/l;out.push({x:b.x+(a.x-b.x)*t,z:b.z+(a.z-b.z)*t});left=0;}else{out.push(a);left-=l;}}
    return out.reverse();
  }
  function showCoverage(site){
    coverage.visible=false;if(!site)return;
    let geometry=null;
    if(site.kind==='queue')geometry=ribbon(tail(sim.edges[site.edge],toMapUnits(100)),14);
    else if(site.kind==='gate'||site.kind==='road')geometry=ribbon(sim.edges[site.edge].points,14);
    else if(site.kind==='access'){const l=sim.lots[site.lot];geometry=ribbon([{x:l.gate[0],z:l.gate[1]},{x:l.road[0],z:l.road[1]}],16);}
    if(!geometry)return;
    coverage.geometry.dispose();coverage.geometry=geometry;coverage.material.color.set(DEVICE_KINDS[site.kind].color);coverage.visible=true;
  }
  // Link colour follows the network type, matching the 3D diagram.
  const networkOf=s=>s.kind==='waste'?'lora':s.kind==='gate'||s.kind==='road'?'fiber':'lan';
  for(const network of ['lan','fiber','lora']){
    const points=sites.filter(s=>s.gateway&&networkOf(s)===network).flatMap(s=>[world(s.x,28,s.z),world(s.gateway.x,38,s.gateway.z)]);
    const links=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:NETWORKS[network].color,transparent:true,opacity:network==='lan'?.5:.8,depthTest:false}));
    links.renderOrder=9;group.add(links);
  }
  const dc=world(DATA_CENTER_SITE.x+DATA_CENTER_SITE.w/2,48,DATA_CENTER_SITE.z+DATA_CENTER_SITE.h/2);
  const dotGeometry=new THREE.SphereGeometry(3.2,10,8),dotMaterial=new THREE.MeshBasicMaterial({color:NETWORKS.fiber.color,depthTest:false});
  const uplinks=gateways.map((g,i)=>{
    const start=world(g.x,42,g.z),mid=start.clone().lerp(dc,.5);mid.y=90+start.distanceTo(dc)*.18;
    const curve=new THREE.QuadraticBezierCurve3(start,mid,dc);
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),new THREE.LineBasicMaterial({color:NETWORKS.fiber.color,transparent:true,opacity:.55,depthTest:false}));line.renderOrder=9;group.add(line);
    const dots=[0,.5].map(()=>{const d=new THREE.Mesh(dotGeometry,dotMaterial);d.renderOrder=11;group.add(d);return d;});
    return {curve,dots,offset:i/gateways.length};
  });
  let selected=null,flowTime=0;

  function select(site){selected=site;showCoverage(site);}
  // Icons keep a readable screen size: full size from afar, shrinking up close so
  // they do not hide the device models.
  const toCamera=new THREE.Vector3();
  function update(delta,camera){
    flowTime+=delta;
    for(const s of sites){
      const base=(s.kind==='gw'?28:22)*(s===selected?1.5:1),distance=toCamera.subVectors(s.sprite.position,camera.position).length();
      s.sprite.scale.setScalar(Math.min(base,distance*base/900));
    }
    for(const u of uplinks)u.dots.forEach((d,i)=>d.position.copy(u.curve.getPointAt((flowTime*.25+u.offset+i*.5)%1)));
  }
  function counts(){return Object.fromEntries(Object.keys(DEVICE_KINDS).map(k=>[k,sites.filter(s=>s.kind===k).length]));}

  function readings(site,city,sampleSeconds){
    const driving=city.cars.filter(c=>c.state==='driving');
    if(['queue','gate','road'].includes(site.kind)){
      const edge=city.edges[site.edge],on=driving.filter(c=>c.edge===site.edge);
      if(site.kind==='queue'){
        const near=on.filter(c=>toMetres(edge.length-c.s)<=100),node=city.nodes[edge.to];
        const {dx,dz}=city.approach(edge),from=Math.abs(dx)>Math.abs(dz)?(dx>0?'barat':'timur'):(dz>0?'utara':'selatan');
        return {location:`Pendekat ${signalName.get(node.id)} · dari ${from}`,rows:[['Kendaraan dalam 100 m',near.length],['Berhenti (< 0,3 m/detik)',near.filter(c=>c.v<.3).length],['Lampu arah ini',{green:'Hijau',yellow:'Kuning',red:'Merah'}[city.phase(node,city.approach(edge).axis)]]]};
      }
      const speed=on.length?on.reduce((s,c)=>s+c.v,0)/on.length*3.6:0;
      const rows=[['Kendaraan di ruas',on.length],['Berhenti',on.filter(c=>c.v<.3).length],['Kecepatan rata-rata',on.length?`${fmt(speed)} km/jam`:'—']];
      if(site.kind==='gate'){
        const inbound=!!city.nodes[edge.from].external,lotId=city.nodes[inbound?edge.from:edge.to].lot,cross=city.crossings[lotId];
        return {location:`${city.lots[lotId].name} · ${inbound?'arah masuk kota':'arah keluar kota'}`,rows:[...rows,['Lintasan sejak mulai',cross?(inbound?cross.in:cross.out):'—']]};
      }
      return {location:`Ruas ${site.edge} · panjang ${fmt(toMetres(edge.length))} m`,rows};
    }
    if(site.kind==='access'){const lot=city.lots[site.lot];return {location:lot.name,rows:[['Kendaraan terparkir',lot.occupied.size],['Menuju petak',lot.reserved.size]]};}
    if(site.kind==='waste'){
      const lot=city.lots[site.lot],w=lot.waste,pct=Math.min(100,w.amount/w.capacity*100);
      return {location:lot.name,rows:[['Tingkat isi (dibaca sensor)',`${fmt(pct)}%`],['Massa menurut model',`${fmt(w.amount,1)} / ${fmt(w.capacity)} kg`],['Status',pct>=80?'Perlu dijemput':'Normal']]};
    }
    if(site.kind==='ctrl'){
      const node=city.nodes[site.node],signal=city.adaptiveSignals?.get(node.id),axis=signal?.axis??'x';
      const dir=a=>a==='x'?'Barat–timur':'Utara–selatan';
      return {location:signalName.get(node.id),rows:[['Arah aktif',dir(axis)],['Fase',{green:'Hijau',yellow:'Kuning',red:'Merah bersama'}[city.phase(node,axis)]??'—'],['Lama fase',signal?`${fmt(city.time-signal.since)} detik`:'—']]};
    }
    const served=sites.filter(s=>s.gateway===site),perSecond=served.reduce((sum,s)=>sum+({queue:1/sampleSeconds,gate:1/sampleSeconds,road:1/sampleSeconds,access:1/5,waste:1/60}[s.kind]??0),0);
    const by=Object.entries(DEVICE_KINDS).filter(([k])=>k!=='gw').map(([k,v])=>[v.label,served.filter(s=>s.kind===k).length]).filter(([,n])=>n);
    return {location:signalName.get(site.node),rows:[...by,['Pesan ke Kafka',`${fmt(perSecond,1)} / detik`]]};
  }
  function describe(site,city,sampleSeconds=1){
    const kind=DEVICE_KINDS[site.kind],device=DEVICES.find(d=>d.id===kind.device),{location,rows}=readings(site,city,sampleSeconds);
    const gw=site.gateway?`Gateway ${signalName.get(site.gateway.node)}`:null;
    const flow=site.kind==='ctrl'?[gw,'Pengendali simpang','Kepala lampu']:site.kind==='gw'?['Sensor sekitar','Gateway','Jaringan kota',`Kafka`,'Spark','Dashboard']:[kind.label,gw,'Jaringan kota',`Kafka (${kind.topic})`,'Spark','Dashboard'];
    // Cameras: road and gate units use access fibre, the rest copper PoE.
    const own=site.kind==='gate'||site.kind==='road'?'fiber':'lan';
    const networks=linksOf(kind.device).filter(l=>kind.device!=='cam'||l.key===own).map(l=>({to:SHORT_NAMES[l.other],...l.network}));
    return {kind,device,location,rows,flow,gateway:gw,networks,process:PROCESSES[kind.device]};
  }
  return {group,pickables,sites,select,update,counts,describe,get selected(){return selected;}};
}
