// Bagian interaktif artikel: simpang dua arah (waktu tetap vs adaptif), alur big data, contoh baris histori.
const $=id=>document.getElementById(id);
const el=(tag,attrs={},text)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!=null)e.textContent=text;return e;};

// ---- Satu simpang, dua cara mengatur. Rumus tundaan Webster (bagian seragam), 1 lajur per arah.
const SAT=1800,LOST=8,MAX_GREEN=60;
function plan(name,gA,gB,qA,qB,adaptive){
  const c=gA+gB+LOST;
  const delay=(g,q)=>{const lam=g/c,x=q/(lam*SAT);return x>=1?null:c*(1-lam)**2/(2*(1-lam*x));};
  const dA=delay(gA,qA),dB=delay(gB,qB);
  const d=dA===null||dB===null?'jenuh':`${Math.round((dA*qA+dB*qB)/(qA+qB))} dtk`;
  const box=el('div',{class:adaptive?'plan adaptive':'plan'});
  const head=el('div',{class:'plan-head'});head.append(el('h3',{},name),el('span',{},`siklus ${Math.round(c)} dtk`));
  const bars=el('div');
  for(const [label,g] of [['Hijau utara–selatan',gA],['Hijau timur–barat',gB]]){
    const row=el('div',{class:'row'});row.append(el('span',{},label),el('span',{},`${Math.round(g)} dtk`));
    const bar=el('div',{class:'bar'}),fill=el('i');fill.style.width=`${Math.round(g/MAX_GREEN*100)}%`;bar.append(fill);
    bars.append(row,bar);
  }
  const res=el('div',{class:'result'});res.append(el('span',{},'Tundaan rata-rata per kendaraan'),el('b',{},d));
  box.append(head,bars,res);return box;
}
function updatePlans(){
  const qA=Number($('qa').value),qB=Number($('qb').value);
  $('qa-out').textContent=qA;$('qb-out').textContent=qB;
  const yA=qA/SAT,yB=qB/SAT,Y=Math.min(0.95,yA+yB);
  const c0=Math.max(40,Math.min(128,(1.5*LOST+5)/(1-Y)));
  const clamp=v=>Math.max(10,Math.min(MAX_GREEN,v));
  $('plans').replaceChildren(plan('Waktu tetap',30,30,qA,qB,false),plan('Adaptif',clamp((c0-LOST)*yA/(yA+yB)),clamp((c0-LOST)*yB/(yA+yB)),qA,qB,true));
}
$('qa').addEventListener('input',updatePlans);$('qb').addEventListener('input',updatePlans);updatePlans();

// ---- Pilihan berbentuk tombol (satu yang aktif).
function pills(box,items,label,onPick){
  const buttons=items.map((it,i)=>{const b=el('button',{type:'button','aria-pressed':'false'},label(it,i));b.addEventListener('click',()=>pick(i));return b;});
  box.replaceChildren(...buttons);
  function pick(i){buttons.forEach((b,k)=>b.setAttribute('aria-pressed',String(k===i)));onPick(items[i],i);}
  pick(0);
}

// ---- Alur big data.
const STEPS=[
  {name:'Kamera',speed:'per detik',text:'Kamera detektor antrean menghitung kendaraan per arah di perangkatnya sendiri dan hanya mengirim hitungan, bukan video.'},
  {name:'Gateway',speed:'per detik',text:'Gateway di lapangan menerima hitungan dari semua perangkat dalam jangkauannya, meneruskannya ke pengendali simpang terdekat dan ke data center.'},
  {name:'Kafka',speed:'detik',text:'Apache Kafka menampung aliran data dari seluruh kota, dibagi per wilayah, dan menyimpannya beberapa hari sehingga tidak ada data yang hilang saat pemrosesan tertinggal.'},
  {name:'Spark',speed:'per menit',text:'Spark Structured Streaming merangkum data per menit: rata-rata dan maksimum antrean, arus per arah, serta kejadian seperti antrean macet.'},
  {name:'ClickHouse & Iceberg',speed:'menit–tahun',text:'ClickHouse menyimpan ringkasan untuk dashboard; data mentah diarsip di lakehouse (MinIO + Apache Iceberg) sebagai bahan pelatihan model.'},
  {name:'Airflow',speed:'harian',text:'Apache Airflow menjadwalkan pelatihan ulang model dari histori setiap hari, lalu mengirim parameter baru ke gateway lewat jaringan kota.'},
  {name:'Pengendali simpang',speed:'per detik',text:'Pengendali memakai parameter baru, tetap dengan pengaman konflik di kabinet sebagai lapisan terakhir.'},
];
pills($('steps'),STEPS,(s,i)=>`${i+1} · ${s.name}`,(s,i)=>{$('step-meta').textContent=`TAHAP ${i+1} · ${s.speed}`;$('step-name').textContent=s.name;$('step-text').textContent=s.text;});

// ---- Contoh baris histori.
const LABEL='jam 6 · 20 Okt 2026 · 9 Jumadilawal 1448';
const TABLES=[
  {name:'arah',cols:['Waktu','Label','Versi model','Id simpang','Id kamera','Lewat garis henti','Di zona'],
    rows:[['06:00:05',LABEL,'3','n0','o3','2','5'],['06:00:05',LABEL,'3','n0','o6','0','3'],['06:00:10',LABEL,'3','n0','o3','1','6']]},
  {name:'simpang',cols:['Waktu','Label','Versi model','Id simpang','Fase menyala','Lama hijau','Hijau habis'],
    rows:[['06:00:05',LABEL,'3','n0','2','14 dtk','−'],['06:00:05',LABEL,'3','n1','1','8 dtk','−'],['06:00:10',LABEL,'3','n0','2','19 dtk','fase 2']]},
  {name:'kota',cols:['Waktu','Label','Versi model','Waktu antre total'],
    rows:[['06:00:05',LABEL,'3','412 dtk'],['06:00:10',LABEL,'3','398 dtk'],['06:00:15',LABEL,'3','420 dtk']]},
];
pills($('tables'),TABLES,t=>`Baris ${t.name}`,t=>{
  const head=el('tr');for(const c of t.cols)head.append(el('th',{scope:'col'},c));
  const thead=el('thead');thead.append(head);
  const tbody=el('tbody');for(const r of t.rows){const tr=el('tr');for(const v of r)tr.append(el('td',{},v));tbody.append(tr);}
  $('table').replaceChildren(thead,tbody);
});
