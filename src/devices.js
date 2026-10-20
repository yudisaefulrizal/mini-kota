// Proposed hardware shared by desain-teknis.html and diagram-3d.html. Counts for sensors
// and controllers follow dataCenterInventory (src/app/data-center.js) on the default map; everything else is a
// sizing proposal.
export const DEVICES=[
  {id:'cam',zone:'field',icon:'◉',name:'Kamera detektor antrean (IP + analitik)',count:'1 per arah datang di simpang berlampu',
    role:'Satu kamera per arah datang di simpang berlampu, dipasang di seberang simpang menghadap kendaraan yang datang. Menghitung kendaraan di zona deteksi (80 m dari garis henti), yang berhenti, panjang antrean, dan yang melewati garis henti; hitungan ini dipakai lampu adaptif. Analitik berjalan di kamera, sehingga yang dikirim hanya metadata hasil deteksi (jumlah, bukan identitas): tidak ada pembacaan plat atau pelacakan kendaraan.',
    hardware:'Kamera IP luar ruang IP66, prosesor analitik di kamera. Kamera tiang di seberang simpang memakai kabel LAN ke gateway simpang; kamera di luar jangkauan kabel gateway (lebih dari 75 m garis lurus, ±100 m kabel) memakai serat optik.',
    os:'Firmware Linux tertanam dari vendor kamera',
    software:'Aplikasi analitik di kamera (deteksi kendaraan, zona antrean, garis virtual), klien NTP untuk sinkronisasi waktu',
    protocol:'Metadata JSON lewat MQTT ke gateway di jaringan kabel lokal (port 8883, TLS), tiap 250 ms untuk kontrol lampu. Gateway meneruskan ringkasan per 1 detik ke data center. Video RTSP tidak dikirim ke data center.',
    links:['gw']},
  {id:'ultra',zone:'field',icon:'≋',name:'Sensor ultrasonik tempat sampah',count:'1 per tempat sampah bersensor',
    role:'Mengukur jarak ke permukaan sampah untuk memperkirakan persentase isi. Tidak mengukur berat.',
    hardware:'Sensor jarak ultrasonik, baterai, radio LoRaWAN, dipasang di tutup tempat sampah menghadap ke bawah',
    os:'Tanpa sistem operasi: firmware mikrokontroler',
    software:'Firmware pengukuran dan pengiriman berkala',
    protocol:'LoRaWAN ke gateway. Interval 60 detik mengikuti model; di lapangan interval 15–60 menit lebih hemat baterai.',
    links:['gw']},
  {id:'ctrl',zone:'field',icon:'⬢',name:'Pengendali simpang',count:'1 per simpang berlampu atau simpang gabungan; lampu dikabel ke pengendalinya',
    role:'Menyalakan fase lampu. Menerima durasi hijau dari gateway dan kembali ke lampu tetap jika data berhenti.',
    hardware:'Kabinet pengendali lampu lalu lintas dengan modul I/O ke kepala lampu, port Ethernet',
    os:'Firmware real-time dari vendor pengendali',
    software:'Program fase, mode lampu tetap sebagai cadangan, pengaman konflik hijau',
    protocol:'NTCIP 1202 lewat Ethernet lokal dari gateway. Lampu dikabel langsung dari kabinet pengendali (kabel sinyal), bukan lewat jaringan data.',
    links:['gw']},
  {id:'gw',zone:'edge',icon:'▣',name:'Gateway edge',count:'Sesedikit mungkin hingga setiap kamera dan pengendali ≤ 75 m dari satu gateway; sensor sampah ke gateway terdekat (LoRaWAN ±1 km)',
    role:'Mengumpulkan data sensor sekitar, menjalankan jalur cepat lampu adaptif, menyangga data saat jaringan putus, lalu mengirim event ke Kafka.',
    hardware:'PC industri fanless 4 core, RAM 8 GB, SSD 128 GB, 2 port Ethernet, switch PoE untuk kamera, modul radio LoRaWAN',
    os:'Ubuntu Server 24.04 LTS',
    software:'Docker; Mosquitto (MQTT lokal); layanan producer Kafka (Python + confluent-kafka); logika lampu adaptif; ChirpStack untuk LoRaWAN; penyangga disk lokal',
    protocol:'MQTT dari kamera, LoRaWAN dari sensor sampah, NTCIP ke pengendali, protokol Kafka TLS (port 9093) lewat VPN',
    links:['cam','ultra','ctrl','net']},
  {id:'net',zone:'network',icon:'⇄',name:'Jaringan kota',count:'1 jaringan per kota',
    role:'Menghubungkan semua gateway ke data center secara terenkripsi.',
    hardware:'Serat optik ke semua gateway, router VPN di tiap gateway dan di data center',
    os:'OS router dari vendor atau OpenWrt',
    software:'VPN WireGuard, firewall yang hanya membuka port Kafka dan pemeliharaan',
    protocol:'Telemetri tanpa video: ±0,3 kbps per kamera (lihat Panel Data Center untuk total)',
    links:['gw','kafka','airflow']},
  {id:'kafka',zone:'dc',icon:'☰',name:'Broker Apache Kafka',count:'Minimal 3 broker (kuorum KRaft); ditambah mengikuti throughput dan penyimpanan',
    role:'Menerima dan menyimpan sementara event sensor, lalu membagikannya ke Spark.',
    hardware:'4 vCPU, RAM 16 GB, SSD 500 GB per node',
    os:'Ubuntu Server 24.04 LTS',
    software:'Apache Kafka 4.x mode KRaft (tanpa ZooKeeper), Java 17. Topik: traffic_events dan waste_events. Faktor replikasi 2.',
    protocol:'Protokol Kafka TLS, port 9093. Tiga node menjaga kuorum KRaft tetap jalan jika satu node mati.',
    links:['net','spark','dash']},
  {id:'spark',zone:'dc',icon:'✦',name:'Worker Apache Spark',count:'Mengikuti beban (Panel Data Center) + 1 cadangan',
    role:'Menjalankan Structured Streaming: parse, window 1 menit, agregasi, deteksi kondisi, dan state tempat sampah.',
    hardware:'8 vCPU, RAM 16 GB per node, sesuai rumus kapasitas. Driver dan master berjalan di node pertama.',
    os:'Ubuntu Server 24.04 LTS',
    software:'Apache Spark 3.5 (mode standalone), Java 17, job PySpark, konektor spark-sql-kafka',
    protocol:'Membaca Kafka port 9093; checkpoint ke MinIO (S3); hasil ke ClickHouse dan tabel Iceberg; job pelatihan model dari Airflow',
    links:['kafka','db','lake','airflow']},
  {id:'db',zone:'dc',icon:'▤',name:'ClickHouse (data panas)',count:'2 node (1 replika); shard per wilayah H3 saat membesar',
    role:'Menyimpan hasil window per menit dan kejadian untuk dashboard dan analisis cepat beberapa bulan terakhir.',
    hardware:'8 vCPU, RAM 32 GB, SSD NVMe 1 TB per node',
    os:'Ubuntu Server 24.04 LTS',
    software:'ClickHouse 24 (MergeTree, partisi per hari, urutan wilayah H3 + simpang + waktu); ringkasan berjenjang menit → jam → hari (materialized view); TTL memindahkan data lama ke Iceberg',
    protocol:'HTTP 8123 / native 9000, hanya dari jaringan internal data center',
    links:['spark','dash']},
  {id:'lake',zone:'dc',icon:'⛁',name:'Lakehouse (MinIO + Apache Iceberg)',count:'Minimal 4 node MinIO (erasure coding); ditambah mengikuti penyimpanan',
    role:'Arsip event mentah dan hasil analisis dalam tabel Iceberg: ACID, time travel untuk audit keputusan lampu, dan bahan pelatihan model. Juga tempat checkpoint Spark dan model.',
    hardware:'Per node: 8 vCPU, RAM 32 GB, 4 × HDD 8 TB',
    os:'Ubuntu Server 24.04 LTS',
    software:'MinIO (kompatibel S3), tabel Apache Iceberg (format Parquet) dengan katalog REST; partisi per tanggal dan wilayah H3; pemadatan dan pembersihan snapshot terjadwal',
    protocol:'API S3 lewat HTTPS, port 9000',
    links:['spark','airflow']},
  {id:'dash',zone:'dc',icon:'▦',name:'Dashboard & pemantauan',count:'1 VM',
    role:'Menampilkan kondisi kota real-time dan kesehatan sistem, termasuk consumer lag yang menjadi tanda perlu menambah worker.',
    hardware:'2 vCPU, RAM 4 GB, SSD 50 GB',
    os:'Ubuntu Server 24.04 LTS',
    software:'Grafana (tampilan, membaca ClickHouse), Prometheus + Kafka exporter (metrik lag, CPU, durasi batch)',
    protocol:'HTTPS port 443 untuk operator, melalui VPN',
    links:['db','kafka']},
  {id:'airflow',zone:'dc',icon:'⟳',name:'Apache Airflow (orkestrasi & pembelajaran)',count:'1 VM; pekerjaan berat dijalankan di Spark',
    role:'Menjadwalkan pekerjaan harian: cek kualitas data, ringkasan harian, pemadatan Iceberg, pelatihan ulang model, dan pengiriman parameter ke gateway.',
    hardware:'4 vCPU, RAM 8 GB, SSD 100 GB',
    os:'Ubuntu Server 24.04 LTS',
    software:'Apache Airflow 2 (DAG Python), operator Spark untuk job pelatihan (Spark MLlib), penyimpanan model di lakehouse',
    protocol:'Mengirim parameter model ke gateway lewat jaringan kota (MQTT TLS, harian)',
    links:['spark','lake','net']},
];
export const ZONES=[['field','Lapangan'],['edge','Tepi jalan'],['network','Jaringan'],['dc','Data center']];

