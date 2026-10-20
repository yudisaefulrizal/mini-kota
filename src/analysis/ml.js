// The learning methods of the Analisis tab, written out (no library):
//   gbt*     Gradient Boosted Trees, regression (squared error), histogram splits
//   ridge*   linear regression (with a small ridge so constant features do no harm)
//   gp*      Gaussian process regression, for Bayesian optimization
//   lcb      the acquisition: the lower confidence bound (mean - kappa * sd)
// Models are plain objects, so they can be stored (IndexedDB) and sent to a worker.

// ---------------------------------------------------------------- Gradient Boosted Trees
const BINS=32;
// X: array of feature arrays, y: targets.
export function gbtFit(X,y,{trees=40,depth=3,rate=0.1,minLeaf=3}={}){
  const n=y.length,f=X[0]?.length||0;
  const base=n?y.reduce((s,v)=>s+v,0)/n:0;
  if(n<2*minLeaf)return {base,rate,trees:[],cuts:[]};
  // Cut points per feature (quantiles), and each sample's bin.
  const cuts=[],bin=Array.from({length:f},()=>new Uint8Array(n));
  for(let j=0;j<f;j++){
    const v=X.map(x=>x[j]).sort((a,b)=>a-b),c=[];
    for(let k=1;k<BINS;k++){const q=v[Math.floor(k*n/BINS)];if(c.at(-1)!==q&&q!==v[0])c.push(q);}
    cuts.push(c);
    for(let i=0;i<n;i++){let b=0;while(b<c.length&&X[i][j]>=c[b])b++;bin[j][i]=b;}
  }
  const pred=new Float64Array(n).fill(base),out=[];
  for(let t=0;t<trees;t++){
    const r=Float64Array.from(y,(v,i)=>v-pred[i]);
    const tree=grow([...Array(n).keys()],0);
    out.push(tree);
    for(let i=0;i<n;i++)pred[i]+=rate*leaf(tree,j=>bin[j][i]);
    function grow(idx,d){
      const sum=idx.reduce((s,i)=>s+r[i],0);
      if(d>=depth||idx.length<2*minLeaf)return {v:sum/idx.length};
      let best=null;
      for(let j=0;j<f;j++){
        const cs=cuts[j].length+1,hs=new Float64Array(cs),hn=new Uint32Array(cs);
        for(const i of idx){hs[bin[j][i]]+=r[i];hn[bin[j][i]]++;}
        let ls=0,ln=0;
        for(let b=0;b<cs-1;b++){
          ls+=hs[b];ln+=hn[b];const rn=idx.length-ln;
          if(ln<minLeaf||rn<minLeaf)continue;
          const gain=ls*ls/ln+(sum-ls)*(sum-ls)/rn;
          if(!best||gain>best.gain)best={gain,j,b};
        }
      }
      if(!best)return {v:sum/idx.length};
      const left=idx.filter(i=>bin[best.j][i]<=best.b),right=idx.filter(i=>bin[best.j][i]>best.b);
      return {j:best.j,b:best.b,l:grow(left,d+1),r:grow(right,d+1)};
    }
  }
  return {base,rate,trees:out,cuts};
}
function leaf(node,binOf){while(node.l)node=binOf(node.j)<=node.b?node.l:node.r;return node.v;}
export function gbtPredict(model,x){
  const binOf=j=>{const c=model.cuts[j];let b=0;while(b<c.length&&x[j]>=c[b])b++;return b;};
  return model.trees.reduce((s,t)=>s+model.rate*leaf(t,binOf),model.base);
}

// ---------------------------------------------------------------- linear regression
// Ridge: (X'X + lambda I) w = X'y, with an intercept (not penalised).
export function ridgeFit(X,y,lambda=1e-3){
  const f=(X[0]?.length||0)+1,A=Array.from({length:f},()=>new Float64Array(f)),b=new Float64Array(f);
  X.forEach((x,i)=>{const z=[1,...x];for(let p=0;p<f;p++){b[p]+=z[p]*y[i];for(let q=0;q<f;q++)A[p][q]+=z[p]*z[q];}});
  for(let p=1;p<f;p++)A[p][p]+=lambda*Math.max(1,y.length);
  A[0][0]+=1e-9;
  return {w:[...solve(A,b)]};
}
export const ridgePredict=(m,x)=>m.w.reduce((s,w,i)=>s+w*(i?x[i-1]:1),0);
function solve(A,b){   // Gauss-Jordan with pivoting (small systems)
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){
    let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
    [M[c],M[p]]=[M[p],M[c]];const d=M[c][c]||1e-12;
    for(let k=c;k<=n;k++)M[c][k]/=d;
    for(let r=0;r<n;r++)if(r!==c){const m=M[r][c];if(m)for(let k=c;k<=n;k++)M[r][k]-=m*M[c][k];}
  }
  return M.map(r=>r[n]);
}

// ---------------------------------------------------------------- Gaussian process
// Inputs scaled to [0,1]; squared-exponential kernel; targets standardised.
const kernel=(a,b,ls)=>{let d=0;for(let i=0;i<a.length;i++){const t=(a[i]-b[i])/ls;d+=t*t;}return Math.exp(-0.5*d);};
export function gpFit(X,y,{lengthScale=0.3,noise=0.1}={}){
  const n=y.length,mean=n?y.reduce((s,v)=>s+v,0)/n:0,sd=Math.sqrt(n?y.reduce((s,v)=>s+(v-mean)**2,0)/n:0)||1;
  const z=y.map(v=>(v-mean)/sd);
  // Cholesky of K + noise I.
  const L=Array.from({length:n},()=>new Float64Array(n));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let s=kernel(X[i],X[j],lengthScale)+(i===j?noise:0);
    for(let k=0;k<j;k++)s-=L[i][k]*L[j][k];
    L[i][j]=i===j?Math.sqrt(Math.max(s,1e-12)):s/L[j][j];
  }
  const alpha=back(L,forward(L,z));
  return {X,mean,sd,lengthScale,L:L.map(r=>[...r]),alpha:[...alpha]};
}
function forward(L,b){const n=b.length,x=new Float64Array(n);for(let i=0;i<n;i++){let s=b[i];for(let k=0;k<i;k++)s-=L[i][k]*x[k];x[i]=s/L[i][i];}return x;}
function back(L,b){const n=b.length,x=new Float64Array(n);for(let i=n-1;i>=0;i--){let s=b[i];for(let k=i+1;k<n;k++)s-=L[k][i]*x[k];x[i]=s/L[i][i];}return x;}
export function gpPredict(m,x){
  if(!m.X.length)return {mean:m.mean,sd:m.sd};
  const k=m.X.map(a=>kernel(a,x,m.lengthScale));
  const mu=k.reduce((s,v,i)=>s+v*m.alpha[i],0),v=forward(m.L,k);
  const variance=Math.max(0,1-v.reduce((s,t)=>s+t*t,0));
  return {mean:m.mean+m.sd*mu,sd:m.sd*Math.sqrt(variance)};
}
// Lower confidence bound (we minimise): low mean or much unknown.
export const lcb=(p,kappa=1)=>p.mean-kappa*p.sd;
