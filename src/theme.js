// Light or dark theme, shared by every page. Light unless chosen otherwise; a choice made with
// the theme button is remembered in this browser. Colours live in theme.css; 3D views listen
// with onThemeChange to recolour their background.
const KEY='miniKota.theme',ORDER=['light','dark'];
const NAMES={light:'Tema: terang',dark:'Tema: gelap'};

export function themePreference(){
  try{const t=localStorage.getItem(KEY);return ORDER.includes(t)?t:'light';}catch{return 'light';}
}
export function isDark(){return themePreference()==='dark';}

function apply(){
  const p=themePreference(),root=document.documentElement;
  root.dataset.theme=p;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',isDark()?'#101815':'#173b37');
  for(const b of document.querySelectorAll('.theme-toggle')){b.textContent=NAMES[p];b.title='Klik untuk mengganti: terang atau gelap';}
  dispatchEvent(new CustomEvent('themechange',{detail:{dark:isDark()}}));
}
export function setTheme(p){try{localStorage.setItem(KEY,p);}catch{}apply();}
// Calls fn(dark) now and whenever the theme changes.
export function onThemeChange(fn){addEventListener('themechange',e=>fn(e.detail.dark));fn(isDark());}

// The button goes where the page marks a slot, otherwise in a corner.
function mount(){
  const b=document.createElement('button');b.type='button';b.className='theme-toggle';
  b.onclick=()=>setTheme(ORDER[(ORDER.indexOf(themePreference())+1)%ORDER.length]);
  const slot=document.querySelector('[data-theme-slot]');
  if(slot)slot.append(b);else{b.classList.add('floating');document.body.append(b);}
  apply();
}
// "!" buttons (details.tip): one open at a time; a click elsewhere or Esc closes it.
document.addEventListener('click',e=>{for(const t of document.querySelectorAll('details.tip[open]'))if(!t.contains(e.target))t.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const t of document.querySelectorAll('details.tip[open]'))t.open=false;});
document.addEventListener('toggle',e=>{if(e.target.matches?.('details.tip')&&e.target.open)for(const t of document.querySelectorAll('details.tip[open]'))if(t!==e.target)t.open=false;},true);
// The same button from script: tip('<p>…</p>', 'left up').
export const tip=(html,place='')=>`<details class="tip ${place}"><summary aria-label="Keterangan" title="Keterangan">!</summary><div class="tip-body">${html}</div></details>`;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
