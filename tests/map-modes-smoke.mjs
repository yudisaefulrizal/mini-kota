import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://localhost:5180');await page.waitForFunction(()=>window.cityDevices);
  const visible=async()=>({baseline:await page.locator('#baseline-view').isVisible(),smart:await page.locator('#smart-view').isVisible()});
  assert.deepEqual(await visible(),{baseline:true,smart:true});
  await page.click('.map-tabs [data-mode=baseline]');assert.deepEqual(await visible(),{baseline:true,smart:false});
  assert.match(await page.textContent('#details-title'),/KOTA BIASA/);
  await page.click('.map-tabs [data-mode=smart]');assert.deepEqual(await visible(),{baseline:false,smart:true});
  assert.match(await page.textContent('#details-title'),/KOTA CERDAS/);assert.equal(await page.locator('#device-legend').isHidden(),true);
  await page.click('.map-tabs [data-mode=devices]');assert.equal(await page.locator('#device-legend').isVisible(),true);
  // Overlay sites must match the data-center inventory (sensors) plus controllers and gateways.
  const {counts}=await page.evaluate(()=>window.cityDevices.state),inventory=await page.evaluate(()=>window.cityComparison.state.dataCenter);
  for(const [i,kind] of ['queue','gate','road','access','waste'].entries())assert.equal(counts[kind],inventory.sensors[i].count);
  assert.equal(counts.ctrl,inventory.signalControllers);assert.equal(counts.gw,inventory.signalControllers);
  await page.locator('#pause').click();
  const point=await page.evaluate(()=>window.cityDevices.screenPoint(window.cityDevices.state.sites-1));
  await page.mouse.click(point.x,point.y);await page.waitForSelector('#device-card:not([hidden])');
  assert.equal(await page.evaluate(()=>window.cityDevices.state.selected),'gw');
  assert.match(await page.textContent('#device-card'),/Ubuntu Server/);
  // "Perangkat" has no map: 3D flow diagram plus a live list of every device.
  await page.click('.map-tabs [data-mode=equipment]');
  assert.equal(await page.locator('#viewport').isVisible(),false);assert.equal(await page.locator('#equipment-view').isVisible(),true);
  assert.equal(await page.textContent('#map-title'),'Perangkat kota cerdas');
  assert.match(await page.getAttribute('#equipment-diagram','src'),/diagram-3d\.html\?embed/);
  assert.equal(await page.locator('#equipment-rows tr').count(),(await page.evaluate(()=>window.cityDevices.state)).sites);
  await page.click('.equipment-filters [data-filter=waste]');assert.equal(await page.locator('#equipment-rows tr').count(),counts.waste);
  await page.locator('#equipment-rows tr').first().click();assert.match(await page.textContent('#equipment-detail'),/Tanpa sistem operasi/);
  await page.click('#equipment-show');assert.equal(await page.textContent('#map-title'),'Kota cerdas × perangkat');
  assert.equal(await page.evaluate(()=>window.cityDevices.state.selected),'waste');assert.equal(await page.locator('#device-card').isVisible(),true);
  // "Editor peta" tab: the editor page loads inside the app.
  await page.click('.map-tabs [data-mode=editor]');
  assert.equal(await page.locator('#viewport').isVisible(),false);assert.equal(await page.locator('#editor-view').isVisible(),true);
  assert.match(await page.getAttribute('#editor-frame','src'),/editor-peta\.html\?embed/);
  const editor=page.frameLocator('#editor-frame');
  await editor.locator('#toolbox [data-asset]').first().waitFor({timeout:30000});
  assert.equal(await editor.locator('.bar').isVisible(),false,'page header hidden inside the tab');
  assert.equal(await page.textContent('#map-title'),'Editor peta');
  await page.click('.map-tabs [data-mode=compare]');assert.equal(await page.locator('#device-card').isHidden(),true);
  assert.deepEqual(await visible(),{baseline:true,smart:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: map menu modes incl. Perangkat and Editor peta, detail city switch, device overlay counts, device card.');
}finally{await browser.close();}
