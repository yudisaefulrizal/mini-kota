import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSimulation} from '../src/live-simulation.js';
const make=()=>new LiveSimulation({students:0,university:0,workers:0,homemakers:0,other:1,noCar:100,oneCar:0,twoCars:0,throughRate:0,idleLitersPerHour:0.8});
function queue(s){
  s.canClaim=()=>false;
  for(const edge of s.edges.slice(0,2))s.newCar({state:'driving',edge:edge.id,s:edge.length-Math.min(20,edge.length/3),v:0,held:null,claimed:false,path:[edge.id],jobs:[{to:'homeA'}],job:0});
}
test('queue time sums stopped vehicles and integrates fuel at the current rate',()=>{
  const s=make();queue(s);
  for(let i=0;i<240;i++)s.step(.25);
  assert.equal(s.stats.queueSeconds,120);
  assert.ok(Math.abs(s.stats.idleFuelLiters-120/3600*.8)<1e-12);
  const fuel=s.stats.idleFuelLiters;
  s.applyConfig({...s.config,idleLitersPerHour:1.6});
  assert.equal(s.stats.idleFuelLiters,fuel);
  s.step(.25);
  assert.equal(s.stats.queueSeconds,120.5);
  assert.ok(Math.abs(s.stats.idleFuelLiters-fuel-.5/3600*1.6)<1e-12);
  s.time=86400-.25;s.step(.25);
  assert.equal(s.stats.queueSeconds,121);
  assert.equal(make().stats.queueSeconds,0);assert.equal(make().stats.idleFuelLiters,0);
});
test('parked and moving vehicles consume no queue fuel; zero rate retains queue time',()=>{
  const s=make();s.step(1);assert.equal(s.stats.queueSeconds,0);
  const edge=s.edges.find(e=>e.length>100);
  s.newCar({state:'driving',edge:edge.id,s:0,v:5,held:null,claimed:false,path:[edge.id],jobs:[{to:'homeA'}],job:0});
  s.step(.25);assert.equal(s.stats.queueSeconds,0);assert.equal(s.stats.idleFuelLiters,0);
  const q=make();q.applyConfig({...q.config,idleLitersPerHour:0});queue(q);q.step(.25);
  assert.equal(q.stats.queueSeconds,.5);assert.equal(q.stats.idleFuelLiters,0);
  for(const rate of [-1,NaN,Infinity])assert.throws(()=>q.applyConfig({...q.config,idleLitersPerHour:rate}));
});
