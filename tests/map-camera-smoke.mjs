import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// Navigation in the map editor, complete with the mouse alone: right drag orbits round the
// point under the cursor, left drag on empty map and middle drag pan, the wheel zooms to
// the cursor; plus limits, F / Home, north arrow, keys, touchpad and following a vehicle.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${process.env.TEST_URL||'http://localhost:5180'}/editor-peta.html`);
  await page.waitForFunction(()=>window.mapEditor?.geometry&&document.querySelector('[data-asset]'),null,{timeout:30000});
  await page.evaluate(()=>localStorage.clear());
  await page.selectOption('#map-select','minikota');await page.waitForFunction(()=>window.mapEditor.map.name==='Mini Kota');
  const cam=()=>page.evaluate(()=>{const c=window.mapEditor.camera;return {d:c.distance,t:c.target.toArray(),p:c.camera.position.toArray(),top:c.topView};});
  const screen=(x,z,y=0)=>page.evaluate(([x,z,y])=>window.mapEditor.screen(x,z,y),[x,z,y]);
  const ground=(sx,sy)=>page.evaluate(([x,y])=>{const p=window.mapEditor.camera.pick(x,y);return p&&[p.x,p.y,p.z];},[sx,sy]);
  const near=(a,b,tol)=>Math.hypot(a.x-b.x,a.y-b.y)<tol;

  // Perspective view, then zoom with the wheel towards a junction off-centre.
  await page.click('#view-perspective');await page.waitForTimeout(900);
  const j=await page.evaluate(()=>{const n=window.mapEditor.map.nodes.find(n=>n.signal);return {x:n.x,z:n.z};});
  let s=await screen(j.x,j.z);s={x:Math.round(s.x),y:Math.round(s.y)};await page.mouse.move(s.x,s.y);
  const under=await ground(s.x,s.y),before=await cam();
  for(let i=0;i<6;i++){await page.mouse.wheel(0,-240);await page.waitForTimeout(30);}
  const after=await cam();
  assert.ok(after.d<before.d*0.5,`zoomed in ${before.d}→${after.d}`);
  assert.ok(near(await screen(under[0],under[2],under[1]),s,1.5),'the point under the cursor stays there while zooming');

  // Middle drag and a left drag on empty map pan: the grabbed point follows the cursor.
  let grab=await ground(s.x,s.y);
  await page.mouse.down({button:'middle'});await page.mouse.move(s.x+200,s.y+80,{steps:8});await page.mouse.up({button:'middle'});
  assert.ok(near(await screen(grab[0],grab[2],grab[1]),{x:s.x+200,y:s.y+80},6),'middle drag keeps the grabbed point under the cursor');
  const empty={x:900,y:700};grab=await ground(empty.x,empty.y);
  await page.mouse.move(empty.x,empty.y);await page.mouse.down();await page.mouse.move(empty.x-150,empty.y-100,{steps:8});await page.mouse.up();
  assert.ok(near(await screen(grab[0],grab[2],grab[1]),{x:empty.x-150,y:empty.y-100},6),'left drag on empty map pans');

  // Right drag orbits round the point under the cursor, which stays put on screen.
  s=await screen(j.x,j.z);s={x:Math.round(s.x),y:Math.round(s.y)};const pivotScreen={...s};
  const pivot=await ground(s.x,s.y);
  await page.mouse.move(s.x,s.y);await page.mouse.down({button:'right'});
  assert.equal(await page.evaluate(()=>window.mapEditor.camera.marker.visible),true,'anchor marker shown');
  await page.mouse.move(s.x+160,s.y+60,{steps:10});
  const turned=await screen(pivot[0],pivot[2],pivot[1]);
  await page.mouse.up({button:'right'});
  assert.ok(near(turned,pivotScreen,4),`orbit keeps the anchor in place (${JSON.stringify(turned)} vs ${JSON.stringify(pivotScreen)})`);
  const angle=await page.evaluate(()=>window.mapEditor.camera.compassAngle());
  assert.ok(Math.abs(angle)>0.3,'view turned');
  assert.equal(await page.evaluate(()=>window.mapEditor.camera.marker.visible),false);

  // Limits: cannot zoom through the ground or out past the city; camera stays above ground.
  for(let i=0;i<40;i++)await page.mouse.wheel(0,-400);
  let c=await cam();assert.ok(c.d>=5.9&&c.p[1]>=1.5,`closest ${c.d}`);
  for(let i=0;i<60;i++)await page.mouse.wheel(0,600);
  const box=await page.evaluate(()=>window.mapEditor.region.box);
  c=await cam();assert.ok(c.d<=1.6*Math.max(box.width,box.depth)+101,`farthest ${c.d}`);
  await page.mouse.move(700,450);await page.mouse.down({button:'right'});await page.mouse.move(700,-400,{steps:10});await page.mouse.up({button:'right'});
  c=await cam();assert.ok(c.p[1]>=1.5);

  // North arrow straightens the view; Home shows the whole map.
  await page.click('#compass');await page.waitForTimeout(600);
  assert.ok(Math.abs(await page.evaluate(()=>window.mapEditor.camera.compassAngle()))<0.02,'north up');
  await page.keyboard.press('Home');await page.waitForTimeout(900);
  c=await cam();assert.ok(Math.abs(c.t[0]-307)<2&&Math.abs(c.t[2]-205)<2,'centred on the map');

  // Keyboard: W moves forward (north when north is up), Q turns.
  const t0=(await cam()).t;
  await page.mouse.move(700,450);await page.keyboard.down('w');await page.waitForTimeout(400);await page.keyboard.up('w');
  assert.ok((await cam()).t[2]<t0[2]-5,'W pans north');
  await page.keyboard.down('q');await page.waitForTimeout(300);await page.keyboard.up('q');
  assert.ok(Math.abs(await page.evaluate(()=>window.mapEditor.camera.compassAngle()))>0.1,'Q turns');

  // F flies to the selected node.
  await page.evaluate(id=>window.mapEditor.select({type:'node',id}),await page.evaluate(()=>window.mapEditor.map.nodes.find(n=>n.signal).id));
  await page.keyboard.press('f');await page.waitForTimeout(900);
  c=await cam();assert.ok(Math.hypot(c.t[0]-j.x,c.t[2]-j.z)<1&&c.d<=61,'focused on the node');

  // Double right click flies to the point.
  s={x:600,y:500};const spot=await ground(s.x,s.y);
  await page.mouse.click(s.x,s.y,{button:'right',clickCount:1});await page.mouse.click(s.x,s.y,{button:'right',clickCount:2});await page.waitForTimeout(900);
  c=await cam();assert.ok(Math.hypot(c.t[0]-spot[0],c.t[2]-spot[2])<1,'double right click flies there');

  // Top view: panning keeps north up; a right drag tilts it into perspective.
  await page.click('#view-top');await page.waitForTimeout(900);
  assert.equal((await cam()).top,true);
  const tTop=(await cam()).t;
  await page.mouse.move(700,450);await page.mouse.down({button:'middle'});await page.mouse.move(800,450,{steps:5});await page.mouse.up({button:'middle'});
  assert.ok(Math.abs(await page.evaluate(()=>window.mapEditor.camera.compassAngle()))<1e-3,'still north up');
  assert.ok(Math.abs((await cam()).t[0]-tTop[0])>5,'middle drag pans in the top view');
  await page.mouse.down({button:'right'});await page.mouse.move(800,520,{steps:6});await page.mouse.up({button:'right'});
  assert.equal((await cam()).top,false,'right drag leaves the top view');
  assert.equal(await page.getAttribute('#view-perspective','aria-pressed'),'true');
  await page.click('#view-top');await page.waitForTimeout(900);

  // Touchpad: two-finger swipe pans, pinch (ctrl + wheel) zooms.
  await page.mouse.move(700,450);
  const tp=(await cam()).t,dp=(await cam()).d;
  await page.mouse.wheel(120,0);const ts=(await cam()).t;assert.ok(Math.abs(ts[0]-tp[0])>3,`swipe pans ${JSON.stringify([tp,ts,dp])}`);
  await page.keyboard.down('Control');await page.mouse.wheel(0,-30);await page.keyboard.up('Control');
  assert.ok((await cam()).d<dp,'pinch zooms');

  // Following a vehicle during the simulation.
  await page.click('#sim-start');await page.waitForFunction(()=>window.mapEditor.sim?.view?.parts?.length>0,null,{timeout:30000});
  await page.waitForFunction(()=>window.mapEditor.sim.engine.time>60&&window.mapEditor.sim.engine.vehicles.filter(v=>v.v>3).length>5,null,{timeout:60000});
  await page.click('#sim-pause');
  await page.keyboard.press('Home');await page.waitForTimeout(900);
  // A moving vehicle that is on screen.
  const v=await page.evaluate(()=>{const e=window.mapEditor.sim.engine,r=document.querySelector('#stage canvas').getBoundingClientRect();
    for(const v of e.vehicles){if(v.v<=3)continue;const p=e.position(v,v.len/2),s=window.mapEditor.screen(p.x,p.z);
      if(s.x>r.left+150&&s.x<r.right-150&&s.y>r.top+150&&s.y<r.bottom-80)return {id:v.id,x:p.x,z:p.z};}
    return null;});
  assert.ok(v,'a moving vehicle on screen');
  s=await screen(v.x,v.z);await page.mouse.click(s.x,s.y);
  assert.match(await page.textContent('#status'),/Mengikuti/);
  await page.click('#sim-pause');await page.waitForTimeout(1500);
  const follow=await page.evaluate(id=>{const e=window.mapEditor.sim.engine,v=e.vehicles.find(v=>v.id===id),t=window.mapEditor.camera.target;if(!v)return null;const p=e.position(v,v.len/2);return Math.hypot(p.x-t.x,p.z-t.z);},v.id);
  assert.ok(follow===null||follow<1,`camera follows the vehicle (${follow})`);
  await page.keyboard.press('Escape');assert.match(await page.textContent('#status'),/Berhenti mengikuti/);
  assert.equal(await page.evaluate(()=>!!window.mapEditor.sim),true,'Esc stops following first, not the simulation');
  assert.deepEqual(errors,[]);
  console.log('PASS: mouse only: right drag orbits round the cursor point, left drag on empty map / middle drag pan, wheel zooms to cursor, double right click flies; limits, north arrow, Home, keys, F, top view tilt, touchpad, follow vehicle.');
}finally{await browser.close();}
