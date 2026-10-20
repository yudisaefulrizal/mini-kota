import {DEVICE_ICONS,LINK_TYPES,LAMP_CABLE,networkSummary} from './network.js';
import {gatewayOf,reachOf} from './placement.js';
const km=m=>m>=1000?`${fmt(m/1000,1)} km`:`${fmt(m)} m`;

// What a device on the map reports while a simulation runs, as label/value rows, and the
// network links it has. Shared by the editor's device card and the app's device views; the
// numbers come from the traffic model and the network layer, standing in for real devices.
const fmt=(n,d=0)=>Number(n).toLocaleString('id-ID',{maximumFractionDigits:d});
export const STAGE_NAMES={green:'Hijau',yellow:'Kuning',allRed:'Merah semua'};

export function binStatus(b){
  return b.fill>=1?'Penuh':b.truck==='called'?'Truk sampah dipanggil':typeof b.truck==='number'?'Sedang dikosongkan':b.truck==='unreachable'?'Tidak terjangkau truk':'Normal';
}
// The signalised junction a controller runs (nearest within 40 m).
export function controllerNode(engine,network,objectId){
  return [...engine.signals.keys()].find(id=>network.controllerAt(engine,id)===objectId)||null;
}

// How a camera's counts reach the lights: its gateway, and the controller's gateway after it.
function cameraPath(network,id){
  const links=network?.linksOf(id)||[],up=links.find(l=>l.kind==='sensor'&&l.from===id);if(!up)return 'Belum tersambung ke gateway';
  const relay=up.relay&&network.linksOf(up.to).find(l=>l.kind==='relay'&&`${l.from}>${l.to}`===up.relay);
  return relay?`Gateway ${up.to} → gateway ${relay.to} (pengendali)`:`Gateway ${up.to}`;
}
// Traffic lights wired to a controller: vehicle heads and pedestrian lights.
function lampsOf(network,id){
  const ids=(network?.linksOf(id)||[]).filter(l=>l.kind==='lamp').map(l=>l.to),objects=network?.map?.objects||[];
  const pedestrian=ids.filter(x=>objects.find(o=>o.id===x)?.asset==='pedestrian-light').length;
  return {vehicle:ids.length-pedestrian,pedestrian};
}

export function deviceReadings(engine,network,o){
  const stats=network?.stats.get(o.id)||{sent:0,received:0},rows=[];
  if(o.asset==='cctv-dome'||o.asset==='cctv'){
    const st=engine.sensorState(o.id);
    if(st)rows.push(['Memantau',st.approaches.length===1?`arah datang dari ${st.approaches[0].from.toLowerCase()} (${st.approaches[0].road}), simpang ${st.node}`:`simpang ${st.node} · ${st.approaches.length} arah`],
      [`Di zona ${fmt(st.zone)} m`,`${st.inZone} kendaraan`],['Berhenti',st.stopped],['Antrean dari garis henti',st.stopped?`±${fmt(st.queueLength)} m`:'—'],
      ['Melewati garis henti',fmt(st.count)],['Lampu arah ini',st.adaptive?'Adaptif, memakai data kamera ini':'Waktu tetap'],['Data lewat',cameraPath(network,o.id)]);
    else rows.push(['Memantau','Tidak menghadap arah datang di simpang berlampu']);
  }else if(o.asset==='bin-sensor'){
    const b=engine.bins.find(x=>x.id===o.id);
    if(b)rows.push(['Isi',`${fmt(Math.min(b.fill,1)*100)}%`],['Status',binStatus(b)],['Dikosongkan',`${b.emptied} kali`],
      ['Laporan',engine.binMode==='sensor'?'Tiap 60 detik lewat LoRaWAN':'Tanpa sensor: truk datang terjadwal']);
    else rows.push(['Status','Terlalu jauh dari jalan untuk dilayani truk']);
  }else if(o.asset==='controller'){
    const node=network&&controllerNode(engine,network,o.id),st=node&&engine.signalState(node),sig=node&&engine.signals.get(node);
    const lamps=lampsOf(network,o.id);
    if(st)rows.push(['Simpang',node],['Fase',`${st.phase+1} dari ${sig.plan.phases.length}`],['Tahap',STAGE_NAMES[st.stage]],['Sisa',`${fmt(st.remaining)} dtk`],['Perintah diterima',stats.received]);
    else rows.push(['Simpang','Tidak mengendalikan simpang berlampu']);
    rows.push(['Lampu dikendalikan',`${lamps.vehicle} kendaraan + ${lamps.pedestrian} penyeberang`]);
  }else if(o.asset==='gateway'){
    const links=network?.linksOf(o.id)||[],served=(network?.map?.objects||[]).filter(x=>gatewayOf(network.map,x)?.id===o.id);
    const n=asset=>served.filter(x=>x.asset===asset).length,relays=links.filter(l=>l.kind==='relay');
    rows.push(['Melayani',`${n('cctv')+n('cctv-dome')} kamera · ${n('controller')} pengendali · ${n('bin-sensor')} sensor sampah`],['Jangkauan',`kabel ${km(reachOf(network?.map).cable)} · LoRaWAN ${km(reachOf(network?.map).lora)}`],
      ...(relays.length?[['Antar-gateway',relays.map(l=>l.from===o.id?`ke ${l.to}`:`dari ${l.from}`).join(', ')]]:[]),['Data diterima',fmt(stats.received)],['Data dikirim',fmt(stats.sent)],['Jalur ke pusat data',links.some(l=>l.kind==='uplink')?'Fiber optik':'Belum ada']);
  }else if(o.asset==='data-center'){
    const ups=(network?.linksOf(o.id)||[]).filter(l=>l.kind==='uplink');
    rows.push(['Gateway terhubung',ups.length],['Data diterima',fmt(stats.received)],['Per menit (waktu simulasi)',engine.time>0?fmt(stats.received/(engine.time/60)):'—']);
  }
  return rows;
}

