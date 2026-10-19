import * as THREE from 'three';

// Camera navigation for the map editor, complete with the mouse alone. The point under
// the cursor is the anchor:
//   right drag             orbit round the point under the cursor: sideways turns,
//                          up/down tilts (from the top view it tilts into perspective)
//   middle drag            pan; the ground point grabbed stays under the cursor
//   left drag on empty map pan as well (started by the page, see beginDrag)
//   wheel / pinch          zoom towards the cursor; the point under it stays put
//   double right / middle  fly to that point
//   touchpad               two-finger swipe pans, Shift + wheel turns
//   keys (optional)        W A S D / arrows pan, Q E turn, + - zoom, F focus, Home
// Limits keep the camera above the ground, near the map and between a street-level and
// a whole-city distance.

const UP=new THREE.Vector3(0,1,0);
const MIN_PITCH=THREE.MathUtils.degToRad(12),MAX_PITCH=THREE.MathUtils.degToRad(89.5);
const ease=t=>t<0.5?2*t*t:1-(-2*t+2)**2/2;

export class MapCamera{
  // bounds: {width, depth} of the map, starting at x0, z0 (default 0). viewRect: the screen
  // rectangle of the view under a pointer, for pages that draw several views with one camera.
  // keysOnHover: take keys only while the pointer is over the view (on a scrolling page).
  constructor(camera,dom,{pickables=()=>[],bounds=()=>({width:600,depth:400}),onChange=()=>{},onLeaveTop=()=>{},viewRect=null,maxDistance=null,keysOnHover=false}={}){
    this.camera=camera;this.dom=dom;this.pickables=pickables;this.bounds=bounds;this.onChange=onChange;this.onLeaveTop=onLeaveTop;
    this.viewRect=viewRect;this.fixedMaxDistance=maxDistance;this.keysOnHover=keysOnHover;this.hover=false;
    this.target=new THREE.Vector3();this.enabled=true;this.topView=true;
    this.minDistance=6;this.follow=null;this.keys=new Set();this.anim=null;this.drag=null;this.lastPointer=null;this.lastClick={button:-1,time:0,x:0,y:0};
    this.raycaster=new THREE.Raycaster();this.ndc=new THREE.Vector2();
    // Marker shown at the anchor while orbiting.
    this.marker=new THREE.Group();this.marker.visible=false;this.marker.renderOrder=40;
    const mat=new THREE.MeshBasicMaterial({color:0xe8742c,depthTest:false,transparent:true,opacity:0.9,side:THREE.DoubleSide});
    const ring=new THREE.Mesh(new THREE.RingGeometry(0.8,1,32),mat),dot=new THREE.Mesh(new THREE.CircleGeometry(0.22,16),mat);
    ring.rotation.x=dot.rotation.x=-Math.PI/2;ring.renderOrder=dot.renderOrder=40;this.marker.add(ring,dot);
    this.listen();
  }
  get distance(){return this.camera.position.distanceTo(this.target);}
  get maxDistance(){if(this.fixedMaxDistance)return this.fixedMaxDistance;const b=this.bounds();return Math.max(b.width,b.depth)*1.6+100;}
  rect(clientX,clientY){
    const r=this.viewRect?.(clientX,clientY);
    return r&&r.width>0?r:this.dom.getBoundingClientRect();
  }

