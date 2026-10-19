import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VEHICLE_TYPES} from './engine.js';

// Draws a running TrafficEngine: instanced vehicles (car, angkot, garbage truck) and
// pedestrians, signal discs at stop lines, the lamps of placed traffic-light assets
// following the phase of their junction, and the fill LED of bin sensors. Vehicles light
// up as they drive: indicators before a turn, a lane change or pulling in at a bus stop,
// hazards and the beacon while a garbage truck works, brake lights when slowing or stopped.
const MAX_VEHICLES=3000,MAX_PEOPLE=2000;
const PAINT={
  car:['#c4553b','#e8b923','#f2f0ea','#4d8f87','#4d77a8','#9db35a','#b85f52'],
  minibus:['#2f7fc1','#3c9a5f','#e2b13c','#2f7fc1','#c4553b'],
  truck:['#d9822b'],
};
const SHIRTS=['#c4553b','#4d77a8','#e8b923','#4d8f87','#f2f0ea','#8a5a9e','#9db35a'].map(c=>new THREE.Color(c));
const TROUSERS=['#26334d','#3a3a3a','#5b4a3a','#2f4f4f','#1f2a44'].map(c=>new THREE.Color(c));
// Walking: one full cycle (two steps) covers this many metres at normal pace; limb swings
// in radians. The rigged people models (assets/blender/people/people.py) swing their legs at
// the hip and arms at the shoulder; the body dips as a straight leg reaches forward.
const GAIT={cycle:1.36,leg:0.44,arm:0.36,bagArm:0.1,hip:0.82};
const PALETTE=Object.fromEntries(Object.entries(PAINT).map(([k,list])=>[k,list.map(c=>new THREE.Color(c))]));
const TIMER_COLORS={red:'#ef6c63',yellow:'#ffd173',green:'#a9e778',arrow:'#a9e778'};
const SIGNAL_COLORS={green:0x2ecc71,arrow:0x2ecc71,yellow:0xf5b82e,red:0xe0412f};
const LAMP_GLOW={lamp_red:0xff3b2f,lamp_yellow:0xffc23a,lamp_green:0x3ddc84,lamp_arrow_right:0x3ddc84,lamp_arrow_left:0x3ddc84,lamp_ped_red:0xff3b2f,lamp_ped_green:0x3ddc84};

// Vehicle lamps (model parts by name) and their colours when on and off.
const LIGHT_PARTS=[['indicator_left','left'],['indicator_right','right'],['brake_light','brake'],['headlight','head'],['beacon','beacon']];
const LIGHT_COLORS={left:['#ffb627','#5e4320'],right:['#ffb627','#5e4320'],brake:['#ff2b1c','#5c1d16'],head:['#fff6d8','#fff6d8'],beacon:['#ffa000','#5a3a00']};
const LIGHT=Object.fromEntries(Object.entries(LIGHT_COLORS).map(([k,[on,off]])=>[k,{on:new THREE.Color(on),off:new THREE.Color(off)}]));
const add=(a,b,k=1)=>({x:a.x+b.x*k,z:a.z+b.z*k}),right=d=>({x:-d.z,z:d.x}),left=d=>({x:d.z,z:-d.x});

