import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// Draws on an empty map with the mouse, as a user would. Run against `npm run preview`.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${process.env.TEST_URL||'http://localhost:5180'}/editor-peta.html`);
  await page.waitForFunction(()=>window.mapEditor?.geometry,null,{timeout:30000});
  await page.selectOption('#map-select','empty');
  await page.waitForFunction(()=>window.mapEditor.map.name==='Peta baru');
  const at=async(x,z)=>page.evaluate(([x,z])=>window.mapEditor.screen(x,z),[x,z]);
  const click=async(x,z)=>{const s=await at(x,z);await page.mouse.click(s.x,s.y);};
  const state=()=>page.evaluate(()=>({roads:window.mapEditor.map.roads.length,nodes:window.mapEditor.map.nodes.length,arms:window.mapEditor.geometry.junctions.map(j=>j.arms)}));

  // A 2-lane main road by clicking three points.
  await page.keyboard.press('r');
  for(const [x,z] of [[50,200],[300,180],[550,200]])await click(x,z);
  await page.keyboard.press('Enter');
  assert.deepEqual(await state(),{roads:1,nodes:2,arms:[]});

  // A 1-lane branch whose end is dropped near the main road snaps onto it: a T-junction.
  await page.click('[data-profile=jalan-1x1]');
  for(const [x,z] of [[300,40],[302,186]])await click(x,z);
  await page.keyboard.press('Enter');
  assert.deepEqual(await state(),{roads:3,nodes:4,arms:[3]});

  // Freehand stroke in drag mode becomes a smooth road with few control points.
  await page.click('[data-mode=drag]');
  let s=await at(100,330);await page.mouse.move(s.x,s.y);await page.mouse.down();
  for(let i=1;i<=20;i++){const t=await at(100+i*20,330-Math.sin(i/20*Math.PI)*60);await page.mouse.move(t.x,t.y);}
  await page.mouse.up();
  const drawn=await page.evaluate(()=>window.mapEditor.map.roads.at(-1));
  assert.equal((await state()).roads,4);assert.ok(drawn.points.length<=7,`simplified to ${drawn.points.length} points`);

  // Undo twice, redo once.
  await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');
  assert.equal((await state()).roads,1);
  await page.keyboard.press('Control+y');
  assert.equal((await state()).roads,3);

  // Select the main road and drag its control point 30 m south.
  await page.keyboard.press('v');
  await click(150,193);
  const selected=await page.evaluate(()=>window.mapEditor.selection);
  assert.equal(selected?.type,'road');
  const cp=await page.evaluate(()=>{const m=window.mapEditor.map;return m.roads.find(r=>r.id===window.mapEditor.selection.id).points[0];});
  s=await at(cp[0],cp[1]);await page.mouse.move(s.x,s.y);await page.mouse.down();
  const to=await at(cp[0],cp[1]+30);await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();
  const moved=await page.evaluate(()=>{const m=window.mapEditor.map;return m.roads.find(r=>r.id===window.mapEditor.selection.id).points[0];});
  assert.ok(Math.abs(moved[1]-(cp[1]+30))<1.5,`point moved to ${moved}`);

  // Junction tool splits a road; erase tool removes a road and its loose node.
  await page.keyboard.press('j');await click(450,198);
  assert.equal((await state()).roads,4);
  await page.keyboard.press('x');await click(300,100);
  assert.equal((await state()).roads,3);
  // Drawing straight across a road without snapping its ends makes a crossroads, and one
  // undo removes the road together with that automatic fix.
  await page.keyboard.press('r');await page.click('[data-mode=click]');
  const roadsBefore=(await state()).roads;
  for(const [x,z] of [[200,60],[200,320]])await click(x,z);
  await page.keyboard.press('Enter');
  const crossed=await state();
  assert.ok(crossed.arms.includes(4),`crossroads expected, arms ${crossed.arms}`);
  assert.match(await page.textContent('#status'),/perempatan dibuat/);
  await page.keyboard.press('Control+z');
  assert.equal((await state()).roads,roadsBefore);
  assert.deepEqual(errors,[]);
  console.log('PASS: draw by clicks, snap to a road (T-junction), freehand, undo/redo, drag a point, add junction, erase, crossing becomes a crossroads (one undo step).');
}finally{await browser.close();}
