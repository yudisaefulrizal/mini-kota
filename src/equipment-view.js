import {DEVICE_KINDS} from './device-overlay.js';

// "Perangkat" tab: the 3D device-flow diagram plus a live list of every planned
// device in the smart city. Readings come from the simulation, not hardware.
const esc=text=>String(text).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function summary(site,d){
  const rows=d.rows,value=label=>rows.find(([k])=>k===label)?.[1];
  const reading=site.kind==='gw'?`${rows.at(-1)[0]}: ${rows.at(-1)[1]}`:rows.slice(0,2).map(([k,v])=>`${k}: ${v}`).join(' · ');
  let status=['Aktif','ok'];
  if(site.kind==='queue')status=value('Berhenti (< 0,3 m/detik)')>=3?['Antre','warn']:['Lancar','ok'];
  else if(site.kind==='gate'||site.kind==='road')status=value('Berhenti')>0?['Ada yang berhenti','warn']:['Lancar','ok'];
  else if(site.kind==='waste')status=value('Status')==='Perlu dijemput'?['Perlu dijemput','bad']:['Normal','ok'];
  return {reading,status};
}

export function createEquipmentView({root,overlay,getCity,getSampleSeconds,onShowOnMap}){
  const counts=overlay.counts();let filter='all',selected=null,rows=[],opened=false;
  root.innerHTML=`<section class="equipment-block"><div class="equipment-head"><h3>Alur perangkat 3D</h3><a href="./diagram-3d.html" target="_blank" rel="noopener">Buka layar penuh ↗</a></div>
<iframe id="equipment-diagram" title="Diagram 3D alur perangkat" loading="lazy"></iframe></section>
<section class="equipment-block"><div class="equipment-head"><h3>Daftar perangkat</h3><span id="equipment-total"></span></div>
<div class="equipment-filters" role="group" aria-label="Saring jenis perangkat"><button type="button" data-filter="all" aria-pressed="true">Semua · ${overlay.sites.length}</button>${Object.entries(DEVICE_KINDS).map(([k,v])=>`<button type="button" data-filter="${k}" aria-pressed="false"><i style="background:${v.color}"></i>${v.label} · ${counts[k]}</button>`).join('')}</div>
<div class="equipment-body"><div class="equipment-table-wrap"><table class="equipment-table"><thead><tr><th scope="col">Perangkat</th><th scope="col">Lokasi</th><th scope="col">Gateway</th><th scope="col">Pembacaan</th><th scope="col">Status</th></tr></thead><tbody id="equipment-rows"></tbody></table></div>
<aside id="equipment-detail" class="equipment-detail" aria-live="polite"></aside></div>
<p class="hint">Pembacaan berasal dari model simulasi kota cerdas sebagai pengganti data perangkat; perangkat belum terpasang.</p></section>`;
  const $=id=>root.querySelector(`#${id}`);

  function buildRows(){
    const city=getCity(),sample=getSampleSeconds();
    const list=overlay.sites.filter(s=>filter==='all'||s.kind===filter);
    $('equipment-total').textContent=`${list.length} perangkat ditampilkan`;
    $('equipment-rows').innerHTML=list.map((s,i)=>{const d=overlay.describe(s,city,sample),{reading,status}=summary(s,d);
      return `<tr data-index="${i}" class="${s===selected?'selected':''}"><th scope="row"><button type="button" data-index="${i}"><i style="background:${d.kind.color}">${d.kind.glyph}</i>${esc(d.kind.label)}</button></th><td>${esc(d.location)}</td><td>${esc(d.gateway??'—')}</td><td class="reading">${esc(reading)}</td><td><span class="status ${status[1]}">${esc(status[0])}</span></td></tr>`;}).join('');
    rows=[...$('equipment-rows').querySelectorAll('tr')].map((tr,i)=>({site:list[i],reading:tr.querySelector('.reading'),status:tr.querySelector('.status')}));
  }
  function renderDetail(){
    const box=$('equipment-detail');
    if(!selected){box.innerHTML='<p class="equipment-empty">Pilih perangkat di daftar untuk melihat pembacaan, alur data, dan isinya.</p>';return;}
    const d=overlay.describe(selected,getCity(),getSampleSeconds());
    box.innerHTML=`<p class="device-card-kind" style="color:${d.kind.color}">${esc(d.kind.label)}</p><h3>${esc(d.location)}</h3>
<dl class="device-card-readings">${d.rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
<h4>Alur data</h4><p>${d.flow.filter(Boolean).map(esc).join(' → ')}</p>
<h4>Jaringan</h4><ul class="device-card-networks">${d.networks.map(n=>`<li><strong>${esc(n.to)}:</strong> ${esc(n.label)}</li>`).join('')}</ul>
<h4>Isi perangkat</h4><dl class="device-card-spec"><dt>Perangkat</dt><dd>${esc(d.device.name)}</dd><dt>Perangkat keras</dt><dd>${esc(d.device.hardware)}</dd><dt>Sistem operasi</dt><dd>${esc(d.device.os)}</dd><dt>Perangkat lunak</dt><dd>${esc(d.device.software)}</dd></dl>
<details><summary>Proses yang dijalankan</summary><ol>${d.process.map(p=>`<li>${esc(p)}</li>`).join('')}</ol></details>
<div class="device-card-actions"><button type="button" class="device-card-zoom" id="equipment-show">Lihat di peta</button></div>`;
    $('equipment-show').onclick=()=>onShowOnMap(selected);
  }
  root.addEventListener('click',event=>{
    const chip=event.target.closest('[data-filter]');
    if(chip){filter=chip.dataset.filter;for(const b of root.querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b===chip));buildRows();return;}
    const row=event.target.closest('#equipment-rows tr');
    if(row){selected=rows[+row.dataset.index].site;for(const r of root.querySelectorAll('#equipment-rows tr'))r.classList.toggle('selected',r===row);renderDetail();}
  });

  return {
    open(){
      if(!opened){opened=true;$('equipment-diagram').src='./diagram-3d.html?embed=1';}
      buildRows();renderDetail();
    },
    // Live values change in place so focus, scroll and open sections survive.
    refresh(){
      const city=getCity(),sample=getSampleSeconds();
      for(const r of rows){const {reading,status}=summary(r.site,overlay.describe(r.site,city,sample));
        if(r.reading.textContent!==reading)r.reading.textContent=reading;
        if(r.status.textContent!==status[0]){r.status.textContent=status[0];r.status.className=`status ${status[1]}`;}}
      const list=$('equipment-detail').querySelector('.device-card-readings');
      if(selected&&list){const html=overlay.describe(selected,city,sample).rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');if(list.innerHTML!==html)list.innerHTML=html;}
    },
  };
}
