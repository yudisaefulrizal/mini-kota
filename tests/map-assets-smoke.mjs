import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// Places assets on the test map with the toolbox, as a user would. Run against `npm run preview`.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${process.env.TEST_URL||'http://localhost:5180'}/editor-peta.html`);
  await page.waitForFunction(()=>window.mapEditor?.geometry&&document.querySelector('[data-asset]'),null,{timeout:30000});
  await page.selectOption('#map-select','maps/peta-uji.json');
  await page.waitForFunction(()=>window.mapEditor.map.name.includes('uji'));
  const at=async(x,z)=>page.evaluate(([x,z])=>window.mapEditor.screen(x,z),[x,z]);
  const click=async(x,z)=>{const s=await at(x,z);await page.mouse.click(s.x,s.y);};
  const objects=()=>page.evaluate(()=>window.mapEditor.map.objects);

  // Click-to-place a traffic light near the west approach of the crossroads.
  await page.click('[data-asset=traffic-light]');
  await click(95,100);
  let list=await objects();
  assert.equal(list.length,1);assert.equal(list[0].asset,'traffic-light');assert.equal(list[0].rotation,270);
  assert.ok(list[0].z<110-7.3&&list[0].x<112,'on the north kerb before the junction');
  assert.match(await page.textContent('#status'),/pendekat simpang simpang-4/);

  // A gateway on a corner, then a CCTV on a kerb: the CCTV reports to that gateway.
  await page.click('[data-asset=gateway]');await click(105,95);
  await page.click('[data-asset=cctv]');await click(60,100);
  list=await objects();
  const [gateway,cctv]=[list.find(o=>o.asset==='gateway'),list.find(o=>o.asset==='cctv')];
  assert.ok(gateway&&cctv);
  assert.equal(await page.evaluate(id=>{const m=window.mapEditor.map;return m.objects.find(o=>o.id===id).gateway??null;},cctv.id),null,'automatic, not stored');
  assert.match(await page.textContent('#selection'),new RegExp(`Otomatis \\(terdekat: ${gateway.id}\\)`));

  // Rotate with E, drag it along to another road, delete it, undo the delete.
  await page.keyboard.press('Escape');await page.keyboard.press('v');
  await click(cctv.x,cctv.z);
  assert.equal(await page.evaluate(()=>window.mapEditor.selection?.type),'object');
  await page.keyboard.press('e');
  assert.equal((await objects()).find(o=>o.id===cctv.id).rotation,(cctv.rotation+15)%360);
  let s=await at(cctv.x,cctv.z);await page.mouse.move(s.x,s.y);await page.mouse.down();
  const to=await at(250,100);await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
  const moved=(await objects()).find(o=>o.id===cctv.id);
  assert.ok(moved.x>200&&moved.z<110-7.3,`snapped to the kerb of the east road, got ${moved.x},${moved.z}`);
  await page.keyboard.press('Delete');
  assert.equal((await objects()).length,2);
  await page.keyboard.press('Control+z');
  assert.equal((await objects()).length,3);

  // Drag and drop from the toolbox onto the map.
  await page.locator('#asset-groups summary',{hasText:'Vegetasi'}).click();
  const drop=await at(200,60);
  const canvasBox=await page.locator('#stage canvas').boundingBox();
  await page.locator('[data-asset=tree-shade]').dragTo(page.locator('#stage canvas'),{targetPosition:{x:drop.x-canvasBox.x,y:drop.y-canvasBox.y}});
  assert.ok((await objects()).some(o=>o.asset==='tree-shade'),'tree dropped');

  // Models load and render.
  await page.waitForFunction(()=>window.mapEditor.objects.group.children.every(g=>g.children.length>0),null,{timeout:20000});
  assert.deepEqual(errors,[]);
  console.log('PASS: click-to-place (traffic light at the approach), gateway + CCTV auto link, rotate, drag to another kerb, delete + undo, drag & drop from toolbox.');
}finally{await browser.close();}
