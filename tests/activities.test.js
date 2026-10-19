import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,DEFAULTS,WORK_SHIFTS,UNIVERSITY_SHIFTS,validate} from '../src/simulation.js';
import {planActivities,destinationCount} from '../src/activities.js';

test('three fixed shifts are balanced, with overnight occupants present at startup',()=>{
  const s=new Simulation({throughRate:0});
  for(const [role,shifts] of [['workers',WORK_SHIFTS],['university',UNIVERSITY_SHIFTS]]){
    const people=s.people.filter(p=>p.role===role),counts=[0,1,2].map(i=>people.filter(p=>p.shift===i).length);
    assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
    for(const p of people)assert.deepEqual(p.schedule,shifts[p.shift]);
  }
  const night=s.cars.filter(c=>c.jobs[0]?.carryover);assert.ok(night.length>0);
  for(const c of night){assert.equal(c.lot,c.jobs[0].from);assert.equal(c.jobs[0].at,7*3600);assert.ok(c.jobs.some(j=>j.until===31*3600));}
  assert.ok(night.some(c=>c.external&&c.state==='parked'));
  assert.ok(night.some(c=>!c.external&&c.state==='outside'));
  assert.ok(s.initialInside!==s.stats.localCars);
});

test('destination draw is bounded and zero-probability choices cannot be selected',()=>{
  for(const count of [1,2,3]){
    const config={...DEFAULTS,oneDestination:count===1?100:0,twoDestinations:count===2?100:0,threeDestinations:count===3?100:0};
    for(const draw of [0,.3,.7,.999])assert.equal(destinationCount(config,()=>draw),count);
  }
  assert.throws(()=>validate({...DEFAULTS,oneDestination:71}),/100%/);
});

test('optional activities fit before night work, do not overlap, and end at home',()=>{
  const plan=planActivities({home:'home',primary:{id:'industry',start:23*3600,end:31*3600},earliest:8*3600,requested:3,worker:true,config:DEFAULTS,travel:()=>600,rng:()=>.4});
  assert.equal(plan.stops.length,3);assert.equal(plan.stops.at(-1).id,'industry');
  for(let i=1;i<plan.stops.length;i++)assert.ok(plan.stops[i-1].end+600<=plan.stops[i].start);
  assert.equal(plan.jobs.at(-1).to,'home');assert.equal(plan.jobs.at(-1).at,31*3600);
  for(let i=1;i<plan.jobs.length;i++)assert.equal(plan.jobs[i].from,plan.jobs[i-1].to);
  for(const stop of plan.stops.filter(s=>s.optional))assert.ok(stop.start>=stop.open&&stop.end<=stop.close);
});

test('all modes receive bounded itineraries; school escort remains a return-and-pickup route',()=>{
  const s=new Simulation({throughRate:0,oneDestination:0,twoDestinations:0,threeDestinations:100});
  assert.ok(s.people.some(p=>p.mode==='car'&&p.activities?.length===3));
  assert.ok(s.people.some(p=>p.mode!=='car'&&p.activities?.length>=2));
  assert.ok(s.people.some(p=>p.mode==='car'&&p.activities?.some(a=>a.id==='cityCenter')));
  assert.ok(s.people.some(p=>p.mode!=='car'&&p.activities?.some(a=>a.id==='cityCenter')));
  assert.ok(s.lots.cityCenter.node!==undefined);
  for(const p of [...s.people,...s.visitors].filter(p=>p.activities)){
    assert.ok(p.activities.length>=1&&p.activities.length<=3);
    assert.equal(new Set(p.activities.map(a=>a.id)).size,p.activities.length);
    assert.ok(p.activities.some(a=>!a.optional&&a.id===p.destination));
    for(let i=1;i<p.activities.length;i++)assert.ok(p.activities[i].start>=p.activities[i-1].end);
  }
  const escort=s.cars.find(c=>c.jobs.length===4&&c.jobs[0].to==='school');assert.ok(escort);
  assert.deepEqual(escort.jobs.map(j=>j.to),['school',escort.home,'school',escort.home]);
  for(const c of s.cars.filter(c=>!c.through&&c.jobs.length)){
    assert.equal(c.jobs.at(-1).to,c.home);
    for(let i=1;i<c.jobs.length;i++)assert.equal(c.jobs[i].from,c.jobs[i-1].to);
  }
});

test('late optional visits are skipped without losing the car or mandatory destination',()=>{
  const s=new Simulation({throughRate:0}),c=s.cars.find(c=>!c.external&&c.state==='parked'&&c.lot===c.home);
  s.time=19.9*3600;c.job=0;c.jobs=[{from:c.home,to:'shop',at:s.time,until:20*3600,activityDuration:3600,close:20*3600,optional:true},{from:'shop',to:'university',at:21*3600,due:22*3600,until:23*3600},{from:'university',to:c.home,at:23*3600}];
  const next=s.nextJob(c);assert.equal(next.to,'university');assert.equal(next.from,c.home);assert.equal(s.skippedStops,1);assert.equal(c.lot,c.home);
});

test('night cars remain at work across midnight and eventually return using the same identity',()=>{
  const s=new Simulation({students:0,university:0,workers:18,homemakers:0,other:0,householdSize:1,noCar:0,oneCar:100,twoCars:0,usage:100,outboundWorkers:0,throughRate:0,oneDestination:100,twoDestinations:0,threeDestinations:0});
  const night=s.cars.filter(c=>c.jobs[0]?.carryover);assert.equal(night.length,6);
  while(s.time<24*3600)s.step(1);
  assert.equal(s.finished,false);assert.equal(s.clock(),'00:00:00');
  for(const c of night){assert.equal(c.state,'parked');assert.equal(c.lot,s.people[c.person].workplace);}
  while(s.time<30.9*3600)s.step(1);
  for(const c of night)assert.equal(c.state,'parked');
  while(!s.finished)s.step(1);
  assert.ok(s.time>31*3600);assert.ok(s.time<48*3600);
  for(const c of night){assert.equal(c.lot,c.home);assert.equal(c.job,c.jobs.length);assert.equal(s.cars[c.id],c);}
});
