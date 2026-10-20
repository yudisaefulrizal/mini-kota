import * as THREE from 'three';

// Builds three.js meshes from buildGeometry() output. Everything of one kind is merged
// into a single mesh, so a whole city costs a handful of draw calls.
// Map x/z are used directly as world x/z; y is up.

const LEVEL={asphalt:0.02,junction:0.025,marking:0.04,zebra:0.045};
export const ROAD_COLORS={asphalt:'#4b504d',sidewalk:'#cfc7b3',curb:'#e2dfd6',marking:'#f3f2ea',box:'#e8b923',ground:'#a9c595',lot:'#d7e2c8'};

function ribbonTriangles(left,right,y,pos){
  const n=Math.min(left.length,right.length);
  for(let i=1;i<n;i++){
    const a=left[i-1],b=right[i-1],c=left[i],d=right[i];
    pos.push(a.x,y,a.z,b.x,y,b.z,c.x,y,c.z, b.x,y,b.z,d.x,y,d.z,c.x,y,c.z);
  }
}
function skirt(line,y0,y1,pos){
  // Vertical face along a line, e.g. the kerb between road and pavement.
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i];
    pos.push(a.x,y0,a.z,b.x,y0,b.z,a.x,y1,a.z, b.x,y0,b.z,b.x,y1,b.z,a.x,y1,a.z);
  }
}
function polygonTriangles(points,y,pos){
  const contour=points.map(p=>new THREE.Vector2(p.x,p.z));
  if(contour.length<3)return;
  for(const [a,b,c] of THREE.ShapeUtils.triangulateShape(contour,[]))
    for(const p of [points[a],points[b],points[c]])pos.push(p.x,y,p.z);
}
function mesh(pos,color,name,options={}){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({color,roughness:options.roughness??0.9,side:THREE.DoubleSide,polygonOffset:!!options.offset,polygonOffsetFactor:options.offset??0,polygonOffsetUnits:options.offset??0});
  const m=new THREE.Mesh(geometry,material);m.name=name;m.receiveShadow=true;return m;
}

export function buildRoadMeshes(geometry,{markings=true,sidewalks=true}={}){
  const group=new THREE.Group();group.name='roads';
  const asphalt=[],walkTop=[],walkSide=[],marks=[],zebra=[];
  for(const r of geometry.ribbons){
    if(r.kind==='asphalt')ribbonTriangles(r.left,r.right,LEVEL.asphalt,asphalt);
    else if(r.kind==='sidewalk'&&sidewalks){ribbonTriangles(r.left,r.right,r.height,walkTop);skirt(r.left,0,r.height,walkSide);skirt(r.right,0,r.height,walkSide);}
    else if(r.kind==='marking'&&markings)ribbonTriangles(r.left,r.right,LEVEL.marking,marks);
  }
  for(const p of geometry.polygons)if(p.kind==='asphalt')polygonTriangles(p.points,LEVEL.junction,asphalt);
  const box=[];
  if(markings)for(const q of geometry.quads){const [a,b,c,d]=q.points,out=q.box?box:q.zebra?zebra:marks,y=q.zebra||q.box?LEVEL.zebra:LEVEL.marking;out.push(a.x,y,a.z,b.x,y,b.z,c.x,y,c.z, a.x,y,a.z,c.x,y,c.z,d.x,y,d.z);}
  group.add(mesh(asphalt,ROAD_COLORS.asphalt,'asphalt',{offset:-1}));
  if(walkTop.length)group.add(mesh(walkTop,ROAD_COLORS.sidewalk,'sidewalk'),mesh(walkSide,ROAD_COLORS.curb,'curb'));
  if(marks.length||zebra.length)group.add(mesh([...marks,...zebra],ROAD_COLORS.marking,'markings',{offset:-3,roughness:0.6}));
  if(box.length)group.add(mesh(box,ROAD_COLORS.box,'yellow-box',{offset:-3,roughness:0.6}));
  return group;
}

// Debug overlay: centre lines and nodes of the raw map data.
export function buildGraphOverlay(map){
  const group=new THREE.Group();group.name='graph';
  const nodes=new Map(map.nodes.map(n=>[n.id,n])),pts=[];
  for(const r of map.roads){
    const line=[nodes.get(r.from),...(r.points||[]).map(([x,z])=>({x,z})),nodes.get(r.to)];
    for(let i=1;i<line.length;i++)pts.push(new THREE.Vector3(line[i-1].x,0.3,line[i-1].z),new THREE.Vector3(line[i].x,0.3,line[i].z));
  }
  const lines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xd43c2c,depthTest:false}));
  lines.renderOrder=5;group.add(lines);
  const dot=new THREE.SphereGeometry(0.8,8,6),signal=new THREE.MeshBasicMaterial({color:0x2e9e5b,depthTest:false}),plain=new THREE.MeshBasicMaterial({color:0xd43c2c,depthTest:false});
  for(const n of map.nodes){const m=new THREE.Mesh(dot,n.signal?signal:plain);m.position.set(n.x,0.3,n.z);m.renderOrder=6;group.add(m);}
  return group;
}

export function buildLots(map){
  const group=new THREE.Group();group.name='lots';
  const material=new THREE.MeshStandardMaterial({color:ROAD_COLORS.lot,roughness:1});
  for(const l of map.lots){const m=new THREE.Mesh(new THREE.BoxGeometry(l.w,0.05,l.d),material);m.position.set(l.x+l.w/2,0.01,l.z+l.d/2);m.receiveShadow=true;m.name=`lot:${l.id}`;group.add(m);}
  return group;
}

// The city's ground: the polygon of its area (src/map/region.js).
export function buildGround(region,color){
  const shape=new THREE.Shape(region.hull.map(p=>new THREE.Vector2(p.x,-p.z)));
  const ground=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshStandardMaterial({color,roughness:1}));
  ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;ground.name='ground';return ground;
}
// A sign at each city gate: "Gerbang N" on a post beside the road end.
export function buildGateMarkers(gates){
  const group=new THREE.Group();group.name='gates';
  for(const g of gates){
    const c=document.createElement('canvas');c.width=256;c.height=72;const x=c.getContext('2d');
    x.fillStyle='#173b37';x.beginPath();x.roundRect(4,4,248,64,14);x.fill();
    x.fillStyle='#ffffff';x.font='700 34px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(g.name,128,38);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
    // A constant size on screen, readable at any zoom.
    const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:t,depthTest:false,transparent:true,sizeAttenuation:false}));
    sign.scale.set(0.085,0.024,1);sign.center.set(0.5,0);sign.position.set(g.x,3,g.z);sign.renderOrder=14;sign.userData.gate=g.id;group.add(sign);
  }
  return group;
}
