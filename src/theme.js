// Light or dark theme, shared by every page. "Otomatis" follows the system; a choice made with
// the theme button is remembered in this browser. Colours live in theme.css; 3D views listen
// with onThemeChange to recolour their background.
const KEY='miniKota.theme',ORDER=['auto','light','dark'];
const NAMES={auto:'Tema: otomatis',light:'Tema: terang',dark:'Tema: gelap'};
const media=matchMedia('(prefers-color-scheme: dark)');

export function themePreference(){
  try{const t=localStorage.getItem(KEY);return ORDER.includes(t)?t:'auto';}catch{return 'auto';}
}
export function isDark(){const p=themePreference();return p==='dark'||(p==='auto'&&media.matches);}

function apply(){
  const p=themePreference(),root=document.documentElement;
  if(p==='auto')delete root.dataset.theme;else root.dataset.theme=p;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',isDark()?'#101815':'#173b37');
  for(const b of document.querySelectorAll('.theme-toggle')){b.textContent=NAMES[p];b.title='Klik untuk mengganti: otomatis (ikut sistem), terang, gelap';}
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
media.addEventListener('change',apply);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
