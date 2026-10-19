import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://localhost:5173');await page.waitForFunction(()=>window.cityDriving);
 await page.locator('#pause').click();
 await page.locator('#explore').click();
 assert.equal(await page.evaluate(()=>window.cityDriving.state.active),true);
 const start=await page.evaluate(()=>({car:window.cityDriving.state,time:window.cityComparison.state.time}));
 await page.keyboard.down('w');await page.waitForFunction(()=>window.cityDriving.state.x>603);await page.keyboard.up('w');
 const moved=await page.evaluate(()=>window.cityDriving.state);assert.ok(moved.x>start.car.x+2);assert.ok(moved.speed>0);
 assert.ok(await page.evaluate(()=>window.cityComparison.state.time)>start.time);
 await page.keyboard.down('Space');await page.waitForFunction(()=>window.cityDriving.state.speed===0);await page.keyboard.up('Space');assert.equal(await page.evaluate(()=>window.cityDriving.state.speed),0);
 await page.locator('#drive-city').selectOption('smart');assert.equal(await page.evaluate(()=>window.cityDriving.state.city),'smart');
 await page.locator('#drive-reset').click();await page.keyboard.down('s');await page.waitForFunction(()=>window.cityDriving.state.speed<0);await page.keyboard.up('s');assert.ok(await page.evaluate(()=>window.cityDriving.state.speed)<0);
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.cityDriving.state.active),false);assert.equal(await page.evaluate(()=>window.cityComparison.state.paused),true);
 await page.setViewportSize({width:390,height:844});await page.locator('#explore').click();
 const gas=page.locator('[data-drive=forward]');const bounds=await gas.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.waitForFunction(()=>window.cityDriving.state.speed>0);await page.mouse.up();
 await page.screenshot({path:'/tmp/mini-kota-driving-mobile.png'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
 await page.locator('#drive-exit').click();assert.equal(await page.locator('#settings').evaluate(e=>e.inert),false);
 // Test collision and boundary integration independently of render timing.
 const physics=await page.evaluate(async()=>{const {stepCar}=await import('/src/driving.js');const keys=new Set(['forward']);const obstacle={x:93,z:100,angle:Math.PI/2,speed:38};const boundary={x:1528,z:400,angle:Math.PI/2,speed:38};return {hit:stepCar(obstacle,keys,.1,[[100,100,4,4]]),obstacle,edge:stepCar(boundary,keys,.1,[]),boundary};});
 assert.equal(physics.hit,true);assert.equal(physics.obstacle.x,93);assert.equal(physics.edge,true);assert.equal(physics.boundary.speed,0);
 assert.deepEqual(errors,[]);console.log('PASS: driving, braking, reverse, city selection, exit, mobile, collisions, and continued traffic.');
}finally{await browser.close();}
