// Map file format v1 (see docs/rancangan-editor-peta.md). Metres; x east, z south.
// Pure data helpers with no rendering dependencies, so tests and the simulation can use them.

export const MAP_FORMAT='minikota-map',MAP_VERSION=1;

// Cross-sections. lanes = [forward, backward] relative to the road's from → to direction;
// Indonesia drives on the left, so forward lanes lie on the left half.
export const DEFAULT_PROFILES={
  'jalan-1x1':{name:'Jalan 1 lajur per arah',lanes:[1,1],laneWidth:3.0,median:0,curb:0.2,sidewalk:2.0},
  'jalan-2x2':{name:'Jalan 2 lajur per arah',lanes:[2,2],laneWidth:3.5,median:0.6,curb:0.2,sidewalk:2.5},
  'jalan-3x3':{name:'Jalan 3 lajur per arah',lanes:[3,3],laneWidth:3.5,median:1.0,curb:0.2,sidewalk:3.0},
  'satu-arah-1':{name:'Satu arah 1 lajur',lanes:[1,0],laneWidth:3.5,median:0,curb:0.2,sidewalk:1.5},
  'satu-arah-2':{name:'Satu arah 2 lajur',lanes:[2,0],laneWidth:3.5,median:0,curb:0.2,sidewalk:2.0},
  'satu-arah-3':{name:'Satu arah 3 lajur',lanes:[3,0],laneWidth:3.5,median:0,curb:0.2,sidewalk:2.5},
  'bundaran':{name:'Bundaran 2 lajur',lanes:[2,0],laneWidth:3.5,median:0,curb:0.2,sidewalk:0,ring:true},
  'akses':{name:'Akses kawasan',lanes:[1,1],laneWidth:2.75,median:0,curb:0.15,sidewalk:0,access:true},
};

export function emptyMap(name='Peta baru',width=600,depth=400){
  return {format:MAP_FORMAT,version:MAP_VERSION,name,bounds:{width,depth},profiles:structuredClone(DEFAULT_PROFILES),nodes:[],roads:[],lots:[],gates:[],objects:[]};
}

// Throws a readable (Indonesian) error for the first problem; returns the map with defaults filled.
export function validateMap(input){
  if(!input||input.format!==MAP_FORMAT)throw Error('Bukan file peta Mini Kota (format tidak dikenal).');
  if(input.version!==MAP_VERSION)throw Error(`Versi peta ${input.version} belum didukung (yang didukung: ${MAP_VERSION}).`);
  const map={...emptyMap(input.name),...input,profiles:{...DEFAULT_PROFILES,...(input.profiles||{})}};
  const finite=(v,label)=>{if(!Number.isFinite(v))throw Error(`${label} harus berupa angka.`);};
  finite(map.bounds?.width,'Lebar peta');finite(map.bounds?.depth,'Kedalaman peta');
  for(const [id,p] of Object.entries(map.profiles)){
    if(!Array.isArray(p.lanes)||p.lanes.length!==2||p.lanes.some(n=>!Number.isInteger(n)||n<0)||p.lanes[0]+p.lanes[1]<1)throw Error(`Profil ${id}: jumlah lajur tidak valid.`);
    for(const k of ['laneWidth','median','curb','sidewalk'])finite(p[k],`Profil ${id}: ${k}`);
  }
  // Gateway reach (m), optional: cables and LoRaWAN radio.
  if(map.network!==undefined){
    for(const [k,[min,max],label] of [['cableReach',[10,100],'Jangkauan kabel'],['loraReach',[100,5000],'Jangkauan LoRaWAN']]){
      const v=map.network?.[k];if(v===undefined)continue;
      if(!Number.isFinite(v)||v<min||v>max)throw Error(`${label} harus ${min}–${max} m.`);
    }
  }
  const nodes=new Map();
  for(const n of map.nodes){
    if(!n.id||nodes.has(n.id))throw Error(`Simpul ${n.id||'(tanpa id)'} kosong atau ganda.`);
    finite(n.x,`Simpul ${n.id}: x`);finite(n.z,`Simpul ${n.id}: z`);nodes.set(n.id,n);
    if(n.signalPlan){
      const sp=n.signalPlan;
      if(sp.pattern!==undefined&&typeof sp.pattern!=='string')throw Error(`Simpul ${n.id}: pola fase tidak valid.`);
      for(const g of sp.green||[])finite(g,`Simpul ${n.id}: lama hijau`);
      // Simpang gabungan: `separate` opts out, `offset` (s) delays this member's cycle.
      if(sp.separate!==undefined&&typeof sp.separate!=='boolean')throw Error(`Simpul ${n.id}: pilihan simpang terpisah tidak valid.`);
      if(sp.offset!==undefined)finite(sp.offset,`Simpul ${n.id}: selisih fase`);
    }
  }
  const roads=new Set();
  for(const r of map.roads){
    if(!r.id||roads.has(r.id))throw Error(`Jalan ${r.id||'(tanpa id)'} kosong atau ganda.`);roads.add(r.id);
    if(!nodes.has(r.from)||!nodes.has(r.to))throw Error(`Jalan ${r.id}: simpul ujung tidak ditemukan.`);
    if(r.from===r.to)throw Error(`Jalan ${r.id}: kedua ujung di simpul yang sama.`);
    if(!map.profiles[r.profile])throw Error(`Jalan ${r.id}: profil ${r.profile} tidak dikenal.`);
    for(const pt of r.points||[]){finite(pt[0],`Jalan ${r.id}: titik x`);finite(pt[1],`Jalan ${r.id}: titik z`);}
  }
  for(const g of map.gates)if(!nodes.has(g.node))throw Error(`Gerbang ${g.id}: simpul tidak ditemukan.`);
  const objects=new Set();
  for(const o of map.objects){
    if(!o.id||objects.has(o.id))throw Error(`Objek ${o.id||'(tanpa id)'} kosong atau ganda.`);objects.add(o.id);
    if(typeof o.asset!=='string'||!o.asset)throw Error(`Objek ${o.id}: jenis aset kosong.`);
    finite(o.x,`Objek ${o.id}: x`);finite(o.z,`Objek ${o.id}: z`);finite(o.rotation??0,`Objek ${o.id}: rotasi`);
  }
  for(const o of map.objects)if(o.gateway&&!objects.has(o.gateway))throw Error(`Objek ${o.id}: gateway ${o.gateway} tidak ditemukan.`);
  return map;
}

// Width of each side of the carriageway relative to the from → to direction.
export function crossSection(profile){
  const [fwd,back]=profile.lanes,w=profile.laneWidth,m=profile.median;
  if(back===0)return {left:fwd*w/2,right:fwd*w/2,center:0};
  if(fwd===0)return {left:back*w/2,right:back*w/2,center:0};
  return {left:fwd*w+m/2,right:back*w+m/2,center:m/2};
}
