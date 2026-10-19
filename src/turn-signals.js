import * as THREE from 'three';
import {toMapUnits} from './scale.js';

// Vehicles face local +Z, so their left side is local +X.
const lensGeometry=new THREE.BoxGeometry(.5,.55,.3);
const offMaterial=new THREE.MeshStandardMaterial({color:'#9c5915',roughness:.5});
const onMaterial=new THREE.MeshBasicMaterial({color:'#ffb521',toneMapped:false});
export function addTurnSignals(group,{width=3.3,front=3.4,rear=-3.4,height=1.8}={}){
  const lights=[];
  for(const side of [-1,1])for(const z of [front+.12,rear-.12]){
    const lamp=new THREE.Mesh(lensGeometry,offMaterial);
    lamp.position.set(side*(width/2-.22),height,z);
    group.add(lamp);lights.push({lamp,side});
  }
  group.userData.turnSignals=lights;
}
export function updateTurnSignals(group,direction,time){
  const lit=time%0.8<0.4;
  for(const {lamp,side} of group.userData.turnSignals??[])lamp.material=lit&&side===direction?onMaterial:offMaterial;
}
export function trafficTurnSignal(sim,car){
  if(car.state!=='driving')return 0;
  const edge=sim.edges[car.edge];
  if(!edge)return 0;
  let incoming=edge,outgoing=sim.edges[car.path[0]];
  const previous=sim.edges[car.previousEdge];
  if(previous?.to===edge.from&&car.s<sim.trim(edge)){
    incoming=previous;outgoing=edge;
  }else if(edge.length-car.s>Math.max(toMapUnits(18),sim.trim(edge)))return 0;
  if(!outgoing)return 0;
  const a=sim.laneEnd(incoming,true),b=sim.laneEnd(outgoing,false);
  const angle=Math.atan2(b.dx*a.dz-b.dz*a.dx,a.dx*b.dx+a.dz*b.dz);
  return Math.abs(angle)<0.25?0:Math.sign(angle);
}