  // ------------------------------------------------------------ picking
  ray(clientX,clientY){
    const r=this.rect(clientX,clientY);
    // Views of different shapes share the camera: use the shape of the one under the pointer.
    if(this.viewRect&&Math.abs(this.camera.aspect-r.width/r.height)>1e-6){this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();}
    this.ndc.set((clientX-r.left)/r.width*2-1,-((clientY-r.top)/r.height)*2+1);
    this.raycaster.setFromCamera(this.ndc,this.camera);return this.raycaster.ray;
  }
  // The visible surface under the cursor (building, lamp, road, ground), else the ground
  // plane, else nothing (sky).
  pick(clientX,clientY){
    const ray=this.ray(clientX,clientY);
    const hits=this.raycaster.intersectObjects(this.pickables(),true).filter(h=>h.object.isMesh&&!h.object.isInstancedMesh&&visible(h.object));
    if(hits.length)return hits[0].point.clone();
    return this.onPlane(ray,0);
  }
  onPlane(ray,height){
    const p=new THREE.Vector3();
    if(!ray.intersectPlane(new THREE.Plane(UP,-height),p))return null;
    // Far towards the horizon a point is of no use as an anchor.
    return p.distanceTo(this.camera.position)<this.maxDistance*2?p:null;
  }
  anchorAt(clientX,clientY){return this.pick(clientX,clientY)||this.target.clone();}

  // ------------------------------------------------------------ moves
  set(position,target){this.camera.position.copy(position);this.target.copy(target);this.apply();}
  // Moves camera and target together by a horizontal offset.
  translate(d){this.camera.position.add(d);this.target.add(d);}
  zoomAt(anchor,factor){
    const d=this.distance,next=THREE.MathUtils.clamp(d*factor,this.minDistance,this.maxDistance);factor=next/d;
    if(Math.abs(factor-1)<1e-4)return;
    // Scale about the anchor: it keeps its place on screen.
    this.camera.position.sub(anchor).multiplyScalar(factor).add(anchor);
    this.target.sub(anchor).multiplyScalar(factor).add(anchor);
    this.apply();
  }
  orbit(anchor,yaw,pitch){
    if(this.topView)return;
    const rot=(axis,angle)=>{const q=new THREE.Quaternion().setFromAxisAngle(axis,angle);
      this.camera.position.sub(anchor).applyQuaternion(q).add(anchor);this.target.sub(anchor).applyQuaternion(q).add(anchor);};
    rot(UP,yaw);
    const dir=this.target.clone().sub(this.camera.position).normalize(),now=Math.asin(-dir.y);
    const goal=THREE.MathUtils.clamp(now+pitch,MIN_PITCH,MAX_PITCH),right=new THREE.Vector3().crossVectors(dir,UP).normalize();
    if(right.lengthSq()>0.5){
      const before=this.camera.position.clone(),targetBefore=this.target.clone();
      rot(right,-(goal-now));
      if(this.camera.position.y<1.5){this.camera.position.copy(before);this.target.copy(targetBefore);}
    }
    this.apply();
  }
  pan(dx,dz){this.translate(new THREE.Vector3(dx,0,dz));this.apply();this.follow=null;}
  // Horizontal forward and right directions of the view.
  axes(){
    const f=this.target.clone().sub(this.camera.position);f.y=0;
    if(f.lengthSq()<1e-6)f.set(0,0,-1);   // straight down: north is forward
    f.normalize();return {forward:f,right:new THREE.Vector3(-f.z,0,f.x)};
  }
  // Keeps the view on the map and above the ground; then points the camera.
  apply(){
    const {width,depth,x0=0,z0=0}=this.bounds(),m=Math.max(width,depth)*0.15;
    const c=new THREE.Vector3(THREE.MathUtils.clamp(this.target.x,x0-m,x0+width+m)-this.target.x,0,THREE.MathUtils.clamp(this.target.z,z0-m,z0+depth+m)-this.target.z);
    if(c.lengthSq())this.translate(c);
    this.target.y=THREE.MathUtils.clamp(this.target.y,0,80);
    if(this.camera.position.y<1.5)this.camera.position.y=1.5;
    if(this.topView){const d=this.distance;this.camera.position.set(this.target.x,this.target.y+d,this.target.z+0.001);}
    this.camera.lookAt(this.target);
    // Picking right after a move (several wheel steps between frames) needs fresh matrices.
    this.camera.updateMatrixWorld();
    this.onChange();
  }

