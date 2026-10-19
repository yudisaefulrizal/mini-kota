import {DEVICE_ICONS,NETWORKS,networkSummary} from './network.js';

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

export function deviceReadings(engine,network,o){
  const stats=network?.stats.get(o.id)||{sent:0,received:0},rows=[];
  if(o.asset==='cctv-dome'||o.asset==='cctv'){
    const st=engine.sensorState(o.id);
    if(st)rows.push(['Memantau',`simpang ${st.node} · ${st.legs.length} pendekat`],['Kendaraan terhitung',fmt(st.count)],['Berhenti di pendekat sekarang',st.queue],['Lampu simpang',st.adaptive?'Adaptif, memakai data kamera ini':'Waktu tetap']);
    else rows.push(['Memantau','Tidak ada simpang berlampu di dekatnya']);
  }else if(o.asset==='bin-sensor'){
    const b=engine.bins.find(x=>x.id===o.id);
    if(b)rows.push(['Isi',`${fmt(Math.min(b.fill,1)*100)}%`],['Status',binStatus(b)],['Dikosongkan',`${b.emptied} kali`],
      ['Laporan',engine.binMode==='sensor'?'Tiap 60 detik lewat LoRaWAN':'Tanpa sensor: truk datang terjadwal']);
    else rows.push(['Status','Terlalu jauh dari jalan untuk dilayani truk']);
  }else if(o.asset==='controller'){
    const node=network&&controllerNode(engine,network,o.id),st=node&&engine.signalState(node),sig=node&&engine.signals.get(node);
    if(st)rows.push(['Simpang',node],['Fase',`${st.phase+1} dari ${sig.plan.phases.length}`],['Tahap',STAGE_NAMES[st.stage]],['Sisa',`${fmt(st.remaining)} dtk`],['Perintah diterima',stats.received]);
    else rows.push(['Simpang','Tidak mengendalikan simpang berlampu']);
  }else if(o.asset==='gateway'){
    const links=network?.linksOf(o.id)||[];
    rows.push(['Perangkat terhubung',links.filter(l=>l.kind!=='uplink').length],['Data diterima',fmt(stats.received)],['Data dikirim',fmt(stats.sent)],['Jalur ke pusat data',links.some(l=>l.kind==='uplink')?'Fiber optik':'Belum ada']);
  }else if(o.asset==='data-center'){
    const ups=(network?.linksOf(o.id)||[]).filter(l=>l.kind==='uplink');
    rows.push(['Gateway terhubung',ups.length],['Data diterima',fmt(stats.received)],['Per menit (waktu simulasi)',engine.time>0?fmt(stats.received/(engine.time/60)):'—']);
  }
  return rows;
}

// The links of a device: [{direction, other, otherLabel, network, label, latency}].
export function deviceLinks(network,map,id){
  return (network?.linksOf(id)||[]).map(l=>{
    const other=l.from===id?l.to:l.from,o=map.objects.find(x=>x.id===other);
    const direction=l.kind==='uplink'?(l.from===id?'Naik ke':'Dari'):l.from===id?'Ke':'Dari';
    return {direction,other,otherLabel:DEVICE_ICONS[o?.asset]?.label||o?.asset||other,network:l.network,label:NETWORKS[l.network].label,latency:NETWORKS[l.network].latency,color:NETWORKS[l.network].color};
  });
}

const hex=n=>`#${n.toString(16).padStart(6,'0')}`;
// Contents of the "Perangkat & jaringan" legend (HTML), or '' when the map has no devices.
export function legendHtml(map,{live=false}={}){
  const s=networkSummary(map),devices=Object.entries(DEVICE_ICONS).filter(([k])=>s.devices[k]);
  if(!devices.length)return '';
  return devices.map(([k,v])=>`<span><i class="${v.square?'square':''}" style="background:${v.color}">${v.glyph}</i>${v.label} · ${s.devices[k]}</span>`).join('')
    +`<strong class="legend-sub">Jaringan</strong>`+['lan','fiber','lora'].map(k=>`<span><b class="net-swatch ${k}" style="--c:${hex(NETWORKS[k].color)}"></b>${NETWORKS[k].label} · ${s.media[k]} sambungan <small>${NETWORKS[k].latency}</small></span>`).join('')
    +(s.dataCentre?'':`<small class="bad">Belum ada Pusat data: gateway belum punya jalur fiber ke atas.</small>`)
    +(s.orphans?`<small class="bad">${s.orphans} perangkat belum punya gateway.</small>`:'')
    +`<small>Klik ikon untuk detail${live?' dan angka langsung':''}.</small>`;
}
