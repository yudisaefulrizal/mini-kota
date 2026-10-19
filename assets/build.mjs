// Build every 3D asset with Blender (headless), or only some.
//   npm run assets                      all scripts
//   npm run assets -- vehicles          one category
//   npm run assets -- vehicles car      selected assets of a category
// Set BLENDER=/path/to/blender if it is not on PATH.
import {spawnSync} from 'node:child_process';
import {readdirSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url)),scripts=join(root,'blender');
const blender=process.env.BLENDER||'blender';
const [category,...ids]=process.argv.slice(2);
const categories=readdirSync(scripts,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name!=='lib'&&!d.name.startsWith('_')).map(d=>d.name);
if(category&&!categories.includes(category)){console.error(`Kategori tidak dikenal: ${category}. Pilihan: ${categories.join(', ')}`);process.exit(1);}
let failed=0;
for(const name of category?[category]:categories){
  for(const file of readdirSync(join(scripts,name)).filter(f=>f.endsWith('.py'))){
    const script=join(scripts,name,file);if(!existsSync(script))continue;
    console.log(`\n▶ ${name}/${file}${ids.length?` (${ids.join(', ')})`:''}`);
    const run=spawnSync(blender,['-b','--python-exit-code','1','--python',script,...(ids.length?['--',...ids]:[])],{encoding:'utf8'});
    const lines=(run.stdout+run.stderr).split('\n').filter(l=>/EXPORTED|Error|Traceback|line \d+/.test(l));
    for(const l of lines)console.log('  '+l.replace(/^.*public\//,'public/'));
    if(run.status!==0){failed++;console.error(`  ✗ gagal (kode ${run.status})`);}
  }
}
console.log(failed?`\n${failed} skrip gagal.`:'\nSelesai. Daftar aset: public/models/manifest.json');
process.exit(failed?1:0);
