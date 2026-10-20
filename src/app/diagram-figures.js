import {estimateDataCenter,DATA_CENTER_DEFAULTS,toolNeeds} from './data-center.js';
import {networkSummary} from '../map/network.js';
import {reachOf} from '../map/placement.js';

// Figures for the 3D device-flow diagram: per device a short line shown under its name in the
// picture, and detail lines (how many, what data passes, what it does) for its panel. Same
// estimate as the Data Center panel, from the devices placed on a map.
const fmt=(n,d=0)=>Number(n).toLocaleString('id-ID',{maximumFractionDigits:d,minimumFractionDigits:0});
const size=gb=>gb>=1000?`${fmt(gb/1000,1)} TB`:gb>=1?`${fmt(gb,1)} GB`:`${fmt(gb*1000,0)} MB`;

export function diagramFigures(map,config=DATA_CENTER_DEFAULTS,{zone=80}={}){
  const e=estimateDataCenter(map,config),net=networkSummary(map),c=e.config;
  const count=id=>e.sensors.find(s=>s.id===id)?.count||0;
  const cams=count('queue')+count('dome'),bins=count('waste');
  const camRate=cams/c.sampleSeconds,binRate=bins/60,perGateway=e.gateways?e.eventsPerSecond/e.gateways:0;
  const rowsPerDay=e.totalSensors*24*60;   // one summary row per sensor per minute
  const per=(short,...lines)=>({short,lines});
  const tools=Object.fromEntries(toolNeeds(e).tools.map(t=>[t.tool,t]));
  return {
    source:map.name||'peta',
    cam:per(`${fmt(cams)} unit`,`${fmt(cams)} unit · 1 per arah datang`,`${fmt(camRate,1)} pesan/dtk`,`Hitung antrean di zona ${fmt(zone)} m`),
    ultra:per(`${fmt(bins)} unit`,`${fmt(bins)} unit`,`${fmt(binRate,2)} pesan/dtk (tiap 60 dtk)`,'Ukur isi tempat sampah'),
    ctrl:per(`${fmt(e.signalControllers)} unit · ${fmt(e.signalHeads+e.pedestrianHeads)} lampu`,`${fmt(e.signalControllers)} unit`,`${fmt(e.signalHeads)} lampu kendaraan + ${fmt(e.pedestrianHeads)} lampu penyeberang, dikabel ke pengendali`,'Jalankan fase, cadangan waktu tetap'),
    gw:per(`${fmt(e.gateways)} unit`,`${fmt(e.gateways)} unit, masing-masing dengan radio LoRaWAN`,`Jangkauan kabel ${fmt(reachOf(map).cable)} m, LoRaWAN ${fmt(reachOf(map).lora/1000,1)} km`,`±${fmt(perGateway,1)} pesan/dtk per gateway`,`${fmt(e.signalEvaluationsPerSecond)} evaluasi lampu/dtk (jalur cepat)`),
    net:per(`${fmt(e.networkMbps,2)} Mbps`,`${fmt(net.media.lan)} LAN · ${fmt(net.media.fiber)} fiber · ${fmt(net.media.lora)} LoRaWAN`,`${fmt(e.networkMbps,2)} Mbps ke data center`),
    kafka:per(`${fmt(e.eventsPerSecond,1)} pesan/dtk`,`${fmt(e.eventsPerSecond,1)} pesan/dtk masuk`,`${size(e.dailyGB)}/hari · 2 topik`,`${tools.Kafka.nodes} broker · ${tools.Kafka.detail}`),
    spark:per(`${e.vcpu} vCPU`,`${e.activeNodes} + 1 cadangan · ${e.vcpu} vCPU · ${e.ramGB} GB RAM`,`Beban ±${fmt(e.cpuCores*100/Math.max(1,e.vcpu),1)}% CPU`,'Window 1 menit per lokasi; pelatihan model harian (MLlib)'),
    db:per(`±${fmt(rowsPerDay/1000)} rb baris/hari`,`±${fmt(rowsPerDay)} baris per menit/hari`,`${size(tools.ClickHouse.storageGB)} untuk 90 hari · ${tools.ClickHouse.nodes} node`,'Ringkasan menit → jam → hari; dibaca Grafana'),
    lake:per(`${size(e.storageGB)} / ${fmt(c.retentionDays)} hari`,`${size(e.storageGB)} untuk ${fmt(c.retentionDays)} hari · ${tools['MinIO + Iceberg'].nodes} node MinIO`,'Tabel Iceberg per tanggal dan wilayah H3; 2 salinan; time travel'),
    dash:per(`${fmt(e.totalSensors)} sensor`,`${fmt(e.totalSensors)} sensor dipantau`,'Diperbarui tiap detik'),
    airflow:per('4 model · harian','Pekerjaan harian: kualitas data, ringkasan, pemadatan Iceberg','Latih ulang 4 model di Spark, uji, kirim parameter ke gateway'),
    note:`Angka dari peta ${map.name||'ini'}: ${fmt(e.totalSensors)} sensor, ${fmt(e.eventsPerSecond,1)} pesan/dtk, ${fmt(c.payloadBytes)} byte per pesan. Estimasi, bukan pengukuran.`,
  };
}