export const SHORT_NAMES={cam:'Kamera detektor',ultra:'Sensor sampah',ctrl:'Pengendali simpang',gw:'Gateway edge',net:'Jaringan kota',kafka:'Kafka',spark:'Spark',db:'ClickHouse',lake:'Lakehouse',dash:'Grafana',airflow:'Airflow'};

// What each device runs, in order, for one cycle of data.
export const PROCESSES={
  cam:['Merekam video. Video tetap di kamera dan tidak dikirim ke data center.','Analitik mendeteksi kendaraan di zona antrean atau saat melewati garis virtual.','Menghitung jumlah kendaraan, kendaraan berhenti, panjang antrean, dan arah gerak.','Menyusun hasil menjadi JSON dengan sensor_id dan cap waktu dari NTP.','Mengirim JSON ke gateway lewat MQTT setiap 250 ms.'],
  ultra:['Bangun dari mode tidur sesuai interval.','Memancarkan gelombang ultrasonik dan mengukur waktu pantulnya dari permukaan sampah.','Mengubah jarak menjadi persentase isi berdasarkan tinggi tempat sampah.','Mengirim paket kecil lewat LoRaWAN, lalu tidur lagi.'],
  ctrl:['Menjalankan siklus fase: hijau, kuning 3 detik, merah bersama 1 detik.','Menerima usulan durasi hijau dari gateway.','Memeriksa batas aman: hijau minimal 10 detik, maksimal 90 detik, dan tidak ada dua arah bertabrakan yang hijau bersamaan.','Kembali ke lampu tetap jika tidak ada data dari gateway selama 2 detik (watchdog).'],
  gw:['Menerima metadata kamera (MQTT) dan data sampah (LoRaWAN lewat ChirpStack).','Memeriksa format dan menambahkan cap waktu terima.','Jalur cepat: membandingkan antrean tiap arah 4 kali per detik, lalu mengirim durasi hijau ke pengendali simpang.','Producer Kafka meringkas data per 1 detik dan mengirim event dengan kunci node_id atau lot_id ke topik yang sesuai.','Jika jaringan putus, event disimpan di disk lokal lalu dikirim ulang sesuai urutan.'],
  net:['Membuka terowongan VPN WireGuard dari tiap gateway ke data center.','Meneruskan event Kafka yang terenkripsi.','Firewall hanya membuka port Kafka dan port pemeliharaan.'],
  kafka:['Menerima event dari producer di gateway.','Memilih partisi dari kunci pesan, sehingga urutan event per simpang terjaga.','Menulis event ke log dan menyalinnya ke broker lain (replikasi 2).','Melayani pembacaan Spark dengan offset tersimpan.','Menghapus data yang melewati masa retensi.'],
  spark:['Membaca stream dari topik traffic_events dan waste_events.','Mengurai JSON dan membuang event rusak.','Mengelompokkan event per lokasi dalam window 1 menit dengan watermark 30 detik.','Menghitung rata-rata dan maksimum antrean, total arus, dan isi tempat sampah.','Menerapkan aturan deteksi: antrean macet, sampah ≥ 80%, sensor diam.','Menulis hasil ke ClickHouse, termasuk kejadian seperti antrean macet dan sampah penuh, arsip ke tabel Iceberg, lalu menyimpan checkpoint.','Atas perintah Airflow, menjalankan job pelatihan model (Spark MLlib) dari data di lakehouse.'],
  db:['Menerima hasil window per menit dari Spark.','Menyimpannya di tabel MergeTree yang dipartisi per hari dan diurutkan per wilayah H3, simpang, dan waktu.','Membuat ringkasan per jam dan per hari secara otomatis (materialized view).','Melayani query Grafana dan analisis cepat.','Memindahkan data lebih lama dari batas simpan ke Iceberg (TTL).'],
  lake:['Menerima event mentah dan hasil window dari Spark ke tabel Iceberg.','Mencatat setiap penulisan sebagai snapshot (time travel untuk audit).','Menyimpan checkpoint Spark dan versi model.','Menyediakan data historis untuk pelatihan model dan analisis jangka panjang.','Memadatkan file kecil dan membuang snapshot lama sesuai jadwal Airflow.'],
  dash:['Grafana membaca kondisi terbaru dan ringkasan dari ClickHouse.','Menampilkan status simpang, isi tempat sampah, dan panggilan truk sampah.','Prometheus mengumpulkan metrik sistem: consumer lag, CPU, dan durasi batch Spark.','Memberi tanda saat consumer lag terus naik (perlu menambah worker).'],
  airflow:['Tiap malam memeriksa kualitas data hari itu (kelengkapan, nilai mustahil).','Membuat ringkasan harian di ClickHouse dan memadatkan tabel Iceberg.','Menjalankan job Spark: melatih ulang empat model lalu lintas dari histori berlabel jam, Masehi, dan Hijriah (prediksi arus dan waktu tempuh; optimasi durasi hijau dan penahanan hijau).','Mengirim parameter baru langsung ke gateway; gateway memeriksa batas aman sebelum memakainya.'],
};

