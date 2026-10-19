import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Runs every browser test (tests/*-smoke.mjs) one after another against a running server
// (TEST_URL, default http://localhost:5180: `npx vite preview --port 5180` after a build).
const dir=new URL('.',import.meta.url),tests=readdirSync(fileURLToPath(dir)).filter(f=>f.endsWith('-smoke.mjs')).sort();
let failed=0;
for(const file of tests){
  const run=spawnSync(process.execPath,[fileURLToPath(new URL(file,dir))],{encoding:'utf8',env:process.env});
  const ok=run.status===0;failed+=ok?0:1;
  console.log(`${ok?'✓':'✗'} ${file}${ok?'':`\n${(run.stderr||run.stdout).split('\n').filter(l=>!/^\s+at /.test(l)).slice(0,8).join('\n')}`}`);
}
console.log(`${tests.length-failed}/${tests.length} tes browser lulus`);
process.exit(failed?1:0);
