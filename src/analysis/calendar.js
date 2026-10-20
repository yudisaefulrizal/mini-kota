// Labels of a history record: the hour, the Gregorian (Masehi) date and the Hijri date, from
// the record's time (seconds since 1970, local time). The Hijri date is the Umm al-Qura
// calendar of the browser (Intl), no library. In the field the start of Ramadan and the
// Eid days follow the government's announcement (sidang isbat), which may differ by a day.
const hijri=new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',{day:'numeric',month:'numeric',year:'numeric'});
const cache=new Map();
// [hour, day, month, year, hijri day, hijri month, hijri year]
export const LABELS=['jam','tanggal','bulan','tahun','tanggalHijriah','bulanHijriah','tahunHijriah'];
export function labels(t){
  const d=new Date(t*1000),key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  let day=cache.get(key);
  if(!day){
    const p=Object.fromEntries(hijri.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,Number.parseInt(x.value,10)]));
    day=[d.getDate(),d.getMonth()+1,d.getFullYear(),p.day,p.month,p.year];
    if(cache.size>400)cache.clear();
    cache.set(key,day);
  }
  return [d.getHours(),...day];
}
// Features of a moment for the models, all within [0,1]: time of day (as a circle), day of
// the week, Gregorian month, Hijri month.
export function context(t){
  const d=new Date(t*1000),l=labels(t),h=(l[0]+d.getMinutes()/60)/24*2*Math.PI;
  return [(Math.sin(h)+1)/2,(Math.cos(h)+1)/2,d.getDay()/6,(l[2]-1)/11,(l[5]-1)/11];
}
// The first moment of the simulation when there is no history yet: today at 06:00.
export function firstMorning(now=new Date()){
  const d=new Date(now.getFullYear(),now.getMonth(),now.getDate(),6,0,0);return Math.floor(d.getTime()/1000);
}
const masehiFmt=new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric'});
const hijriFmt=new Intl.DateTimeFormat('id-ID-u-ca-islamic-umalqura',{day:'numeric',month:'long',year:'numeric'});
export const masehi=t=>masehiFmt.format(new Date(t*1000));
export const hijriah=t=>hijriFmt.format(new Date(t*1000));
export const clockText=t=>{const d=new Date(t*1000);return [d.getHours(),d.getMinutes(),d.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':');};
