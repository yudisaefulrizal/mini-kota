import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// Simpang gabungan in the editor: the panel explains it, it can be run separately and
// joined again, an offset can be set, and very close junctions can be merged into one.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${process.env.TEST_URL||'http://localhost:5180'}/editor-peta.html`);
  await page.waitForFunction(()=>window.mapEditor?.geometry&&document.querySelector('[data-asset]'),null,{timeout:30000});
  await page.evaluate(()=>localStorage.clear());
  await page.selectOption('#map-select','minikota');await page.waitForFunction(()=>window.mapEditor.map.name==='Mini Kota');
  const clusters=()=>page.evaluate(()=>window.mapEditor.geometry.clusters.map(c=>c.nodes.join('+')));
  const select=id=>page.evaluate(id=>window.mapEditor.select({type:'node',id}),id);
  assert.deepEqual(await clusters(),['n19+n25']);
  assert.ok(await page.evaluate(()=>window.mapEditor.geometry.quads.some(q=>q.box)),'yellow box drawn');

  await select('n25');
  const panel=await page.textContent('#selection');
  assert.match(panel,/Simpang gabungan: n19 \+ n25/);assert.match(panel,/Ruas tengah 9,2 m/);
  // Offset for the second member.
  await page.fill('#sel-offset','24');await page.press('#sel-offset','Enter');
  await page.waitForFunction(()=>window.mapEditor.map.nodes.find(n=>n.id==='n25').signalPlan?.offset===24);
  // Run separately, then join again (each one undo step).
  await select('n25');await page.uncheck('#sel-cluster');
  await page.waitForFunction(()=>window.mapEditor.geometry.clusters.length===0);
  assert.match(await page.textContent('#status'),/diatur terpisah/);
  assert.ok(!(await page.evaluate(()=>window.mapEditor.geometry.quads.some(q=>q.box))),'no box when separate');
  await select('n19');assert.match(await page.textContent('#selection'),/Simpang berdekatan/);
  await page.check('#sel-cluster');
  await page.waitForFunction(()=>window.mapEditor.geometry.clusters.length===1);
  // Merge into one junction; undo brings both back.
  await select('n19');await page.click('#sel-merge');
  await page.waitForFunction(()=>!window.mapEditor.map.nodes.some(n=>n.id==='n25'));
  assert.match(await page.textContent('#status'),/digabung menjadi satu simpang/);
  assert.equal(await page.evaluate(()=>window.mapEditor.geometry.junctions.find(j=>j.id==='n19').arms),5);
  await page.click('#undo');
  await page.waitForFunction(()=>window.mapEditor.map.nodes.some(n=>n.id==='n25'));
  assert.deepEqual(await clusters(),['n19+n25']);

  // The simulation runs the pair as one: no timer or stop disc on the link.
  await page.click('#sim-start');await page.waitForFunction(()=>window.mapEditor.sim?.view?.timers?.length>0,null,{timeout:30000});
  const sim=await page.evaluate(()=>{const {engine,view}=window.mapEditor.sim;return {internal:[...engine.internal],timers:view.timers.filter(t=>engine.internal.has(`${t.node}:${t.leg}`)).length,discs:view.discs.filter(d=>engine.internal.has(`${d.node}:${d.leg}`)).length,offset:engine.offsets.n25};});
  assert.equal(sim.internal.length,2);assert.equal(sim.timers,0);assert.equal(sim.discs,0);assert.equal(sim.offset,24);
  await page.click('#sim-stop');
  assert.deepEqual(errors,[]);
  console.log('PASS: simpang gabungan: detected with yellow box, panel, offset, run separately / join again, merge + undo, no timers or stop discs on the link.');
}finally{await browser.close();}
