import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// The city simulation (ordinary vs smart city, side by side with one camera) uses the
// same mouse navigation as the map editor: wheel zooms to the cursor in whichever view it
// is over, right drag turns round the point under the cursor, left drag pans, a left click
// still picks; north arrow, home button, keys only while the pointer is over the map.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${process.env.TEST_URL||'http://localhost:5180'}/index.html`);
  await page.waitForFunction(()=>window.cityCamera&&window.citySimulation&&!document.getElementById('loading'),null,{timeout:60000});
  await page.locator('#viewport').scrollIntoViewIfNeeded();
  const cam=()=>page.evaluate(()=>{const c=window.cityCamera;return {d:c.distance,t:c.target.toArray(),top:c.topView};});
  // Screen position of a world point inside the view (baseline or smart) that holds it.
  const screen=(p,view)=>page.evaluate(([p,view])=>{
    const c=window.cityCamera,r=document.getElementById(view).getBoundingClientRect();
    c.camera.aspect=r.width/r.height;c.camera.updateProjectionMatrix();c.camera.updateMatrixWorld();
    const {Vector3}=c.target.constructor?{Vector3:c.target.constructor}:{};const v=new Vector3(...p).project(c.camera);
    return {x:r.left+(v.x+1)/2*r.width,y:r.top+(1-v.y)/2*r.height};},[p,view]);
  const pick=(x,y)=>page.evaluate(([x,y])=>{const p=window.cityCamera.pick(x,y);return p&&p.toArray();},[x,y]);
  const near=(a,b,tol)=>Math.hypot(a.x-b.x,a.y-b.y)<tol;

  for(const view of ['baseline-view','smart-view']){
    await page.keyboard.press('Escape');await page.click('#home');await page.waitForTimeout(200);
    const r=await page.locator(`#${view}`).boundingBox();
    const s={x:Math.round(r.x+r.width*0.3),y:Math.round(r.y+r.height*0.6)};
    await page.mouse.move(s.x,s.y);const under=await pick(s.x,s.y),d0=(await cam()).d;
    for(let i=0;i<5;i++){await page.mouse.wheel(0,-240);await page.waitForTimeout(30);}
    assert.ok((await cam()).d<d0*0.6,`${view}: zoomed in`);
    assert.ok(near(await screen(under,view),s,2),`${view}: the point under the cursor stays there`);
  }

  // Right drag turns and tilts round the point under the cursor.
  const r=await page.locator('#smart-view').boundingBox(),s={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
  const pivot=await pick(s.x,s.y);
  await page.mouse.move(s.x,s.y);await page.mouse.down({button:'right'});await page.mouse.move(s.x+120,s.y+40,{steps:8});
  assert.ok(near(await screen(pivot,'smart-view'),s,4),'orbit keeps the anchor in place');
  await page.mouse.up({button:'right'});
  assert.ok(Math.abs(await page.evaluate(()=>window.cityCamera.compassAngle()))>0.2,'turned');

  // Left drag pans: the grabbed point follows the cursor.
  const grab=await pick(s.x,s.y);
  await page.mouse.move(s.x,s.y);await page.mouse.down();await page.mouse.move(s.x-140,s.y+60,{steps:8});await page.mouse.up();
  assert.ok(near(await screen(grab,'smart-view'),{x:s.x-140,y:s.y+60},6),'left drag pans');

  // North arrow straightens, the home button resets, keys work while hovering the map only.
  await page.click('#city-compass');await page.waitForTimeout(600);
  assert.ok(Math.abs(await page.evaluate(()=>window.cityCamera.compassAngle()))<0.02,'north up');
  await page.click('#top');assert.equal((await cam()).top,true);
  await page.mouse.move(s.x,s.y);await page.mouse.down({button:'right'});await page.mouse.move(s.x,s.y+60,{steps:5});await page.mouse.up({button:'right'});
  assert.equal((await cam()).top,false,'right drag tilts out of the top view');
  assert.equal(await page.getAttribute('#perspective','class'),'active');
  await page.click('#home');const home=await cam();
  await page.mouse.move(s.x,s.y);await page.keyboard.down('d');await page.waitForTimeout(300);await page.keyboard.up('d');
  assert.ok(Math.abs((await cam()).t[0]-home.t[0])>5,'D pans while over the map');
  await page.mouse.move(5,5);const away=await cam();
  const scrollBefore=await page.evaluate(()=>scrollY);await page.keyboard.down('ArrowDown');await page.waitForTimeout(200);await page.keyboard.up('ArrowDown');
  assert.deepEqual((await cam()).t,away.t,'keys away from the map are left to the page');
  assert.deepEqual(errors,[]);
  console.log('PASS: city simulation navigation like the editor: zoom to cursor in both views, right-drag orbit, left-drag pan, north arrow, top-view tilt, home, keys only over the map.');
}finally{await browser.close();}
