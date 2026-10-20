import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// The article page: photos load, the two-way junction reacts to the sliders, the data-flow
// steps and history rows switch, and the button leads to the simulation.
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Fonts come from Google; without a network the page must still work.
  page.on('console',m=>m.type()==='error'&&!/fonts\.g/.test(m.text())&&errors.push(m.text()));
  const base=process.env.TEST_URL||'http://localhost:5180';
  await page.goto(`${base}/artikel/index.html`);
  await page.waitForFunction(()=>[...document.querySelectorAll('.photos img')].every(i=>i.complete&&i.naturalWidth>0),null,{timeout:30000});
  assert.equal(await page.locator('.photos figure').count(),3);
  assert.equal(await page.locator('.point').count(),8);

  // Fixed time keeps 30 s each way; adaptive gives the busier way more green.
  const greens=()=>page.$$eval('.plan',ps=>ps.map(p=>[...p.querySelectorAll('.row span:last-child')].map(s=>parseInt(s.textContent,10))));
  let g=await greens();assert.deepEqual(g[0],[30,30]);assert.ok(g[1][0]>g[1][1]);
  await page.fill('#qa','200');await page.dispatchEvent('#qa','input');
  await page.fill('#qb','1200');await page.dispatchEvent('#qb','input');
  g=await greens();assert.deepEqual(g[0],[30,30]);assert.ok(g[1][1]>g[1][0]);
  assert.equal(await page.textContent('#qb-out'),'1200');

  await page.click('#steps button:nth-child(3)');
  assert.equal(await page.textContent('#step-name'),'Kafka');
  assert.equal(await page.getAttribute('#steps button:nth-child(3)','aria-pressed'),'true');
  await page.click('#tables button:nth-child(3)');
  assert.equal(await page.locator('#table th').count(),4);

  await page.click('.hero .cta');
  await page.waitForFunction(()=>window.miniKota?.cities,null,{timeout:30000});
  assert.deepEqual(errors,[]);
  console.log('PASS: article: photos, junction sliders, data-flow steps, history rows, link to the simulation.');
}finally{await browser.close();}
