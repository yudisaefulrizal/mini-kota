import {WasteSystem} from './waste.js';
import {Simulation,DEFAULTS,GROUPS,GATES,WORK_SHIFTS,UNIVERSITY_SHIFTS,validate,entryKey,exitKey} from './simulation.js';

const resident=p=>['resident','departureQueued','departing'].includes(p.residency);
const random=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const idle=c=>c.job>=c.jobs.length&&!c.pendingExternal&&['parked','outside'].includes(c.state);

// The finite Simulation remains useful for reproducible scenario tests. This
// controller adds incremental arrivals, migration and recurring daily plans.
export class LiveSimulation extends Simulation {
  createThroughTraffic(){this.throughCompleted=0;this.throughScheduled=0;}
  constructor(config={}){
    super(config);
    this.target={...this.config};this.end=Infinity;this.moves=[];this.moveSerial=0;
    this.liveRng=random(this.config.seed+19273);this.trafficRng=random(this.config.seed+913);
    this.people.forEach(p=>{p.residency='resident';p.lastPlanDay=0;});
    this.visitors.forEach(v=>{v.active=true;v.lastPlanDay=0;});
    this.households.forEach(h=>{h.sizeSetting=this.config.householdSize;h.targetCars=h.cars.length;});
    this.ownershipSignature=this.ownershipKey();
    this.nodes.forEach(n=>{n.signalGreen=this.config.green;n.signalAnchor=-n.id*3;});
    this.tickAt=this.time;this.nextTraffic=this.trafficTime();this.refreshPopulation();
    this.waste=new WasteSystem(this);
  }
  phase(node,axis){
    if(node.signalGreen===undefined)return super.phase(node,axis);
    if(node.switchAt!==undefined&&this.time>=node.switchAt){node.signalAnchor=node.switchAt;node.signalGreen=node.requestedGreen;delete node.switchAt;}
    const green=node.signalGreen,period=2*(green+4),p=((this.time-node.signalAnchor)%period+period)%period;
    const own=axis==='x'?p:(p+green+4)%period;
    return own<green?'green':own<green+3?'yellow':'red';
  }
  applyConfig(input){
    const config=validate({...DEFAULTS,...input}),previous=this.target;
    this.target={...config};this.config={...config};
    for(const n of this.nodes){
      n.requestedGreen=config.green;
      if(config.green===n.signalGreen)delete n.switchAt;
      else if(n.switchAt===undefined){const cycle=2*(n.signalGreen+4);n.switchAt=n.signalAnchor+(Math.floor((this.time-n.signalAnchor)/cycle)+1)*cycle;}
    }
    const trafficKeys=['throughRate',...GATES.flatMap(g=>[entryKey(g.id),exitKey(g.id)])];
    if(trafficKeys.some(k=>config[k]!==previous[k]))this.nextTraffic=this.trafficTime();
    this.busyPeople=null;this.tickAt=this.time;this.reconcileTargets();this.refreshPopulation();
  }
  trafficTime(at=this.time){
    const hour=Math.floor(at/3600)%24,rate=this.config.throughRate;
    if(!rate)return Infinity;
    const factor=hour<6||hour>=21?.35:(hour>=7&&hour<9)||(hour>=16&&hour<19)?1.6:1;
    // Re-evaluate the intensity at every hourly boundary, without scheduling a full day.
    const sampled=at-Math.log(Math.max(1e-9,1-this.trafficRng()))*3600/(rate*factor);
    return Math.min(sampled,(Math.floor(at/3600)+1)*3600);
  }
  newCar(properties,pool){
    const reusable=pool&&this.cars.find(c=>idle(c)&&c.state==='outside'&&pool(c));
    const car=reusable??{id:this.cars.length};
    const id=car.id;
    for(const key of Object.keys(car))delete car[key];
    Object.assign(car,{id,external:true,household:null,home:properties.lot,lot:properties.lot,state:'outside',readyAt:this.time,jobs:[],job:0,v:0,s:0,edge:null,path:[],held:null,wait:0,claimed:false},properties);
    if(!reusable)this.cars.push(car);
    return car;
  }
  streamTraffic(){
    while(this.nextTraffic<=this.time){
      const at=this.nextTraffic;
      const atBoundary=Math.abs(at/3600-Math.round(at/3600))<1e-8;
      if(!atBoundary&&this.config.throughRate){
        const from=this.pickGate(entryKey,this.trafficRng),to=this.pickGate(exitKey,this.trafficRng,from);
        this.newCar({through:true,lot:from,home:from,readyAt:at,jobs:[{from,to,at,riders:[],stay:0}]},c=>c.through);
        this.throughScheduled++;
      }
      // Preserve event time and process every arrival due, including between steps.
      this.nextTraffic=this.trafficTime(at);
    }
  }
  personalBusy(p){
    if(!this.busyPeople){
      this.busyPeople=new Set(this.virtual.filter(v=>v.homeAt>this.time).map(v=>v.person));
      for(const c of this.cars){
        if(c.service||c.through)continue;
        if(!idle(c)&&c.person!==undefined)this.busyPeople.add(c.person);
        for(const job of c.jobs.slice(c.job))for(const id of job.riders??[])this.busyPeople.add(id);
      }
    }
    return this.busyPeople.has(p.id);
  }
  service(move,home){
    const gate=this.chooseGate();
    const car=this.newCar({service:true,boundaryOnly:true,migration:move,lot:gate,home:gate,readyAt:this.time,
      jobs:[{from:gate,to:home,at:this.time,riders:[],stay:60},{from:home,to:gate,at:this.time,riders:[],stay:0}]},c=>c.service);
    move.car=car.id;return car;
  }
  cancelIncoming(move,amount){
    const car=this.cars[move.car];
    if(car.state!=='outside'||car.job!==0)return 0;
    const n=Math.min(amount,move.count);move.count-=n;
    if(!move.count){move.done=true;car.jobs=[];car.readyAt=Infinity;}
    return n;
  }
  cancelOutgoing(move,amount){
    if(move.picked)return 0;
    const ids=move.people.splice(0,Math.min(amount,move.people.length));
    for(const id of ids)this.people[id].residency='resident';
    if(!move.people.length)move.done=true;
    return ids.length;
  }
  reconcileTargets(){
    for(const role of GROUPS){
      const active=this.people.filter(p=>resident(p)&&p.role===role).length;
      const incoming=this.moves.filter(m=>!m.done&&m.direction==='in'&&m.role===role).reduce((n,m)=>n+m.count,0);
      const outgoing=this.moves.filter(m=>!m.done&&m.direction==='out'&&m.role===role).reduce((n,m)=>n+m.people.length,0);
      let delta=this.target[role]-(active+incoming-outgoing);
      for(const move of this.moves.filter(m=>!m.done&&m.role===role)){
        if(delta<0&&move.direction==='in')delta+=this.cancelIncoming(move,-delta);
        if(delta>0&&move.direction==='out')delta-=this.cancelOutgoing(move,delta);
      }
      if(!delta||this.moves.filter(m=>!m.done).length>=64)continue;
      const count=Math.min(Math.abs(delta),Math.max(1,Math.min(10,Math.round(this.config.householdSize))));
      const move={id:this.moveSerial++,role,direction:delta>0?'in':'out',done:false};
      if(delta>0){
        move.count=count;move.home=this.moveSerial%2?'homeA':'homeB';this.moves.push(move);this.service(move,move.home);
      }else{
        const chosen=this.people.filter(p=>p.role===role&&p.residency==='resident');
        if(!chosen.length)continue;
        // A pickup serves one home area; it need not remove an entire household.
        move.home=this.households[chosen[0].household].home;
        move.people=chosen.filter(p=>this.households[p.household].home===move.home).slice(0,count).map(p=>p.id);
        for(const id of move.people)this.people[id].residency='departureQueued';
        this.moves.push(move);
      }
    }
    for(const move of this.moves.filter(m=>!m.done&&m.direction==='out'&&m.car===undefined)){
      if(move.people.every(id=>!this.personalBusy(this.people[id])))this.service(move,move.home);
    }
    this.moves=this.moves.filter(m=>!m.done);
  }
  assignActivity(p){
    if(p.role==='workers'){
      p.workplace??=['industry','business','shop'][this.liveRng()<.6?0:this.liveRng()<.625?1:2];
      p.shift??=p.id%3;p.schedule=WORK_SHIFTS[p.shift];p.outbound=this.liveRng()*100<this.config.outboundWorkers;
    }else if(p.role==='university'){
      p.shift??=p.id%3;p.schedule=UNIVERSITY_SHIFTS[p.shift];p.outbound=this.liveRng()*100<this.config.outboundUniversity;
    }
    if(p.outbound)p.gate=this.chooseGate();
  }
  admit(move){
    const h={id:this.households.length,home:move.home,people:[],cars:[],sizeSetting:this.config.householdSize};this.households.push(h);
    for(let i=0;i<move.count;i++){
      const p={id:this.people.length,role:move.role,household:h.id,residency:'resident',mode:'home',lastPlanDay:-1,destination:null};
      this.people.push(p);h.people.push(p.id);this.assignActivity(p);
    }
    move.done=true;this.log(`${move.count} penduduk baru tiba di ${this.lots[move.home].name}`);
    this.refreshPopulation();
  }
  depart(move){
    for(const id of move.people){const p=this.people[id];p.residency='departed';p.mode='home';const h=this.households[p.household];h.people=h.people.filter(n=>n!==id);}
    move.done=true;this.log(`${move.people.length} penduduk meninggalkan kota`);this.refreshPopulation();
  }
  finishTrip(car){
    const index=car.job,move=car.migration;
    super.finishTrip(car);
    if(car.delivery&&this.lots[car.lot].home){car.delivery=false;car.boundaryOnly=false;}
    if(move&&!move.done&&index===0){
      if(move.direction==='in')this.admit(move);
      else{move.picked=true;for(const id of move.people)this.people[id].residency='departing';}
    }
  }
  arrive(car){
    const exits=this.lots[car.jobs[car.job].to].external;
    super.arrive(car);
    if(exits&&car.migration?.direction==='out'&&car.migration.picked&&!car.migration.done)this.depart(car.migration);
    if(exits&&car.retiring){car.retired=true;car.retiring=false;}
  }
  retireCar(car){
    const home=car.lot,gate=this.chooseGate();
    car.external=true;car.retiring=true;car.boundaryOnly=true;car.household=null;car.person=undefined;
    car.jobs=[{from:home,to:gate,at:this.time,riders:[],stay:0}];car.job=0;
  }
  rebalanceHouseholds(){
    for(const home of ['homeA','homeB']){
      const available=this.households.filter(h=>h.home===home&&h.people.length&&h.people.every(id=>this.people[id].residency==='resident'&&!this.personalBusy(this.people[id]))&&h.cars.every(id=>idle(this.cars[id])&&this.cars[id].lot===home));
      if(!available.some(h=>h.sizeSetting!==this.config.householdSize))continue;
      const ids=available.flatMap(h=>h.people),cars=available.flatMap(h=>h.cars),count=Math.max(1,Math.round(ids.length/this.config.householdSize));
      for(const h of available){h.people=[];h.cars=[];}
      let cursor=0;
      for(let i=0;i<count;i++){
        const h=available[i]??{id:this.households.length,home,people:[],cars:[]};if(!available[i])this.households.push(h);
        const size=Math.floor(ids.length/count)+(i<ids.length%count?1:0);h.people=ids.slice(cursor,cursor+size);cursor+=size;
        h.sizeSetting=this.config.householdSize;for(const id of h.people)this.people[id].household=h.id;
        h.cars=[];
      }
      const memberSet=new Set(ids),destinations=this.households.filter(h=>h.home===home&&h.people.some(id=>memberSet.has(id)));
      for(let i=0;i<cars.length;i++){const h=destinations[i%destinations.length],car=this.cars[cars[i]];h.cars.push(car.id);car.household=h.id;}
    }
  }
  ownershipKey(){return [this.config.noCar,this.config.oneCar,this.config.twoCars,...this.households.filter(h=>h.people.length).map(h=>h.id)].join(':');}
  adjustOwnership(){
    const households=this.households.filter(h=>h.people.length),n=households.length;
    const exact=[this.config.noCar,this.config.oneCar,this.config.twoCars].map(p=>p*n/100),counts=exact.map(Math.floor);
    const order=exact.map((v,i)=>({i,r:v-counts[i]})).sort((a,b)=>b.r-a.r),remaining=n-counts.reduce((a,b)=>a+b,0);for(let i=0;i<remaining;i++)counts[order[i].i]++;
    const targets=counts.flatMap((count,i)=>Array(count).fill(i));
    // Stable ordering avoids churn when only timing settings are changed.
    households.sort((a,b)=>((a.id*2654435761)>>>0)-((b.id*2654435761)>>>0));
    const indices=new Map(households.map((h,i)=>[h.id,i]));
    const signature=this.ownershipKey(),changed=signature!==this.ownershipSignature;this.ownershipSignature=signature;
    for(const h of this.households){
      const index=indices.get(h.id)??-1;if(changed||index<0)h.targetCars=index<0?0:targets[index];const target=h.targetCars??0;
      if(h.people.some(id=>this.people[id].residency!=='resident'||this.personalBusy(this.people[id])))continue;
      h.cars=h.cars.filter(id=>!this.cars[id].retired&&!this.cars[id].retiring);
      while(h.cars.length>target){
        const id=h.cars.find(id=>idle(this.cars[id])&&this.cars[id].lot===h.home);if(id===undefined)break;
        h.cars=h.cars.filter(n=>n!==id);this.retireCar(this.cars[id]);
      }
      while(h.cars.length<target){
        const gate=this.chooseGate(),car=this.newCar({external:false,delivery:true,boundaryOnly:true,household:h.id,home:h.home,lot:gate,readyAt:this.time,jobs:[{from:gate,to:h.home,at:this.time,riders:[],stay:0}]},c=>c.retired&&!c.service&&!c.through);
        h.cars.push(car.id);
      }
    }
  }
  canPlan(p,day){return p.residency==='resident'&&p.lastPlanDay<day&&!this.personalBusy(p);}
  planResidents(){
    const day=Math.floor(this.time/86400);
    for(const h of this.households){
      const available=()=>h.cars.map(id=>this.cars[id]).filter(c=>idle(c)&&c.state==='parked'&&c.lot===h.home&&!c.delivery&&!c.retiring);
      const guardian=h.people.map(id=>this.people[id]).find(p=>p.role==='homemakers'&&this.canPlan(p,day));
      const students=h.people.map(id=>this.people[id]).filter(p=>p.role==='students'&&this.canPlan(p,day));
      if(guardian&&students.length&&available().length&&this.liveRng()*100<this.config.usage&&this.time<(day*24+this.config.schoolStart)*3600){
        const c=available()[0],start=(day*24+this.config.schoolStart)*3600,end=(day*24+this.config.schoolEnd)*3600,travel=this.estimate(h.home,'school'),riders=[guardian.id,...students.map(p=>p.id)];
        c.jobs=[{from:h.home,to:'school',at:Math.max(this.time,start-travel-300),due:start,riders,stay:120},{from:'school',to:h.home,at:0,riders:[guardian.id],stay:0},{from:h.home,to:'school',at:end-travel-300,riders:[guardian.id],stay:120,until:end},{from:'school',to:h.home,at:end,riders,stay:0}];c.job=0;c.person=guardian.id;
        for(const p of [guardian,...students]){p.lastPlanDay=day;p.mode='car';p.destination='school';p.activities=undefined;this.busyPeople?.add(p.id);}
      }
      for(const id of h.people){
        const p=this.people[id];if(!this.canPlan(p,day))continue;
        this.assignActivity(p);
        let dest,start,end;
        if(p.role==='students'){dest='school';start=this.config.schoolStart;end=this.config.schoolEnd;}
        else if(p.role==='workers'||p.role==='university'){dest=p.outbound?p.gate:p.role==='workers'?p.workplace:'university';[start,end]=p.schedule;}
        else if(this.liveRng()<(p.role==='homemakers'?.7:.2)){dest='shop';start=this.config.shopStart+this.liveRng()*Math.max(.1,this.config.shopEnd-this.config.shopStart-1);end=Math.min(this.config.shopEnd,start+1);}
        else{p.lastPlanDay=day;p.mode='home';continue;}
        let planDay=day;if((planDay*24+start)*3600<this.time)planDay++;
        const c=p.role!=='students'&&p.role!=='other'&&this.liveRng()*100<this.config.usage?available()[0]:null;
        p.mode=c?'car':!p.outbound&&(this.estimate(h.home,dest)-90)*8<=800?'walk':'transit';p.destination=dest;
        const plan=this.dailyPlan(p,h.home,dest,start,end,p.id+planDay*100003,planDay,false);
        if(c){c.job=0;this.installPlan(c,p,dest,plan);}else this.installVirtual(p,h.home,dest,plan);
        this.busyPeople?.add(p.id);
        p.lastPlanDay=planDay;
      }
    }
  }
  planVisitors(){
    const vacancies=this.people.filter(p=>resident(p)&&p.role==='workers'&&p.outbound),desired=Math.round(vacancies.length*this.config.incomingFill/100),day=Math.floor(this.time/86400);
    for(let i=0;i<Math.max(desired,this.visitors.length);i++){
      let v=this.visitors[i],car=v&&this.cars.find(c=>c.person===v.id&&!c.retired&&!c.retiring);
      const busy=v&&(this.virtual.some(t=>t.person===v.id&&t.homeAt>this.time)||(car&&!idle(car)));
      if(busy)continue;
      if(i>=desired){if(v)v.active=false;if(car){car.retired=true;car.person=undefined;}continue;}
      if(v?.active&&v.lastPlanDay>=day)continue;
      const assignment=vacancies[i%vacancies.length];
      if(!v){v={id:`visitor-${i}`,role:'workers',lastPlanDay:-1};this.visitors.push(v);}
      Object.assign(v,{active:true,destination:assignment.workplace,shift:assignment.shift,schedule:WORK_SHIFTS[assignment.shift],gate:this.chooseGate()});
      v.mode=i<Math.round(desired*this.config.incomingCar/100)?'car':'transit';
      let planDay=day;if((planDay*24+v.schedule[0])*3600<this.time)planDay++;
      const plan=this.dailyPlan(v,v.gate,v.destination,...v.schedule,i+100000+planDay*100003,planDay,false);
      if(v.mode==='car'){
        if(!car)car=this.newCar({lot:v.gate,home:v.gate,person:v.id},c=>c.retired&&!c.service&&!c.through);
        // A completed external trip is outside the modelled city; its next entry
        // gate is selected only after that trip has finished.
        car.lot=v.gate;car.home=v.gate;car.job=0;this.installPlan(car,v,v.destination,plan);
      }else{if(car){car.retired=true;car.person=undefined;}this.installVirtual(v,v.gate,v.destination,plan);}
      v.lastPlanDay=planDay;
    }
  }
  refreshPopulation(){
    this.demography=GROUPS.map(role=>this.people.filter(p=>resident(p)&&p.role===role).length);
    this.modeCounts=Object.fromEntries(['car','walk','transit','home'].map(mode=>[mode,this.people.filter(p=>resident(p)&&p.mode===mode).length]));
    this.workplaces={};
    for(const id of ['industry','business','shop']){
      const workers=this.people.filter(p=>resident(p)&&p.role==='workers'&&p.workplace===id),local=workers.filter(p=>!p.outbound).length,incoming=this.visitors.filter(v=>v.active&&v.destination===id).length;
      this.workplaces[id]={total:Math.max(workers.length,local+incoming),targetTotal:workers.length,local,incoming,vacant:Math.max(0,workers.length-local-incoming)};
    }
  }
  step(dt=.25){
    this.finished=false;
    if(this.time>=this.tickAt){
      this.busyPeople=null;
      this.reconcileTargets();this.rebalanceHouseholds();this.adjustOwnership();this.planResidents();this.planVisitors();this.refreshPopulation();
      this.virtual=this.virtual.filter(v=>v.homeAt>this.time);this.tickAt=this.time+10;
    }
    this.waste.step(dt);this.streamTraffic();super.step(dt);this.finished=false;
  }
  get stats(){
    const s=super.stats;if(!this.moves)return s;
    const incoming=this.moves.filter(m=>!m.done&&m.direction==='in').reduce((n,m)=>n+m.count,0),outgoing=this.moves.filter(m=>!m.done&&m.direction==='out').reduce((n,m)=>n+m.people.length,0);
    return {...s,waste:this.waste?.stats,population:this.people.filter(resident).length,targetPopulation:this.target.population,incomingResidents:incoming,outgoingResidents:outgoing,
      households:this.households.filter(h=>h.people.length).length,localCars:this.cars.filter(c=>!c.external&&!c.retired).length,
      externalCars:this.cars.filter(c=>c.external&&!c.wasteTruck&&!c.through&&!c.service&&!c.retired&&!c.retiring).length,
      commuterOutside:this.cars.filter(c=>c.state==='outside'&&!c.through&&!c.service&&!c.retired).length,
      serviceVehicles:this.cars.filter(c=>c.service&&!idle(c)).length,visitors:this.visitors.filter(v=>v.active).length,
      outbound:this.people.filter(p=>resident(p)&&p.outbound).length,throughPlanned:this.throughScheduled};
  }
}