// The links of a device: [{direction, other, otherLabel, network, label, latency}].
// Lamp cables are summed up in the readings instead.
export function deviceLinks(network,map,id){
  return (network?.linksOf(id)||[]).filter(l=>l.kind!=='lamp').map(l=>{
    const other=l.from===id?l.to:l.from,o=map.objects.find(x=>x.id===other);
    const direction=l.kind==='uplink'?(l.from===id?'Naik ke':'Dari'):l.from===id?'Ke':'Dari',type=LINK_TYPES[l.network];
    return {direction,other,otherLabel:DEVICE_ICONS[o?.asset]?.label||o?.asset||other,network:l.network,label:type.label,latency:type.latency,color:type.color};
  });
}

const hex=n=>`#${n.toString(16).padStart(6,'0')}`;
// Contents of the "Perangkat & jaringan" legend (HTML), or '' when the map has no devices.
export function legendHtml(map,{live=false}={}){
  const s=networkSummary(map),devices=Object.entries(DEVICE_ICONS).filter(([k])=>s.devices[k]);
  if(!devices.length)return '';
  return devices.map(([k,v])=>`<span><i class="${v.square?'square':''}" style="background:${v.color}">${v.glyph}</i>${v.label} · ${s.devices[k]}</span>`).join('')
    +(s.lamps.vehicle+s.lamps.pedestrian?`<span><b class="net-swatch lamp" style="--c:${hex(LAMP_CABLE.color)}"></b>Lampu lalu lintas · ${s.lamps.vehicle+s.lamps.pedestrian} <small>${s.lamps.vehicle} kendaraan, ${s.lamps.pedestrian} penyeberang; kabel ke pengendali</small></span>`:'')
    +`<strong class="legend-sub">Jaringan</strong>`+['lan','fiber','lora'].map(k=>`<span><b class="net-swatch ${k}" style="--c:${hex(LINK_TYPES[k].color)}"></b>${LINK_TYPES[k].label} · ${s.media[k]} sambungan <small>${LINK_TYPES[k].latency}</small></span>`).join('')
    +(s.relays?`<small>${s.relays} sambungan antar-gateway (kamera yang dilayani gateway lain dari pengendalinya).</small>`:'')
    +(s.outOfReach?`<small class="bad">${s.outOfReach} perangkat di luar jangkauan gateway (kabel ${km(s.reach.cable)}, LoRaWAN ${km(s.reach.lora)}).</small>`:'')
    +(s.dataCentre?'':`<small class="bad">Belum ada Pusat data: gateway belum punya jalur fiber ke atas.</small>`)
    +(s.orphans?`<small class="bad">${s.orphans} perangkat belum punya gateway.</small>`:'')
    +`<small>Klik ikon untuk detail${live?' dan angka langsung':''}.</small>`;
}
