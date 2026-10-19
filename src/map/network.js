import {NETWORKS} from '../devices.js';
import {gatewayOf} from './placement.js';

// The device network of a map: which device talks to which, over what medium. Same three
// media as the device design (docs, 3D diagram): LAN for short cables at a junction, fiber
// optic for long cables and the gateway uplinks to the data centre, LoRaWAN radio for the
// battery-powered bin sensors.
export {NETWORKS};
export const DEVICE_ICONS={
  cctv:{glyph:'A',label:'CCTV pendekat (antrean)',color:'#2f7fc1'},
  'cctv-dome':{glyph:'K',label:'CCTV kubah simpang',color:'#5a6fd1'},
  'bin-sensor':{glyph:'S',label:'Sensor tempat sampah',color:'#c98a12'},
  controller:{glyph:'L',label:'Pengendali simpang',color:'#2e9e5b'},
  gateway:{glyph:'GW',label:'Gateway edge',color:'#26332e',square:true},
  'data-center':{glyph:'DC',label:'Pusat data',color:'#173b37',square:true},
};
// A camera further than this from its gateway is cabled with fiber instead of LAN.
export const LAN_REACH=60;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

// Links as {from, to, network, kind}: kind 'sensor' (device → gateway), 'control'
// (gateway → junction controller) or 'uplink' (gateway → data centre).
export function networkLinks(map){
  const byId=new Map(map.objects.map(o=>[o.id,o])),links=[];
  for(const o of map.objects){
    const gw=gatewayOf(map,o),g=gw&&byId.get(gw.id);if(!g)continue;
    if(o.asset==='controller')links.push({from:g.id,to:o.id,network:'lan',kind:'control'});
    else if(o.asset==='bin-sensor')links.push({from:o.id,to:g.id,network:'lora',kind:'sensor'});
    else links.push({from:o.id,to:g.id,network:dist(o,g)<=LAN_REACH?'lan':'fiber',kind:'sensor'});
  }
  const centres=map.objects.filter(o=>o.asset==='data-center');
  if(centres.length)for(const g of map.objects.filter(o=>o.asset==='gateway')){
    const dc=centres.reduce((a,b)=>dist(a,g)<=dist(b,g)?a:b);
    links.push({from:g.id,to:dc.id,network:'fiber',kind:'uplink'});
  }
  return links;
}

export function networkSummary(map){
  const links=networkLinks(map),devices={},media={lan:0,fiber:0,lora:0};
  for(const o of map.objects)if(DEVICE_ICONS[o.asset])devices[o.asset]=(devices[o.asset]||0)+1;
  for(const l of links)media[l.network]++;
  const gateways=map.objects.filter(o=>o.asset==='gateway');
  return {links,devices,media,dataCentre:!!devices['data-center'],
    unlinkedGateways:devices['data-center']?0:gateways.length,
    orphans:map.objects.filter(o=>DEVICE_ICONS[o.asset]&&o.asset!=='gateway'&&o.asset!=='data-center'&&!gatewayOf(map,o)).length};
}
