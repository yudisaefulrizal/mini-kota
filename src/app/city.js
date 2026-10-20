import * as THREE from 'three';
import {validateMap} from '../map/format.js';
import {buildGeometry} from '../map/geometry.js';
import {buildRoadMeshes,buildLots,ROAD_COLORS} from '../map/mesh.js';
import {ObjectLayer} from '../map/object-layer.js';
import {NetworkLayer} from '../map/network-layer.js';
import {TrafficEngine} from '../traffic/engine.js';
import {TrafficView} from '../traffic/view.js';
import {ZoneLayer} from '../traffic/zones.js';
import {onThemeChange} from '../theme.js';

// One city of the comparison: its own scene (ground, roads, placed assets), traffic model
// and view. The ordinary city ('baseline') runs fixed-time lights and empties bins on a
// fixed round; the smart city ('smart') adapts its lights to what its cameras count, calls
// trucks from its bin sensors, and shows its device network. Both get the same map, traffic
// and seed, so their numbers can be compared at the same simulated time.
export const CITY_NAMES={baseline:'Kota biasa',smart:'Kota cerdas'};

// Engine options from the app settings (see main.js).
export function engineOptions(kind,s){
  // A bin holds about 120 kg; the city's daily waste is shared over its bins.
  return {seed:s.seed,demand:s.demand,pedestrians:s.pedestrians,green:s.green,speedSpread:s.speedSpread??0.1,zone:s.zone??80,overtaking:s.overtaking??true,adaptive:kind==='smart',
    binMode:kind==='smart'?'sensor':'schedule',binSchedule:s.truckRoundHours*3600,binFill:s.binFill};
}

export class City{
  constructor(kind,manifest){
    this.kind=kind;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xe4eae0);
    onThemeChange(dark=>this.scene.background.setHex(dark?0x1a2420:0xe4eae0));
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x8a9a80,1.7));
    const sun=new THREE.DirectionalLight(0xfff4e0,1.6);sun.position.set(-200,400,-150);this.scene.add(sun);
    this.objects=new ObjectLayer(this.scene);this.objects.manifest=manifest;
    manifest.then(m=>{this.objects.categories=m.categories;for(const a of m.assets)this.objects.assets.set(a.id,a);});
    this.network=kind==='smart'?new NetworkLayer(this.scene):null;
    if(this.network)this.network.visible=false;
    // The smart city's cameras and their detection zones (shown with its devices).
    this.zones=kind==='smart'?new ZoneLayer(this.scene):null;
    if(this.zones)this.zones.visible=false;
    this.base=null;this.engine=null;this.view=null;
  }
  // Builds the city on a map; returns when vehicles can be drawn.
  async load(map,settings){
    this.dispose();
    this.map=validateMap(structuredClone(map));
    this.geometry=buildGeometry(this.map);
    const {width,depth}=this.map.bounds;
    this.base=new THREE.Group();
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),new THREE.MeshStandardMaterial({color:ROAD_COLORS.ground,roughness:1}));
    ground.rotation.x=-Math.PI/2;ground.position.set(width/2,0,depth/2);ground.name='ground';
    this.base.add(ground,buildRoadMeshes(this.geometry),buildLots(this.map));
    this.scene.add(this.base);
    this.objects.sync(this.map);this.objects.updateLinks(false);
    this.engine=new TrafficEngine(this.map,engineOptions(this.kind,settings));
    if(this.network){this.network.sync(this.map);this.network.reset();}
    this.zones?.build(this.engine);
    this.view=new TrafficView(this.scene,this.objects);
    await this.view.init(this.engine);
    return this;
  }
  step(dt){this.engine?.step(dt);}
  // Per frame: vehicles, lamps, timers; packets when the network is shown.
  draw(camera,height,dt,{network=false,paused=false,labels=true}={}){
    if(!this.view?.engine)return;
    this.view.update();this.view.layoutTimers(camera,height,labels);
    if(this.network){this.network.visible=network;this.network.update(paused?0:dt,camera,height,this.engine);}
    if(this.zones){this.zones.visible=network;this.zones.update(paused?0:dt,camera,height,{selected:this.network?.selected});}
  }
  // What can be picked under the pointer (anchor for the camera, icons for devices).
  pickables(){return [this.base,this.objects.group].filter(Boolean);}
  dispose(){
    this.view?.dispose();this.view=null;this.engine=null;this.zones?.clear();
    if(this.base){this.scene.remove(this.base);this.base.traverse(o=>{o.geometry?.dispose?.();});this.base=null;}
    for(const [,holder] of this.objects.meshes)this.objects.group.remove(holder);this.objects.meshes.clear();
  }
}
