import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// Signals in the map editor: automatic lights, phase plans, arrows, light assets.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${process.env.TEST_URL||'http://localhost:5180'}/editor-peta.html`);
  await page.waitForFunction(()=>window.mapEditor?.geometry&&document.querySelector('[data-asset]'),null,{timeout:30000});
  const at=async(x,z)=>page.evaluate(([x,z])=>window.mapEditor.screen(x,z),[x,z]);
  const click=async(x,z)=>{const s=await at(x,z);await page.mouse.click(s.x,s.y);};
  const node=id=>page.evaluate(id=>window.mapEditor.map.nodes.find(n=>n.id===id),id);

  // Junctions where two main-road legs meet get a light automatically; 1-lane crossings do not.
  await page.selectOption('#map-select','empty');await page.waitForFunction(()=>window.mapEditor.map.name==='Peta baru');
  await page.keyboard.press('r');
  for(const [x,z] of [[50,100],[550,100]])await click(x,z);await page.keyboard.press('Enter');
  for(const [x,z] of [[200,20],[200,380]])await click(x,z);await page.keyboard.press('Enter');
  assert.match(await page.textContent('#status'),/1 simpang diberi lampu/);
  await page.click('[data-profile=jalan-1x1]');
  for(const [x,z] of [[50,300],[550,300]])await click(x,z);await page.keyboard.press('Enter');
  for(const [x,z] of [[450,200],[450,390]])await click(x,z);await page.keyboard.press('Enter');
  // Lit: 2x2 × 2x2 at (200,100) and 2x2 × 1x1 at (200,300). Unlit: 1x1 × 1x1 at (450,300).
  const lit=await page.evaluate(()=>window.mapEditor.map.nodes.filter(n=>n.signal===true).map(n=>[Math.round(n.x),Math.round(n.z)]));
  assert.equal(lit.length,2);
  assert.ok(lit.every(([x])=>Math.abs(x-200)<2),`lit at ${JSON.stringify(lit)}`);

  // Phase plan of the test map's crossroads.
  await page.selectOption('#map-select','maps/peta-uji.json');await page.waitForFunction(()=>window.mapEditor.map.name.includes('uji'));
  await page.evaluate(()=>window.mapEditor.select({type:'node',id:'simpang-4'}));
  assert.equal(await page.inputValue('#sel-pattern'),'4-fase');
  assert.equal(await page.locator('.phases li').count(),4);
  assert.match(await page.textContent('#selection'),/Siklus 96 detik/);
  await page.click('[data-phase="0"]');
  assert.ok(await page.evaluate(()=>window.mapEditor.phaseArrows.children.length)>0,'arrows drawn');

  await page.selectOption('#sel-pattern','2-fase-panah-kanan');
  assert.equal(await page.locator('.phases li').count(),3);
  assert.equal((await node('simpang-4')).signalPlan.pattern,'2-fase-panah-kanan');
  await page.fill('[data-green="2"]','35');await page.press('[data-green="2"]','Enter');
  assert.equal((await node('simpang-4')).signalPlan.green[2],35);

  // Light assets: one per approach (arrow lights on the arrow pair) plus a controller; idempotent.
  await page.click('#sel-place-lights');
  const assets=await page.evaluate(()=>window.mapEditor.map.objects.map(o=>o.asset));
  assert.equal(assets.filter(a=>a.startsWith('traffic-light')).length,4);
  assert.equal(assets.filter(a=>a==='traffic-light-arrow-right').length,2);
  assert.equal(assets.filter(a=>a==='controller').length,1);
  await page.click('#sel-place-lights');
  assert.equal(await page.evaluate(()=>window.mapEditor.map.objects.length),5);

  // Switching the light off is stored as an explicit "no" and can be undone.
  await page.uncheck('#sel-signal');
  assert.equal((await node('simpang-4')).signal,false);
  await page.keyboard.press('Control+z');
  assert.equal((await node('simpang-4')).signal,true);
  assert.deepEqual(errors,[]);
  console.log('PASS: automatic lights only where main roads meet, phase plan + arrows, pattern and green edits, light assets, explicit off + undo.');
}finally{await browser.close();}
