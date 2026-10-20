// Data center sizing for the smart city, from the devices placed on the map. A scenario
// estimate, not a hardware benchmark: the devices are planned, not connected, and the
// readings come from the traffic model. The load is the sensors' messages and the signal
// evaluations only: the smart city keeps aggregate counts and does not track or reroute
// individual vehicles (privacy), so the number of vehicles does not size the system.
export const DATA_CENTER_DEFAULTS={sampleSeconds:1,payloadBytes:256,retentionDays:30,eventCpuMs:.2};

export function validateDataCenter(input={}){
  const c={...DATA_CENTER_DEFAULTS,...input};
  const ranges={sampleSeconds:[.25,60],payloadBytes:[32,65536],retentionDays:[1,365],eventCpuMs:[.001,100]};
  for(const [key,[min,max]] of Object.entries(ranges))if(!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw Error(`Nilai ${key} harus ${min}–${max}.`);
  for(const key of ['payloadBytes','retentionDays'])if(!Number.isInteger(c[key]))throw Error(`Nilai ${key} harus bilangan bulat.`);
  return c;
}

const count=(map,asset)=>map.objects.filter(o=>o.asset===asset).length;
export function dataCenterInventory(map){
  const sensors=[
    {id:'queue',name:'Kamera detektor antrean',device:'Kamera IP tiang + analitik video',
      method:'Dipasang di seberang simpang menghadap kendaraan yang datang. Menghitung kendaraan di zona deteksi (bawaan 80 m dari garis henti), yang berhenti, panjang antrean, dan yang melewati garis henti; hitungan ini dipakai lampu adaptif. Tidak mengenali pelat atau mengikuti kendaraan.',
      count:count(map,'cctv'),basis:'1 per arah datang di simpang berlampu',interval:'traffic',status:'Input lampu adaptif'},
    {id:'dome',name:'Kamera kubah simpang (peta lama)',device:'Kamera IP kubah + analitik video',
      method:'Peta lama: satu kamera melihat semua pendekat simpang.',
      count:count(map,'cctv-dome'),basis:'Sesuai yang dipasang di peta',interval:'traffic',status:'Input lampu adaptif'},
    {id:'waste',name:'Sensor isi tempat sampah',device:'Sensor jarak ultrasonik + radio LoRaWAN',
      method:'Dipasang di tutup tempat sampah menghadap ke bawah untuk mengukur jarak ke permukaan sampah dan memperkirakan persentase isi; memanggil truk saat hampir penuh. Tidak mengukur berat.',
      count:count(map,'bin-sensor'),basis:'1 per tempat sampah bersensor',interval:60,status:'Panggilan truk sampah'},
  ].filter(s=>s.count>0);
  return {sensors,totalSensors:sensors.reduce((sum,s)=>sum+s.count,0),signalControllers:count(map,'controller'),
    signalHeads:map.objects.filter(o=>/^traffic-light/.test(o.asset)).length,pedestrianHeads:count(map,'pedestrian-light'),gateways:count(map,'gateway'),dataCentres:count(map,'data-center')};
}

export function estimateDataCenter(map,input={},inventory=dataCenterInventory(map)){
  const config=validateDataCenter(input);
  const eventsPerSecond=inventory.sensors.reduce((sum,s)=>sum+s.count/(s.interval==='traffic'?config.sampleSeconds:s.interval),0);
  const signalEvaluationsPerSecond=inventory.signalControllers*4;
  // A signal evaluation costs about as much as handling one message.
  const cpuCores=(eventsPerSecond+signalEvaluationsPerSecond)*config.eventCpuMs/1000;
  const vcpu=Math.max(2,Math.ceil(cpuCores/.6));
  const ramGB=Math.ceil((4+inventory.totalSensors*.002)/2)*2;
  const dailyGB=eventsPerSecond*config.payloadBytes*86400/1e9;
  const storageGB=dailyGB*config.retentionDays*2*1.3;
  const networkMbps=eventsPerSecond*config.payloadBytes*8*1.3/1e6;
  const activeNodes=Math.max(1,Math.ceil(vcpu/8),Math.ceil(ramGB/16));
  return {...inventory,config,eventsPerSecond,signalEvaluationsPerSecond,cpuCores,vcpu,ramGB,dailyGB,storageGB,networkMbps,activeNodes,totalNodes:activeNodes+1,nodeVcpu:8,nodeRamGB:16};
}

// Resources per tool of the data center (Desain Teknis), from the same estimate: Kafka keeps a
// few days of events, Spark does the stream and the training, ClickHouse keeps per-minute
// results for months, MinIO + Iceberg the raw archive, plus Grafana and Airflow.
const KAFKA_DAYS=3,HOT_DAYS=90,ROW_BYTES=64,DRIVE_TB=8;
export function toolNeeds(e){
  const c=e.config,bytes=e.eventsPerSecond*c.payloadBytes;
  const kafkaGB=bytes*86400*KAFKA_DAYS*2*1.3/1e9;
  const brokers=Math.max(3,Math.ceil(e.eventsPerSecond/20000),Math.ceil(kafkaGB/1000));
  const partitions=Math.max(12,Math.ceil(e.eventsPerSecond/1000));
  const rowsPerDay=e.totalSensors*1440;
  const hotGB=rowsPerDay*ROW_BYTES*HOT_DAYS*2/1e9;
  const clickhouse=2*Math.max(1,Math.ceil(hotGB/800));
  // MinIO keeps about half of the raw drive space after erasure coding; 4 drives per node.
  const minio=Math.max(4,Math.ceil(e.storageGB/(4*DRIVE_TB*1000*0.5)));
  const tools=[
    {tool:'Kafka',role:'Antrean event',nodes:brokers,vcpu:brokers*4,ramGB:brokers*16,storageGB:kafkaGB,detail:`${partitions} partisi traffic_events, simpan ${KAFKA_DAYS} hari, replikasi 2`},
    {tool:'Spark',role:'Stream + pelatihan model',nodes:e.totalNodes,vcpu:e.totalNodes*e.nodeVcpu,ramGB:e.totalNodes*e.nodeRamGB,storageGB:0,detail:`${e.activeNodes} aktif + 1 cadangan; beban ±${e.vcpu} vCPU`},
    {tool:'ClickHouse',role:'Data panas (per menit)',nodes:clickhouse,vcpu:clickhouse*8,ramGB:clickhouse*32,storageGB:hotGB,detail:`${Math.round(rowsPerDay).toLocaleString('id-ID')} baris/hari, simpan ${HOT_DAYS} hari, 1 replika`},
    {tool:'MinIO + Iceberg',role:'Arsip & data latih',nodes:minio,vcpu:minio*8,ramGB:minio*32,storageGB:e.storageGB,detail:`mentah ${c.retentionDays} hari, 2 salinan + 30% cadangan`},
    {tool:'Grafana + Prometheus',role:'Dashboard & pemantauan',nodes:1,vcpu:2,ramGB:4,storageGB:50,detail:'1 VM'},
    {tool:'Airflow',role:'Orkestrasi & pelatihan ulang',nodes:1,vcpu:4,ramGB:8,storageGB:100,detail:'1 VM; job berat di Spark'},
  ];
  const sum=k=>tools.reduce((s,t)=>s+t[k],0);
  return {tools,total:{nodes:sum('nodes'),vcpu:sum('vcpu'),ramGB:sum('ramGB'),storageGB:sum('storageGB')}};
}
