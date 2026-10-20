import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {miniKotaLengkap} from '../src/map/default-map.js';
import {networkSummary} from '../src/map/network.js';

// The device network in the map editor: lettered icons, cables and radio by medium, a
// legend, data packets, icon clicks (selection panel when editing, live card while the
// simulation runs) and the layer switch.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${process.env.TEST_URL||'http://localhost:5180'}/editor-peta.html`);
  await page.waitForFunction(()=>window.mapEditor?.geometry&&document.querySelector('[data-asset]'),null,{timeout:30000});
  await page.evaluate(()=>localStorage.clear());
  const net=()=>page.evaluate(()=>{const n=window.mapEditor.network;return {icons:n.icons.length,links:n.links.length,lines:n.lines.map(l=>l.userData.network),packets:n.packets.length,visible:n.visible};});
  let s=await net();
  // Expected counts come from the map itself (the same rules, src/map/network.js).
  const want=networkSummary(miniKotaLengkap()),devices=Object.values(want.devices).reduce((a,b)=>a+b,0);
  assert.equal(s.icons,devices);assert.equal(s.links,want.links.length);assert.deepEqual(s.lines,['lan','fiber','lora','lamp']);
  // A camera for every outer approach of the 15 signalised junctions.
  assert.equal(want.devices.cctv,51);assert.equal(want.devices['cctv-dome'],undefined);
  const legend=await page.textContent('#net-legend');
  assert.match(legend,/Kamera detektor antrean · 51/);
  assert.match(legend,/Lampu lalu lintas · 101\s*50 kendaraan, 51 penyeberang/);
  assert.match(legend,new RegExp(`LoRaWAN · ${want.media.lora} sambungan`));assert.match(legend,new RegExp(`Fiber optik · ${want.media.fiber} sambungan`));
  await page.waitForFunction(()=>window.mapEditor.network.packets.length>5,null,{timeout:10000});

  // Clicking an icon selects the device and lists its connections.
  await page.evaluate(()=>window.mapEditor.focus(209,163,70));await page.waitForTimeout(500);
  const iconAt=asset=>page.evaluate(asset=>{const m=window.mapEditor.map,o=m.objects.filter(o=>o.asset===asset).sort((a,b)=>Math.hypot(a.x-209,a.z-163)-Math.hypot(b.x-209,b.z-163))[0];
    const icon=window.mapEditor.network.icons.find(i=>i.userData.objectId===o.id);return {id:o.id,...window.mapEditor.screen(icon.position.x,icon.position.z,icon.position.y)};},asset);
  let dome=await iconAt('cctv');
  await page.mouse.click(dome.x,dome.y);
  assert.deepEqual(await page.evaluate(()=>window.mapEditor.selection),{type:'object',id:dome.id});
  assert.match(await page.textContent('#selection'),/Jaringan\s*Ke Gateway edge o\d+ · LAN/);
  // A selected camera shows its detection zone and which approach it watches; the zone length can be set.
  assert.match(await page.textContent('#selection'),/Memantau arah datang dari/);
  assert.deepEqual(await page.evaluate(()=>{const z=window.mapEditor.zones;return [z.visible,z.zones.length,z.zones[0]?.id];}),[true,1,dome.id]);
  // One zone length for all cameras, in the simulation panel; the preview follows it.
  await page.fill('#sim-zone','50');await page.dispatchEvent('#sim-zone','change');
  await page.waitForFunction(()=>window.mapEditor.zones.zones.length===1&&/50 m/.test(document.getElementById('selection').textContent));
  await page.fill('#sim-zone','80');await page.dispatchEvent('#sim-zone','change');

  // While the simulation runs, packets follow the cameras' counts and the card is live.
  await page.check('#sim-adaptive');await page.click('#sim-start');
  await page.waitForFunction(()=>window.mapEditor.sim?.view?.parts?.length>0,null,{timeout:30000});
  await page.selectOption('#sim-speed','10');
  await page.waitForFunction(()=>window.mapEditor.sim.engine.time>90,null,{timeout:120000});
  await page.selectOption('#sim-speed','1');
  dome=await iconAt('cctv');await page.mouse.click(dome.x,dome.y);
  await page.waitForSelector('#device-card:not([hidden])');
  assert.match(await page.textContent('#device-card'),/Di zona 80 m\s*\d+ kendaraan[\s\S]*Melewati garis henti\s*\d+/);
  assert.equal(await page.evaluate(()=>window.mapEditor.zones.zones.length),51);
  assert.match(await page.textContent('#device-card'),/Adaptif/);
  const dc=await page.evaluate(()=>{const n=window.mapEditor.network,dc=window.mapEditor.map.objects.find(o=>o.asset==='data-center');return n.stats.get(dc.id)?.received||0;});
  assert.ok(dc>10,`data centre received ${dc}`);
  const ctrl=await iconAt('controller');await page.mouse.click(ctrl.x,ctrl.y);
  assert.match(await page.textContent('#device-card'),/Fase\s*\d dari \d/);
  await page.click('#device-card-close');assert.equal(await page.isHidden('#device-card'),true);
  await page.click('#sim-stop');

  // Gateway reach is a field of the map: a short cable reach leaves devices out of reach.
  await page.fill('#reach-cable','20');await page.dispatchEvent('#reach-cable','change');
  assert.equal(await page.evaluate(()=>window.mapEditor.map.network.cableReach),20);
  assert.match(await page.textContent('#warnings'),/perangkat di luar jangkauan gateway \(kabel 20 m/);
  await page.fill('#reach-cable','75');await page.dispatchEvent('#reach-cable','change');
  assert.equal(await page.evaluate(()=>window.mapEditor.map.network),undefined);

  // The layer switch hides icons, cables and legend.
  await page.uncheck('#layer-links');
  s=await net();assert.equal(s.visible,false);assert.equal(await page.isHidden('#net-legend'),true);
  await page.check('#layer-links');assert.equal((await net()).visible,true);
  assert.deepEqual(errors,[]);
  console.log('PASS: device network: icons, LAN/fiber/LoRaWAN links, legend, packets, icon click selects, live card in simulation, layer switch.');
}finally{await browser.close();}