export const FLOW_TYPES={
  traffic:{label:'Data lalu lintas',color:0x2f7fc1},
  waste:{label:'Data sampah',color:0xd99a1e},
  control:{label:'Perintah lampu',color:0x2e9e5b},
  result:{label:'Hasil analisis',color:0x7c5cbf},
  metrics:{label:'Metrik sistem',color:0x8a9a90},
  model:{label:'Parameter model',color:0xc2547a},
};
// Physical network on each link. Latencies are design targets, not measurements.
export const NETWORKS={
  lan:{color:0x6b7f99,label:'LAN',detail:'Kabel jaringan untuk jarak dekat: kamera ke kabinet simpang, gateway ke pengendali, dan antarserver di data center.',latency:'< 1 ms'},
  fiber:{color:0x2f7fc1,label:'Fiber optik',detail:'Untuk jarak jauh: kamera yang jauh dari gateway, serta setiap gateway ke data center.',latency:'± 1–5 ms'},
  lora:{color:0xd99a1e,label:'LoRaWAN',detail:'Radio hemat baterai untuk data kecil yang tidak mendesak.',latency:'± 1 detik'},
};
export const FLOWS=[
  {from:'cam',to:'gw',network:'lan',alt:{network:'fiber',who:'kamera yang jauh dari gateway'},who:'kamera pendekat simpang',type:'traffic',label:'Metadata deteksi (JSON lewat MQTT, tiap 250 ms)'},
  {from:'ultra',to:'gw',network:'lora',type:'waste',label:'Persentase isi (LoRaWAN, tiap 60 detik)'},
  {from:'gw',to:'ctrl',network:'lan',type:'control',label:'Durasi hijau (NTCIP, 4 kali per detik)'},
  {from:'gw',to:'net',network:'fiber',type:'traffic',label:'Event sensor (protokol Kafka, TLS)'},
  {from:'net',to:'kafka',network:'fiber',type:'traffic',label:'Event ke topik traffic dan waste'},
  {from:'kafka',to:'spark',network:'lan',type:'traffic',label:'Stream event sensor'},
  {from:'spark',to:'db',network:'lan',type:'result',label:'Hasil window 1 menit dan kejadian ke ClickHouse'},
  {from:'spark',to:'lake',network:'lan',type:'result',label:'Event mentah dan hasil ke tabel Iceberg, checkpoint'},
  {from:'db',to:'dash',network:'lan',type:'result',label:'Query kondisi terbaru'},
  {from:'kafka',to:'dash',network:'lan',type:'metrics',label:'Metrik consumer lag (Prometheus)'},
  {from:'lake',to:'airflow',network:'lan',type:'result',label:'Data historis untuk pelatihan dan pemeriksaan kualitas'},
  {from:'airflow',to:'spark',network:'lan',type:'model',label:'Job pelatihan ulang model (harian)'},
  {from:'airflow',to:'net',network:'fiber',type:'model',label:'Parameter model baru (harian, MQTT TLS)'},
  {from:'net',to:'gw',network:'fiber',type:'model',label:'Parameter model ke gateway; gateway memeriksa batas aman'},
];

