import {DEVICE_ICONS} from '../map/network.js';
import {gatewayOf} from '../map/placement.js';
import {deviceReadings,deviceLinks} from '../map/device-info.js';
import {DEVICES,PROCESSES} from '../devices.js';

// "Perangkat" tab: the 3D device-flow diagram plus a live list of every device placed in the
// smart city. Readings come from the simulation, standing in for real devices.
const esc=text=>String(text).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Map assets → the device catalogue (devices.js) used by the diagram and the design page.
export const CATALOGUE={'cctv-dome':'cam',cctv:'cam','bin-sensor':'ultra',controller:'ctrl',gateway:'gw'};

function status(o,city){
  const e=city.engine;
  if(o.asset==='bin-sensor'){const b=e.bins.find(x=>x.id===o.id);if(!b)return ['Tidak terjangkau','warn'];return b.fill>=1?['Penuh','bad']:b.fill>=0.8?['Perlu dijemput','warn']:['Normal','ok'];}
  if(o.asset==='cctv-dome'||o.asset==='cctv'){const s=e.sensorState(o.id);return !s?['Tidak memantau','warn']:s.stopped>=3?['Antre','warn']:['Lancar','ok'];}
  return ['Aktif','ok'];
}
// Where a device stands: by the nearest junction (or lot).
function locationOf(o,city){
  let best=null;
  for(const j of city.geometry.junctions){const d=Math.hypot(j.x-o.x,j.z-o.z);if(!best||d<best.d)best={d,label:`dekat simpang ${j.id}`};}
  const lot=city.map.lots.find(l=>o.x>=l.x-25&&o.x<=l.x+l.w+25&&o.z>=l.z-25&&o.z<=l.z+l.d+25);
  if(lot&&(!best||best.d>30))return `kawasan ${lot.name}`;
  return best?.label||`x ${Math.round(o.x)}, z ${Math.round(o.z)}`;
}

