// Traffic signals: which junctions get lights, phase plans and a safety check.
// Pure functions over buildGeometry() output (junction legs). Traffic keeps left (Indonesia):
// a left turn is the short turn; a right turn crosses the opposing traffic.

export const TIMING={yellow:3,allRed:1,minGreen:5,maxGreen:120};

export const PATTERNS={
  '4-fase':{name:'4 fase · per pendekat',arms:4,description:'Setiap pendekat hijau bergiliran; tidak ada gerakan yang bersilangan.'},
  '2-fase':{name:'2 fase · berpasangan',arms:4,description:'Pendekat yang berhadapan hijau bersamaan; belok kanan mengalah ke arus lurus dari depan.'},
  '2-fase-panah-kanan':{name:'2 fase + panah belok kanan',arms:4,description:'Seperti 2 fase, ditambah fase panah khusus belok kanan untuk satu pasangan.'},
  '3-fase':{name:'3 fase · per pendekat',arms:3,description:'Setiap lengan hijau bergiliran.'},
  '2-fase-t':{name:'2 fase · jalan utama lalu cabang',arms:3,description:'Jalan utama dua arah hijau bersamaan (belok kanan mengalah), lalu jalan cabang.'},
  'per-pendekat':{name:'Per pendekat',arms:0,description:'Setiap lengan hijau bergiliran.'},
};
export function patternsFor(arms){
  return Object.entries(PATTERNS).filter(([,p])=>p.arms===arms||(p.arms===0&&arms!==3&&arms!==4)).map(([id])=>id);
}
export function defaultPattern(arms){return arms===4?'4-fase':arms===3?'3-fase':'per-pendekat';}

const add=(a,b,k=1)=>({x:a.x+b.x*k,z:a.z+b.z*k});
const left=d=>({x:d.z,z:-d.x}),right=d=>({x:-d.z,z:d.x});
const DIRECTIONS=['Timur','Tenggara','Selatan','Barat Daya','Barat','Barat Laut','Utara','Timur Laut'];
// Compass name of a leg, by the direction it leaves the junction (x east, z south).
export function compass(dir){return DIRECTIONS[((Math.round(Math.atan2(dir.z,dir.x)/(Math.PI/4))%8)+8)%8];}

// Legs that carry traffic into the junction (not access driveways' exits only).
function signalLegs(j){return j.legs.filter(l=>!l.ring);}

// Every movement: from the leg it enters by, to the leg it leaves by, with its turn.
export function movements(j){
  const legs=signalLegs(j),out=[];
  legs.forEach((from,fi)=>legs.forEach((to,ti)=>{
    if(fi===ti)return;
    const h={x:-from.dir.x,z:-from.dir.z},o=to.dir;          // heading in, heading out
    const cross=h.x*o.z-h.z*o.x,dot=h.x*o.x+h.z*o.z;
    if(dot<-0.9)return;                                     // U-turn
    const turn=dot>Math.cos(Math.PI/5)?'lurus':cross<0?'kiri':'kanan';
    out.push({from:fi,to:ti,turn});
  }));
  return out;
}

// A light is proposed where two or more legs are main roads (2+ lanes per direction).
export function suggestSignal(j){
  if(j.legs.some(l=>l.ring))return false;
  return j.legs.filter(l=>!l.access&&l.lanes>=2).length>=2;
}

// Pairs of roughly opposite legs (for 2-phase plans).
function oppositePairs(legs){
  // Most opposite first, so a fork pairs its true through road rather than any near match.
  const candidates=[];
  legs.forEach((a,i)=>legs.forEach((b,k)=>{if(k>i){const dot=a.dir.x*b.dir.x+a.dir.z*b.dir.z;if(dot<-0.8)candidates.push({i,k,dot});}}));
  candidates.sort((p,q)=>p.dot-q.dot);
  const pairs=[],used=new Set();
  for(const {i,k} of candidates)if(!used.has(i)&&!used.has(k)){pairs.push([i,k]);used.add(i);used.add(k);}
  return pairs;
}

