import {NETWORKS} from '../devices.js';
import {gatewayOf,controllerOf,reachOf,CABLE_REACH,LORA_REACH} from './placement.js';

// The device network of a map: which device talks to which, over what medium. Same three
// media as the device design (docs, 3D diagram): LAN for short cables at a junction, fiber
// optic for long cables and the gateway uplinks to the data centre, LoRaWAN radio for the
// battery-powered bin sensors. Traffic lights are wired straight to their junction
// controller with signal cable (the controller switches the lamps); that is a cable, not a
// data network, and is drawn and counted apart from the three media.
export {NETWORKS,CABLE_REACH,LORA_REACH};
export const LAMP_CABLE={color:0x9c8a5a,label:'Kabel sinyal lampu',detail:'Kabel langsung dari kabinet pengendali ke setiap lampu; pengendali menyalakan dan mematikan lampunya.',latency:'langsung'};
// Every kind of link: the three network media plus the lamp cable.
export const LINK_TYPES={...NETWORKS,lamp:LAMP_CABLE};
export const isLamp=o=>/^traffic-light/.test(o.asset)||o.asset==='pedestrian-light';
export const DEVICE_ICONS={
  cctv:{glyph:'A',label:'Kamera detektor antrean',color:'#2f7fc1'},
  'cctv-dome':{glyph:'K',label:'Kamera kubah simpang (peta lama)',color:'#5a6fd1'},
  'bin-sensor':{glyph:'S',label:'Sensor tempat sampah',color:'#c98a12'},
  controller:{glyph:'L',label:'Pengendali simpang',color:'#2e9e5b'},
  gateway:{glyph:'GW',label:'Gateway edge',color:'#26332e',square:true},
  'data-center':{glyph:'DC',label:'Pusat data',color:'#173b37',square:true},
};
// A device further than this from its gateway is cabled with fiber instead of LAN.
export const LAN_REACH=CABLE_REACH;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

// Links as {from, to, network, kind}: kind 'sensor' (device → gateway), 'control'
// (gateway → junction controller), 'lamp' (controller → traffic light), 'relay' (gateway →
// the gateway of the controller a camera's counts are for) or 'uplink' (gateway → data
// centre). A sensor link that needs a relay names it in `relay`.
export function networkLinks(map){
  const byId=new Map(map.objects.map(o=>[o.id,o])),links=[],relays=new Map();
  const reach=reachOf(map).cable,cable=(a,b)=>dist(a,b)<=reach?'lan':'fiber';
  for(const o of map.objects){
    if(isLamp(o)){const c=controllerOf(map,o,80);if(c)links.push({from:c.id,to:o.id,network:'lamp',kind:'lamp'});continue;}
    const gw=gatewayOf(map,o),g=gw&&byId.get(gw.id);if(!g)continue;
    if(o.asset==='controller')links.push({from:g.id,to:o.id,network:cable(o,g),kind:'control'});
    else if(o.asset==='bin-sensor')links.push({from:o.id,to:g.id,network:'lora',kind:'sensor'});
    else{
      const link={from:o.id,to:g.id,network:cable(o,g),kind:'sensor'},own=controllerOf(map,o),via=own&&byId.get(gatewayOf(map,own)?.id);
      if(via&&via.id!==g.id){
        const key=`${g.id}>${via.id}`;
        if(!relays.has(key))relays.set(key,{from:g.id,to:via.id,network:cable(g,via),kind:'relay'});
        link.relay=key;
      }
      links.push(link);
    }
  }
  links.push(...relays.values());
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
  for(const l of links)if(l.network in media)media[l.network]++;
  const gateways=map.objects.filter(o=>o.asset==='gateway'),lampObjects=map.objects.filter(isLamp);
  const pedestrian=lampObjects.filter(o=>o.asset==='pedestrian-light').length;
  const lamps={vehicle:lampObjects.length-pedestrian,pedestrian,wired:links.filter(l=>l.kind==='lamp').length};
  // Devices whose automatic gateway is further than the medium reaches.
  const outOfReach=map.objects.filter(o=>{const g=gatewayOf(map,o);return g?.auto&&!g.inReach;}).length;
  return {links,devices,media,lamps,outOfReach,reach:reachOf(map),relays:links.filter(l=>l.kind==='relay').length,dataCentre:!!devices['data-center'],
    unlinkedGateways:devices['data-center']?0:gateways.length,
    orphans:map.objects.filter(o=>DEVICE_ICONS[o.asset]&&o.asset!=='gateway'&&o.asset!=='data-center'&&!gatewayOf(map,o)).length};
}