// One instanced set per model part; `tint` names the material coloured per instance.
async function instanced(group,file,tint,max,palette,tint2=null,palette2=null){
  const pieces=[];
  try{
    const scene=(await new GLTFLoader().loadAsync(file)).scene;scene.updateMatrixWorld(true);
    scene.traverse(o=>{if(o.isMesh)pieces.push({geometry:o.geometry,material:o.material,local:o.matrixWorld.clone(),name:o.name||o.parent?.name||''});});
  }catch{pieces.push({geometry:new THREE.BoxGeometry(1.8,1.4,4.4),material:new THREE.MeshStandardMaterial({color:'#ffffff',name:tint}),local:new THREE.Matrix4().makeTranslation(0,0.7,0)});}
  return pieces.map(p=>{
    // A lamp gets an unlit material whose per-instance colour switches it on and off.
    const light=LIGHT_PARTS.find(([prefix])=>p.name.startsWith(prefix))?.[1]||null;
    const painted=!light&&p.material.name===tint,painted2=!light&&tint2&&p.material.name===tint2;
    const material=light?new THREE.MeshBasicMaterial({color:'#ffffff',toneMapped:false}):p.material.clone();if(painted||painted2)material.color.set('#ffffff');
    const mesh=new THREE.InstancedMesh(p.geometry,material,max);mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=!light;
    if(painted)for(let i=0;i<max;i++)mesh.setColorAt(i,palette[i%palette.length]);
    if(light)for(let i=0;i<max;i++)mesh.setColorAt(i,LIGHT[light].off);
    if(painted2)for(let i=0;i<max;i++)mesh.setColorAt(i,palette2[i%palette2.length]);
    // A limb of a rigged figure: where it hinges, so it can be swung per instance.
    const limb=['leg_l','leg_r','arm_l','arm_r'].find(k=>p.name.startsWith(k))||null;
    const pivot=new THREE.Vector3(),rest=new THREE.Quaternion(),size=new THREE.Vector3();p.local.decompose(pivot,rest,size);
    group.add(mesh);return {mesh,local:p.local,painted,painted2,light,limb,pivot,size};
  });
}
function draw(parts,items,matrixOf,colorOf,lightOf=null){
  const m=new THREE.Matrix4(),base=items.map(matrixOf);
  for(const part of parts){
    items.forEach((item,i)=>{
      m.multiplyMatrices(base[i],part.local);part.mesh.setMatrixAt(i,m);
      if(part.painted)part.mesh.setColorAt(i,colorOf(item));
      else if(part.light&&lightOf)part.mesh.setColorAt(i,lightOf(item,part.light)?LIGHT[part.light].on:LIGHT[part.light].off);
    });
    part.mesh.count=items.length;part.mesh.instanceMatrix.needsUpdate=true;if((part.painted||part.light)&&part.mesh.instanceColor)part.mesh.instanceColor.needsUpdate=true;
  }
}
// Which way a vehicle signals now: 'left', 'right', 'both' (hazards) or null.
export function signalOf(e,v){
  const stop=v.stops[0];
  if(stop?.bin&&v.dwelling)return 'both';
  if(v.shift>0&&v.laneDir)return v.laneDir;
  if(stop?.busStop){
    if(v.bay)return v.dwell>=stop.dwell-1.5?'right':null;   // about to pull out
    if(stop.idx===v.idx&&stop.s-v.s<30&&stop.s-v.s>-1)return 'left';
  }
  if(stop?.bin&&stop.idx===v.idx&&stop.s-v.s<30&&stop.s-v.s>-1)return 'left';
  const seg=e.graph.byId.get(v.route[v.idx]),next=e.graph.byId.get(v.route[v.idx+1]);
  if(seg.kind==='connector')return seg.turn==='kiri'?'left':seg.turn==='kanan'?'right':null;
  if(next?.kind==='lane'&&(next.id===seg.left||next.id===seg.right))return next.id===seg.left?'left':'right';
  // The next junction move, from 35 m before it.
  let ahead=seg.length-v.s;
  for(let k=v.idx+1;k<v.route.length&&ahead<35;k++){
    const s=e.graph.byId.get(v.route[k]);
    if(s.kind==='connector')return s.turn==='kiri'?'left':s.turn==='kanan'?'right':null;
    ahead+=s.length;
  }
  return null;
}

