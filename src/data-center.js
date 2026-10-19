// Scenario sizing, not a hardware benchmark. Counts follow the model topology;
// these are planned devices, not connected hardware or measured telemetry.
export const DATA_CENTER_SITE={id:'dataCenter',name:'Data Center',x:1050,z:450,w:105,h:105,gate:[1040,500],road:[1015,500]};
export const DATA_CENTER_DEFAULTS={sampleSeconds:1,payloadBytes:256,retentionDays:30,eventCpuMs:.2,routeCpuMs:2,peakVehicles:500};
export function validateDataCenter(input={}){
  const c={...DATA_CENTER_DEFAULTS,...input};
  const ranges={sampleSeconds:[.25,60],payloadBytes:[32,65536],retentionDays:[1,365],eventCpuMs:[.001,100],routeCpuMs:[.01,1000],peakVehicles:[0,50000]};
  for(const [key,[min,max]] of Object.entries(ranges))if(!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw Error(`Nilai ${key} harus ${min}–${max}.`);
  for(const key of ['payloadBytes','retentionDays','peakVehicles'])if(!Number.isInteger(c[key]))throw Error(`Nilai ${key} harus bilangan bulat.`);
  return c;
}
// Monitoring points by role; each road direction belongs to exactly one detector group.
export function sensorSites(sim){
  const signals=sim.nodes.filter(n=>sim.hasSignal(n));
  const roads=sim.edges.filter(e=>![e.from,e.to].some(id=>sim.nodes[id].lot&&!sim.nodes[id].external));
  const approaches=roads.filter(e=>sim.hasSignal(sim.nodes[e.to]));
  const boundaries=roads.filter(e=>!approaches.includes(e)&&[e.from,e.to].some(id=>sim.nodes[id].external));
  const otherRoads=roads.filter(e=>!approaches.includes(e)&&!boundaries.includes(e));
  const lots=Object.values(sim.lots).filter(l=>!l.external);
  return {signals,roads,approaches,boundaries,otherRoads,lots,bins:sim.waste.sources};
}
export function dataCenterInventory(sim){
  const {signals,roads,approaches,boundaries,otherRoads,lots}=sensorSites(sim);
  const sensors=[
    {id:'queue',name:'Detektor antrean lampu merah',device:'Kamera CCTV IP + analitik video',method:'Mendeteksi dan melacak kendaraan berhenti atau bergerak lambat pada zona pendekat simpang untuk memperkirakan jumlah dan panjang antrean.',count:approaches.length,basis:'1 per ruas terarah yang masuk simpang berlampu',interval:'traffic',status:'Input lampu adaptif & rute'},
    {id:'gate',name:'Detektor arus gerbang',device:'Kamera CCTV IP + penghitung kendaraan',method:'Menghitung kendaraan yang melewati garis virtual di gerbang serta membedakan arah masuk dan keluar kota.',count:boundaries.length,basis:'1 per arah batas kota yang belum dicakup detektor simpang',interval:'traffic',status:'Input kepadatan rute'},
    {id:'road',name:'Detektor kepadatan ruas lain',device:'Kamera CCTV IP + analitik video',method:'Menghitung kendaraan dalam zona pantau ruas untuk memperkirakan kepadatan sebagai masukan pemilihan rute.',count:otherRoads.length,basis:'1 per ruas terarah lain; tidak menggandakan detektor simpang / gerbang',interval:'traffic',status:'Input kepadatan rute'},
    {id:'access',name:'Penghitung akses kawasan',device:'Kamera CCTV IP + penghitung dua arah',method:'Menghitung kendaraan masuk dan keluar akses kawasan; saldo kendaraan awal ditambah masuk dikurangi keluar menjadi estimasi jumlah kendaraan terparkir.',count:lots.length,basis:'1 per akses kawasan, dua arah',interval:5,status:'Rencana pemantauan parkir'},
    {id:'waste',name:'Sensor isi tempat sampah',device:'Sensor jarak ultrasonik',method:'Dipasang di bagian atas tempat sampah menghadap ke bawah untuk mengukur jarak ke permukaan sampah dan memperkirakan persentase keterisian. Tidak mengukur berat dalam kg secara langsung.',count:sim.waste.sources.length,basis:'1 per tempat sampah kawasan',interval:60,status:'Rencana pemantauan sampah'},
  ];
  return {sensors,totalSensors:sensors.reduce((sum,s)=>sum+s.count,0),signalControllers:signals.length,signalHeads:approaches.length,roadDirections:roads.length,sites:lots.length};
}
export function estimateDataCenter(sim,input={},inventory=dataCenterInventory(sim)){
  const config=validateDataCenter(input);
  const activeVehicles=sim.cars.filter(c=>c.state==='driving').length;
  const sizingVehicles=Math.max(activeVehicles,config.peakVehicles);
  const eventsPerSecond=inventory.sensors.reduce((sum,s)=>sum+s.count/(s.interval==='traffic'?config.sampleSeconds:s.interval),0);
  const signalEvaluationsPerSecond=inventory.signalControllers*4;
  const routeEvaluationsPerSecond=sizingVehicles/5;
  // Signal evaluation shares the per-event cost assumption. Each route evaluation
  // uses its own editable cost, including the graph search in this scenario.
  const cpuCores=(eventsPerSecond*config.eventCpuMs+signalEvaluationsPerSecond*config.eventCpuMs+routeEvaluationsPerSecond*config.routeCpuMs)/1000;
  const vcpu=Math.max(2,Math.ceil(cpuCores/.6));
  const ramGB=Math.ceil((4+inventory.totalSensors*.002+sizingVehicles*.001)/2)*2;
  const dailyGB=eventsPerSecond*config.payloadBytes*86400/1e9;
  const storageGB=dailyGB*config.retentionDays*2*1.3;
  const networkMbps=eventsPerSecond*config.payloadBytes*8*1.3/1e6;
  const activeNodes=Math.max(1,Math.ceil(vcpu/8),Math.ceil(ramGB/16));
  return {...inventory,config,activeVehicles,sizingVehicles,eventsPerSecond,signalEvaluationsPerSecond,routeEvaluationsPerSecond,cpuCores,vcpu,ramGB,dailyGB,storageGB,networkMbps,activeNodes,totalNodes:activeNodes+1,nodeVcpu:8,nodeRamGB:16};
}
