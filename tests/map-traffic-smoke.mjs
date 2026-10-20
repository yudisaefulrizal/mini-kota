import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// Traffic simulation inside the map editor.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${process.env.TEST_URL||'http://localhost:5180'}/editor-peta.html`);
  await page.waitForFunction(()=>window.mapEditor?.geometry&&document.querySelector('[data-asset]'),null,{timeout:30000});
  await page.selectOption('#map-select','maps/peta-uji.json');await page.waitForFunction(()=>window.mapEditor.map.name.includes('uji'));
  await page.evaluate(()=>window.mapEditor.select({type:'node',id:'simpang-4'}));
  await page.click('#sel-place-lights');

  await page.selectOption('#sim-speed','20').catch(()=>{});
  await page.click('#sim-toggle');
  await page.waitForFunction(()=>window.mapEditor.sim?.view?.parts?.length>0,null,{timeout:20000});
  await page.selectOption('#sim-speed','20');
  await page.waitForFunction(()=>window.mapEditor.sim.engine.stats.completed>5,null,{timeout:60000});
  const state=await page.evaluate(()=>{const s=window.mapEditor.sim;return {cars:s.view.parts[0].mesh.count,discs:s.view.discs.length,lamps:s.view.lamps.length,summary:s.engine.summary()};});
  // Vehicle lamps: brake lights of stopped cars are lit; indicators blink on turning cars,
  // on the side they turn to.
  const lamps=await page.waitForFunction(()=>{
    const {view,engine}=window.mapEditor.sim,cars=engine.vehicles.filter(v=>v.type==='car');
    const part=key=>view.fleet.car.find(p=>p.light===key),lit=(p,i)=>p.mesh.instanceColor.array[i*3]>0.9;   // red channel: lamps on are bright
    const brake=part('brake'),left=part('left'),right=part('right');
    const stopped=cars.map((v,i)=>[v,i]).filter(([v])=>v.v<0.3&&!v.dwelling);
    const blinking=cars.map((v,i)=>[v,i]).filter(([v,i])=>lit(left,i)||lit(right,i));
    const wrongSide=blinking.filter(([v,i])=>{const seg=engine.graph.byId.get(v.route[v.idx]);return seg.kind==='connector'&&((seg.turn==='kiri'&&lit(right,i)&&!lit(left,i))||(seg.turn==='kanan'&&lit(left,i)&&!lit(right,i)));});
    return stopped.length&&stopped.every(([,i])=>lit(brake,i))&&blinking.length>0&&!wrongSide.length?{stopped:stopped.length,blinking:blinking.length}:false;
  },null,{timeout:30000,polling:100});
  assert.ok(await lamps.jsonValue());
  assert.ok(state.cars>0,'cars drawn');
  assert.equal(state.discs,7,'one signal disc per approach of the two signalised junctions');
  assert.equal(state.lamps,4,'the four placed traffic lights are bound to their approaches');
  assert.equal(state.summary.redViolations,0);
  assert.match(await page.textContent('#sim-stats'),/Perjalanan selesai/);
  // Driver settings reach the running simulation.
  assert.match(await page.textContent('#sim-stats'),/Kendaraan menyalip\s*\d+/);
  await page.click('#sim-card .advanced summary');
  await page.fill('#sim-spread','20');await page.dispatchEvent('#sim-spread','change');await page.uncheck('#sim-overtaking');
  assert.deepEqual(await page.evaluate(()=>{const e=window.mapEditor.sim.engine;return [e.speedSpread,e.overtaking];}),[0.2,false]);

  // Some lamp of a placed light is lit.
  const lit=await page.evaluate(()=>window.mapEditor.sim.view.lamps.some(l=>l.lamps.some(x=>x.mesh.material.emissiveIntensity>0)));
  assert.ok(lit,'placed lights follow the phases');

  // Editing is locked during the run; pause freezes time; stop unlocks.
  await page.keyboard.press('r');
  assert.equal(await page.evaluate(()=>document.querySelector('[data-tool=road]').getAttribute('aria-pressed')),'false');
  await page.click('#sim-pause');
  const t1=await page.evaluate(()=>window.mapEditor.sim.engine.time);await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.mapEditor.sim.engine.time),t1,'paused');
  await page.click('#sim-stop');
  assert.equal(await page.evaluate(()=>window.mapEditor.sim),null);
  assert.equal(await page.locator('#toolbox').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: simulation runs in the editor: cars drawn, brake lights and indicators, signal discs per approach, placed lamps follow phases, no red-light runs, locked editing, pause, stop.');
}finally{await browser.close();}
