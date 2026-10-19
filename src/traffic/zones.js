import * as THREE from 'three';
import {offsetLine} from '../map/geometry.js';

// Detection zones of the traffic cameras, drawn on the road: a band over each lane of the
// watched approach from the stop line back to the end of the zone (default 80 m), a dashed
// line and a label at that threshold, and — for the selected camera — lines from the camera
// to its zone (field of view). The band colour follows what the camera reports:
//   green  nothing stopped        amber  vehicles waiting
//   red    the queue reaches 70% of the zone (the light holds this green longer)
const COLORS={free:0x2ecc71,waiting:0xf5b82e,full:0xe0412f,plain:0x2f7fc1};
const Y=0.06;
// Drawn over the asphalt and its markings (which are pulled forward with a polygon offset).
const lifted=o=>({transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-6,polygonOffsetUnits:-6,...o});

function band(points,width,out){
  if(points.length<2)return;
  const l=offsetLine(points,width/2),r=offsetLine(points,-width/2);
  for(let i=1;i<points.length;i++){
    const a=l[i-1],b=r[i-1],c=l[i],d=r[i];
    out.push(a.x,Y,a.z,b.x,Y,b.z,c.x,Y,c.z, b.x,Y,b.z,d.x,Y,d.z,c.x,Y,c.z);
  }
}
// A dashed line across the lane at the far end of the zone.
function threshold(points,width,out){
  if(points.length<2)return;
  const p=points[0],q=points[1],t={x:q.x-p.x,z:q.z-p.z},len=Math.hypot(t.x,t.z)||1,n={x:t.z/len,z:-t.x/len},u={x:t.x/len,z:t.z/len};
  const dashes=3,step=width/(dashes*2-1);
  for(let k=0;k<dashes;k++){
    const a=-width/2+k*2*step,b=a+step;
    const c=[[a,0],[b,0],[b,0.45],[a,0.45]].map(([s,f])=>({x:p.x+n.x*s+u.x*f,z:p.z+n.z*s+u.z*f}));
    out.push(c[0].x,Y+0.01,c[0].z,c[1].x,Y+0.01,c[1].z,c[2].x,Y+0.01,c[2].z, c[0].x,Y+0.01,c[0].z,c[2].x,Y+0.01,c[2].z,c[3].x,Y+0.01,c[3].z);
  }
}
function mesh(pos,material){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  const m=new THREE.Mesh(g,material);m.renderOrder=6;return m;
}
function labelTexture(text){
  const c=document.createElement('canvas');c.width=128;c.height=56;const x=c.getContext('2d');
  x.fillStyle='#ffffffe6';x.beginPath();x.roundRect(4,4,120,48,12);x.fill();
  x.fillStyle='#25483b';x.font='700 30px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(text,64,30);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}

export class ZoneLayer{
  constructor(scene){this.group=new THREE.Group();this.group.name='zones';scene.add(this.group);this.zones=[];this.clock=0;}
  set visible(v){this.group.visible=v;}
  get visible(){return this.group.visible;}
  // One zone per camera of the engine (or only `only`, for the editor's selection).
  build(engine,{only=null}={}){
    this.clear();this.engine=engine;
    for(const s of engine.sensors){
      if(only&&s.id!==only)continue;
      const paths=engine.zonePaths(s.id).filter(p=>p.points.length>=2);if(!paths.length)continue;
      const fill=[],marks=[];
      for(const p of paths){band(p.points,p.width*0.86,fill);threshold(p.points,p.width*0.86,marks);}
      const material=new THREE.MeshBasicMaterial(lifted({color:COLORS.plain,opacity:0.4}));
      const group=new THREE.Group();
      group.add(mesh(fill,material),mesh(marks,new THREE.MeshBasicMaterial(lifted({color:0xffffff,opacity:0.95,polygonOffsetFactor:-8,polygonOffsetUnits:-8}))));
      // Label at the threshold, between the lanes' far ends.
      const ends=paths.map(p=>p.points[0]),at={x:ends.reduce((a,p)=>a+p.x,0)/ends.length,z:ends.reduce((a,p)=>a+p.z,0)/ends.length};
      const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(`${Math.round(s.zone)} m`),depthTest:false,transparent:true}));
      label.position.set(at.x,1.2,at.z);label.renderOrder=31;label.center.set(0.5,0);group.add(label);
      // Field of view: from the camera (on its pole) to the outer corners of the zone, filled.
      const cam=engine.map.objects.find(o=>o.id===s.id),eye=new THREE.Vector3(cam.x,5.5,cam.z);
      const edges=p=>[offsetLine(p.points,p.width*0.43),offsetLine(p.points,-p.width*0.43)];
      const widest=pick=>{let best=null;const pts=paths.flatMap(p=>edges(p).map(pick));
        for(const a of pts)for(const b of pts){const d=Math.hypot(a.x-b.x,a.z-b.z);if(!best||d>best.d)best={a,b,d};}return [best.a,best.b];};
      const [fa,fb]=widest(l=>l[0]),[na,nb]=widest(l=>l.at(-1)),v=q=>new THREE.Vector3(q.x,Y,q.z);
      const cone=new THREE.Group();cone.visible=false;
      const lines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([eye,v(fa),eye,v(fb),eye,v(na),eye,v(nb)]),
        new THREE.LineBasicMaterial({color:0x123c66,transparent:true,opacity:0.9,depthTest:false}));
      const fan=new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([eye,v(fa),v(fb)]),
        new THREE.MeshBasicMaterial({color:0x2f7fc1,transparent:true,opacity:0.14,depthWrite:false,side:THREE.DoubleSide}));
      lines.renderOrder=30;fan.renderOrder=29;cone.add(fan,lines);group.add(cone);
      this.group.add(group);
      this.zones.push({id:s.id,material,label,cone,state:'plain'});
    }
  }
  // Colours from the cameras' readings (four times a second), the selected one stands out;
  // labels keep a readable size on screen.
  update(dt,camera,height,{selected=null,live=true}={}){
    if(!this.group.visible||!this.engine)return;
    this.clock+=dt;const refresh=this.clock>=0.25;if(refresh)this.clock=0;
    for(const z of this.zones){
      if(refresh&&live){
        const st=this.engine.sensorState(z.id);
        z.state=!st?'plain':st.stopped===0?'free':st.queueLength>=st.zone*0.7?'full':'waiting';
      }
      const on=z.id===selected;
      z.material.color.setHex(COLORS[live?z.state:'plain']);z.material.opacity=on?0.6:selected?0.2:0.4;
      z.cone.visible=on;
      const d=camera.position.distanceTo(z.label.position),mpp=2*d*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/height;
      z.label.visible=on||d<260;z.label.scale.set(mpp*44,mpp*19,1);
    }
  }
  clear(){
    for(const c of [...this.group.children]){this.group.remove(c);c.traverse(o=>{o.geometry?.dispose?.();o.material?.map?.dispose?.();});}
    this.zones=[];
  }
  dispose(){this.clear();this.group.parent?.remove(this.group);}
}
