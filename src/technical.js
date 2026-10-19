import {DEVICES,ZONES,SHORT_NAMES,linksOf,networkLinks} from './devices.js';
const FIELDS=[['count','Jumlah'],['role','Fungsi'],['hardware','Perangkat keras'],['os','Sistem operasi'],['software','Perangkat lunak'],['protocol','Koneksi & protokol']];
const byId=Object.fromEntries(DEVICES.map(d=>[d.id,d]));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const diagram=document.getElementById('device-diagram'),detail=document.getElementById('device-detail');
diagram.innerHTML=ZONES.map(([zone,label])=>`<div class="zone zone-${zone}"><h3>${label}</h3>${DEVICES.filter(d=>d.zone===zone).map(d=>`<button type="button" class="device" data-id="${d.id}" aria-pressed="false" aria-controls="device-detail"><i aria-hidden="true">${d.icon}</i><span>${esc(d.name)}</span><small>${esc(d.count)}</small></button>`).join('')}</div>`).join('');

function select(id){
  const d=byId[id],links=linksOf(id);
  for(const b of diagram.querySelectorAll('.device')){
    b.setAttribute('aria-pressed',String(b.dataset.id===id));
    b.classList.toggle('linked',links.some(l=>l.other===b.dataset.id));
  }
  detail.innerHTML=`<h3><i aria-hidden="true">${d.icon}</i>${esc(d.name)}</h3><dl>${FIELDS.map(([k,label])=>`<dt>${label}</dt><dd>${esc(d[k])}</dd>`).join('')}<dt>Terhubung ke</dt><dd class="device-links">${links.map(l=>`<button type="button" data-id="${l.other}">${esc(byId[l.other].name)}</button>`).join('')}</dd><dt>Jaringan</dt><dd><ul class="device-networks">${links.map(l=>`<li><strong>${esc(SHORT_NAMES[l.other])}${l.who?` (${esc(l.who)})`:''}:</strong> ${esc(l.network.label)}</li>`).join('')}</ul></dd></dl>`;
}
document.addEventListener('click',e=>{
  const b=e.target.closest('#device-diagram [data-id], #device-detail [data-id]');
  if(b)select(b.dataset.id);
});
select('gw');

// One row per network type, listing every link that uses it.
const byNetwork=new Map();
// Grouped by name, so both fibre uses share one row.
for(const l of networkLinks()){const key=l.network.label;if(!byNetwork.has(key))byNetwork.set(key,{label:key,details:new Set(),links:[]});const g=byNetwork.get(key);g.details.add(l.network.detail);g.links.push(`${SHORT_NAMES[l.from]}${l.who?` (${l.who})`:''} → ${SHORT_NAMES[l.to]}`);}
document.getElementById('network-table').innerHTML=`<table><thead><tr><th>Jaringan</th><th>Dipakai untuk</th><th>Keterangan</th></tr></thead><tbody>${[...byNetwork.values()].map(g=>`<tr><td><strong>${esc(g.label)}</strong></td><td>${g.links.map(esc).join('<br>')}</td><td>${[...g.details].map(esc).join(' ')}</td></tr>`).join('')}</tbody></table>`;
