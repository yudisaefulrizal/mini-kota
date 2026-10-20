import {tip} from '../theme.js';
import {recorder,chooseSetting,compose,MODELS,STEP,BASE_SETTING} from '../analysis/learn.js';
import {firstMorning,masehi,hijriah,clockText} from '../analysis/calendar.js';
import * as store from '../analysis/store.js';

// "Analisis" tab: the smart city learns from its own history (see tujuan-analisis.md).
// While it runs, a record is taken every 5 s and kept in this browser (IndexedDB). Every
// "periode latih" records (or on Latih sekarang) six models are trained on the history in a
// worker (src/analysis/worker.js) and applied straight away to the running city; Bayesian
// optimization then picks the light and truck settings for the moment, every 15 minutes.
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(n,d=0)=>Number(n).toLocaleString('id-ID',{maximumFractionDigits:d});
const when=t=>`${masehi(t)} ${clockText(t)}`;
const NAMES={arus:'Prediksi arus per arah',isi:'Prediksi isi tempat sampah',tempuh:'Prediksi waktu tempuh antar simpang',hijau:'Optimasi durasi hijau per fase',tahan:'Optimasi penahanan hijau',truk:'Optimasi waktu pemanggilan truk'};
const POLICY_EVERY=180;   // records between setting choices (15 minutes)
const SETTINGS_KEY='mini-kota-analisis-input';
const DEFAULTS={auto:true,period:17280,range:0};

function newRegistry(key){
  return {key,count:0,firstT:null,lastT:null,nextSeq:0,chunks:[],sinceTrain:0,
    versions:Object.fromEntries(MODELS.map(m=>[m,0])),params:{},setting:{...BASE_SETTING},
    settingLog:{hijau:{0:{scale:1}},tahan:{0:{horizon:0}},truk:{0:{tau:null}}},trainings:[]};
}

