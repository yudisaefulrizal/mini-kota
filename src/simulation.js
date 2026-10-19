import {toMetres,toMapUnits,vehicleLength} from './scale.js';
// Map coordinates, metric physics, seconds and persons. No rendering dependencies; fixed-step deterministic model.
import {DATA_CENTER_SITE} from './data-center.js';
import {makePedestrianNetwork,walkingPosition,hasTrafficSignal} from './pedestrians.js';
import {WORK_SHIFTS,UNIVERSITY_SHIFTS,destinationCount,planActivities} from './activities.js';
export {WORK_SHIFTS,UNIVERSITY_SHIFTS} from './activities.js';
export const DEFAULTS = {
  householdSize: 4, students: 80, university: 40, workers: 180, homemakers: 60, other: 40,
  noCar: 40, oneCar: 50, twoCars: 10, usage: 80,
  schoolStart: 7, schoolEnd: 14, shopStart: 9, shopEnd: 20,
  oneDestination:70,twoDestinations:25,threeDestinations:5,
  green: 25, seed: 42, wastePerPerson: 0.7, idleLitersPerHour: 0.8,
  outboundWorkers: 25, outboundUniversity: 15, incomingFill: 100, incomingCar: 60, externalMinutes: 30,
  throughRate: 800,
  gateShareGate1: 10, gateShareGate2: 10, gateShareGate3: 10, gateShareGate5: 10,
  gateShareGate6: 10, gateShareGate7: 10, gateShareGate8: 10, gateShareGate9: 10,
  gateShareGate10: 10, gateShareGate11: 10, gateShareGate12: 10, gateShareGate13: 10,
  gateShareGate14: 10,
  gateEntryGate1: 10, gateEntryGate2: 10, gateEntryGate3: 10, gateEntryGate5: 10,
  gateEntryGate6: 10, gateEntryGate7: 10, gateEntryGate8: 10, gateEntryGate9: 10,
  gateEntryGate10: 10, gateEntryGate11: 10, gateEntryGate12: 10, gateEntryGate13: 10,
  gateEntryGate14: 10,
  gateExitGate1: 10, gateExitGate2: 10, gateExitGate3: 10, gateExitGate5: 10,
  gateExitGate6: 10, gateExitGate7: 10, gateExitGate8: 10, gateExitGate9: 10,
  gateExitGate10: 10, gateExitGate11: 10, gateExitGate12: 10, gateExitGate13: 10,
  gateExitGate14: 10,
};
export const GROUPS = ['students', 'university', 'workers', 'homemakers', 'other'];
export const GROUP_NAMES = ['Siswa', 'Mahasiswa', 'Pekerja', 'Pengurus rumah tangga', 'Tidak sekolah / bekerja'];
export const LOTS = [
  DATA_CENTER_SITE,
  {id:'wasteDepot',name:'TPS3R',x:310,z:860,w:85,h:110,gate:[380,810],road:[380,782]},
  {id:'homeA',name:'Permukiman Utara',x:250,z:275,w:230,h:95,gate:[365,385],road:[365,409],home:true},
  {id:'homeB',name:'Permukiman Selatan',x:435,z:840,w:245,h:65,gate:[557,810],road:[557,782],home:true},
  {id:'school',name:'Sekolah',x:550,z:510,w:130,h:95,gate:[548,520],road:[524,520]},
  {id:'university',name:'Kampus',x:550,z:655,w:130,h:95,gate:[690,680],road:[713,680]},
  {id:'industry',name:'Industri',x:1300,z:625,w:120,h:110,gate:[1360,755],road:[1360,782]},
  {id:'business',name:'Bisnis',x:1050,z:260,w:170,h:100,gate:[1040,310],road:[1015,310]},
  {id:'shop',name:'Perbelanjaan',x:770,z:620,w:180,h:110,gate:[860,755],road:[860,782]},
  {id:'park',name:'Taman',x:220,z:460,w:180,h:150,gate:[178,520],road:[154,520]},
  {id:'cityCenter',name:'Pusat Kota',x:780,z:100,w:190,h:210,gate:[740,260],road:[713,260]},
];
// A gate is where a road leaves the city: a stretch from a real junction out to the map edge,
// the way the original two did. Gates 5, 12 and 14 fan out of one riverside junction and
// gates 8 and 13 out of another, which is how a single junction serves several destinations.
// Numbers follow the marked reference map, so the sequence has gaps.
export const GATES = [
  {id:'gate1',number:1,gate:[524,0],road:[524,186],external:true},
  {id:'gate2',number:2,gate:[713,0],road:[713,186],external:true},
  {id:'gate3',number:3,gate:[1015,0],road:[1015,85],external:true},
  {id:'gate5',number:5,gate:[1536,409],road:[1455,409],external:true},
  {id:'gate6',number:6,gate:[1536,782],road:[1274,782],external:true},
  {id:'gate7',number:7,gate:[713,1024],road:[713,782],external:true},
  // The airport road leaves near the south-west corner and meets gate 13 at the
  // diagonal T-junction, rather than joining the map halfway up the west edge.
  {id:'gate8',number:8,gate:[0,988],road:[286,750],via:[[284,778],[274,796],[250,817]],external:true},
  {id:'gate9',number:9,gate:[1015,1024],road:[1015,782],external:true},
  {id:'gate10',number:10,gate:[0,186],road:[154,186],external:true},
  {id:'gate11',number:11,gate:[0,409],road:[154,409],external:true},
  {id:'gate12',number:12,gate:[1536,596],road:[1500,596],external:true},
  {id:'gate13',number:13,gate:[0,582],road:[154,671],external:true},
  {id:'gate14',number:14,gate:[1536,271],road:[1500,291],external:true},
].map(g=>({...g,name:`Gerbang ${g.number}`}));
const capitalise=id=>`${id[0].toUpperCase()}${id.slice(1)}`;
// Commuters have a home and a workplace, so one share settles which gate they use both ways.
// Through traffic has neither, so its entry and exit gates are drawn independently.
export const shareKey=id=>`gateShare${capitalise(id)}`;
export const entryKey=id=>`gateEntry${capitalise(id)}`;
export const exitKey=id=>`gateExit${capitalise(id)}`;
export function validate(c) {
  if(!Number.isFinite(c.idleLitersPerHour)||c.idleLitersPerHour<0)throw Error('Konsumsi BBM idle harus nol atau lebih liter/jam.');
  const population=GROUPS.reduce((sum,key)=>sum+c[key],0);
  c={...c,population,householdCount:Math.max(1,Math.round(population/c.householdSize))};
  for(const [k,v] of Object.entries(c)) if(!Number.isFinite(v)) throw Error(`Nilai ${k} harus berupa angka.`);
  if(GROUPS.some(k=>!Number.isInteger(c[k])||c[k]<0))throw Error('Jumlah setiap kelompok aktivitas harus bilangan bulat nol atau lebih.');
  if(c.householdSize<1||c.householdSize>10)throw Error('Rata-rata anggota rumah tangga harus 1–10 orang.');
  if(c.population<1||c.population>20000)throw Error('Total kelompok aktivitas harus 1–20.000 penduduk.');
  for(const keys of [['noCar','oneCar','twoCars']]) {
    if(keys.some(k=>c[k]<0||c[k]>100)||Math.abs(keys.reduce((s,k)=>s+c[k],0)-100)>.001) throw Error('Persentase kepemilikan mobil harus berjumlah 100%.');
  }
  const chances=['oneDestination','twoDestinations','threeDestinations'];
  if(chances.some(k=>c[k]<0||c[k]>100)||Math.abs(chances.reduce((n,k)=>n+c[k],0)-100)>.001)throw Error('Peluang 1–3 tujuan harus berjumlah 100%.');
  if(c.usage<0||c.usage>100)throw Error('Penggunaan mobil harus 0–100%.');
  for(const k of ['outboundWorkers','outboundUniversity','incomingFill','incomingCar',...GATES.flatMap(g=>[shareKey(g.id),entryKey(g.id),exitKey(g.id)])])if(c[k]<0||c[k]>100)throw Error('Persentase komuter harus 0–100%.');
  if(GATES.every(g=>!c[shareKey(g.id)]))throw Error('Minimal satu gerbang harus memiliki pembagian komuter lebih dari 0%.');
  // Through traffic needs two distinct gates, so one gate alone cannot carry the whole entry or exit share.
  for(const [keyOf,arah] of [[entryKey,'masuk'],[exitKey,'keluar']]){
    const positif=GATES.filter(g=>c[keyOf(g.id)]>0);
    if(positif.length===1)throw Error(`Pembagian gerbang ${arah} kendaraan melintas tidak boleh hanya satu gerbang.`);
  }
  if(c.externalMinutes<5||c.externalMinutes>600)throw Error('Waktu perjalanan luar harus 5–600 menit.');
  if(c.throughRate<0||c.throughRate>5000)throw Error('Arus melintas harus 0–5.000 kendaraan per jam.');
  for(const prefix of ['school','shop']) if(c[`${prefix}Start`]<6||c[`${prefix}End`]>22||c[`${prefix}End`]<=c[`${prefix}Start`])throw Error('Jadwal harus antara 06.00–22.00 dan jam pulang setelah jam masuk.');
  if(c.wastePerPerson<0||c.wastePerPerson>5)throw Error('Timbulan sampah harus 0–5 kg/orang/hari.');
  if(c.green<10||c.green>90)throw Error('Lampu hijau harus 10–90 detik.');
  return c;
}
function random(seed) {return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
function distribute(total,weights){const sum=weights.reduce((a,b)=>a+b,0);const exact=weights.map(x=>total*x/sum),out=exact.map(Math.floor);const order=exact.map((x,i)=>({i,r:x-out[i]})).sort((a,b)=>b.r-a.r);const remaining=total-out.reduce((a,b)=>a+b,0);for(let i=0;i<remaining;i++)out[order[i].i]++;return out;}
function shuffle(a,rng){for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function makeNetwork(){
  const nodes=[],edges=[],lookup=new Map();
  function node(x,z){const key=`${x},${z}`;if(!lookup.has(key)){lookup.set(key,nodes.length);nodes.push({id:nodes.length,x,z,edges:[],owner:null});}return lookup.get(key);}
  function connect(a,b,shape=null,oneway=false){
    const points=shape||[[nodes[a].x,nodes[a].z],[nodes[b].x,nodes[b].z]];
    for(const reverse of oneway?[false]:[false,true]){const pts=(reverse?[...points].reverse():points).map(([x,z])=>({x,z}));const lengths=[0];for(let i=1;i<pts.length;i++)lengths.push(lengths.at(-1)+distance(pts[i-1],pts[i]));const from=reverse?b:a,to=reverse?a:b,e={id:edges.length,from,to,length:lengths.at(-1),points:pts,lengths,roundabout:oneway};edges.push(e);nodes[from].edges.push(e.id);}
  }
  function road(points){connect(node(...points[0]),node(...points.at(-1)),points);}
  function line(a,b){const points=[a,b,...LOTS.map(l=>l.road).filter(([x,z])=>a[1]===b[1]?z===a[1]&&x>Math.min(a[0],b[0])&&x<Math.max(a[0],b[0]):x===a[0]&&z>Math.min(a[1],b[1])&&z<Math.max(a[1],b[1]))].sort((a,b)=>(a[0]-b[0])||(a[1]-b[1]));for(let i=1;i<points.length;i++)road([points[i-1],points[i]]);}
  for(const [a,b] of [[[154,186],[524,186]],[[524,186],[713,186]],[[154,186],[154,409]],[[524,186],[524,409]],[[713,186],[713,349]],[[154,409],[524,409]],[[154,409],[154,671]],[[524,409],[524,520]],[[713,489],[713,782]],[[365,782],[408,782]],[[408,782],[713,782]],[[713,782],[1015,782]],[[1015,782],[1274,782]],[[1015,85],[1015,409]],[[1015,409],[1015,704]],[[1015,704],[1015,782]],[[1015,409],[1274,409]]])line(a,b);
  road([[524,409],[620,409],[643,419]]);road([[783,419],[815,409],[1015,409]]);
  road([[524,520],[516,545],[480,583],[450,615],[423,650],[409,700],[408,782]]);
  // The two south-west gates meet at the diagonal T-junction shown on the map.
  // Keep that junction separate from the nearby city-road intersection at 408,782.
  road([[154,671],[237,720],[286,750]]);road([[286,750],[310,764],[330,773],[348,779],[365,782]]);
  road([[1015,85],[1030,112],[1080,145],[1150,204],[1210,257],[1250,305],[1270,350],[1274,409]]);
  road([[1274,409],[1260,473],[1230,513],[1180,566],[1120,625],[1065,674],[1015,704]]);
  // The bridge crosses to a second junction on the east bank; its arms curve off to gates 12 and 14.
  road([[1274,409],[1455,409]]);
  road([[1455,409],[1455,370],[1456,356],[1460,341],[1467,325],[1476,313],[1487,302],[1500,291]]);
  road([[1455,409],[1455,550],[1457,568],[1462,580],[1472,590],[1485,595],[1500,596]]);
  for(let i=0;i<4;i++){const start=-Math.PI/2+i*Math.PI/2;const pts=Array.from({length:17},(_,j)=>[713+70*Math.cos(start+j*Math.PI/32),419+70*Math.sin(start+j*Math.PI/32)]);pts[0]=[[713,349],[783,419],[713,489],[643,419]][i];pts[16]=[[783,419],[713,489],[643,419],[713,349]][i];const a=node(...pts[0]),b=node(...pts[16]);nodes[a].roundabout=true;nodes[b].roundabout=true;connect(a,b,pts,true);}
  const lotNodes={};for(const l of LOTS){
    // The road-side node is a driveway/turn-off, not a signalised public junction.
    // It can still have three graph edges (the two main-road directions plus the access),
    // so retain that distinction explicitly instead of inferring it from degree alone.
    const access=node(...l.road);nodes[access].access=true;
    const id=node(...l.gate);nodes[id].lot=l.id;lotNodes[l.id]=id;connect(access,id);
  }
  // line() inserts lot turn-offs along an axis; a slanted gate road has none, so it is drawn directly.
  for(const g of GATES){
    if(g.via)road([g.road,...g.via,g.gate]);
    else if(g.road[0]===g.gate[0]||g.road[1]===g.gate[1])line(g.road,g.gate);else road([g.road,g.gate]);
    const id=node(...g.gate);nodes[id].lot=g.id;nodes[id].external=true;lotNodes[g.id]=id;
  }
  return {nodes,edges,lotNodes};
}
export class Simulation {
  constructor(config={}){
    this.config=validate({...DEFAULTS,...config});this.rng=random(this.config.seed);
    Object.assign(this,makeNetwork());this.time=5.5*3600;this.end=48*3600;this.finished=false;
    this.queueSeconds=0;this.gateQueueSeconds=0;this.idleFuelLiters=0;
    this.completed=0;this.late=0;this.travelSeconds=0;this.parkingWait=0;this.events=[];
    this.people=[];this.households=[];this.cars=[];this.virtual=[];this.visitors=[];this.routeCache=new Map();
    this.crossings=Object.fromEntries(GATES.map(g=>[g.id,{in:0,out:0}]));
    // `slots` only spaces cars out for drawing; parking itself is unlimited.
    this.lots=Object.fromEntries(LOTS.map(l=>[l.id,{...l,node:this.lotNodes[l.id],slots:0,occupied:new Map(),reserved:new Map(),aisle:null}]));
    for(const g of GATES)this.lots[g.id]={...g,node:this.lotNodes[g.id]};
    this.pedestrianNetwork=makePedestrianNetwork(this,[...LOTS,...GATES]);
    this.createPopulation();this.assignCommuters();this.createPlans();this.createIncoming();this.createThroughTraffic();
    this.initialInside=this.cars.filter(c=>c.state!=='outside').length;
    this.initialGateBalance=Object.fromEntries(GATES.map(g=>[g.id,this.cars.filter(c=>c.external&&!c.through&&c.state!=='outside'&&c.home===g.id).length-this.cars.filter(c=>!c.external&&c.state==='outside'&&c.lot===g.id).length]));
    this.skippedStops=0;
  }
  createThroughTraffic(){
    const rng=random(this.config.seed+913),rate=this.config.throughRate;this.throughCompleted=0;
    if(!rate)return;
    // Independent Poisson arrivals per time block; rate is a base hourly flow, not a target occupancy.
    for(let hour=5;hour<24;hour++){
      const factor=hour<6||hour>=21?.35:(hour>=7&&hour<9)||(hour>=16&&hour<19)?1.6:1;
      let at=Math.max(this.time,hour*3600),end=Math.min(this.end,(hour+1)*3600);
      while((at+=-Math.log(Math.max(1e-9,1-rng()))*3600/(rate*factor))<end){
        const from=this.pickGate(entryKey,rng),to=this.pickGate(exitKey,rng,from);
        this.cars.push({id:this.cars.length,external:true,through:true,household:null,home:from,lot:from,state:'outside',readyAt:at,jobs:[{from,to,at,riders:[],stay:0}],job:0,v:0,s:0,edge:null,path:[],held:null,wait:0,claimed:false});
      }
    }
  }
  // Weighted pick over the gates. `exclude` lets through traffic leave by a different gate
  // than it entered, falling back to an even draw when the remaining weights are all zero.
  pickGate(keyOf,rng=this.rng,exclude=null){
    const pool=GATES.filter(g=>g.id!==exclude);
    const weights=pool.map(g=>Math.max(0,this.config[keyOf(g.id)]));
    const total=weights.reduce((a,b)=>a+b,0);
    if(total<=0)return pool[Math.floor(rng()*pool.length)].id;
    let r=rng()*total;
    for(let i=0;i<pool.length;i++){r-=weights[i];if(r<=0)return pool[i].id;}
    return pool.at(-1).id;
  }
  chooseGate(){return this.pickGate(shareKey);}
  assignCommuters(){
    const workers=shuffle(this.people.filter(p=>p.role==='workers'),this.rng),destinations=shuffle(distribute(workers.length,[60,25,15]).flatMap((n,i)=>Array(n).fill(['industry','business','shop'][i])),this.rng);
    this.workplaces={};const outgoing=Math.round(workers.length*this.config.outboundWorkers/100);
    workers.forEach((p,i)=>{p.workplace=destinations[i];p.shift=i%3;p.schedule=WORK_SHIFTS[p.shift];p.outbound=i<outgoing;if(p.outbound)p.gate=this.chooseGate();});
    const vacancies=shuffle(workers.filter(p=>p.outbound),this.rng),filled=Math.round(vacancies.length*this.config.incomingFill/100);
    this.incomingAssignments=vacancies.slice(0,filled).map(p=>({destination:p.workplace,shift:p.shift}));
    for(const id of ['industry','business','shop']){const total=workers.filter(p=>p.workplace===id).length,local=workers.filter(p=>p.workplace===id&&!p.outbound).length,incoming=this.incomingAssignments.filter(d=>d.destination===id).length;this.workplaces[id]={total,local,incoming,vacant:total-local-incoming};}
    const university=shuffle(this.people.filter(p=>p.role==='university'),this.rng);university.forEach((p,i)=>{p.shift=i%3;p.schedule=UNIVERSITY_SHIFTS[p.shift];p.outbound=i<Math.round(university.length*this.config.outboundUniversity/100);if(p.outbound)p.gate=this.chooseGate();});
  }
  createIncoming(){
    const c=this.config,carCount=Math.round(this.incomingAssignments.length*c.incomingCar/100);
    this.incomingAssignments.forEach(({destination,shift},i)=>{
      const gate=this.chooseGate(),visitor={id:`visitor-${i}`,destination,gate,shift,role:'workers',schedule:WORK_SHIFTS[shift],mode:i<carCount?'car':'transit'};this.visitors.push(visitor);
      const plan=this.dailyPlan(visitor,gate,destination,...visitor.schedule,i+100000);
      if(visitor.mode==='car'){
        const car={id:this.cars.length,external:true,household:null,person:visitor.id,home:gate,lot:gate,state:'outside',jobs:plan.jobs,job:0,v:0,s:0,edge:null,path:[],held:null,wait:0,claimed:false};
        this.cars.push(car);this.installPlan(car,visitor,destination,plan);
      }else this.installVirtual(visitor,gate,destination,plan);
    });
  }
  travelDuration(from,to,mode='car'){
    const units=mode==='walk'?this.pedestrianNetwork.route(from,to).length:this.route(this.lots[from].node,this.lots[to].node).reduce((n,id)=>n+this.edges[id].length,0);
    const metres=toMetres(units);
    const inside=mode==='walk'?metres/1.2:mode==='transit'?metres/5+600:metres/8+90;
    return inside+(this.lots[from].external?this.config.externalMinutes*60:0)+(this.lots[to].external?this.config.externalMinutes*60:0);
  }
  dailyPlan(person,home,destination,start,end,seed,day=0,carryover=true){
    const rng=random(this.config.seed+seed*977+173),travel=(a,b)=>this.travelDuration(a,b,person.mode);
    const overnight=carryover&&day===0&&person.role==='workers'&&person.shift===2;
    const earliest=overnight?7*3600+travel(destination,home)+120:this.time;
    const requested=destinationCount(this.config,rng);
    const plan=planActivities({home,primary:{id:destination,start:(start+day*24)*3600,end:(end+day*24)*3600},earliest,requested,worker:person.role==='workers',config:this.config,travel,rng,day});
    person.requestedDestinations=requested;person.activities=plan.stops;person.overnight=overnight;
    for(const job of plan.jobs)job.riders=typeof person.id==='number'?[person.id]:[];
    // Preserve school departure jitter separately from optional destination draws.
    plan.jobs[0].at=Math.max(earliest,plan.jobs[0].at-rng()*720);
    if(overnight)plan.jobs.unshift({from:destination,to:home,at:7*3600,riders:typeof person.id==='number'?[person.id]:[],stay:120,carryover:true});
    return plan;
  }
  installPlan(car,person,destination,plan){
    car.jobs=plan.jobs;car.person=person.id;
    if(person.overnight){
      const previous=this.lots[car.lot];if(!previous.external)previous.occupied.delete(car.id);
      car.lot=destination;
      const lot=this.lots[destination];
      if(lot.external){car.state='outside';car.slot=undefined;}
      else{car.state='parked';car.slot=this.freeSlot(lot);lot.occupied.set(car.id,car.slot);}
    }
    if(car.state==='outside')car.readyAt=car.jobs[0].at+this.config.externalMinutes*60;
  }
  installVirtual(person,home,destination,plan){
    let available=person.overnight?7*3600:this.time,from=person.overnight?destination:home;
    for(const job of plan.jobs){
      const depart=Math.max(available,job.at),arrive=depart+this.travelDuration(from,job.to,person.mode);
      if(job.optional&&arrive+job.activityDuration>job.close)continue;
      this.virtual.push({person:person.id,external:typeof person.id==='string',mode:person.mode,from,to:job.to,depart,arrive,returnAt:Infinity,homeAt:arrive});
      available=Math.max(job.until??0,arrive+(job.stay??0));
      from=job.to;
    }
  }
  get pedestrians(){return this.virtual.filter(v=>v.mode==='walk'&&v.depart<=this.time&&this.time<v.arrive);}
  pedestrianPosition(trip){return walkingPosition(this.pedestrianNetwork.route(trip.from,trip.to),toMapUnits((this.time-trip.depart)*1.2));}
  route(a,b){
    const key=`${a}:${b}`;if(this.routeCache.has(key))return [...this.routeCache.get(key)];
    const d=Array(this.nodes.length).fill(Infinity),prev=[],seen=new Set();d[a]=0;
    while(seen.size<this.nodes.length){let u=-1;for(let i=0;i<d.length;i++)if(!seen.has(i)&&(u<0||d[i]<d[u]))u=i;if(u===b||u<0||!Number.isFinite(d[u]))break;seen.add(u);for(const id of this.nodes[u].edges){const e=this.edges[id];if(d[u]+e.length<d[e.to]){d[e.to]=d[u]+e.length;prev[e.to]=id;}}}
    if(!Number.isFinite(d[b]))throw Error('Tujuan tidak terhubung.');
    const result=[];for(let at=b;at!==a;){const id=prev[at];result.unshift(id);at=this.edges[id].from;}
    this.routeCache.set(key,result);return [...result];
  }
  estimate(a,b){return this.route(this.lots[a].node,this.lots[b].node).reduce((s,id)=>s+this.edges[id].length,0)/8+90;}
  drivingRoute(a,b){return this.route(a,b);}
  createPopulation(){
    const c=this.config,counts=GROUPS.map(k=>c[k]);this.demography=counts;
    const roles=shuffle(counts.flatMap((n,i)=>Array(n).fill(GROUPS[i])),this.rng);
    const n=c.householdCount,ownership=shuffle(distribute(n,[c.noCar,c.oneCar,c.twoCars]).flatMap((count,i)=>Array(count).fill(i)),this.rng);
    for(let i=0;i<n;i++){
      const household={id:i,home:i%2?'homeB':'homeA',people:[],cars:[]};this.households.push(household);
      const size=Math.floor(c.population/n)+(i<c.population%n?1:0);
      for(let j=0;j<size;j++){const p={id:this.people.length,role:roles[this.people.length],household:i,mode:'home',destination:null};household.people.push(p.id);this.people.push(p);}
      for(let j=0;j<ownership[i];j++){
        const lot=this.lots[household.home],id=this.cars.length,slot=lot.slots++;
        const car={id,household:i,home:lot.id,lot:lot.id,slot,state:'parked',jobs:[],job:0,v:0,s:0,edge:null,path:[],held:null,wait:0,claimed:false};
        lot.occupied.set(id,slot);household.cars.push(id);this.cars.push(car);
      }
    }
  }
  createPlans(){
    const c=this.config;
    for(const h of this.households){
      const available=h.cars.filter(()=>this.rng()*100<c.usage);
      const adults=h.people.map(id=>this.people[id]).filter(p=>p.role!=='students');
      // A designated adult may escort household students; this car is not double-booked for work.
      const guardian=adults.find(p=>p.role==='homemakers');
      const students=h.people.map(id=>this.people[id]).filter(p=>p.role==='students');
      if(guardian&&students.length&&available.length){
        const car=this.cars[available.shift()],start=c.schoolStart*3600,end=c.schoolEnd*3600;
        const travel=this.estimate(h.home,'school'),depart=Math.max(this.time,start-travel-300-this.rng()*600);
        const riders=[guardian.id,...students.map(p=>p.id)];
        car.jobs=[{from:h.home,to:'school',at:depart,due:start,riders,stay:120},{from:'school',to:h.home,at:0,riders:[guardian.id],stay:0},{from:h.home,to:'school',at:end-travel-300,riders:[guardian.id],stay:120,until:end},{from:'school',to:h.home,at:end,riders,stay:0}];
        for(const p of [guardian,...students]){p.mode='car';p.destination='school';}
      }
      for(const id of h.people){
        const p=this.people[id];if(p.mode==='car')continue;
        let dest,start,end;
        if(p.role==='students'){dest='school';start=c.schoolStart;end=c.schoolEnd;}
        else if(p.role==='university'){dest='university';[start,end]=p.schedule;}
        else if(p.role==='workers'){dest=p.workplace;[start,end]=p.schedule;}
        else if(this.rng()<(p.role==='homemakers'?.7:.2)){dest='shop';start=Math.min(c.shopEnd-.5,c.shopStart+1+this.rng()*2);end=Math.min(c.shopEnd,start+.5+this.rng());}
        else continue;
        if(p.outbound)dest=p.gate;
        p.destination=dest;
        if(p.role!=='students'&&p.role!=='other'&&available.length){
          p.mode='car';const car=this.cars[available.shift()];
          this.installPlan(car,p,dest,this.dailyPlan(p,h.home,dest,start,end,id));
        }else{
          const metres=toMetres(this.route(this.lots[h.home].node,this.lots[dest].node).reduce((s,e)=>s+this.edges[e].length,0));
          p.mode=!p.outbound&&metres<=800?'walk':'transit';
          this.installVirtual(p,h.home,dest,this.dailyPlan(p,h.home,dest,start,end,id));
        }
      }
    }
    this.modeCounts=Object.fromEntries(['car','walk','transit','home'].map(mode=>[mode,this.people.filter(p=>p.mode===mode).length]));
  }
  phase(node,axis){const p=(this.time+node.id*3)%(2*(this.config.green+4));const own=axis==='x'?p:(p+this.config.green+4)%(2*(this.config.green+4));return own<this.config.green?'green':own<this.config.green+3?'yellow':'red';}
  hasSignal(node){return hasTrafficSignal(node);}
  approach(edge){
    const a=edge.points.at(-2),b=edge.points.at(-1),length=distance(a,b);
    const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
    const node=this.nodes[edge.to];
    if(!node.signalDirection){
      const directions=this.edges.filter(e=>e.to===node.id).map(e=>{const a=e.points.at(-2),b=e.points.at(-1),l=distance(a,b);return {dx:(b.x-a.x)/l,dz:(b.z-a.z)/l};});
      let best=Infinity,reference=directions[0];
      // The most nearly opposing approaches establish the main signal group,
      // including diagonal junctions whose branches all lean along the X axis.
      for(let i=0;i<directions.length;i++)for(let j=i+1;j<directions.length;j++){
        const dot=directions[i].dx*directions[j].dx+directions[i].dz*directions[j].dz;
        if(dot<best){best=dot;reference=directions[i];}
      }
      node.signalDirection=reference;
    }
    const ref=node.signalDirection,axis=Math.abs(dx*ref.dx+dz*ref.dz)>=Math.SQRT1_2?'x':'z';
    return {dx,dz,axis,stop:Math.min(20,edge.length/3)};
  }
  bay(lotId,slot){const lot=this.lots[lotId],n=Math.max(lot.slots,slot+1,1),cols=Math.max(1,Math.ceil(Math.sqrt(n*lot.w/lot.h)));const rows=Math.max(1,Math.ceil(n/cols));return {x:lot.x+10+(slot%cols+.5)*(lot.w-20)/cols,z:lot.z+10+(Math.floor(slot/cols)+.5)*(lot.h-20)/rows};}
  position(car){
    if(car.state==='outside')return {...this.nodes[this.lots[car.lot].node],angle:0};
    if(car.state==='parked')return {...this.bay(car.lot,car.slot),angle:0};
    if(car.state==='entering'||car.state==='leaving'){
      const lot=this.lots[car.lot],bay=this.bay(car.lot,car.slot),gate=this.nodes[lot.node];
      const t=Math.min(1,car.internal/12),a=car.state==='entering'?gate:bay,b=car.state==='entering'?bay:gate;
      return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,angle:Math.atan2(b.x-a.x,b.z-a.z)};
    }
    const e=this.edges[car.edge];
    const next=car.path[0],previous=car.previousEdge;
    if(next!==undefined&&car.s>e.length-this.trim(e))return this.turnPosition(e.id,next,(car.s-e.length+this.trim(e))/(this.trim(e)+this.trim(this.edges[next])));
    if(previous!==undefined&&this.edges[previous].to===e.from&&car.s<this.trim(e))return this.turnPosition(previous,e.id,(this.trim(this.edges[previous])+car.s)/(this.trim(this.edges[previous])+this.trim(e)));
    let i=1;while(i<e.points.length-1&&e.lengths[i]<car.s)i++;
    const a=e.points[i-1],b=e.points[i],length=e.lengths[i]-e.lengths[i-1],t=(car.s-e.lengths[i-1])/length,dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
    // Only taper at the map boundary; public junctions keep their lane separation.
    const boundaryScale=Math.min(1,this.nodes[e.from].external?car.s/18:1,this.nodes[e.to].external?(e.length-car.s)/18:1);
    const offset=e.roundabout?0:5*boundaryScale;
    return {x:a.x+(b.x-a.x)*t+dz*offset,z:a.z+(b.z-a.z)*t-dx*offset,angle:Math.atan2(dx,dz)};
  }
  trim(edge){return Math.min(18,edge.length/3);}
  laneEnd(edge,end){
    const a=end?edge.points.at(-2):edge.points[0],b=end?edge.points.at(-1):edge.points[1];
    const length=distance(a,b),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
    const n=end?b:a,offset=edge.roundabout?0:5,along=(end?-1:1)*this.trim(edge);
    return {x:n.x+dx*along+dz*offset,z:n.z+dz*along-dx*offset,dx,dz};
  }
  turnPosition(inId,outId,t){
    const incoming=this.edges[inId],outgoing=this.edges[outId],a=this.laneEnd(incoming,true),b=this.laneEnd(outgoing,false);
    // Cubic tangents keep each lane separate through the junction and round turns.
    const reach=(this.trim(incoming)+this.trim(outgoing))/3;
    const c={x:a.x+a.dx*reach,z:a.z+a.dz*reach},d={x:b.x-b.dx*reach,z:b.z-b.dz*reach},u=1-t;
    const x=u*u*u*a.x+3*u*u*t*c.x+3*u*t*t*d.x+t*t*t*b.x,z=u*u*u*a.z+3*u*u*t*c.z+3*u*t*t*d.z+t*t*t*b.z;
    const dx=3*u*u*(c.x-a.x)+6*u*t*(d.x-c.x)+3*t*t*(b.x-d.x),dz=3*u*u*(c.z-a.z)+6*u*t*(d.z-c.z)+3*t*t*(b.z-d.z);
    return {x,z,angle:Math.atan2(dx,dz)};
  }
  movement(inId,outId){
    if(outId===undefined)return null;
    this.movementCache??=new Map();const key=`${inId}:${outId}`;
    if(!this.movementCache.has(key))this.movementCache.set(key,{inId,outId,points:Array.from({length:49},(_,i)=>this.turnPosition(inId,outId,i/48))});
    return this.movementCache.get(key);
  }
  canClaim(node,car){
    if(node.owner!==null&&node.owner!==car.id)return false;
    const movement=this.movement(car.edge,car.path[0]);
    for(const [id,other] of node.movements??[]){
      if(id===car.id)continue;
      if(!movement||!other||movement.inId===other.inId||movement.outId===other.outId)return false;
      this.conflictCache??=new Map();const key=`${movement.inId}:${movement.outId}:${other.inId}:${other.outId}`;
      if(!this.conflictCache.has(key))this.conflictCache.set(key,movement.points.some(a=>other.points.some(b=>distance(a,b)<9)));
      if(this.conflictCache.get(key))return false;
    }
    return true;
  }
  // Parking is unlimited: a lot never fills up, so this only hands out a free drawing position.
  freeSlot(lot){const used=new Set([...lot.occupied.values(),...lot.reserved.values()]);for(let i=0;;i++)if(!used.has(i)){lot.slots=Math.max(lot.slots,i+1);return i;}}
  startClear(edgeId,except){return !this.cars.some(c=>c.id!==except&&c.state==='driving'&&c.edge===edgeId&&c.s<36);}
  release(car){if(car.held!==null){const node=this.nodes[car.held];if(node.owner===car.id)node.owner=null;node.movements?.delete(car.id);}car.held=null;}
  arrive(car){
    car.previousEdge=undefined;
    const lot=this.lots[car.jobs[car.job].to];
    if(lot.external){this.crossings[lot.id].out++;car.lot=lot.id;car.state='outside';car.v=0;car.claimed=false;if(car.through){car.job++;this.throughCompleted++;}else car.pendingExternal=this.time+(car.boundaryOnly?0:this.config.externalMinutes*60);this.release(car);this.log(`Mobil ${car.id+1}${car.through?' (melintas)':''} keluar ${lot.name}`);return;}
    car.lot=lot.id;car.slot=lot.reserved.get(car.id);lot.reserved.delete(car.id);lot.occupied.set(car.id,car.slot);
    car.state='entering';car.internal=0;car.v=0;lot.aisle=car.id;car.claimed=false;
  }
  log(message){this.events.unshift(`${this.clock()} · ${message}`);this.events.length=Math.min(6,this.events.length);}
  finishTrip(car){
    const job=car.jobs[car.job];this.completed++;this.travelSeconds+=this.time-car.departed;if(job.due&&this.time>job.due)this.late++;
    this.log(`Mobil ${car.id+1} tiba di ${this.lots[car.lot].external?'tujuan luar kota':this.lots[car.lot].name}`);
    car.job++;const next=car.jobs[car.job];if(next)next.at=Math.max(next.at,this.time+(job.stay||0),job.until||0);
  }
  nextJob(car){
    let job=car.jobs[car.job];
    while(job?.optional){
      const arrival=Math.max(this.time,job.at)+this.travelDuration(car.lot,job.to),end=Math.max(job.until,arrival+job.activityDuration);
      const next=car.jobs[car.job+1];
      if(end<=job.close&&(!next?.due||end+this.travelDuration(job.to,next.to)<=next.due))break;
      car.jobs.splice(car.job,1);this.skippedStops++;
      job=car.jobs[car.job];
      if(job){job.from=car.lot;job.at=Math.max(this.time,job.due?job.due-this.travelDuration(car.lot,job.to)-180:this.time);}
    }
    return job;
  }
  isGateWaiting(car){return car.state==='outside'&&!car.pendingExternal&&!!car.jobs[car.job]&&car.readyAt<=this.time;}
  step(dt=.25){
    if(this.finished)return;
    this.time+=dt;
    for(const car of this.cars){
      if(car.state==='outside'){
        if(car.pendingExternal){if(this.time<car.pendingExternal)continue;car.pendingExternal=null;this.finishTrip(car);car.readyAt=(car.jobs[car.job]?.at??Infinity)+(car.boundaryOnly?0:this.config.externalMinutes*60);}
        const previous=car.jobs[car.job],job=this.nextJob(car);if(job!==previous&&job)car.readyAt=job.at+this.config.externalMinutes*60;
        if(!job||this.time<car.readyAt)continue;
        const lot=this.lots[car.lot],node=this.nodes[lot.node],path=this.drivingRoute(lot.node,this.lots[job.to].node);
        if(node.owner!==null||!this.startClear(path[0],car.id)){this.gateQueueSeconds+=Math.min(dt,Math.max(0,this.time-car.readyAt));continue;}
        car.departed=car.readyAt-(car.through||car.boundaryOnly?0:this.config.externalMinutes*60);car.path=path;car.edge=car.path.shift();car.s=0;car.v=0;car.wait=0;car.state='driving';node.owner=car.id;car.held=node.id;car.claimed=false;this.crossings[lot.id].in++;this.log(`Mobil ${car.id+1}${car.through?' (melintas)':''} masuk ${lot.name}`);
      }else if(car.state==='parked'){
        const job=this.nextJob(car);if(!job||this.time<job.at)continue;
        const lot=this.lots[car.lot];
        if(lot.aisle!==null||this.nodes[lot.node].owner!==null)continue;
        const path=this.drivingRoute(lot.node,this.lots[job.to].node);if(!this.startClear(path[0],car.id))continue;
        car.path=path;car.state='leaving';car.internal=0;car.departed=this.time;car.wait=0;lot.aisle=car.id;
        this.nodes[lot.node].owner=car.id;car.held=lot.node;
      }else if(car.state==='leaving'){
        car.internal+=dt;if(car.internal<12)continue;
        if(!this.startClear(car.path[0],car.id))continue;
        const lot=this.lots[car.lot];lot.occupied.delete(car.id);lot.aisle=null;car.state='driving';car.edge=car.path.shift();car.s=0;car.v=0;
      }else if(car.state==='entering'){
        car.internal+=dt;if(car.internal<12)continue;
        const lot=this.lots[car.lot];lot.aisle=null;car.state='parked';this.release(car);
        this.finishTrip(car);
      }
    }
    const driving=this.cars.filter(c=>c.state==='driving').sort((a,b)=>a.edge-b.edge||b.s-a.s);
    for(const car of driving){
      const e=this.edges[car.edge],node=this.nodes[e.to];if(car.held!==null&&car.held!==node.id&&car.s>=Math.min(18,e.length/3)-.001)this.release(car);
      let room=e.length-car.s;
      let canContinue=car.claimed;
      if(!car.claimed){
        let allowed=this.canClaim(node,car);
        const {axis}=this.approach(e);
        if(this.hasSignal(node)&&this.phase(node,axis)!=='green')allowed=false;
        if(node.roundabout&&!e.roundabout&&driving.some(c=>c.id!==car.id&&this.edges[c.edge].roundabout&&this.edges[c.edge].to===node.id&&this.edges[c.edge].length-c.s<35))allowed=false;
        if(car.path.length){if(!this.startClear(car.path[0],car.id))allowed=false;}
        else{
          const lot=this.lots[car.jobs[car.job].to];
          if(!lot.external&&lot.aisle!==null){allowed=false;if(e.length-car.s<45){car.wait+=dt;this.parkingWait+=dt;}}
        }
        if(allowed&&e.length-car.s<=Math.min(20,e.length/3)+5){
          this.release(car);node.movements??=new Map();node.movements.set(car.id,this.movement(car.edge,car.path[0]));if(node.lot)node.owner=car.id;car.held=node.id;car.claimed=true;
          if(!car.path.length){const lot=this.lots[car.jobs[car.job].to];if(!lot.external){lot.reserved.set(car.id,this.freeSlot(lot));lot.aisle=car.id;}}
        }
        canContinue=allowed||car.claimed;
        if(!canContinue)room=Math.min(room,e.length-car.s-Math.min(20,e.length/3));
      }
      // An open junction is not a stopping point; look into the outgoing lane.
      if(canContinue&&car.path.length){
        const next=this.edges[car.path[0]];
        room=e.length-car.s+Math.max(0,next.length-Math.min(20,next.length/3));
        for(const other of driving)if(other.id!==car.id&&other.edge===next.id)room=Math.min(room,e.length-car.s+other.s-toMapUnits((vehicleLength(car)+vehicleLength(other))/2+2));
      }
      let desired=Math.min(80/3.6,Math.sqrt(2*2.8*toMetres(Math.max(0,room))));
      const front=driving.filter(c=>c.id!==car.id&&c.edge===car.edge&&c.s>car.s).sort((a,b)=>a.s-b.s)[0];
      if(front){
        const gap=front.s-car.s-toMapUnits((vehicleLength(car)+vehicleLength(front))/2+2);
        // A moving leader leaves braking distance of its own. Keep the physical
        // clearance cap as well, so even a sudden stop cannot cause overlap.
        desired=Math.min(desired,Math.sqrt(front.v*front.v+2*2.8*toMetres(Math.max(0,gap))));
        room=Math.min(room,gap);
      }
      car.v=Math.max(0,Math.min(desired,car.v+2.8*dt));
      // Match the queue indicator: vehicles on the road below 0.3 m/s.
      // Accumulate per vehicle using simulation seconds and the rate at this step.
      if(car.v<.3){this.queueSeconds+=dt;this.idleFuelLiters+=dt/3600*this.config.idleLitersPerHour;}
      car.s+=Math.min(toMapUnits(car.v*dt),Math.max(0,room),e.length-car.s);
      if(car.s>=e.length-.01&&car.claimed){
        if(car.path.length){car.previousEdge=car.edge;car.edge=car.path.shift();car.s=0;car.claimed=false;}
        else this.arrive(car);
      }
    }
    if(this.time>=this.end){this.time=this.end;this.finished=true;}
    else if(this.time>=24*3600&&this.cars.every(c=>c.job>=c.jobs.length)&&this.virtual.every(v=>v.homeAt<=this.time))this.finished=true;
  }
  clock(){const t=Math.floor(this.time)%86400;return [Math.floor(t/3600),Math.floor(t/60)%60,t%60].map(n=>String(n).padStart(2,'0')).join(':');}
  get stats(){
    const moving=this.cars.filter(c=>c.state==='driving'),atHome=this.cars.filter(c=>c.state==='parked'&&this.lots[c.lot].home).length;
    const localCars=this.cars.filter(c=>!c.external).length,outside=this.cars.filter(c=>c.state==='outside').length,through=this.cars.filter(c=>c.through);
    return {gateWaiting:this.cars.filter(c=>this.isGateWaiting(c)).length,gateQueueSeconds:this.gateQueueSeconds,totalQueueSeconds:this.queueSeconds+this.gateQueueSeconds,queueSeconds:this.queueSeconds,idleFuelLiters:this.idleFuelLiters,population:this.people.length,households:this.households.length,cars:this.cars.length,localCars,externalCars:this.cars.filter(c=>c.external&&!c.through).length,throughPlanned:through.length,throughActive:through.filter(c=>c.state==='driving').length,throughWaiting:through.filter(c=>c.state==='outside'&&c.job===0&&c.readyAt<=this.time).length,throughCompleted:this.throughCompleted,outside,inside:this.cars.length-outside,visitors:this.visitors.length,outbound:this.people.filter(p=>p.outbound).length,driving:moving.length,waiting:moving.filter(c=>c.v<.3).length,atHome,parked:this.cars.filter(c=>c.state==='parked'&&!this.lots[c.lot].home).length,internal:this.cars.filter(c=>['entering','leaving'].includes(c.state)).length,speed:moving.length?moving.reduce((s,c)=>s+c.v,0)/moving.length*3.6:0,completed:this.completed,late:this.late,averageMinutes:this.completed?this.travelSeconds/this.completed/60:0,virtualActive:this.virtual.filter(v=>(this.time>=v.depart&&this.time<v.arrive)||(this.time>=v.returnAt&&this.time<v.homeAt)).length};
  }
}
