import {toMetres,toMapUnits} from './scale.js';
import {walkingPosition} from './pedestrians.js';
// Scenario assumptions, not measured waste forecasts. Mass is always retained.
export class WasteSystem {
  constructor(sim){
    this.sim=sim;this.day=Math.floor(sim.time/86400);
    this.generated=0;this.collected=0;this.delivered=0;this.today={generated:0,collected:0,delivered:0};
    this.sources=Object.values(sim.lots).filter(l=>!l.external&&l.id!=='wasteDepot');
    this.walkers=[];
    for(const lot of this.sources){
      const [gx,gz]=lot.gate,[rx,rz]=lot.road,length=Math.hypot(gx-rx,gz-rz);
      const bin={x:gx-(gz-rz)/length*12,z:gz+(gx-rx)/length*12};
      const center={x:lot.x+lot.w/2,z:lot.z+lot.h/2};
      const distance=Math.hypot(center.x-bin.x,center.z-bin.z),reach=Math.min(60,distance);
      const origin={x:bin.x+(center.x-bin.x)/distance*reach,z:bin.z+(center.z-bin.z)/distance*reach};
      const drop={x:bin.x+(center.x-bin.x)/distance*9,z:bin.z+(center.z-bin.z)/distance*9};
      const walkLength=Math.hypot(origin.x-drop.x,origin.z-drop.z);
      lot.waste={amount:0,building:0,capacity:lot.home?250:150,rate:0,lastCollection:null,bin,
        route:{points:[origin,drop],lengths:[0,walkLength],length:walkLength},nextDisposal:sim.time};
    }
    this.storage=0;this.storageCapacity=5000;this.nextDispatch=sim.time;
    this.trucks=Array.from({length:2},()=>{
      const car=sim.newCar({wasteTruck:true,lot:'wasteDepot',home:'wasteDepot',state:'parked'});
      car.slot=sim.freeSlot(sim.lots.wasteDepot);sim.lots.wasteDepot.occupied.set(car.id,car.slot);
      return {car,load:0,capacity:300,target:null,serviceAt:null,status:'Tersedia'};
    });
    sim.initialInside+=this.trucks.length;
    this.updateRates();
  }
  updateRates(){
    const sim=this.sim;
    for(const l of this.sources)l.waste.rate=0;
    for(const p of sim.people){
      if(p.residency==='departed')continue;
      const home=sim.lots[sim.households[p.household].home];
      const primary=p.outbound?null:p.role==='workers'?p.workplace:p.role==='students'?'school':p.role==='university'?'university':p.destination;
      const ids=new Set([primary,...(p.activities??[]).map(a=>a.id)]);
      const destinations=this.sources.filter(l=>!l.home&&ids.has(l.id));
      const rate=sim.config.wastePerPerson;
      home.waste.rate+=rate*(destinations.length?.7:1);
      for(const dest of destinations)dest.waste.rate+=rate*.3/destinations.length;
    }
    for(const p of sim.visitors.filter(p=>p.active)){
      const lot=sim.lots[p.destination];if(lot?.waste)lot.waste.rate+=sim.config.wastePerPerson*.3;
    }
  }
  // One representative carrier per area, independent of commuter headcounts.
  walkPosition(trip){
    const elapsed=this.sim.time-trip.depart,travel=toMetres(trip.route.length)/1.2;
    const units=elapsed<=travel?toMapUnits(elapsed*1.2):elapsed<=travel+4?trip.route.length:trip.route.length-toMapUnits((elapsed-travel-4)*1.2);
    const position=walkingPosition(trip.route,units);
    return {...position,angle:position.angle+(elapsed>travel+4?Math.PI:0),carrying:!trip.deposited};
  }
  dispose(){
    const now=this.sim.time;
    for(const trip of this.walkers){
      if(!trip.deposited&&now>=trip.depositAt){
        this.sim.lots[trip.lot].waste.amount+=trip.load;trip.deposited=true;
      }
    }
    this.walkers=this.walkers.filter(t=>now<t.returnAt);
    const hour=now/3600%24;
    if(hour<6||hour>=20)return;
    for(const lot of this.sources){
      const w=lot.waste;
      if(w.building<.25||now<w.nextDisposal||this.walkers.some(t=>t.lot===lot.id))continue;
      const load=Math.min(5,w.building),travel=toMetres(w.route.length)/1.2;
      w.building-=load;w.nextDisposal=now+300;
      this.walkers.push({lot:lot.id,load,route:w.route,depart:now,depositAt:now+travel+4,returnAt:now+travel*2+4,deposited:false});
    }
  }
  send(truck,to){
    const c=truck.car;truck.target=to;truck.status=to==='wasteDepot'?'Menuju TPS3R':'Menuju pengambilan';
    c.jobs=[{from:c.lot,to,at:this.sim.time,riders:[],stay:0}];c.job=0;
  }
  step(dt){
    const sim=this.sim,day=Math.floor(sim.time/86400);
    if(day!==this.day){this.day=day;this.today={generated:0,collected:0,delivered:0};}
    if(sim.time>=this.nextDispatch){this.updateRates();this.nextDispatch=sim.time+60;}
    for(const l of this.sources){const kg=l.waste.rate*dt/86400;l.waste.building+=kg;this.generated+=kg;this.today.generated+=kg;}
    this.dispose();
    for(const t of this.trucks){
      const c=t.car;if(c.state!=='parked'||c.job<c.jobs.length)continue;
      if(t.target){
        if(t.serviceAt===null){t.serviceAt=sim.time+120;t.status=t.target==='wasteDepot'?'Membongkar':'Mengambil';}
        if(sim.time<t.serviceAt)continue;
        if(t.target==='wasteDepot'){
          const kg=Math.min(t.load,this.storageCapacity-this.storage);this.storage+=kg;t.load-=kg;this.delivered+=kg;this.today.delivered+=kg;
          if(t.load>1e-8){t.status='TPS3R penuh';continue;}
        }else{
          const w=sim.lots[t.target].waste,kg=Math.min(w.amount,t.capacity-t.load);
          w.amount-=kg;t.load+=kg;w.lastCollection=sim.time;this.collected+=kg;this.today.collected+=kg;
        }
        t.target=null;t.serviceAt=null;
      }
      const hour=sim.time/3600%24;
      const claimed=new Set(this.trucks.map(t=>t.target));
      const candidates=this.sources.filter(l=>!claimed.has(l.id)&&l.waste.amount>=l.waste.capacity*.25).sort((a,b)=>b.waste.amount/b.waste.capacity-a.waste.amount/a.waste.capacity);
      if(t.load>=t.capacity-1e-8||hour<6||hour>=20||!candidates.length){
        if(c.lot!=='wasteDepot')this.send(t,'wasteDepot');else t.status='Tersedia';
      }else this.send(t,candidates[0].id);
    }
  }
  get stats(){
    return {today:{...this.today},generated:this.generated,collected:this.collected,delivered:this.delivered,
      inBuildings:this.sources.reduce((n,l)=>n+l.waste.building,0),
      carried:this.walkers.reduce((n,t)=>n+(t.deposited?0:t.load),0),walkers:this.walkers.length,
      waiting:this.sources.reduce((n,l)=>n+l.waste.amount,0),inTrucks:this.trucks.reduce((n,t)=>n+t.load,0),storage:this.storage,storageCapacity:this.storageCapacity,
      overflowing:this.sources.filter(l=>l.waste.amount>l.waste.capacity).length,active:this.trucks.filter(t=>t.target!==null).length,
      locations:this.sources.map(l=>({id:l.id,name:l.name,...l.waste})),trucks:this.trucks.map((t,i)=>({number:i+1,load:t.load,capacity:t.capacity,status:t.status}))};
  }
}
