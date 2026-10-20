// Publishes the built app (dist/) on GitHub Pages: builds, then commits dist/ to the
// gh-pages branch (through a temporary worktree) and pushes it. Served at
// https://yudisaefulrizal.github.io/mini-kota/.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,cpSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=(cmd,args,opts={})=>execFileSync(cmd,args,{stdio:'inherit',...opts});
const out=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8'}).trim();
run('npm',['run','build']);
const commit=out('git',['rev-parse','--short','HEAD']);
const dir=mkdtempSync(join(tmpdir(),'gh-pages-'));
try{
  const exists=out('git',['ls-remote','--heads','origin','gh-pages'])!=='';
  if(exists){run('git',['fetch','origin','gh-pages']);run('git',['worktree','add','-B','gh-pages',dir,'origin/gh-pages']);}
  else run('git',['worktree','add','--orphan','-b','gh-pages',dir]);
  for(const f of readdirSync(dir))if(f!=='.git')rmSync(join(dir,f),{recursive:true,force:true});
  cpSync('dist',dir,{recursive:true});
  writeFileSync(join(dir,'.nojekyll'),'');
  run('git',['add','-A'],{cwd:dir});
  if(out('git',['-C',dir,'status','--porcelain'])){run('git',['commit','-m',`Terbitkan ${commit}`],{cwd:dir});run('git',['push','origin','gh-pages'],{cwd:dir});}
  else console.log('Tidak ada perubahan untuk diterbitkan.');
}finally{run('git',['worktree','remove','--force',dir]);}
