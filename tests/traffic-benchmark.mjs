// Run separately from unit tests: npm run benchmark:traffic -- 4 42
// Arguments: simulated hours from 05:30, seed. Output: JSON lines per 30 minutes.
import assert from 'node:assert/strict';
import {SimulationComparison} from '../src/comparison.js';
const hours=Number(process.argv[2]??4),seed=Number(process.argv[3]??42);
assert.ok(Number.isFinite(hours)&&hours>0&&Number.isInteger(seed),'Expected positive hours and integer seed');
for(const throughRate of [500,1000]){
 const pair=new SimulationComparison({throughRate,seed});
 const steps=Math.ceil(hours*3600/.25);
 for(let i=1;i<=steps;i++){
  pair.step(.25);
  if(i%7200!==0&&i!==steps)continue;
  const stats=pair.stats;
  assert.equal(pair.baseline.time,pair.smart.time);
  assert.equal(stats.baseline.throughPlanned,stats.smart.throughPlanned);
  const row={throughRate,seed,clock:pair.baseline.clock(),elapsedHours:i*.25/3600};
  for(const name of ['baseline','smart']){
   const s=stats[name];
   assert.equal(s.totalQueueSeconds,s.queueSeconds+s.gateQueueSeconds);
   assert.ok(s.gateQueueSeconds>=0);
   row[name]={roadQueueHours:s.queueSeconds/3600,gateQueueHours:s.gateQueueSeconds/3600,totalQueueHours:s.totalQueueSeconds/3600,waiting:s.waiting,gateWaiting:s.gateWaiting,driving:s.driving,throughCompleted:s.throughCompleted,throughScheduled:s.throughPlanned,speed:s.speed};
  }
  console.log(JSON.stringify(row));
 }
}