  // ------------------------------------------------------------ animation & following
  flyTo(position,target,duration=0.6,done=null){
    this.anim={t:0,duration,done,from:{p:this.camera.position.clone(),t:this.target.clone()},to:{p:position.clone(),t:target.clone()}};
  }
  // Fly so that a point becomes the centre of the view, keeping the viewing direction.
  focusOn(point,distance=Math.min(this.distance,70)){
    const back=this.camera.position.clone().sub(this.target).normalize().multiplyScalar(Math.max(distance,this.minDistance));
    this.flyTo(point.clone().add(back),point);
  }
  // Turn round the view centre until north is up.
  northUp(){
    const {forward}=this.axes(),yaw=Math.atan2(forward.x,-forward.z);
    if(Math.abs(yaw)<1e-3)return;
    const p=this.camera.position.clone().sub(this.target).applyAxisAngle(UP,yaw).add(this.target);
    this.flyTo(p,this.target,0.4);
  }
  update(dt=0){
    if(!this.enabled)return;
    if(this.anim){
      const a=this.anim;a.t=Math.min(1,a.t+dt/a.duration);const k=ease(a.t);
      this.camera.position.lerpVectors(a.from.p,a.to.p,k);this.target.lerpVectors(a.from.t,a.to.t,k);
      this.apply();
      if(a.t>=1){this.anim=null;a.done?.();}
    }
    if(this.follow){
      const p=this.follow();
      if(!p)this.follow=null;
      else{this.translate(new THREE.Vector3(p.x-this.target.x,0,p.z-this.target.z));this.apply();}
    }
    if(this.keys.size&&this.enabled){
      const {forward,right}=this.axes(),speed=Math.max(this.distance,15)*0.9*dt,k=this.keys;
      const move=new THREE.Vector3();
      if(k.has('w')||k.has('arrowup'))move.add(forward);
      if(k.has('s')||k.has('arrowdown'))move.sub(forward);
      if(k.has('d')||k.has('arrowright'))move.add(right);
      if(k.has('a')||k.has('arrowleft'))move.sub(right);
      if(move.lengthSq()){this.anim=null;this.pan(move.x*speed,move.z*speed);}
      if(k.has('q'))this.orbit(this.target.clone(),-1.4*dt,0);
      if(k.has('e'))this.orbit(this.target.clone(),1.4*dt,0);
      if(k.has('+')||k.has('='))this.zoomAt(this.target.clone(),1-1.6*dt);
      if(k.has('-')||k.has('_'))this.zoomAt(this.target.clone(),1+1.6*dt);
    }
    if(!this.anim&&!this.follow&&!this.keys.size)this.apply();   // like OrbitControls.update(): point at the target
  }
  // Rotation of a north arrow on screen (radians, clockwise).
  compassAngle(){
    const {forward,right}=this.axes();return Math.atan2(-right.z,-forward.z);
  }

