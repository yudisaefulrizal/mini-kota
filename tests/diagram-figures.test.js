import test from 'node:test';
import assert from 'node:assert/strict';
import {miniKotaLengkap} from '../src/map/default-map.js';
import {diagramFigures} from '../src/app/diagram-figures.js';
import {estimateDataCenter} from '../src/app/data-center.js';
import {DEVICES} from '../src/devices.js';

test('the 3D diagram gets figures for every device, from the same estimate as the data center',()=>{
  const map=miniKotaLengkap(),f=diagramFigures(map),e=estimateDataCenter(map);
  for(const d of DEVICES){assert.ok(f[d.id]?.short,`${d.id} short`);assert.ok(f[d.id].lines.length>=2,`${d.id} lines`);}
  assert.equal(f.cam.short,'51 unit');assert.equal(f.gw.short,`${e.gateways} unit`);
  assert.match(f.kafka.short,/^51,1 pesan\/dtk$/);assert.match(f.note,/57 sensor/);
  // Assumptions change the estimate: one message every 2 s halves the camera rate.
  assert.match(diagramFigures(map,{sampleSeconds:2,payloadBytes:256,retentionDays:30,eventCpuMs:.2}).cam.lines[1],/^25,5 pesan\/dtk/);
});
