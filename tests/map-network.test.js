import test from 'node:test';
import {miniKotaRoads,miniKotaLengkap} from '../src/map/default-map.js';
import assert from 'node:assert/strict';
import {validateMap} from '../src/map/format.js';
import {miniKotaRoads as convertMiniKota} from '../src/map/default-map.js';
import {furnish} from '../src/map/furnish.js';
import {addObject} from '../src/map/edit.js';
import {networkLinks,networkSummary,LAN_REACH} from '../src/map/network.js';

const full=miniKotaLengkap;

test('every device of the full map is on the network, with the right medium',()=>{
  const map=full(),s=networkSummary(map),byId=new Map(map.objects.map(o=>[o.id,o]));
  assert.equal(s.orphans,0);assert.ok(s.dataCentre);
  for(const l of s.links){
    const a=byId.get(l.from),b=byId.get(l.to);
    if(l.kind==='uplink'){assert.equal(a.asset,'gateway');assert.equal(b.asset,'data-center');assert.equal(l.network,'fiber');}
    else if(l.kind==='control'){assert.equal(b.asset,'controller');assert.equal(l.network,'lan');}
    else if(a.asset==='bin-sensor')assert.equal(l.network,'lora');
    else assert.equal(l.network,Math.hypot(a.x-b.x,a.z-b.z)<=LAN_REACH?'lan':'fiber');
  }
  assert.equal(s.links.filter(l=>l.kind==='uplink').length,s.devices.gateway,'every gateway has an uplink');
  assert.equal(s.media.lora,s.devices['bin-sensor']);
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
