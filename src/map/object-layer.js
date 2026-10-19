import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {gatewayOf} from './placement.js';

// Shows the assets placed on a map (map.objects) using the models listed in
// public/models/manifest.json. Each model file is loaded once and cloned per object.
const RAD=Math.PI/180;

export class ObjectLayer{
  constructor(scene){
    this.group=new THREE.Group();this.group.name='objects';scene.add(this.group);
    this.links=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x2f7fc1,depthTest:false,transparent:true,opacity:0.8}));
    this.links.renderOrder=15;scene.add(this.links);
    this.loader=new GLTFLoader();this.models=new Map();this.meshes=new Map();this.assets=new Map();this.categories={};
    this.ghost=null;this.ghostAsset=null;this.selectionBox=new THREE.BoxHelper(undefined,0xe8742c);this.selectionBox.visible=false;scene.add(this.selectionBox);
  }
  loadManifest(url='models/manifest.json'){
    this.manifest=(async()=>{
      const manifest=await (await fetch(url)).json();
      this.categories=manifest.categories;
      for(const a of manifest.assets)this.assets.set(a.id,a);
      return manifest;
    })();
    return this.manifest;
  }
  // Objects can arrive before the manifest (a map loaded at start-up): wait for it.
  model(id){
    if(!this.models.has(id)){
      this.models.set(id,(this.manifest||Promise.resolve()).then(()=>{
        const asset=this.assets.get(id);if(!asset)throw Error(`Aset ${id} tidak dikenal`);
        return this.loader.loadAsync(asset.file);
      }).then(g=>{g.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});return g.scene;}));
    }
    return this.models.get(id);
  }
  // Brings the meshes in line with map.objects (adds, moves, removes).
  sync(map){
    this.map=map;
    const ids=new Set(map.objects.map(o=>o.id));
    for(const [id,mesh] of this.meshes)if(!ids.has(id)){this.group.remove(mesh);this.meshes.delete(id);}
    for(const o of map.objects){
      let holder=this.meshes.get(o.id);
      if(!holder||holder.userData.asset!==o.asset){
        if(holder)this.group.remove(holder);
        holder=new THREE.Group();holder.userData={asset:o.asset,id:o.id};this.group.add(holder);this.meshes.set(o.id,holder);
        this.model(o.asset).then(model=>{if(this.meshes.get(o.id)===holder)holder.add(model.clone(true));this.refreshSelection();}).catch(()=>{});
      }
      holder.position.set(o.x,0,o.z);holder.rotation.y=(o.rotation||0)*RAD;
    }
    this.updateLinks();this.refreshSelection();
  }
  updateLinks(visible=this.linksVisible??true){
    this.linksVisible=visible;
    const points=[];
    if(visible&&this.map)for(const o of this.map.objects){
      const gw=gatewayOf(this.map,o);if(!gw)continue;
      const g=this.map.objects.find(x=>x.id===gw.id);if(!g)continue;
      points.push(new THREE.Vector3(o.x,3,o.z),new THREE.Vector3(g.x,3.6,g.z));
    }
    this.links.geometry.dispose();this.links.geometry=new THREE.BufferGeometry().setFromPoints(points);
  }
  select(id){this.selected=id;this.refreshSelection();}
  refreshSelection(){
    const holder=this.selected&&this.meshes.get(this.selected);
    this.selectionBox.visible=!!holder&&holder.children.length>0;
    if(this.selectionBox.visible)this.selectionBox.setFromObject(holder);
  }
  // Semi-transparent preview while dragging or placing.
  showGhost(assetId,placed){
    if(this.ghostAsset!==assetId){
      this.hideGhost();this.ghostAsset=assetId;
      const holder=new THREE.Group();this.ghost=holder;this.group.parent.add(holder);
      this.model(assetId).then(model=>{
        if(this.ghost!==holder)return;
        const copy=model.clone(true);
        copy.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.transparent=true;o.material.opacity=0.55;o.material.depthWrite=false;}});
        holder.add(copy);
      }).catch(()=>{});
    }
    this.ghost.visible=true;this.ghost.position.set(placed.x,0,placed.z);this.ghost.rotation.y=(placed.rotation||0)*RAD;
  }
  hideGhost(){if(this.ghost){this.ghost.parent?.remove(this.ghost);this.ghost=null;this.ghostAsset=null;}}
}