// Builds the phases of a plan. Each phase lists movements as protected (go) or yield (go
// when clear). Left turns may be free in every phase ("belok kiri jalan terus").
export function buildPlan(j,plan={}){
  const legs=signalLegs(j),moves=movements(j),n=legs.length;
  let pattern=plan.pattern&&patternsFor(n).includes(plan.pattern)?plan.pattern:defaultPattern(n);
  const leftFree=plan.leftFree??true;
  const groups=[];   // each: {legs:[...], moves:filter fn, yieldRight:bool}
  const pairs=oppositePairs(legs);
  if(pattern==='2-fase'&&pairs.length===2){
    for(const pair of pairs)groups.push({legs:pair,only:null,yieldRight:true});
  }else if(pattern==='2-fase-panah-kanan'&&pairs.length===2){
    groups.push({legs:pairs[0],only:['kiri','lurus']},{legs:pairs[0],only:['kanan'],arrow:true},{legs:pairs[1],yieldRight:true});
  }else if(pattern==='2-fase-t'&&n===3&&pairs.length===1){
    const branch=[0,1,2].find(i=>!pairs[0].includes(i));
    groups.push({legs:pairs[0],yieldRight:true},{legs:[branch]});
  }else{
    if(pattern!=='3-fase'&&pattern!=='4-fase'&&pattern!=='per-pendekat')pattern=defaultPattern(n);
    legs.forEach((_,i)=>groups.push({legs:[i]}));
  }
  const greens=groups.map((_,i)=>clampGreen(plan.green?.[i]??(groups.length<=2?25:20)));
  const phases=groups.map((g,i)=>({
    index:i,green:greens[i],arrow:!!g.arrow,legs:g.legs,
    name:g.legs.map(k=>compass(legs[k].dir)).join(' & '),
    movements:moves.filter(m=>g.legs.includes(m.from)&&(!g.only||g.only.includes(m.turn))).map(m=>({...m,
      mode:g.yieldRight&&m.turn==='kanan'?'yield':'protected'})),
  }));
  if(leftFree)for(const ph of phases)for(const m of moves.filter(m=>m.turn==='kiri'))
    if(!ph.movements.some(x=>x.from===m.from&&x.to===m.to))ph.movements.push({...m,mode:'free'});
  // Safety net for unusual shapes (forks, skewed legs): if two protected movements would
  // still cross, the turning one yields, as a permissive turn does on the street.
  const rank={kanan:0,kiri:1,lurus:2};
  for(const ph of phases){
    for(let guard=0;guard<20;guard++){
      const [pair]=conflicts(j,ph);if(!pair)break;
      const [a,b]=pair,demote=rank[a.turn]<=rank[b.turn]?a:b;
      demote.mode='yield';
    }
  }
  const cycle=phases.reduce((s,p)=>s+p.green+TIMING.yellow+TIMING.allRed,0);
  return {pattern,leftFree,phases,cycle,legs:legs.map(l=>({road:l.road,name:compass(l.dir)}))};
}
function clampGreen(v){return Math.min(TIMING.maxGreen,Math.max(TIMING.minGreen,Math.round(Number(v)||0)));}

// Straight chord of a movement: from the incoming lane at the entry mouth to the outgoing
// lane at the exit mouth. Incoming traffic keeps left of its own heading, i.e. the right
// side of the leg seen from the junction; outgoing traffic uses the leg's left side.
export function movementPath(j,m){
  const legs=signalLegs(j),a=legs[m.from],b=legs[m.to];
  const entry=add(add(j,a.dir,a.setback),right(a.dir),Math.max(1,a.right/2));
  const exit=add(add(j,b.dir,b.setback),left(b.dir),Math.max(1,b.left/2));
  return [entry,exit];
}
function segmentsCross([a,b],[c,d]){
  const r={x:b.x-a.x,z:b.z-a.z},s={x:d.x-c.x,z:d.z-c.z},den=r.x*s.z-r.z*s.x;
  if(Math.abs(den)<1e-9)return false;
  const t=((c.x-a.x)*s.z-(c.z-a.z)*s.x)/den,u=((c.x-a.x)*r.z-(c.z-a.z)*r.x)/den;
  return t>0.02&&t<0.98&&u>0.02&&u<0.98;
}
// Protected movements of one phase that cross or merge into the same exit: must be none.
export function conflicts(j,phase){
  const prot=phase.movements.filter(m=>m.mode==='protected'),out=[];
  for(let i=0;i<prot.length;i++)for(let k=i+1;k<prot.length;k++){
    const a=prot[i],b=prot[k];
    if(a.from===b.from)continue;
    if(a.to===b.to||segmentsCross(movementPath(j,a),movementPath(j,b)))out.push([a,b]);
  }
  return out;
}
// Movements that never get a green (should be none).
export function unserved(j,plan){
  return movements(j).filter(m=>!plan.phases.some(p=>p.movements.some(x=>x.from===m.from&&x.to===m.to)));
}