export class TrafficView{
  constructor(scene,objectLayer){
    this.scene=scene;this.objects=objectLayer;this.group=new THREE.Group();this.group.name='traffic';scene.add(this.group);
    this.fleet={};this.people={};this.parts=[];this.discs=[];this.lamps=[];this.binLeds=[];
  }
  async init(engine){
    this.engine=engine;
    const file=(id,fallback)=>this.objects?.assets?.get(id)?.file||fallback;
    await Promise.all([
      ...Object.entries(VEHICLE_TYPES).map(async([type,t])=>{this.fleet[type]=await instanced(this.group,file(t.asset,`models/vehicles/${t.asset}.glb`),'paint',type==='car'?MAX_VEHICLES:400,PALETTE[type]);}),
      // One rigged figure for everybody (some carry a rubbish bag); poses come from the gait.
      ...(engine.pedestrians?[['body','person'],['bag','person-carrying-bag']].map(async([key,id])=>{this.people[key]=await instanced(this.group,file(id,`models/people/${id}.glb`),'baju',MAX_PEOPLE,SHIRTS,'celana',TROUSERS);}):[]),
    ]);
    this.parts=this.fleet.car;   // kept for tests and older callers
    this.buildSignalDiscs();
    this.bindLamps();
    this.buildTimers();
  }
  // Countdown labels like the old city view: seconds until the light of each approach
  // changes colour, '~' when an adaptive light can only estimate. The same number shows on
  // the timer display of the traffic-light models placed at that approach.
  buildTimers(){
    this.timers=[];this.panels=[];
    for(const [id,sig] of this.engine.signals)sig.j.legs.filter(l=>!l.ring).forEach((leg,i)=>{
      if(leg.access||this.engine.internal.has(`${id}:${i}`))return;
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,transparent:true}));
      sprite.renderOrder=32;sprite.center.set(0.5,0);
      const lamps=this.lamps.filter(l=>!l.pedestrian&&!l.warning&&l.binding?.node===id&&l.binding.leg===i);
      const at=lamps[0]?.object||add(add(sig.j,leg.dir,leg.setback+6),right(leg.dir),leg.right+2);
      sprite.position.set(at.x,lamps.length?6.6:5,at.z);this.group.add(sprite);
      // The model's own timer display shows the same texture.
      // (The display box has no texture coordinates: a thin panel goes on its front face.)
      for(const l of lamps)this.objects.meshes.get(l.object.id)?.traverse(m=>{
        if(!m.isMesh||!m.name.startsWith('timer_display'))return;
        m.geometry.computeBoundingBox();const b=m.geometry.boundingBox,size=new THREE.Vector3();b.getSize(size);
        const panel=new THREE.Mesh(new THREE.PlaneGeometry(size.x*0.94,size.y*0.9),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));
        panel.position.set((b.min.x+b.max.x)/2,(b.min.y+b.max.y)/2,b.max.z+0.01);panel.name='timer_panel';
        m.add(panel);this.panels.push(panel);
      });
      this.timers.push({node:id,leg:i,sprite,texture,last:''});
    });
  }
  updateTimers(){
    const counts=new Map();
    for(const t of this.timers||[]){
      if(!counts.has(t.node))counts.set(t.node,this.engine.signalCountdown(t.node));
      const c=counts.get(t.node)[t.leg],text=`${c.estimated?'~':''}${c.seconds}`,key=`${text}|${c.state}`;
      if(key===t.last)continue;
      const ctx=t.texture.image.getContext('2d');
      ctx.clearRect(0,0,128,64);ctx.fillStyle='#15251ff2';ctx.beginPath();ctx.roundRect(0,0,128,64,10);ctx.fill();
      ctx.fillStyle=TIMER_COLORS[c.state];ctx.font='700 46px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,64,34,120);
      t.texture.needsUpdate=true;t.last=key;
    }
  }
  // Labels keep a readable size on screen (smaller from far away); `show` false hides them
  // (the timers on the light models stay).
  layoutTimers(camera,height,show=true){
    if(!this.timers)return;
    for(const t of this.timers){
      t.sprite.visible=show;if(!show)continue;
      const d=camera.position.distanceTo(t.sprite.position),mpp=2*d*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/height;
      const px=d<150?34:d<400?28:22;t.sprite.scale.set(mpp*px,mpp*px/2,1);
    }
  }
  buildSignalDiscs(){
    const geometry=new THREE.CircleGeometry(1.1,20);
    for(const [id,sig] of this.engine.signals){
      sig.plan.legs.forEach((_,i)=>{
        const leg=sig.j.legs.filter(l=>!l.ring)[i];if(!leg||leg.access||leg.internal)return;   // no stop line inside a simpang gabungan
        const at=add(add(sig.j,leg.dir,leg.setback+5.5),right(leg.dir),Math.max(1.2,leg.right/2));
        const disc=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:SIGNAL_COLORS.red,depthTest:false}));
        disc.rotation.x=-Math.PI/2;disc.position.set(at.x,0.6,at.z);disc.renderOrder=30;
        this.group.add(disc);this.discs.push({disc,node:id,leg:i});
      });
    }
  }
  // Each placed light belongs to the approach it stands beside (nearest leg of a signal);
  // a pedestrian light to the crossing it stands at.
  bindLamps(){
    if(!this.objects)return;
    const glowing=holder=>{const list=[];holder.traverse(m=>{if(m.isMesh){const key=Object.keys(LAMP_GLOW).sort((a,b)=>b.length-a.length).find(k=>m.name.startsWith(k));if(key){m.material=m.material.clone();list.push({mesh:m,key});}}});return list;};
    for(const o of this.engine.map.objects){
      const holder=this.objects.meshes.get(o.id);if(!holder)continue;
      if(o.asset==='bin-sensor'){
        const bin=this.engine.bins.find(b=>b.id===o.id);if(!bin)continue;
        holder.traverse(m=>{if(m.isMesh&&m.name.startsWith('sensor_led')){m.material=m.material.clone();this.binLeds.push({mesh:m,bin});}});
        continue;
      }
      if(!/^(traffic-light|pedestrian-light|warning-light)/.test(o.asset))continue;
      const pedestrian=o.asset==='pedestrian-light';
      let best=null;
      for(const [id,sig] of this.engine.signals)sig.j.legs.filter(l=>!l.ring).forEach((leg,i)=>{
        const spots=pedestrian?[add(add(sig.j,leg.dir,leg.setback+2),left(leg.dir),leg.left+2),add(add(sig.j,leg.dir,leg.setback+2),right(leg.dir),leg.right+2)]
          :[add(add(sig.j,leg.dir,leg.setback+6),right(leg.dir),leg.right+2)];
        for(const at of spots){const d=Math.hypot(at.x-o.x,at.z-o.z);if(d<35&&(!best||d<best.d))best={node:id,leg:i,d};}
      });
      this.lamps.push({object:o,lamps:glowing(holder),binding:best,warning:o.asset==='warning-light',pedestrian});
    }
  }
  update(){
    this.updateTimers();
    const e=this.engine,q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),pos=new THREE.Vector3(),one=new THREE.Vector3(1,1,1);
    const matrix=(p,y=0.02)=>{q.setFromAxisAngle(up,p.heading);pos.set(p.x,y,p.z);return new THREE.Matrix4().compose(pos,q,one);};
    // Indicators blink about 80 times a minute, in real time whatever the simulation speed.
    const blinkOn=performance.now()%750<400,signals=new Map();
    for(const [type,parts] of Object.entries(this.fleet)){
      const list=e.vehicles.filter(v=>v.type===type).slice(0,parts[0]?.mesh.instanceMatrix.count||MAX_VEHICLES);
      draw(parts,list,v=>matrix(e.position(v,v.len/2)),v=>PALETTE[type][v.color%PALETTE[type].length],(v,light)=>{
        if(light==='head')return true;
        if(light==='brake')return (v.acc??0)<-0.8||v.v<0.5;
        if(light==='beacon')return v.dwelling&&blinkOn;
        const sig=signals.get(v)??signals.set(v,signalOf(e,v)).get(v);
        return blinkOn&&(sig===light||sig==='both');
      });
    }
    if(e.pedestrians&&this.people.body)this.drawPeople();
    const states=new Map([...e.signals.keys()].map(id=>[id,e.signalState(id)]));
    for(const d of this.discs)d.disc.material.color.set(SIGNAL_COLORS[states.get(d.node).legs[d.leg]]);
    const blink=Math.floor(e.time)%2===0;
    for(const l of this.lamps){
      const state=l.binding?states.get(l.binding.node).legs[l.binding.leg]:'red';
      for(const {mesh,key} of l.lamps){
        let on;
        if(l.warning)on=blink;
        // Walk while the vehicles of the crossed approach have red.
        else if(l.pedestrian)on=key.includes('green')?state==='red':state!=='red';
        else on=key==='lamp_red'?state==='red':key==='lamp_yellow'?state==='yellow':key.startsWith('lamp_arrow')?state==='arrow':state==='green';
        mesh.material.emissive.setHex(on?LAMP_GLOW[key]:0x000000);mesh.material.emissiveIntensity=on?2.4:0;
      }
    }
    // Bin sensor LED: green, amber when a truck is due, red when full.
    for(const {mesh,bin} of this.binLeds){
      const hex=bin.fill>=1?0xff3b2f:bin.fill>=0.8?0xffb020:0x3ddc84;
      mesh.material.emissive.setHex(hex);mesh.material.emissiveIntensity=bin.fill>=1&&!blink?0.4:2.2;
    }
  }
  // Pedestrians step: legs and arms swing in opposition, in step with the distance walked
  // (so feet do not slide), a longer and quicker stride when hurrying across a zebra; the
  // swing eases in and out when someone starts or stops, and waiting people stand still.
  drawPeople(){
    const now=performance.now(),dt=Math.min(0.1,(now-(this.lastPeople??now))/1000);this.lastPeople=now;
    const gait=this.gait||(this.gait=new Map()),P=this.engine.pedestrians;this.poses||(this.poses=new Map());
    const m=new THREE.Matrix4(),q=new THREE.Quaternion(),rx=new THREE.Quaternion(),pos=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),up=new THREE.Vector3(0,1,0),X=new THREE.Vector3(1,0,0);
    for(const [key,parts] of Object.entries(this.people)){
      const list=P.agents.filter(a=>(a.id%6===5)===(key==='bag')).slice(0,MAX_PEOPLE);
      const poses=list.map(a=>{
        const p=P.position(a),g=gait.get(a.id)||{amp:0};
        g.amp+=((p.walking?1:0)-g.amp)*Math.min(1,dt*6);gait.set(a.id,g);
        const pace=THREE.MathUtils.clamp(p.pace/1.3,0.7,1.35),swing=Math.sin(2*Math.PI*p.walked/(GAIT.cycle*pace)+a.id*1.7);
        const leg=GAIT.leg*pace*g.amp*swing,arm=GAIT.arm*pace*g.amp*swing;
        const drop=GAIT.hip*(1-Math.cos(leg));
        q.setFromAxisAngle(up,p.heading);pos.set(p.x,0.02-drop,p.z);
        const angles={leg_l:-leg,leg_r:leg,arm_l:key==='bag'?-0.14+GAIT.bagArm*g.amp*swing:arm,arm_r:-arm};
        this.poses.set(a.id,{walking:p.walking,amp:g.amp,...angles});   // for tests and inspection
        return {base:new THREE.Matrix4().compose(pos,q.clone(),one),angles};
      });
      for(const part of parts){
        list.forEach((a,i)=>{
          const pose=poses[i];
          if(part.limb){rx.setFromAxisAngle(X,pose.angles[part.limb]);m.compose(part.pivot,rx,part.size).premultiply(pose.base);}
          else m.multiplyMatrices(pose.base,part.local);
          part.mesh.setMatrixAt(i,m);
          if(part.painted)part.mesh.setColorAt(i,SHIRTS[a.id%SHIRTS.length]);
          else if(part.painted2)part.mesh.setColorAt(i,TROUSERS[(a.id*3)%TROUSERS.length]);
        });
        part.mesh.count=list.length;part.mesh.instanceMatrix.needsUpdate=true;
        if((part.painted||part.painted2)&&part.mesh.instanceColor)part.mesh.instanceColor.needsUpdate=true;
      }
    }
  }
  dispose(){for(const p of this.panels||[])p.parent?.remove(p);this.scene.remove(this.group);this.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});}
}
