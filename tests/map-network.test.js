import test from 'node:test';
import {miniKotaRoads,miniKotaLengkap} from '../src/map/default-map.js';
import assert from 'node:assert/strict';
import {validateMap} from '../src/map/format.js';
import {miniKotaRoads as convertMiniKota} from '../src/map/default-map.js';
import {furnish} from '../src/map/furnish.js';
import {addObject} from '../src/map/edit.js';
import {gatewayOf} from '../src/map/placement.js';
import {networkLinks,networkSummary,LAN_REACH,CABLE_REACH,LORA_REACH} from '../src/map/network.js';

const full=miniKotaLengkap;

test('every device of the full map is on the network, with the right medium',()=>{
  const map=full(),s=networkSummary(map),byId=new Map(map.objects.map(o=>[o.id,o]));
  assert.equal(s.orphans,0);assert.ok(s.dataCentre);assert.equal(s.outOfReach,0);
  for(const l of s.links){
    const a=byId.get(l.from),b=byId.get(l.to);
    if(l.kind==='uplink'){assert.equal(a.asset,'gateway');assert.equal(b.asset,'data-center');assert.equal(l.network,'fiber');}
    else if(l.kind==='control'){assert.equal(b.asset,'controller');assert.equal(l.network,'lan');}
    else if(l.kind==='lamp'){assert.equal(a.asset,'controller');assert.ok(/^traffic-light|pedestrian-light/.test(b.asset));assert.equal(l.network,'lamp');}
    else if(a.asset==='bin-sensor')assert.equal(l.network,'lora');
    else assert.equal(l.network,Math.hypot(a.x-b.x,a.z-b.z)<=LAN_REACH?'lan':'fiber');
  }
  assert.equal(s.links.filter(l=>l.kind==='uplink').length,s.devices.gateway,'every gateway has an uplink');
  assert.equal(s.media.lora,s.devices['bin-sensor']);
  // Every traffic light is cabled to a controller: 50 for vehicles, 51 for pedestrians.
  assert.deepEqual(s.lamps,{vehicle:50,pedestrian:51,wired:101});
});

test('as few gateways as reach every device within 75 m of cable; bins use the nearest gateway',()=>{
  const map=full(),gateways=map.objects.filter(o=>o.asset==='gateway'),d=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  assert.ok(gateways.length<=13,`${gateways.length} gateways`);
  for(const o of map.objects.filter(o=>/^cctv|controller/.test(o.asset)))assert.ok(gateways.some(g=>d(g,o)<=CABLE_REACH),`${o.id} reached`);
  for(const b of map.objects.filter(o=>o.asset==='bin-sensor')){
    const nearest=gateways.reduce((a,g)=>d(g,b)<d(a,b)?g:a);assert.equal(gatewayOf(map,b).id,nearest.id);assert.ok(d(nearest,b)<=LORA_REACH);
  }
  // A camera goes to its controller's gateway when that is in reach, so no counts need relaying here.
  assert.equal(networkSummary(map).relays,0);
});

test('a camera served by another gateway than its controller has its counts relayed',()=>{
  const map=validateMap({...convertMiniKota(),objects:[]});
  const ctrl=addObject(map,'controller',{x:100,z:100}),gA=addObject(map,'gateway',{x:102,z:100}),gB=addObject(map,'gateway',{x:150,z:100});
  const cam=addObject(map,'cctv',{x:130,z:100});cam.gateway=gB.id;
  addObject(map,'traffic-light',{x:95,z:105});
  const links=networkLinks(map),up=links.find(l=>l.from===cam.id);
  assert.equal(up.to,gB.id);assert.equal(up.relay,`${gB.id}>${gA.id}`);
  assert.deepEqual(links.filter(l=>l.kind==='relay').map(l=>[l.from,l.to,l.network]),[[gB.id,gA.id,'lan']]);
  assert.equal(links.filter(l=>l.kind==='lamp'&&l.from===ctrl.id).length,1);
  // Out of reach of every gateway: reported.
  addObject(map,'cctv',{x:400,z:300});assert.equal(networkSummary(map).outOfReach,1);
});

test('a far camera is cabled with fiber; without a data centre the gateways have no uplink',()=>{
  const map=validateMap({...convertMiniKota(),objects:[]});
  const gw=addObject(map,'gateway',{x:100,z:100});
  addObject(map,'cctv',{x:110,z:100});addObject(map,'cctv',{x:100+LAN_REACH+20,z:100});addObject(map,'bin-sensor',{x:90,z:100});
  const links=networkLinks(map);
  assert.deepEqual(links.map(l=>l.network).sort(),['fiber','lan','lora']);
  assert.ok(links.every(l=>l.to===gw.id));
  const s=networkSummary(map);assert.equal(s.dataCentre,false);assert.equal(s.unlinkedGateways,1);
  addObject(map,'data-center',{x:300,z:200});
  assert.equal(networkLinks(map).filter(l=>l.kind==='uplink').length,1);
});

test('a map can set its own gateway reach; it is checked and changes links and warnings',()=>{
  const map=full();
  assert.deepEqual(networkSummary(map).reach,{cable:CABLE_REACH,lora:LORA_REACH});
  map.network={cableReach:20};validateMap(map);
  const s=networkSummary(map);assert.equal(s.reach.cable,20);assert.ok(s.outOfReach>0);
  assert.ok(s.links.some(l=>l.kind==='sensor'&&l.network==='fiber'),'beyond 20 m the cable is fiber');
  map.network={loraReach:50};assert.throws(()=>validateMap(map),/Jangkauan LoRaWAN harus 100–5000 m/);
  map.network={cableReach:150};assert.throws(()=>validateMap(map),/Jangkauan kabel harus 10–100 m/);
});
