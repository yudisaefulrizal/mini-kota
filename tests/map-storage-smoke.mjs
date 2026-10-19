import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Save and load in the map editor: draft after a reload, download, open, broken file.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  const url=`${process.env.TEST_URL||'http://localhost:5180'}/editor-peta.html`;
  const ready=()=>page.waitForFunction(()=>window.mapEditor?.geometry&&document.querySelector('[data-asset]'),null,{timeout:30000});
  await page.goto(url);await ready();
  await page.evaluate(()=>localStorage.clear());
  const at=async(x,z)=>page.evaluate(([x,z])=>window.mapEditor.screen(x,z),[x,z]);
  const click=async(x,z)=>{const s=await at(x,z);await page.mouse.click(s.x,s.y);};
  const state=()=>page.evaluate(()=>({name:window.mapEditor.map.name,roads:window.mapEditor.map.roads.length}));

  // Edit an empty map and name it.
  await page.selectOption('#map-select','empty');await page.waitForFunction(()=>window.mapEditor.map.name==='Peta baru');
  await page.keyboard.press('r');for(const [x,z] of [[100,100],[500,120]])await click(x,z);await page.keyboard.press('Enter');
  await page.fill('#map-name','Kota Uji Simpan');await page.press('#map-name','Enter');
  // The draft is written 0.4 s after the last change: wait for the one with the new name.
  await page.waitForFunction(()=>/draf di browser/.test(document.getElementById('save-state').textContent)&&JSON.parse(localStorage.getItem('minikota.editor.draft')||'{}').map?.name==='Kota Uji Simpan');

  // Reload: the draft is offered and restores the work.
  await page.reload();await ready();
  assert.equal(await page.locator('#draft-card').isVisible(),true);
  assert.match(await page.textContent('#draft-card'),/Kota Uji Simpan · 1 jalan/);
  await page.click('#draft-restore');
  assert.deepEqual(await state(),{name:'Kota Uji Simpan',roads:1});

  // Download, then open the downloaded file on top of another map.
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#download')]);
  assert.equal(download.suggestedFilename(),'kota-uji-simpan.json');
  const dir=await mkdtemp(join(tmpdir(),'peta-')),file=join(dir,download.suggestedFilename());
  await download.saveAs(file);
  const saved=JSON.parse(await readFile(file,'utf8'));
  assert.equal(saved.format,'minikota-map');assert.ok(saved.meta.savedAt);
  assert.match(await page.textContent('#save-state'),/Diunduh/);
  await page.selectOption('#map-select','maps/peta-uji.json');await page.waitForFunction(()=>window.mapEditor.map.name.includes('uji'));
  await page.setInputFiles('#file-input',file);
  await page.waitForFunction(()=>window.mapEditor.map.name==='Kota Uji Simpan');
  assert.deepEqual(await state(),{name:'Kota Uji Simpan',roads:1});
  assert.match(await page.textContent('#map-select option[value=file]'),/kota-uji-simpan\.json/);

  // A broken file is refused and the current map stays.
  const bad=join(dir,'rusak.json');await writeFile(bad,'{bukan json');
  await page.setInputFiles('#file-input',bad);
  await page.waitForFunction(()=>/Gagal membuka rusak\.json/.test(document.getElementById('status').textContent));
  assert.deepEqual(await state(),{name:'Kota Uji Simpan',roads:1});

  // Discarding the draft removes it for good.
  await page.reload();await ready();
  await page.click('#draft-discard');
  await page.reload();await ready();
  assert.equal(await page.locator('#draft-card').isHidden(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: draft survives a reload and restores, download with readable name, open file, broken file refused, discard draft.');
}finally{await browser.close();}