  // ------------------------------------------------------------ input
  listen(){
    const dom=this.dom;
    dom.addEventListener('contextmenu',e=>e.preventDefault());
    dom.addEventListener('pointerdown',e=>{
      if(!this.enabled||e.button===0)return;   // the left button belongs to the page
      e.preventDefault();this.anim=null;
      // Double right or middle click: fly to the point.
      const now=performance.now(),last=this.lastClick;
      this.lastClick={button:e.button,time:now,x:e.clientX,y:e.clientY};
      if(last.button===e.button&&now-last.time<350&&Math.hypot(e.clientX-last.x,e.clientY-last.y)<6){
        const p=this.pick(e.clientX,e.clientY);if(p)this.focusOn(p);return;
      }
      this.beginDrag(e.button===2?'orbit':'pan',e);
    });
    dom.addEventListener('pointermove',e=>{
      this.lastPointer={x:e.clientX,y:e.clientY};
      const d=this.drag;if(!d||e.pointerId!==d.pointer)return;
      const dx=e.clientX-d.x,dy=e.clientY-d.y;d.x=e.clientX;d.y=e.clientY;d.moved+=Math.abs(dx)+Math.abs(dy);
      if(d.mode==='orbit'){
        // Tilting away from the top view turns it into a perspective view.
        if(this.topView){if(Math.abs(dx)+Math.abs(dy)<1)return;this.topView=false;this.onLeaveTop();}
        const k=2*Math.PI/this.rect(e.clientX,e.clientY).height;this.orbit(d.anchor,-dx*k,dy*k);
      }
      else{
        // Grab the ground: the anchor stays under the cursor.
        const q=this.onPlane(this.ray(e.clientX,e.clientY),d.anchor.y);
        if(q)this.pan(d.anchor.x-q.x,d.anchor.z-q.z);
      }
    });
    const end=e=>{if(!this.drag||e.pointerId!==this.drag.pointer)return;this.drag=null;this.marker.visible=false;this.dom.style.cursor='';};
    dom.addEventListener('pointerup',end);dom.addEventListener('pointercancel',end);
    dom.addEventListener('wheel',e=>{
      if(!this.enabled)return;
      e.preventDefault();this.anim=null;
      const px=e.deltaMode===1?e.deltaY*33:e.deltaMode===2?e.deltaY*400:e.deltaY;
      if(e.ctrlKey){this.zoomAt(this.anchorAt(e.clientX,e.clientY),Math.exp(px*0.01));return;}   // touchpad pinch
      if(e.shiftKey){this.orbit(this.target.clone(),(e.deltaX||e.deltaY)*0.004,0);return;}
      if(Math.abs(e.deltaX)>0.5&&e.deltaMode===0){
        // Two-finger swipe on a touchpad: pan by screen pixels.
        const mpp=2*this.distance*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))/this.rect(e.clientX,e.clientY).height;
        const {forward,right}=this.axes();
        this.pan((right.x*e.deltaX-forward.x*e.deltaY)*mpp,(right.z*e.deltaX-forward.z*e.deltaY)*mpp);return;
      }
      this.zoomAt(this.anchorAt(e.clientX,e.clientY),Math.exp(px*0.0015));
    },{passive:false});
    dom.addEventListener('pointerenter',()=>{this.hover=true;});dom.addEventListener('pointerleave',()=>{this.hover=false;this.keys.clear();});
    window.addEventListener('keyup',e=>this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur',()=>this.keys.clear());
  }
  // Starts a pan or orbit drag; the page calls it for a left drag on empty map, with the
  // position where the press began.
  beginDrag(mode,e,from={x:e.clientX,y:e.clientY}){
    this.anim=null;
    const anchor=this.anchorAt(from.x,from.y);
    this.drag={mode,x:e.clientX,y:e.clientY,anchor,pointer:e.pointerId,moved:0};
    if(mode==='pan')this.follow=null;
    try{this.dom.setPointerCapture(e.pointerId);}catch{}
    this.dom.style.cursor=mode==='orbit'?'move':'grabbing';
    if(mode==='orbit'){this.marker.visible=true;this.marker.position.copy(anchor);this.marker.scale.setScalar(Math.max(0.6,this.distance/60));}
    // A left drag starts a few pixels late: catch up so the grabbed point is under the cursor.
    if(mode==='pan'&&(from.x!==e.clientX||from.y!==e.clientY)){const q=this.onPlane(this.ray(e.clientX,e.clientY),anchor.y);if(q)this.pan(anchor.x-q.x,anchor.z-q.z);}
  }
  // Called by the page for keys it does not use itself.
  keyDown(key){
    if(!this.enabled||(this.keysOnHover&&!this.hover))return false;
    if(['w','a','s','d','q','e','+','=','-','_','arrowup','arrowdown','arrowleft','arrowright'].includes(key)){this.keys.add(key);this.anim=null;return true;}
    return false;
  }
}
function visible(o){for(let x=o;x;x=x.parent)if(!x.visible)return false;return true;}
