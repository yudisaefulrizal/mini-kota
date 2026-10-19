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
    {id:'queue',name:'Detektor antrean simpang',device:'Kamera CCTV IP kubah + analitik video',
      method:'Melihat semua pendekat simpang berlampu (atau simpang gabungan) dan menghitung kendaraan yang menuju, berhenti, dan melewati garis henti; hitungan ini dipakai lampu adaptif.',
      count:count(map,'cctv-dome'),basis:'1 per simpang berlampu atau simpang gabungan',interval:'traffic',status:'Input lampu adaptif'},
    {id:'road',name:'Detektor ruas',device:'Kamera CCTV IP tiang + analitik video',
      method:'Menghitung kendaraan pada satu pendekat atau ruas tempat kamera dipasang.',
      count:count(map,'cctv'),basis:'Sesuai yang dipasang di peta',interval:'traffic',status:'Input lampu adaptif & kepadatan'},
    {id:'waste',name:'Sensor isi tempat sampah',device:'Sensor jarak ultrasonik + radio LoRaWAN',
      method:'Dipasang di tutup tempat sampah menghadap ke bawah untuk mengukur jarak ke permukaan sampah dan memperkirakan persentase isi; memanggil truk saat hampir penuh. Tidak mengukur berat.',
      count:count(map,'bin-sensor'),basis:'1 per tempat sampah bersensor',interval:60,status:'Panggilan truk sampah'},
  ].filter(s=>s.count>0);
  return {sensors,totalSensors:sensors.reduce((sum,s)=>sum+s.count,0),signalControllers:count(map,'controller'),
    signalHeads:map.objects.filter(o=>/^traffic-light/.test(o.asset)).length,gateways:count(map,'gateway'),dataCentres:count(map,'data-center')};
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
