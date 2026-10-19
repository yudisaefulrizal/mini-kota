import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://localhost:5180');await page.waitForFunction(()=>window.cityComparison);
 await page.locator('#pause').click();
 let state=await page.evaluate(()=>window.cityComparison.state);
 assert.equal(state.time,state.smartTime);assert.equal(state.paused,true);
 const left=await page.locator('#baseline-view').boundingBox(),right=await page.locator('#smart-view').boundingBox();
 assert.equal(left.y,right.y);assert.ok(right.x>left.x);
 await page.locator('[name=idleLitersPerHour]').fill('1.3');
 await page.waitForFunction(()=>window.cityComparison.state.smartTarget.idleLitersPerHour===1.3);
 let updated=await page.evaluate(()=>window.cityComparison.state);
 assert.equal(updated.time,state.time);assert.equal(updated.smartTime,state.smartTime);
 assert.equal(updated.baseline.queueSeconds,state.baseline.queueSeconds);assert.equal(updated.smart.queueSeconds,state.smart.queueSeconds);
 await page.locator('[name=green]').evaluate(e=>e.closest('details').open=true);
 await page.locator('[name=green]').fill('35');await page.waitForFunction(()=>window.cityComparison.state.smartTarget.green===35);
 await page.locator('#next-hour').click();
 await page.waitForFunction(()=>window.cityComparison.state.time>=23400,null,{timeout:90000});
 await page.locator('#pause').click();state=await page.evaluate(()=>window.cityComparison.state);
 assert.equal(state.time,state.smartTime);assert.ok(state.baseline.queueSeconds>0);assert.ok(state.smart.queueSeconds>0);
 assert.equal(state.baseline.throughPlanned,state.smart.throughPlanned);
 assert.ok(state.smart.adaptiveSignals>0);
 assert.match(await page.locator('#comparison-results').textContent(),/Total waktu antre \(dalam \+ luar\)/);
 assert.match(await page.locator('#comparison-results').textContent(),/Menunggu di gerbang luar/);
 for(const name of ['baseline','smart']){assert.equal(state[name].totalQueueSeconds,state[name].queueSeconds+state[name].gateQueueSeconds);assert.match(await page.locator(`#${name}-map-queue`).textContent(),/dalam · .* luar/);}
 await page.locator('#top').click();await page.screenshot({path:'/tmp/unpam-comparison-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
 const mobileLeft=await page.locator('#baseline-view').boundingBox(),mobileRight=await page.locator('#smart-view').boundingBox();assert.ok(mobileRight.y>mobileLeft.y);
 await page.screenshot({path:'/tmp/unpam-comparison-mobile.png',fullPage:true});
 await page.locator('#reset').click();await page.locator('#pause').click();state=await page.evaluate(()=>window.cityComparison.state);
 assert.equal(state.time,state.smartTime);assert.equal(state.baseline.queueSeconds,0);assert.equal(state.smart.queueSeconds,0);
 assert.equal(state.smartTarget.idleLitersPerHour,1.3);
 assert.deepEqual(errors,[]);
 console.log('PASS: two views, synchronized time and inputs, queue/fuel, one-hour advance, reset, mobile layout, no browser errors.');
}finally{await browser.close();}
