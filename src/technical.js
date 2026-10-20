import './theme.js';
import {SHORT_NAMES,networkLinks} from './devices.js';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// One row per network type, listing every link that uses it.
const byNetwork=new Map();
// Grouped by name, so both fibre uses share one row.
for(const l of networkLinks()){const key=l.network.label;if(!byNetwork.has(key))byNetwork.set(key,{label:key,details:new Set(),links:[]});const g=byNetwork.get(key);g.details.add(l.network.detail);g.links.push(`${SHORT_NAMES[l.from]}${l.who?` (${l.who})`:''} → ${SHORT_NAMES[l.to]}`);}
document.getElementById('network-table').innerHTML=`<table><thead><tr><th>Jaringan</th><th>Dipakai untuk</th><th>Keterangan</th></tr></thead><tbody>${[...byNetwork.values()].map(g=>`<tr><td><strong>${esc(g.label)}</strong></td><td>${g.links.map(esc).join('<br>')}</td><td>${[...g.details].map(esc).join(' ')}</td></tr>`).join('')}</tbody></table>`;
