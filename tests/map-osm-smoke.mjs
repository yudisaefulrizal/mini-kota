import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

// Opening an OpenStreetMap export in the editor and simulating it.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${process.env.TEST_URL||'http://localhost:5180'}/editor-peta.html`);
  await page.waitForFunction(()=>window.mapEditor?.geometry&&document.querySelector('[data-asset]'),null,{timeout:30000});
  await page.evaluate(()=>localStorage.clear());
  await page.setInputFiles('#file-input',fileURLToPath(new URL('./fixtures/contoh.osm',import.meta.url)));
  await page.waitForFunction(()=>window.mapEditor.map.meta?.source==='OpenStreetMap');
  assert.match(await page.textContent('#status'),/diimpor dari OpenStreetMap: 7 jalan, 1 simpang, 1 berlampu/);
  assert.match(await page.textContent('#map-select option[value=file]'),/OSM: contoh\.osm/);
  const lit=await page.evaluate(()=>window.mapEditor.map.nodes.filter(n=>n.signal).map(n=>n.id));
  assert.deepEqual(lit,['n2']);
  if(process.env.SHOT)await page.screenshot({path:process.env.SHOT});
  await page.click('#sim-start');
  await page.waitForFunction(()=>window.mapEditor.sim?.engine?.time>20,null,{timeout:30000});
  assert.deepEqual(errors,[]);
  console.log('PASS: .osm export opens as a map with junction and traffic light, and simulates.');
}finally{await browser.close();}
