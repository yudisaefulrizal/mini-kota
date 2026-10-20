import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// The editor's default map (Mini Kota with every asset), the devices at work in the
// simulation, and "Isi aset otomatis" on another map.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${process.env.TEST_URL||'http://localhost:5180'}/editor-peta.html`);
  await page.waitForFunction(()=>window.mapEditor?.geometry&&document.querySelector('[data-asset]'),null,{timeout:30000});
  await page.evaluate(()=>localStorage.clear());
  assert.equal(await page.inputValue('#map-select'),'minikota-lengkap');
  assert.equal(await page.evaluate(()=>window.mapEditor.map.name),'Mini Kota lengkap');
  // Every placed asset gets its model, even though the map loads before the asset list.
  await page.waitForFunction(()=>{const m=window.mapEditor.objects.meshes;let k=0;for(const [,h] of m)if(h.children.length)k++;return m.size>350&&k===m.size;},null,{timeout:60000});
  if(process.env.SHOT_MAP){await page.evaluate(()=>window.mapEditor.frame(false));await page.waitForTimeout(1500);await page.screenshot({path:process.env.SHOT_MAP});}

  await page.check('#sim-adaptive');await page.fill('#sim-people','40');
  await page.click('#sim-start');
  await page.waitForFunction(()=>window.mapEditor.sim?.view?.parts?.length>0,null,{timeout:30000});
  await page.selectOption('#sim-speed','20');
  await page.waitForFunction(()=>window.mapEditor.sim.engine.time>300,null,{timeout:180000});
  await page.selectOption('#sim-speed','1');
  const state=await page.evaluate(()=>{const {engine,view}=window.mapEditor.sim;return {s:engine.summary(),people:view.people.body[0].mesh.count+view.people.bag[0].mesh.count,
    leds:view.binLeds.length,minibus:view.fleet.minibus[0].mesh.count,counted:engine.sensors.reduce((n,x)=>n+x.count,0)};});
  assert.equal(state.s.sensedSignals,15);assert.equal(state.s.redViolations,0);
  assert.equal(state.people,40);
  // People step: walkers swing their legs in opposition (arms against legs); people waiting
  // to cross stand with their legs together.
  const gait=await page.waitForFunction(()=>{
    const poses=[...window.mapEditor.sim.view.poses.values()];
    const striding=poses.filter(p=>p.walking&&p.amp>0.9&&Math.abs(p.leg_l)>0.2);
    const opposite=striding.every(p=>Math.abs(p.leg_l+p.leg_r)<1e-9&&Math.sign(p.arm_r)===Math.sign(p.leg_l));
    const still=poses.filter(p=>!p.walking&&p.amp<0.05).every(p=>Math.abs(p.leg_l)<0.03);
    return striding.length>=5&&opposite&&still?striding.length:false;
  },null,{timeout:20000,polling:100});
  assert.ok(await gait.jsonValue());assert.ok(state.leds>=5);assert.ok(state.counted>100,`counted ${state.counted}`);
  assert.ok(state.s.pedestrians.crossings>20&&state.s.busStops>0,JSON.stringify(state.s));
  assert.match(await page.textContent('#sim-stats'),/Simpang dengan kamera detektor\s*15 dari 15/);
  // Countdown timers like the old city view, also on the displays of the light models.
  const timers=await page.evaluate(()=>{const v=window.mapEditor.sim.view,e=window.mapEditor.sim.engine;
    return {count:v.timers.length,panels:v.panels.length,labels:v.timers.map(t=>t.last),match:v.timers.every(t=>{const c=e.signalCountdown(t.node)[t.leg];return t.last.split('|')[1]===c.state;})};});
  assert.ok(timers.count>=40&&timers.panels>=30,JSON.stringify(timers));
  assert.ok(timers.labels.every(l=>/^~\d+\|/.test(l)),'adaptive timers are estimates (~)');
  assert.ok(timers.match,'label colour follows the light');
  assert.match(await page.textContent('#sim-adaptive-note'),/Semua simpang berlampu punya kamera detektor/);
  if(process.env.SHOT_SIM){await page.evaluate(()=>window.mapEditor.focus(209,163,42));await page.waitForTimeout(1500);await page.screenshot({path:process.env.SHOT_SIM});}
  await page.click('#sim-stop');

  // Without cameras the note says which junctions stay on fixed timing.
  await page.selectOption('#map-select','maps/peta-uji.json');await page.waitForFunction(()=>window.mapEditor.map.name.includes('uji'));
  await page.click('#sim-start');await page.waitForFunction(()=>window.mapEditor.sim?.engine);
  assert.match(await page.textContent('#sim-adaptive-note'),/belum punya kamera detektor/);
  await page.click('#sim-stop');
  // "Rapikan seluruh peta" tidies the roads and fills the assets; again, it renews only the
  // automatic ones (the same set); one undo takes it all back.
  const before=await page.evaluate(()=>window.mapEditor.map.objects.length);
  await page.click('#tidy-all');
  const after=await page.evaluate(()=>window.mapEditor.map.objects.length);
  assert.ok(after>before+30,`${before} → ${after}`);
  assert.match(await page.textContent('#status'),/Peta dirapikan.*Aset otomatis: 0 dihapus, \d+ dipasang/);
  await page.click('#tidy-all');
  assert.equal(await page.evaluate(()=>window.mapEditor.map.objects.length),after);
  assert.match(await page.textContent('#status'),/sudah rapi/);
  await page.click('#undo');
  assert.equal(await page.evaluate(()=>window.mapEditor.map.objects.length),before);
  assert.deepEqual(errors,[]);
  console.log('PASS: full default map with all models, walking pedestrians step, cameras drive adaptive lights, angkot/bins/pedestrians at work, CCTV note, auto-fill + undo.');
}finally{await browser.close();}