export function createEquipmentView({root,getCity,onShowOnMap}){
  let filter='all',selected=null,rows=[],opened=false;
  root.innerHTML=`<section class="equipment-block"><div class="equipment-head"><h3>Alur perangkat 3D</h3><a href="./diagram-3d.html" target="_blank" rel="noopener">Buka layar penuh ↗</a></div>
<iframe id="equipment-diagram" title="Diagram 3D alur perangkat" loading="lazy"></iframe></section>
<section class="equipment-block"><div class="equipment-head"><h3>Daftar perangkat</h3><span id="equipment-total"></span></div>
<div class="equipment-filters" role="group" aria-label="Saring jenis perangkat" id="equipment-filters"></div>
<div class="equipment-body"><div class="equipment-table-wrap"><table class="equipment-table"><thead><tr><th scope="col">Perangkat</th><th scope="col">Lokasi</th><th scope="col">Gateway</th><th scope="col">Pembacaan</th><th scope="col">Status</th></tr></thead><tbody id="equipment-rows"></tbody></table></div>
<aside id="equipment-detail" class="equipment-detail" aria-live="polite"></aside></div>
<p class="hint">Daftar ini adalah perangkat yang terpasang di peta kota cerdas. Pembacaan berasal dari simulasi sebagai pengganti data perangkat; perangkat belum terpasang di lapangan.</p></section>`;
  const $=id=>root.querySelector(`#${id}`);
  const devices=()=>{const c=getCity();return c?.map?c.map.objects.filter(o=>DEVICE_ICONS[o.asset]):[];};
  const reading=(o,c)=>deviceReadings(c.engine,c.network,o).slice(0,2).map(([k,v])=>`${k}: ${v}`).join(' · ');

  function buildFilters(){
    const all=devices(),kinds=Object.entries(DEVICE_ICONS).filter(([k])=>all.some(o=>o.asset===k));
    $('equipment-filters').innerHTML=`<button type="button" data-filter="all" aria-pressed="${filter==='all'}">Semua · ${all.length}</button>`
      +kinds.map(([k,v])=>`<button type="button" data-filter="${k}" aria-pressed="${filter===k}"><i style="background:${v.color}"></i>${v.label} · ${all.filter(o=>o.asset===k).length}</button>`).join('');
  }
  function buildRows(){
    const c=getCity();if(!c?.engine)return;
    const list=devices().filter(o=>filter==='all'||o.asset===filter);
    $('equipment-total').textContent=`${list.length} perangkat ditampilkan`;
    $('equipment-rows').innerHTML=list.map((o,i)=>{const icon=DEVICE_ICONS[o.asset],[st,cls]=status(o,c),gw=gatewayOf(c.map,o);
      return `<tr data-index="${i}" class="${o.id===selected?'selected':''}"><th scope="row"><button type="button" data-index="${i}"><i style="background:${icon.color}">${icon.glyph}</i>${esc(icon.label)} · ${esc(o.id)}</button></th><td>${esc(locationOf(o,c))}</td><td>${esc(gw?.id??'—')}</td><td class="reading">${esc(reading(o,c))}</td><td><span class="status ${cls}">${esc(st)}</span></td></tr>`;}).join('');
    rows=[...$('equipment-rows').querySelectorAll('tr')].map((tr,i)=>({o:list[i],reading:tr.querySelector('.reading'),status:tr.querySelector('.status')}));
  }
  function renderDetail(){
    const box=$('equipment-detail'),c=getCity(),o=selected&&c?.map.objects.find(x=>x.id===selected);
    if(!o){box.innerHTML='<p class="equipment-empty">Pilih perangkat di daftar untuk melihat pembacaan, alur data, dan isinya.</p>';return;}
    const icon=DEVICE_ICONS[o.asset],spec=DEVICES.find(d=>d.id===CATALOGUE[o.asset]),links=deviceLinks(c.network,c.map,o.id);
    const flow=o.asset==='data-center'?['Gateway','Jaringan kota (fiber)','Pusat data']:o.asset==='gateway'?['Perangkat sekitar','Gateway','Pusat data']:o.asset==='controller'?['Gateway','Pengendali','Kepala lampu']:[icon.label,'Gateway','Pusat data'];
    box.innerHTML=`<p class="device-card-kind" style="color:${icon.color}">${esc(icon.label)}</p><h3>${esc(o.id)} · ${esc(locationOf(o,c))}</h3>
<dl class="device-card-readings">${deviceReadings(c.engine,c.network,o).map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
<h4>Alur data</h4><p>${flow.map(esc).join(' → ')}</p>
<h4>Jaringan</h4><ul class="device-card-networks">${links.length?links.map(l=>`<li><strong>${esc(l.direction)} ${esc(l.otherLabel)} ${esc(l.other)}:</strong> ${esc(l.label)} (${esc(l.latency)})</li>`).join(''):'<li>Belum tersambung</li>'}</ul>
${spec?`<h4>Isi perangkat</h4><dl class="device-card-spec"><dt>Perangkat</dt><dd>${esc(spec.name)}</dd><dt>Perangkat keras</dt><dd>${esc(spec.hardware)}</dd><dt>Sistem operasi</dt><dd>${esc(spec.os)}</dd><dt>Perangkat lunak</dt><dd>${esc(spec.software)}</dd></dl>
<details><summary>Proses yang dijalankan</summary><ol>${(PROCESSES[spec.id]||[]).map(p=>`<li>${esc(p)}</li>`).join('')}</ol></details>`:''}
<div class="device-card-actions"><button type="button" class="device-card-zoom" id="equipment-show">Lihat di peta</button></div>`;
    $('equipment-show').onclick=()=>onShowOnMap(o);
  }
  root.addEventListener('click',event=>{
    const chip=event.target.closest('[data-filter]');
    if(chip){filter=chip.dataset.filter;buildFilters();buildRows();return;}
    const row=event.target.closest('#equipment-rows tr');
    if(row){selected=rows[+row.dataset.index].o.id;for(const r of root.querySelectorAll('#equipment-rows tr'))r.classList.toggle('selected',r===row);renderDetail();}
  });
  return {
    open(){
      if(!opened){opened=true;$('equipment-diagram').src='./diagram-3d.html?embed=1';}
      buildFilters();buildRows();renderDetail();
    },
    // Live values change in place so focus, scroll and open sections survive.
    refresh(){
      const c=getCity();if(!c?.engine)return;
      for(const r of rows){const text=reading(r.o,c),[st,cls]=status(r.o,c);
        if(r.reading.textContent!==text)r.reading.textContent=text;
        if(r.status.textContent!==st){r.status.textContent=st;r.status.className=`status ${cls}`;}}
      const list=$('equipment-detail').querySelector('.device-card-readings'),o=selected&&c.map.objects.find(x=>x.id===selected);
      if(o&&list){const html=deviceReadings(c.engine,c.network,o).map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');if(list.innerHTML!==html)list.innerHTML=html;}
    },
    reset(){selected=null;filter='all';},
  };
}
