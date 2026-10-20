// Garbage truck routes for the bins that called (a capacitated vehicle routing problem):
//   1. Clarke-Wright savings: start with one trip per stop, then join the two trips whose
//      joining saves the most time (end of one -> start of the other), while the load fits
//   2. 2-opt: within each trip, reverse a stretch of the visits when that is quicker
// cost(a,b): travel seconds from a to b (shortest paths, Dijkstra; Infinity if no way), where
// a stop is its index, START the depot's way out and END the way back. load[i]: what stop i
// adds to the truck; capacity: what a truck carries. Returns {trips:[[stop...]], unreachable}.
export const START=-1,END=-2;
export function planRoutes(load,{cost,capacity}){
  const n=load.length,reach=[],unreachable=[];
  for(let i=0;i<n;i++)(Number.isFinite(cost(START,i))&&Number.isFinite(cost(i,END))?reach:unreachable).push(i);
  let trips=reach.map(i=>[i]);
  const weight=t=>t.reduce((s,i)=>s+load[i],0);
  const savings=[];
  for(const i of reach)for(const j of reach)if(i!==j){
    const s=cost(i,END)+cost(START,j)-cost(i,j);
    if(Number.isFinite(s)&&s>0)savings.push({i,j,s});
  }
  savings.sort((a,b)=>b.s-a.s);
  for(const {i,j} of savings){
    const a=trips.find(t=>t.at(-1)===i),b=trips.find(t=>t[0]===j);
    if(!a||!b||a===b||weight(a)+weight(b)>capacity)continue;
    trips=trips.filter(t=>t!==a&&t!==b);trips.push([...a,...b]);
  }
  return {trips:trips.map(t=>twoOpt(t,cost)),unreachable};
}
export function tripTime(t,cost){let s=cost(START,t[0]);for(let k=1;k<t.length;k++)s+=cost(t[k-1],t[k]);return s+cost(t.at(-1),END);}
function twoOpt(t,cost){
  let best=t,time=tripTime(t,cost),better=true;
  while(better){
    better=false;
    for(let a=0;a<best.length-1;a++)for(let b=a+1;b<best.length;b++){
      const c=[...best.slice(0,a),...best.slice(a,b+1).reverse(),...best.slice(b+1)],ct=tripTime(c,cost);
      if(ct<time-1e-9){best=c;time=ct;better=true;}
    }
  }
  return best;
}
