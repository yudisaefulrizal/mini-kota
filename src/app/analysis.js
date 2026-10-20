import {tip} from '../theme.js';

// "Analisis" tab: the smart city learns from its own sensor data. Each round collects a day of
// simulated sensor data (queue cameras, bin sensors), trains four models, tests them on the
// same day against the model in use, and adopts them only when they do better. The adopted
// model then runs the smart city. The work runs in a worker (src/analysis/worker.js).
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(n,d=0)=>Number(n).toLocaleString('id-ID',{maximumFractionDigits:d});
const duration=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s/60)%60;return h?`${h} j ${m} mnt`:`${m} mnt ${s%60} dtk`;};
const STAGES={collect:'Mengumpulkan data sensor',train:'Melatih model',evaluate:'Menguji pada hari yang sama'};

export function createAnalysisView({root,getContext,onApply}){
  let model=null,applied=null,history=[],worker=null,key=null;
  root.innerHTML=`<section class="equipment-block"><div class="equipment-head"><h3>Siklus belajar${tip(`<p>Setiap putaran: kota cerdas dijalankan selama waktu yang dipilih dan data sensornya dikumpulkan (hitungan kamera detektor antrean tiap 5 detik, isi tempat sampah tiap menit). Empat model dilatih dari data itu dan dari putaran sebelumnya, lalu diuji pada hari uji yang sama dengan model yang sedang dipakai. Model baru dipakai hanya jika waktu antrenya lebih kecil minimal 2% (rata-rata 4 hari uji), supaya kebetulan tidak dianggap perbaikan.</p><p>Tidak ada data per kendaraan: hanya hitungan, seperti yang dikirim perangkat ke data center. Di lapangan langkah yang sama dijalankan terjadwal pada riwayat data center.</p>`)}</h3><span id="analysis-status" class="analysis-status">Belum ada model; kota cerdas memakai aturan dasar.</span></div>
<div class="analysis-controls"><label>Data per putaran <select id="analysis-hours"><option value="1">1 jam simulasi</option><option value="2" selected>2 jam simulasi</option><option value="4">4 jam simulasi</option></select></label>
<button type="button" id="analysis-run" class="analysis-run">Jalankan putaran belajar</button><button type="button" id="analysis-reset" class="analysis-reset" hidden>Mulai dari nol</button></div>
<div id="analysis-progress" class="analysis-progress" hidden><div><i></i></div><span></span></div>
<div id="analysis-eval" class="compare-grid"></div>
<div class="comparison-table-wrap" id="analysis-history-wrap" hidden><table class="comparison-table analysis-history"><thead><tr><th scope="col">Putaran</th><th scope="col">Data</th><th scope="col">Antre: dipakai → baru</th><th scope="col">Keputusan</th></tr></thead><tbody id="analysis-history"></tbody></table></div></section>
<section class="analysis-models" id="analysis-models"></section>`;
  const $=id=>root.querySelector(`#${id}`);

  function card(title,about,body){
    return `<article class="equipment-block analysis-model"><div class="equipment-head"><h3>${title}${tip(about)}</h3></div>${body}</article>`;
  }
  function renderModels(){
    const box=$('analysis-models');
    if(!model){box.innerHTML='';return;}
    const e=model.error,better=e.naive>0?Math.round((1-e.model/e.naive)*100):0;
    const top=[...model.forecast].sort((a,b)=>b.perHour-a.perHour).slice(0,5);
    const lead=model.waste.lead,bins=Object.entries(model.waste.bins);
    box.innerHTML=[
      card('Prediksi antrean per arah','<p><strong>Masukan:</strong> kendaraan yang masuk zona tiap kamera, per 5 detik.</p><p><strong>Belajar:</strong> arus per arah untuk setiap 15 menit dalam sehari, digabung dengan putaran sebelumnya.</p><p><strong>Dipakai untuk:</strong> dashboard dan rencana lampu per jam di lapangan. Kedatangan kendaraan di simulasi rata sepanjang hari, jadi prediksinya belum mengubah lampu. Diuji pada seperempat data terakhir, dibanding tebakan "5 menit berikutnya sama dengan 5 menit terakhir".</p>',
        `<p class="analysis-key">Galat ${fmt(e.model,1)} kendaraan per 5 menit · tebakan sederhana ${fmt(e.naive,1)} <span class="delta ${better>0?'good':'bad'}">${better>0?'−':'+'}${Math.abs(better)}%</span></p>
<table class="mini"><thead><tr><th>Kamera</th><th>Simpang</th><th>Prediksi</th><th>Teramati</th></tr></thead><tbody>${top.map(f=>`<tr><td>${esc(f.id)}</td><td>${esc(f.node)}</td><td>${fmt(f.perHour)} /jam</td><td>${fmt(f.observed)} /jam</td></tr>`).join('')}</tbody></table>`),
      card('Penyetelan lampu per simpang','<p><strong>Masukan:</strong> catatan pengendali simpang: berapa kali hijau tiap fase habis sementara kamera masih melihat kendaraan menunggu, dan berapa lama hijau terpakai.</p><p><strong>Belajar:</strong> fase yang sering habis diberi hijau rencana lebih panjang (+20%), fase yang jarang memakai hijaunya dikurangi (−10%). Langkah kecil, jadi setelan mengendap dari putaran ke putaran.</p><p><strong>Dipakai untuk:</strong> hijau rencana tiap simpang; lampu adaptif tetap memperpanjang sampai dua kalinya. Simpang gabungan tetap memakai siklus bersamanya.</p>',
        `<p class="analysis-key">${model.greenChanges.length} simpang disetel</p>
<table class="mini"><thead><tr><th>Simpang</th><th>Hijau habis</th><th>Hijau sebelum (dtk)</th><th>Hijau baru (dtk)</th></tr></thead><tbody>${model.greenChanges.slice(0,6).map(c=>`<tr><td>${esc(c.node)}</td><td>${c.maxouts.map(x=>`${x}%`).join(' · ')}</td><td>${c.before.join(' · ')}</td><td>${c.after.join(' · ')}</td></tr>`).join('')}</tbody></table>`),
      card('Koordinasi antar simpang','<p><strong>Masukan:</strong> kendaraan yang melewati garis henti di simpang hulu dan yang masuk zona kamera simpang berikutnya, per 5 detik.</p><p><strong>Belajar:</strong> jeda waktu dengan korelasi tertinggi antara keduanya (waktu tempuh) dan berapa bagian yang sampai.</p><p><strong>Dipakai untuk:</strong> lampu hilir menahan hijau beberapa detik bila rombongan dari hulu diperkirakan tiba. Hanya pasangan dengan waktu tempuh 10 detik atau lebih; rombongan yang lebih dekat sudah terlihat kamera hilir.</p>',
        `<p class="analysis-key">${model.links.length} pasangan simpang terhubung</p>
<table class="mini"><thead><tr><th>Hulu → hilir</th><th>Jarak</th><th>Waktu tempuh</th><th>Bagian tiba</th></tr></thead><tbody>${model.links.slice(0,6).map(l=>`<tr><td>${esc(l.from)} → ${esc(l.node)}</td><td>${fmt(l.distance)} m</td><td>${l.travel} dtk</td><td>${fmt(l.share*100)}%</td></tr>`).join('')}</tbody></table>`),
      card('Prediksi isi tempat sampah','<p><strong>Masukan:</strong> isi tiap tempat sampah per menit, dan lama truk tiba setelah dipanggil.</p><p><strong>Belajar:</strong> laju pengisian tiap tempat sampah dan waktu tiba truk.</p><p><strong>Dipakai untuk:</strong> truk dipanggil lebih awal sehingga tiba saat isi mencapai 80%, bukan baru berangkat saat itu.</p>',
        `<p class="analysis-key">Truk tiba ±${fmt(lead/60,1)} menit setelah dipanggil</p>
<table class="mini"><thead><tr><th>Tempat sampah</th><th>Laju</th><th>Isi kini</th><th>Sampai 80%</th></tr></thead><tbody>${bins.slice(0,6).map(([id,b])=>`<tr><td>${esc(id)}</td><td>${fmt(b.rate*3600*100,1)}% /jam</td><td>${fmt(b.fill*100)}%</td><td>${b.rate>0?(b.fill>=0.8?'sudah':`${fmt((0.8-b.fill)/b.rate/3600,1)} jam`):'—'}</td></tr>`).join('')}</tbody></table>`),
    ].join('');
  }
  function renderEval(){
    const box=$('analysis-eval');
    if(!model){box.innerHTML='';return;}
    const {current,candidate,seconds,days}=model.evaluation;
    const rows=[['Waktu antre',current.queueSeconds+current.backlogSeconds,candidate.queueSeconds+candidate.backlogSeconds,duration,'lower'],
      ['Rata-rata waktu tempuh',current.averageTravel,candidate.averageTravel,x=>`${fmt(x)} dtk`,'lower'],
      ['Perjalanan selesai',current.completed,candidate.completed,x=>fmt(x),'higher'],
      ['Tempat sampah penuh',current.binFullSeconds,candidate.binFullSeconds,duration,'lower']];
    box.innerHTML=rows.map(([k,x,y,f,better])=>{
      const d=x>0?Math.round((y-x)/x*100):0,good=better==='lower'?d<0:d>0;
      return `<div class="metric"><span class="metric-name">${k}${d?`<span class="delta ${good?'good':'bad'}">${d>0?'+':''}${d}%</span>`:''}</span><dl><dt>Dipakai</dt><dd>${f(x)}</dd><dt>Model baru</dt><dd>${f(y)}</dd></dl><small>Rata-rata ${days} hari uji × ${fmt(seconds/3600)} jam</small></div>`;
    }).join('');
  }
  function renderHistory(){
    $('analysis-history-wrap').hidden=!history.length;
    $('analysis-history').innerHTML=history.map(h=>`<tr><th scope="row">${h.round}</th><td>${fmt(h.minutes)} mnt</td><td>${duration(h.before)} → ${duration(h.after)}</td><td>${h.adopted?'Dipakai':'Ditolak (tidak lebih baik ≥2%)'}</td></tr>`).join('');
    $('analysis-reset').hidden=!model;
    $('analysis-status').textContent=!model?'Belum ada model; kota cerdas memakai aturan dasar.'
      :applied?`Putaran ${model.round} · ${fmt(model.minutes)} menit data · kota cerdas memakai model.`:`Putaran ${model.round} · ${fmt(model.minutes)} menit data · model belum lebih baik, kota cerdas tetap memakai aturan dasar.`;
  }
  function render(){renderHistory();renderEval();renderModels();}

  function run(){
    if(worker)return;
    const ctx=getContext();if(!ctx)return;
    if(key&&key!==ctx.key){model=null;applied=null;history=[];}   // another map: start over
    key=ctx.key;
    const hours=Number($('analysis-hours').value)||2;
    worker=new Worker(new URL('../analysis/worker.js',import.meta.url),{type:'module'});
    $('analysis-run').disabled=true;$('analysis-progress').hidden=false;
    const bar=$('analysis-progress').querySelector('i'),label=$('analysis-progress').querySelector('span');
    worker.onmessage=({data})=>{
      if(data.type==='progress'){bar.style.width=`${Math.round((data.stage==='collect'?data.fraction*0.6:data.stage==='train'?0.62:0.62+data.fraction*0.38)*100)}%`;label.textContent=STAGES[data.stage];return;}
      worker.terminate();worker=null;$('analysis-run').disabled=false;$('analysis-progress').hidden=true;
      if(data.type==='error'){$('analysis-status').textContent=`Gagal: ${data.message}`;return;}
      model=data.model;
      const ev=model.evaluation,cost=r=>r.queueSeconds+r.backlogSeconds;
      history.push({round:model.round,minutes:model.minutes,before:cost(ev.current),after:cost(ev.candidate),adopted:model.adopted});
      if(model.adopted){applied=model.learned;onApply(applied);}
      render();
    };
    worker.postMessage({map:ctx.map,options:ctx.options,collectSeconds:hours*3600,evalSeconds:3600,previous:model&&{...model,evaluation:undefined},applied});
  }
  $('analysis-run').onclick=run;
  $('analysis-reset').onclick=()=>{model=null;applied=null;history=[];onApply(null);render();};
  render();
  return {
    // The learned model for the smart city on this map (null: rules only).
    learnedFor(mapKey){return mapKey===key?applied:null;},
    get model(){return model;},
  };
}
