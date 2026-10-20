import {estimateDataCenter,DATA_CENTER_DEFAULTS} from './data-center.js';
import {networkSummary} from '../map/network.js';

// Figures for the 3D device-flow diagram: per device a short line shown under its name in the
// picture, and detail lines (how many, what data passes, what it does) for its panel. Same
// estimate as the Data Center panel, from the devices placed on a map.
const fmt=(n,d=0)=>Number(n).toLocaleString('id-ID',{maximumFractionDigits:d,minimumFractionDigits:0});
const size=gb=>gb>=1000?`${fmt(gb/1000,1)} TB`:gb>=1?`${fmt(gb,1)} GB`:`${fmt(gb*1000,0)} MB`;

export function diagramFigures(map,config=DATA_CENTER_DEFAULTS){
  const e=estimateDataCenter(map,config),net=networkSummary(map),c=e.config;
  const count=id=>e.sensors.find(s=>s.id===id)?.count||0;
  const cams=count('queue')+count('dome'),bins=count('waste');
  const camRate=cams/c.sampleSeconds,binRate=bins/60,perGateway=e.gateways?e.eventsPerSecond/e.gateways:0;
  const rowsPerDay=e.totalSensors*24*60;   // one summary row per sensor per minute
  const per=(short,...lines)=>({short,lines});
  return {
    source:map.name||'peta',
    cam:per(`${fmt(cams)} unit`,`${fmt(cams)} unit · 1 per pendekat`,`${fmt(camRate,1)} pesan/dtk`,'Hitung antrean di zona 80 m'),
    ultra:per(`${fmt(bins)} unit`,`${fmt(bins)} unit`,`${fmt(binRate,2)} pesan/dtk (tiap 60 dtk)`,'Ukur isi tempat sampah'),
    ctrl:per(`${fmt(e.signalControllers)} unit · ${fmt(e.signalHeads+e.pedestrianHeads)} lampu`,`${fmt(e.signalControllers)} unit`,`${fmt(e.signalHeads)} lampu kendaraan + ${fmt(e.pedestrianHeads)} lampu penyeberang, dikabel ke pengendali`,'Jalankan fase, cadangan waktu tetap'),
    gw:per(`${fmt(e.gateways)} unit`,`${fmt(e.gateways)} unit · ${fmt(e.loraGateways)} dengan LoRaWAN`,'Jangkauan kabel 75 m, LoRaWAN 1 km',`±${fmt(perGateway,1)} pesan/dtk per gateway`,`${fmt(e.signalEvaluationsPerSecond)} evaluasi lampu/dtk (jalur cepat)`),
    net:per(`${fmt(e.networkMbps,2)} Mbps`,`${fmt(net.media.lan)} LAN · ${fmt(net.media.fiber)} fiber · ${fmt(net.media.lora)} LoRaWAN`,`${fmt(e.networkMbps,2)} Mbps ke data center`),
    kafka:per(`${fmt(e.eventsPerSecond,1)} pesan/dtk`,`${fmt(e.eventsPerSecond,1)} pesan/dtk masuk`,`${size(e.dailyGB)}/hari · 2 topik`),
    spark:per(`${e.vcpu} vCPU`,`${e.activeNodes} + 1 cadangan · ${e.vcpu} vCPU · ${e.ramGB} GB RAM`,`Beban ±${fmt(e.cpuCores*100/Math.max(1,e.vcpu),1)}% CPU`,'Window 1 menit per lokasi'),
    db:per(`±${fmt(rowsPerDay/1000)} rb baris/hari`,`±${fmt(rowsPerDay)} baris ringkasan/hari`,'Kondisi terbaru + grafik'),
    lake:per(`${size(e.storageGB)} / ${fmt(c.retentionDays)} hari`,`${size(e.storageGB)} untuk ${fmt(c.retentionDays)} hari`,'2 salinan, Parquet per tanggal'),
    dash:per(`${fmt(e.totalSensors)} sensor`,`${fmt(e.totalSensors)} sensor dipantau`,'Diperbarui tiap detik'),
    note:`Angka dari peta ${map.name||'ini'}: ${fmt(e.totalSensors)} sensor, ${fmt(e.eventsPerSecond,1)} pesan/dtk, ${fmt(c.payloadBytes)} byte per pesan. Estimasi, bukan pengukuran.`,
  };
}