export function createAnalysisView({root,onApplied=()=>{}}){
  let reg=null,rec=null,engine=null,ctx=null,worker=null,writing=Promise.resolve(),sincePolicy=0,summary=null;
  let input={...DEFAULTS};
  try{input={...DEFAULTS,...JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')};}catch{}
  const saveInput=()=>{try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(input));}catch{}};

  root.innerHTML=`<section class="equipment-block"><div class="equipment-head"><h3>Siklus belajar${tip(`<p>Selama kota cerdas berjalan, setiap 5 detik dicatat satu data: satu baris per kamera (arah), per simpang, per tempat sampah, dan satu baris kota. Setiap baris diberi waktu, label jam, tanggal Masehi dan Hijriah, serta versi tiap model yang sedang dipakai. Histori disimpan di browser ini (IndexedDB), per peta, dan tetap ada setelah halaman dimuat ulang.</p><p>Setiap <em>periode latih</em> data baru (atau lewat Latih sekarang), enam model dilatih dari histori dalam <em>rentang data latih</em> lalu langsung dipakai kota cerdas yang sedang berjalan, tanpa uji dan tanpa memulai ulang. Setelan lampu dan truk dipilih Bayesian optimization setiap 15 menit sesuai jam dan tanggalnya.</p><p>Tidak ada data per kendaraan: hanya hitungan.</p>`)}</h3><span id="analysis-status" class="analysis-status"></span></div>
<p id="analysis-history-size" class="analysis-history-size"></p>
<div class="analysis-controls">
<label class="check"><input type="checkbox" id="analysis-auto"> Latih otomatis</label>
<label>Periode latih <input type="number" id="analysis-period" min="1" step="1"> data</label>
<label>Rentang data latih <input type="number" id="analysis-range" min="0" step="1"> data${tip('<p>Jumlah data terakhir yang dipakai melatih. 0 = semua histori.</p>')}</label>
</div>
<div class="analysis-controls">
<button type="button" id="analysis-run" class="analysis-run">Latih sekarang</button>
<button type="button" id="analysis-base" class="analysis-reset">Kembali ke aturan dasar</button>
<button type="button" id="analysis-clear" class="analysis-reset">Hapus histori</button>
</div>
<div id="analysis-progress" class="analysis-progress" hidden><div><i></i></div><span>Melatih model dari histori</span></div>
<div class="comparison-table-wrap" id="analysis-trainings-wrap" hidden><table class="comparison-table analysis-history"><thead><tr><th scope="col">Waktu</th><th scope="col">Data dipakai</th><th scope="col">Model diperbarui</th></tr></thead><tbody id="analysis-trainings"></tbody></table></div></section>
<section class="analysis-models" id="analysis-models"></section>`;
  const $=id=>root.querySelector(`#${id}`);
  $('analysis-auto').checked=input.auto;$('analysis-period').value=input.period;$('analysis-range').value=input.range;
  $('analysis-auto').onchange=e=>{input.auto=e.target.checked;saveInput();refresh();};
  for(const [id,k] of [['analysis-period','period'],['analysis-range','range']])$(id).onchange=e=>{const v=Math.max(k==='period'?1:0,Math.round(Number(e.target.value)||0));e.target.value=v;input[k]=v;saveInput();refresh();};

  const versions=()=>MODELS.map(m=>reg.versions[m]);
  const persist=()=>{const meta=reg;writing=writing.then(()=>store.putMeta(meta)).catch(()=>{});};
  function append(chunk){
    if(!chunk)return;
    const seq=reg.nextSeq++;reg.chunks.push([seq,chunk.n]);
    const meta=reg;writing=writing.then(()=>store.putChunk(meta,{...chunk,seq})).catch(()=>{});
  }
  const flush=()=>{if(rec&&reg){const p=rec.flush();if(p){reg.count+=p.n;append(p);}}};

  // Applies the params and this moment's setting to the running city.
  function apply(t=rec?.time){
    if(!engine)return;
    const next=Object.keys(reg.params).length?chooseSetting(reg.params,t):{...BASE_SETTING};
    const bump=(m,log)=>{reg.versions[m]++;reg.settingLog[m][reg.versions[m]]=log;};
    if(next.scale!==reg.setting.scale)bump('hijau',{scale:next.scale});
    if(next.horizon!==reg.setting.horizon)bump('tahan',{horizon:next.horizon});
    if(next.tau!==reg.setting.tau)bump('truk',{tau:next.tau});
    reg.setting=next;
    const learned=compose(reg.params,next,t);
    engine.setLearned(learned);onApplied(learned);
  }

  // The chunks within the range (0: all), newest last; the partial chunk counts too.
  function selection(){
    const partial=rec?.partial(),want=input.range||Infinity,seqs=[];let n=partial?.n||0;
    for(let i=reg.chunks.length-1;i>=0&&n<want;i--){seqs.unshift(reg.chunks[i][0]);n+=reg.chunks[i][1];}
    return {seqs,partial,total:n};
  }
  async function trainNow(){
    if(worker||!reg||!(reg.count+(rec?.n||0)))return;
    worker=true;$('analysis-run').disabled=true;
    await writing;
    const {seqs,partial,total}=selection(),key=reg.key;
    worker=new Worker(new URL('../analysis/worker.js',import.meta.url),{type:'module'});
    $('analysis-progress').hidden=false;const bar=$('analysis-progress').querySelector('i');bar.style.width='0%';
    worker.onmessage=({data})=>{
      if(data.type==='progress'){bar.style.width=`${Math.round(data.fraction*100)}%`;return;}
      worker.terminate();worker=null;$('analysis-progress').hidden=true;refresh();
      if(data.type==='error'){$('analysis-status').textContent=`Gagal melatih: ${data.message}`;return;}
      if(!reg||reg.key!==key)return;   // the map changed meanwhile
      const {params,summary:s,records}=data.out,updated=[];
      for(const m of ['arus','isi','tempuh','hijau','truk'])if(params[m]){
        reg.params[m]=params[m];
        if(m!=='truk'){reg.versions[m]++;if(m==='hijau')reg.settingLog.hijau[reg.versions.hijau]={scale:reg.setting.scale};}
        updated.push(m);
      }
      summary=s;reg.sinceTrain=0;
      reg.trainings.unshift({t:rec?.time??reg.lastT,records,updated});reg.trainings=reg.trainings.slice(0,50);
      apply();persist();render();
    };
    worker.postMessage({map:ctx.map,options:ctx.options,key,seqs,partial,reg:{params:reg.params,settingLog:reg.settingLog},total});
  }

  function card(m,about,body){
    const used=reg?.params?.[m==='tahan'?'hijau':m];
    return `<article class="equipment-block analysis-model"><div class="equipment-head"><h3>${NAMES[m]}${tip(about)}</h3><span class="analysis-status">${used?`versi ${reg.versions[m]}`:'belum dilatih'}</span></div>${used?body:''}</article>`;
  }
  function renderModels(){
    const box=$('analysis-models'),p=reg?.params||{},s=summary||{},set=reg?.setting||BASE_SETTING;
    const arus=[...(s.arus||[])].sort((a,b)=>b.next-a.next).slice(0,5),bins=Object.keys(p.isi?.bins||{}).slice(0,6);
    box.innerHTML=[
      card('arus','<p><strong>Metode:</strong> Gradient Boosted Trees (regresi).</p><p><strong>Data:</strong> kendaraan lewat garis henti dan di zona kamera, per arah; label jam, Masehi, Hijriah.</p><p>Memperkirakan kendaraan yang datang per arah dalam 15 menit, dari label waktunya dan dua 15 menit sebelumnya.</p>',
        `<p class="analysis-key">${Object.keys(p.arus?.cams||{}).length} arah</p>${arus.length?`<table class="mini"><thead><tr><th>Kamera</th><th>Simpang</th><th>15 mnt sebelumnya</th><th>Prediksi 15 mnt ini</th></tr></thead><tbody>${arus.map(a=>`<tr><td>${esc(a.id)}</td><td>${esc(a.node)}</td><td>${fmt(a.last)}</td><td>${fmt(a.next)}</td></tr>`).join('')}</tbody></table>`:''}`),
      card('isi','<p><strong>Metode:</strong> regresi linear.</p><p><strong>Data:</strong> isi tempat sampah; label jam, Masehi, Hijriah.</p><p>Memperkirakan laju pengisian tiap tempat sampah, dan lama truk tiba setelah dipanggil.</p>',
        `<p class="analysis-key">Truk tiba ±${fmt((p.isi?.lead||0)/60,1)} menit setelah dipanggil</p><table class="mini"><thead><tr><th>Tempat sampah</th><th>Laju</th><th>Isi terakhir</th></tr></thead><tbody>${bins.map(id=>{const b=engine?.learned?.bins?.[id],f=s.isi?.fill?.[id];return `<tr><td>${esc(id)}</td><td>${b?`${fmt(b.rate*3600*100,1)}% /jam`:'—'}</td><td>${f!=null?`${fmt(f*100)}%`:'—'}</td></tr>`;}).join('')}</tbody></table>`),
      card('tempuh','<p><strong>Metode:</strong> korelasi silang.</p><p><strong>Data:</strong> kendaraan lewat garis henti di simpang hulu dan yang masuk zona kamera simpang hilir (paling banyak 2 hari data terakhir).</p><p>Jeda dengan korelasi tertinggi = waktu tempuh. Hanya pasangan dengan waktu tempuh 10 detik atau lebih.</p>',
        `<p class="analysis-key">${(p.tempuh?.links||[]).length} pasangan simpang</p><table class="mini"><thead><tr><th>Hulu → hilir</th><th>Jarak</th><th>Waktu tempuh</th><th>Bagian tiba</th></tr></thead><tbody>${(p.tempuh?.links||[]).slice(0,6).map(l=>`<tr><td>${esc(l.from)} → ${esc(l.node)}</td><td>${fmt(l.distance)} m</td><td>${l.travel} dtk</td><td>${fmt(l.share*100)}%</td></tr>`).join('')}</tbody></table>`),
      card('hijau','<p><strong>Metode:</strong> Bayesian optimization (Gaussian process, batas bawah keyakinan).</p><p><strong>Data:</strong> waktu antre total, fase lampu dan lama hijaunya, hijau yang habis, versi model; label jam, Masehi, Hijriah.</p><p>Bagian hijau tiap fase mengikuti seberapa sering hijaunya habis. Pengali hijau rencana (0,8–1,4) dipilih setiap 15 menit: yang diperkirakan memberi antre per kendaraan terkecil, atau yang hasilnya belum diketahui (supaya terus belajar).</p>',
        `<p class="analysis-key">Pengali hijau ${fmt(set.scale,1)}× · ${p.hijau?.points||0} pengamatan</p><table class="mini"><thead><tr><th>Simpang</th><th>Hijau habis</th><th>Bagian hijau</th></tr></thead><tbody>${(s.hijau?.changes||[]).slice(0,6).map(c=>`<tr><td>${esc(c.node)}</td><td>${c.maxouts.map(x=>x==null?'—':`${x}%`).join(' · ')}</td><td>${c.split.map(x=>fmt(x,2)).join(' · ')}</td></tr>`).join('')}</tbody></table>`),
      card('tahan','<p><strong>Metode:</strong> Bayesian optimization, bersama durasi hijau.</p><p><strong>Data:</strong> waktu antre total, versi model, hasil prediksi waktu tempuh.</p><p>Lampu hilir menahan hijau bila rombongan dari hulu diperkirakan tiba dalam beberapa detik ke depan (0–12 detik, 0 = tidak menahan).</p>',
        `<p class="analysis-key">${set.horizon?`Menahan hijau untuk rombongan dalam ${set.horizon} detik ke depan`:'Tidak menahan hijau'}</p>`),
      card('truk','<p><strong>Metode:</strong> Bayesian optimization.</p><p><strong>Data:</strong> waktu truk dipanggil dan tiba, jumlah perjalanan truk, lama tempat sampah penuh, versi model, hasil prediksi isi.</p><p>Memilih isi tempat sampah saat truk tiba (60–100%). Truk dipanggil lebih awal sesuai prediksi laju isi dan waktu tiba. Dicari lama penuh terkecil tanpa perjalanan truk lebih banyak dari aturan dasar.</p>',
        `<p class="analysis-key">${set.tau!=null?`Truk tiba saat isi ±${fmt(set.tau*100)}%`:'Aturan dasar'} · ${p.truk?.points||0} pengamatan</p>${p.truk?.baseTrips!=null?`<p class="analysis-status">Perjalanan truk aturan dasar: ${fmt(p.truk.baseTrips,1)} per jam</p>`:''}`),
    ].join('');
  }
  function renderTrainings(){
    const list=reg?.trainings||[];
    $('analysis-trainings-wrap').hidden=!list.length;
    $('analysis-trainings').innerHTML=list.slice(0,10).map(x=>`<tr><th scope="row">${when(x.t)}</th><td>${fmt(x.records)} data</td><td>${x.updated.length?x.updated.map(m=>NAMES[m]).join(', '):'—'}</td></tr>`).join('');
  }
  function refresh(){
    if(!reg)return;
    const n=reg.count+(rec?.n||0),t=rec?.time??reg.lastT,first=reg.firstT??t;
    $('analysis-history-size').textContent=n?`Histori: ${fmt(n)} data · ${masehi(first)} – ${masehi(t)} · ${hijriah(first)} – ${hijriah(t)}`:'Histori: 0 data';
    $('analysis-status').textContent=engine?.learned?`Kota cerdas memakai model · ${input.auto?`latih berikutnya dalam ${fmt(Math.max(0,input.period-reg.sinceTrain))} data`:'latih otomatis mati'}`:`Kota cerdas memakai aturan dasar${input.auto?` · latih pertama dalam ${fmt(Math.max(0,input.period-reg.sinceTrain))} data`:''}`;
    $('analysis-run').disabled=!!worker||!n;
  }
  function render(){refresh();renderTrainings();renderModels();}

  $('analysis-run').onclick=()=>trainNow();
  $('analysis-base').onclick=()=>{
    if(!reg)return;
    reg.params={};summary=null;input.auto=false;$('analysis-auto').checked=false;saveInput();
    apply();persist();render();
  };
  $('analysis-clear').onclick=async()=>{
    if(!reg||!confirm('Hapus semua histori dan model untuk peta ini?'))return;
    const key=reg.key;if(worker instanceof Worker)worker.terminate();worker=null;$('analysis-progress').hidden=true;
    rec?.flush();await writing;await store.clear(key).catch(()=>{});
    reg=newRegistry(key);summary=null;apply();render();
  };
  // On leaving the page the records not in a chunk yet are stored too.
  addEventListener('pagehide',flush);

  return {
    // The smart city (re)started on a map: keep its history going. Returns the time (s since
    // 1970) of engine time 0, continuing the history's clock.
    async attach(e,{map,key,options}){
      flush();await writing;
      if(!reg||reg.key!==key){reg=(await store.loadMeta(key))||newRegistry(key);summary=null;}
      engine=e;ctx={map,options};
      const origin=reg.lastT!=null?reg.lastT+STEP:firstMorning();
      rec=recorder(engine,{origin,versions,onChunk:c=>{reg.count+=c.n;append(c);}});
      sincePolicy=0;apply(origin);render();
      return origin;
    },
    // Each simulation step (before it): records, picks settings, trains when due.
    tick(){
      if(!rec?.tick())return;
      const t=rec.time;reg.lastT=t;if(reg.firstT==null)reg.firstT=t;reg.sinceTrain++;
      if(++sincePolicy>=POLICY_EVERY){sincePolicy=0;if(Object.keys(reg.params).length)apply(t);}
      if(input.auto&&reg.sinceTrain>=input.period&&!worker)trainNow();
    },
    refresh,
    get registry(){return reg;},
  };
}
