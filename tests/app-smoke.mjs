import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

// The main app on the new map engine: ordinary vs smart city side by side, the tabs, the
// device views, settings and map choice (editor draft, OSM file), data center, driving and
// mouse navigation.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  const base=process.env.TEST_URL||'http://localhost:5180';
  await page.goto(`${base}/index.html`);
  const ready=()=>page.waitForFunction(()=>window.miniKota?.cities.smart.engine&&window.miniKota.cities.baseline.engine&&document.getElementById('loading').hidden,null,{timeout:90000});
  await ready();
  assert.match(await page.textContent('#map-status'),/Mini Kota lengkap: 65 jalan, 15 simpang berlampu/);
  // Same map, different strategies.
  const kinds=await page.evaluate(()=>{const {baseline,smart}=window.miniKota.cities;return {b:[baseline.engine.adaptive,baseline.engine.binMode],s:[smart.engine.adaptive,smart.engine.binMode],sensed:smart.engine.summary().sensedSignals};});
  // Theme button: follows the system, then light, then dark (remembered), then back.
  const theme=()=>page.evaluate(()=>[document.documentElement.dataset.theme??'auto',getComputedStyle(document.documentElement).backgroundColor]);
  const light=await theme();
  await page.click('.theme-toggle');await page.click('.theme-toggle');
  const dark=await theme();assert.equal(dark[0],'dark');assert.notEqual(dark[1],light[1]);
  assert.equal(await page.evaluate(()=>localStorage.getItem('miniKota.theme')),'dark');
  await page.click('.theme-toggle');assert.deepEqual(await theme(),light);
  assert.deepEqual(kinds.b,[false,'schedule']);assert.deepEqual(kinds.s,[true,'sensor']);assert.equal(kinds.sensed,15);

  // Running: both clocks advance together and the comparison fills in.
  await page.fill('#speed','60');await page.dispatchEvent('#speed','input');
  await page.waitForFunction(()=>window.miniKota.cities.smart.engine.time>90,null,{timeout:120000});
  const times=await page.evaluate(()=>[window.miniKota.cities.baseline.engine.time,window.miniKota.cities.smart.engine.time]);
  assert.equal(times[0],times[1]);
  assert.match(await page.textContent('#comparison-saving'),/Cerdas dibanding biasa: waktu antre/);
  assert.equal(await page.locator('#comparison-results tr').count(),8);
  assert.match(await page.textContent('#smart-clock'),/HARI 01 06:0/);

  // In the comparison the smart city's half shows its devices, network and zones too.
  assert.equal(await page.evaluate(()=>window.miniKota.mode),'compare');
  assert.equal(await page.isVisible('#net-legend'),true);
  await page.waitForFunction(()=>{const c=window.miniKota.cities.smart;return c.network.visible&&c.zones.visible;});
  // Tabs: one city, then the smart city with its device network.
  await page.click('[data-mode=baseline]');assert.equal(await page.isHidden('#smart-view'),true);
  await page.click('[data-mode=smart]');   // the smart city shows its devices
  assert.equal(await page.isVisible('#net-legend'),true);
  assert.match(await page.textContent('#net-legend'),/Kamera detektor antrean · 51/);
  await page.waitForTimeout(400);
  const dome=await page.evaluate(()=>{const c=window.miniKota.cities.smart,icon=c.network.icons.find(i=>c.map.objects.find(o=>o.id===i.userData.objectId).asset==='cctv');
    return {id:icon.userData.objectId,...window.miniKota.screen(icon.position.x,icon.position.z,icon.position.y,'smart')};});
  await page.mouse.click(dome.x,dome.y);
  await page.waitForSelector('#device-card:not([hidden])');
  assert.match(await page.textContent('#device-card'),new RegExp(`Kamera detektor antrean · ${dome.id}`));
  assert.match(await page.textContent('#device-card'),/Memantau\s*arah datang dari .*Di zona 80 m/s);
  // Every camera's zone is drawn; the selected one is highlighted with its field of view.
  assert.deepEqual(await page.evaluate(id=>{const z=window.miniKota.cities.smart.zones;return [z.visible,z.zones.length,z.zones.find(x=>x.id===id).cone.visible];},dome.id),[true,51,true]);

  // Device list, detail, and back to the map.
  await page.click('[data-mode=equipment]');
  await page.waitForSelector('#equipment-rows tr');
  const count=await page.locator('#equipment-rows tr').count();assert.ok(count>=50,`${count} devices`);
  // The 3D diagram labels carry the current map's counts and estimates.
  const diagram=page.frameLocator('#equipment-diagram');
  await diagram.locator('.label[data-id=cam] .figure',{hasText:'51 unit'}).waitFor({timeout:20000});
  assert.match(await diagram.locator('#figures-note').textContent(),/Mini Kota lengkap: 57 sensor/);
  await page.click('[data-filter=bin-sensor]');assert.equal(await page.locator('#equipment-rows tr').count(),6);
  await page.click('#equipment-rows tr:first-child button');
  assert.match(await page.textContent('#equipment-detail'),/Sensor ultrasonik tempat sampah/);
  await page.click('#equipment-show');
  assert.equal(await page.evaluate(()=>window.miniKota.mode),'smart');
  assert.equal(await page.isVisible('#device-card'),true);

  // Data center: sized from the devices on the map; assumptions can be changed.
  await page.click('[data-mode=compare]');
  await page.click('#data-center-details summary');
  assert.match(await page.textContent('#data-center-sensors'),/Kamera detektor antrean.*51/s);
  const before=await page.textContent('#data-center-summary');
  await page.click('#data-center-form >> xpath=..');   // open "Ubah asumsi perencanaan"
  await page.fill('[name=sampleSeconds]','0.25');await page.dispatchEvent('[name=sampleSeconds]','input');
  assert.notEqual(await page.textContent('#data-center-summary'),before);

  // Driving: the car moves, the view fills the screen, Esc returns.
  await page.click('#explore');
  await page.keyboard.down('w');await page.waitForTimeout(1500);await page.keyboard.up('w');
  const drive=await page.evaluate(()=>window.miniKota.driving.state);
  assert.equal(drive.active,true);assert.ok(Math.abs(drive.speed)>1||drive.collision,`speed ${drive.speed}`);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>window.miniKota.driving.active),false);

  // Navigation: the wheel zooms towards the cursor in either view.
  await page.locator('#viewport').scrollIntoViewIfNeeded();
  const r=await page.locator('#smart-view').boundingBox(),s={x:Math.round(r.x+r.width*0.4),y:Math.round(r.y+r.height*0.55)};
  await page.mouse.move(s.x,s.y);
  const under=await page.evaluate(([x,y])=>{const p=window.miniKota.camera.pick(x,y);return p&&[p.x,p.y,p.z];},[s.x,s.y]);
  for(let i=0;i<4;i++){await page.mouse.wheel(0,-240);await page.waitForTimeout(30);}
  const after=await page.evaluate(p=>window.miniKota.screen(p[0],p[2],p[1],'smart'),under);
  assert.ok(Math.hypot(after.x-s.x,after.y-s.y)<2,'point under the cursor stays put');

  // Settings restart both cities; a map from the editor (draft) and an OSM file can be used.
  await page.fill('[name=demand]','600');await page.dispatchEvent('[name=demand]','input');
  await page.waitForFunction(()=>window.miniKota.cities.smart.engine?.demand===600&&document.getElementById('loading').hidden,null,{timeout:90000});
  // The cameras' detection zone is a traffic setting too.
  await page.fill('[name=zone]','50');await page.dispatchEvent('[name=zone]','input');
  await page.waitForFunction(()=>{const e=window.miniKota.cities.smart.engine;return e?.zone===50&&e.sensors.every(s=>s.zone===50)&&document.getElementById('loading').hidden;},null,{timeout:90000});
  await page.evaluate(async()=>{const map=await (await fetch('maps/peta-uji.json')).json();localStorage.setItem('minikota.editor.draft',JSON.stringify({savedAt:new Date().toISOString(),map}));});
  await page.selectOption('#map-source','draft');
  await page.waitForFunction(()=>/draf editor/.test(document.getElementById('map-status').textContent),null,{timeout:90000});
  await page.setInputFiles('#map-file',fileURLToPath(new URL('./fixtures/simpang-bermedian.osm',import.meta.url)));
  await page.waitForFunction(()=>/simpang-bermedian\.osm/.test(document.getElementById('map-status').textContent),null,{timeout:90000});
  await ready();
  assert.match(await page.textContent('#map-status'),/4 simpang berlampu/);

  // The editor tab embeds the editor.
  await page.click('[data-mode=editor]');
  assert.match(await page.getAttribute('#editor-frame','src'),/editor-peta\.html\?embed=1/);
  assert.deepEqual(errors,[]);
  console.log('PASS: app on the new map: ordinary vs smart city in step, comparison, tabs, device card, device list, data center, driving, zoom to cursor, settings restart, editor draft and OSM file, editor tab.');
}finally{await browser.close();}
