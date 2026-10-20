import * as THREE from 'three';
import {networkLinks,DEVICE_ICONS,NETWORKS,LINK_TYPES} from './network.js';

// Draws the device network of a map, in the style of the device map of the old city view:
// lettered icons above the devices, cables as arcs coloured by medium (LAN, fiber optic),
// LoRaWAN radio as dashed arcs with radio rings, high fiber arcs from the gateways to the
// data centre, and data packets running along them. Without a simulation the packets
// flow at a calm idle rate; with one they follow what happens: every vehicle a camera
// counts, every bin report, every phase change sent to a junction controller and from it,
// along the lamp cables, to its traffic lights.

// Height (m) where cables attach on each model, and the icon above it.
const TOP={'cctv-dome':5.4,cctv:6,'bin-sensor':1.6,controller:1.9,gateway:3.9,'data-center':12,
  'traffic-light':4.2,'traffic-light-arm':5.6,'traffic-light-arrow-right':4.2,'pedestrian-light':2.6};
const ICON_PX=22,PACKET_SPEED={lan:45,fiber:90,lora:22,lamp:30},MAX_PACKETS=700,MAX_RINGS=60;

function iconTexture({glyph,color,square}){
  const c=document.createElement('canvas');c.width=c.height=128;
  const x=c.getContext('2d');x.fillStyle=color;x.strokeStyle='#ffffff';x.lineWidth=9;
  x.beginPath();if(square)x.roundRect(10,10,108,108,22);else x.arc(64,64,54,0,Math.PI*2);x.fill();x.stroke();
  x.fillStyle='#ffffff';x.font=`700 ${glyph.length>1?50:64}px sans-serif`;x.textAlign='center';x.textBaseline='middle';x.fillText(glyph,64,68);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
function ringTexture(){
  const c=document.createElement('canvas');c.width=c.height=128;
  const x=c.getContext('2d');x.strokeStyle='#ffffff';x.lineWidth=7;x.beginPath();x.arc(64,64,56,0,Math.PI*2);x.stroke();
  return new THREE.CanvasTexture(c);
}

export class NetworkLayer{
  constructor(scene){
    this.group=new THREE.Group();this.group.name='network';scene.add(this.group);
    this.textures=Object.fromEntries(Object.entries(DEVICE_ICONS).map(([k,v])=>[k,iconTexture(v)]));
    this.icons=[];this.links=[];this.lines=[];this.packets=[];this.rings=[];this.stats=new Map();
    this.byObject=new Map();this.idle=true;this.clock=0;this.selected=null;
    // Packets: one instanced sphere mesh coloured per instance.
    this.packetMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(1,10,8),new THREE.MeshBasicMaterial({depthTest:false,transparent:true}),MAX_PACKETS);
    this.packetMesh.renderOrder=12;this.packetMesh.frustumCulled=false;this.packetMesh.count=0;
    for(let i=0;i<MAX_PACKETS;i++)this.packetMesh.setColorAt(i,new THREE.Color(1,1,1));
    this.group.add(this.packetMesh);
    const ring=ringTexture();
    for(let i=0;i<MAX_RINGS;i++){
      const s=new THREE.Sprite(new THREE.SpriteMaterial({map:ring,color:NETWORKS.lora.color,transparent:true,depthTest:false,opacity:0}));
      s.visible=false;s.renderOrder=11;this.group.add(s);this.rings.push({sprite:s,age:0,life:1});
    }
  }
  set visible(v){this.group.visible=v;}
  get visible(){return this.group.visible;}

  // Rebuilds icons and cables from the map (call after every edit).
  sync(map){
    for(const o of [...this.icons,...this.lines])this.group.remove(o);
    for(const l of this.lines)l.geometry.dispose();
    this.icons=[];this.lines=[];this.packets=[];this.byObject.clear();
    this.map=map;
    const byId=new Map(map.objects.map(o=>[o.id,o]));
    const at=o=>new THREE.Vector3(o.x,TOP[o.asset]??3,o.z);
    for(const o of map.objects){
      if(!DEVICE_ICONS[o.asset])continue;
      const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.textures[o.asset],depthTest:false,transparent:true}));
      sprite.position.copy(at(o)).add(new THREE.Vector3(0,o.asset==='data-center'?8:3.2,0));
      sprite.renderOrder=13;sprite.userData.objectId=o.id;sprite.userData.big=o.asset==='gateway'||o.asset==='data-center';
      this.group.add(sprite);this.icons.push(sprite);
    }
    this.links=networkLinks(map).map((l,i)=>{
      const a=at(byId.get(l.from)),b=at(byId.get(l.to)),span=a.distanceTo(b);
      const mid=a.clone().lerp(b,0.5);mid.y=Math.max(a.y,b.y)+(l.kind==='uplink'?18+span*0.22:l.kind==='lamp'?0.5+span*0.08:2+span*0.18);
      const curve=new THREE.QuadraticBezierCurve3(a,mid,b);
      const link={...l,curve,length:curve.getLength(),timer:(i*0.37)%3};
      for(const id of [l.from,l.to])(this.byObject.get(id)||this.byObject.set(id,[]).get(id)).push(link);
      return link;
    });
    for(const network of ['lan','fiber','lora','lamp']){
      const list=this.links.filter(l=>l.network===network);if(!list.length)continue;
      const pts=[];
      for(const l of list){const p=l.curve.getPoints(l.kind==='uplink'?36:18);for(let i=1;i<p.length;i++)pts.push(p[i-1],p[i]);}
      const geometry=new THREE.BufferGeometry().setFromPoints(pts);
      const material=network==='lora'
        ?new THREE.LineDashedMaterial({color:NETWORKS.lora.color,dashSize:2.2,gapSize:1.6,transparent:true,opacity:0.95,depthTest:false})
        :new THREE.LineBasicMaterial({color:LINK_TYPES[network].color,transparent:true,opacity:network==='lamp'?0.7:network==='lan'?0.75:0.85,depthTest:false});
      const lines=new THREE.LineSegments(geometry,material);if(network==='lora')lines.computeLineDistances();
      lines.renderOrder=10;lines.userData.network=network;this.group.add(lines);this.lines.push(lines);
    }
  }

  // ------------------------------------------------------------ packets
  send(link,{reverse=false,forward=true,big=false}={}){
    if(this.packets.length>=MAX_PACKETS)return;
    this.packets.push({link,t:0,reverse,forward,big,color:new THREE.Color(LINK_TYPES[link.network].color)});
    const from=reverse?link.to:link.from;
    this.count(from,'sent');
    if(link.network==='lora')this.ring(reverse?link.curve.v2:link.curve.v0);
  }
  ring(p){
    const r=this.rings.find(r=>!r.sprite.visible);if(!r)return;
    r.sprite.position.copy(p);r.age=0;r.life=1.4;r.sprite.visible=true;
  }
  count(id,key){const s=this.stats.get(id)||{sent:0,received:0};s[key]++;this.stats.set(id,s);}
  // A sensor reading: to its gateway, which passes it on to the data centre.
  report(objectId,{big=false}={}){
    const link=(this.byObject.get(objectId)||[]).find(l=>l.kind==='sensor'&&l.from===objectId);
    if(link)this.send(link,{big});
  }
  arrive(p){
    const to=p.reverse?p.link.from:p.link.to;this.count(to,'received');
    if(!p.forward)return;
    // A controller passes a new phase on to its lamps.
    if(p.link.kind==='control'){for(const l of this.linksOf(to))if(l.kind==='lamp')this.send(l);return;}
    if(p.link.kind!=='sensor')return;
    const up=(this.byObject.get(to)||[]).find(l=>l.kind==='uplink'&&l.from===to);
    if(up)this.send(up,{big:p.big});
    // Counts for a controller under another gateway go on to that gateway.
    if(p.link.relay){const r=this.linksOf(to).find(l=>l.kind==='relay'&&`${l.from}>${l.to}`===p.link.relay);if(r)this.send(r);}
  }

  // Idle traffic, or the simulation's events; then move packets and rings, size icons.
  update(dt,camera,height,engine=null){
    if(!this.group.visible)return;
    this.clock+=dt;
    if(engine)this.fromEngine(engine);
    else for(const l of this.links){
      l.timer-=dt;if(l.timer>0)continue;
      l.timer=(l.network==='lora'?7:l.kind==='uplink'?4:2.2)*(0.6+Math.random()*0.8);
      if(l.kind==='uplink'||l.kind==='relay'||l.kind==='lamp')continue;   // these carry what arrives before them
      this.send(l);
    }
    const m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(),pos=new THREE.Vector3();
    const mpp=d=>2*d*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/height;
    let n=0;
    for(const p of this.packets){
      p.t+=dt*PACKET_SPEED[p.link.network]/Math.max(p.link.length,1);
      if(p.t>=1){p.done=true;this.arrive(p);continue;}
      p.link.curve.getPointAt(p.reverse?1-p.t:p.t,pos);
      const size=Math.max(0.35,mpp(camera.position.distanceTo(pos))*(p.big?6:4));
      m.compose(pos,q,s.setScalar(size));this.packetMesh.setMatrixAt(n,m);this.packetMesh.setColorAt(n,p.color);n++;
    }
    this.packets=this.packets.filter(p=>!p.done);
    this.packetMesh.count=n;this.packetMesh.instanceMatrix.needsUpdate=true;if(this.packetMesh.instanceColor)this.packetMesh.instanceColor.needsUpdate=true;
    for(const r of this.rings){
      if(!r.sprite.visible)continue;
      r.age+=dt;const k=r.age/r.life;
      if(k>=1){r.sprite.visible=false;continue;}
      const d=camera.position.distanceTo(r.sprite.position);
      r.sprite.scale.setScalar(Math.max(2,mpp(d)*60)*(0.2+k));r.sprite.material.opacity=0.85*(1-k);
    }
    // Icons keep a readable size on screen.
    for(const icon of this.icons){
      const px=(icon.userData.big?ICON_PX*1.25:ICON_PX)*(icon.userData.objectId===this.selected?1.4:1);
      icon.scale.setScalar(mpp(camera.position.distanceTo(icon.position))*px);
    }
  }
  // Packets from what the simulation reports since the last frame.
  fromEngine(engine){
    const seen=this.seen||(this.seen={counts:new Map(),phases:new Map(),reports:new Map()});
    for(const s of engine.sensors){
      const before=seen.counts.get(s.id)??s.count,fresh=Math.min(3,s.count-before);
      for(let i=0;i<fresh;i++)this.report(s.id);
      seen.counts.set(s.id,s.count);
    }
    // Bins report their fill every 60 s of simulated time; a call for a truck goes at once.
    for(const b of engine.bins){
      const slot=Math.floor(engine.time/60+(parseInt(b.id.replace(/\D/g,''),10)||0)*0.37%1),last=seen.reports.get(b.id);
      const called=b.truck==='called'&&!seen.reports.get(`${b.id}:call`);
      if(last!==slot||called){this.report(b.id,{big:called});seen.reports.set(b.id,slot);}
      seen.reports.set(`${b.id}:call`,b.truck==='called');
    }
    // A phase change: the gateway sends the new green time to the junction controller.
    for(const [node,sig] of engine.signals){
      const key=`${sig.phase}:${sig.stage==='green'}`;
      if(seen.phases.get(node)!==key&&sig.stage==='green'){
        const ctrl=this.controllerAt(engine,node);
        const link=ctrl&&(this.byObject.get(ctrl)||[]).find(l=>l.kind==='control');
        if(link)this.send(link);
      }
      seen.phases.set(node,key);
    }
  }
  controllerAt(engine,node){
    this.controllers||(this.controllers=new Map());
    if(!this.controllers.has(node)){
      const j=engine.signals.get(node).j;let best=null;
      for(const o of this.map.objects)if(o.asset==='controller'){const d=Math.hypot(o.x-j.x,o.z-j.z);if(d<40&&(!best||d<best.d))best={id:o.id,d};}
      this.controllers.set(node,best?.id||null);
    }
    return this.controllers.get(node);
  }
  // Leaving or entering a simulation starts the counters afresh.
  reset(){this.seen=null;this.controllers=null;this.packets=[];this.stats.clear();}
  pick(raycaster){
    const hit=raycaster.intersectObjects(this.icons,false)[0];
    return hit?.object.userData.objectId||null;
  }
  linksOf(id){return this.byObject.get(id)||[];}
}