// Guided walkthrough: one queue event and one waste event through the system.
export const TOUR=[
  {devices:['cam'],flows:['cam-gw'],title:'Kamera mendeteksi antrean',text:'Pukul 07.42 kamera di pendekat utara simpang 7 melihat 11 kendaraan berhenti dengan antrean 62,5 m. Kamera mengirim angka ini ke gateway, bukan videonya.'},
  {devices:['gw','ctrl'],flows:['gw-ctrl'],title:'Gateway mengatur lampu',text:'Gateway membandingkan antrean semua arah dan meminta hijau lebih lama untuk arah utara. Keputusan ini diambil di simpang dalam waktu kurang dari 1 detik, tanpa menunggu data center.'},
  {devices:['ultra','gw'],flows:['ultra-gw'],title:'Sensor sampah melapor',text:'Pada saat yang sama, sensor tempat sampah di kawasan bisnis melaporkan isi 84%.'},
  {devices:['gw','net','kafka'],flows:['gw-net','net-kafka'],title:'Event dikirim ke data center',text:'Gateway mengirim kedua event lewat VPN ke Kafka. Jika jaringan putus, event disimpan dulu di gateway.'},
  {devices:['kafka'],flows:[],title:'Kafka menyimpan event',text:'Event antrean masuk ke topik traffic_events dan event sampah ke waste_events. Kunci simpang 7 selalu menuju partisi yang sama, dan setiap event disalin ke broker kedua.'},
  {devices:['kafka','spark'],flows:['kafka-spark'],title:'Spark menganalisis window',text:'Pada window 07.42–07.43, antrean maksimum 92 m. Ini window kedua berturut-turut di atas 80 m, sehingga Spark menandai QUEUE_CONGESTED. Isi sampah 84% menghasilkan WASTE_FULL.'},
  {devices:['spark','db','dash'],flows:['spark-db','db-dash'],title:'Dashboard diperbarui',text:'Hasil window masuk ClickHouse. Dashboard menampilkan simpang 7 sebagai macet dan tempat sampah kawasan bisnis sebagai penuh.'},
  {devices:['spark','lake'],flows:['spark-lake'],title:'Data diarsipkan',text:'Event mentah dan hasil window disimpan ke tabel Iceberg untuk analisis jam sibuk, evaluasi lampu, dan pelatihan model.'},
  {devices:['airflow','spark','lake'],flows:['lake-airflow','airflow-spark'],title:'Model belajar setiap malam',text:'Airflow menjalankan job Spark yang melatih ulang empat model lalu lintas dari histori di lakehouse: prediksi arus dan waktu tempuh, serta optimasi durasi hijau dan penahanan hijau. Model baru langsung dipakai.'},
  {devices:['airflow','net','gw','ctrl'],flows:['airflow-net','net-gw','gw-ctrl'],title:'Parameter kembali ke simpang',text:'Parameter yang lolos uji dikirim ke gateway. Gateway memeriksa batas aman, lalu memakainya untuk jalur cepat lampu. Pengaman konflik di kabinet pengendali tetap menjadi lapisan terakhir.'},
];

// Neighbours of a device with the network on each link. A link can have an
// alternative medium for some units (cameras far from their gateway use fibre).
function flowNetworks(f){return [{key:f.network,who:f.who},...(f.alt?[{key:f.alt.network,who:f.alt.who}]:[])];}
export function linksOf(id){
  const seen=new Map();
  for(const f of FLOWS){const other=f.from===id?f.to:f.to===id?f.from:null;if(!other)continue;
    for(const n of flowNetworks(f)){const k=`${other}|${n.key}`;if(!seen.has(k))seen.set(k,{other,key:n.key,who:n.who,network:NETWORKS[n.key]});}}
  return [...seen.values()];
}
// Each physical link once per medium, in data-flow order.
export function networkLinks(){
  const seen=new Map();
  for(const f of FLOWS)for(const n of flowNetworks(f)){const k=[f.from,f.to].sort().join('|')+n.key;if(!seen.has(k))seen.set(k,{from:f.from,to:f.to,who:n.who,network:NETWORKS[n.key]});}
  return [...seen.values()];
}
