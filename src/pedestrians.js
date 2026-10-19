// A separate, bidirectional walking graph. Cars never use these edges.
const distance=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
export const hasTrafficSignal=node=>node.edges.length>=3&&!node.lot&&!node.access&&!node.roundabout;
export function makePedestrianNetwork(network,lots){
  const nodes=[],edges=[],ports=new Map(),destinations={},cache=new Map();
  const add=p=>{nodes.push({...p,edges:[]});return nodes.length-1;};
  const connect=(a,b,points,kind='sidewalk')=>{
    const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
    if(lengths.at(-1)<1e-6)return;
    const id=edges.length;edges.push({a,b,points,lengths,length:lengths.at(-1),kind});nodes[a].edges.push(id);nodes[b].edges.push(id);
  };
  const seen=new Set();
  for(const road of network.edges){
    if([road.from,road.to].some(id=>network.nodes[id].lot&&!network.nodes[id].external))continue;
    const key=[road.from,road.to].sort((a,b)=>a-b).join(':');if(seen.has(key))continue;seen.add(key);
    const source=road.points,trim=Math.min(26,road.length/4);
    for(const side of [-1,1]){
      const points=source.map((p,i)=>{
        const a=source[Math.max(0,i-1)],b=source[Math.min(source.length-1,i+1)],len=distance(a,b);
        return {x:p.x-(b.z-a.z)/len*18*side,z:p.z+(b.x-a.x)/len*18*side};
      });
      // Leave room for the approach sidewalks beside each roundabout opening.
      // Its short arc segments must be trimmed cumulatively, not one segment at a time.
      for(let end=0;end<2;end++){
        const endpoint=network.nodes[end===0?road.from:road.to];
        if(endpoint.external){
          // Meet the map boundary along the road direction, including diagonal exits.
          const i=end===0?0:source.length-1,j=end===0?1:source.length-2;
          const dx=source[j].x-source[i].x,dz=source[j].z-source[i].z;
          const t=endpoint.x===0||endpoint.x===1536?(endpoint.x-points[0].x)/dx:(endpoint.z-points[0].z)/dz;
          points[0]={x:points[0].x+dx*t,z:points[0].z+dz*t};
        }else if(endpoint.roundabout){
          let remaining=road.roundabout&&side===1?Math.min(trim,distance(points[0],points[1])*.4):trim;
          while(points.length>2&&distance(points[0],points[1])<=remaining){remaining-=distance(points[0],points[1]);points.shift();}
          const a=points[0],b=points[1],ratio=remaining/distance(a,b);
          points[0]={x:a.x+(b.x-a.x)*ratio,z:a.z+(b.z-a.z)*ratio};
        }else{
          const i=end===0?0:source.length-1,j=end===0?1:source.length-2;
          const a=source[i],b=source[j],len=distance(a,b),amount=Math.min(trim,len*.4);
          points[0].x+=(b.x-a.x)/len*amount;points[0].z+=(b.z-a.z)/len*amount;
        }
        points.reverse();
      }
      const a=add(points[0]),b=add(points.at(-1));connect(a,b,points);
      for(const [node,id] of [[road.from,a],[road.to,b]]){if(!ports.has(node))ports.set(node,[]);ports.get(node).push({id,road:key,ring:road.roundabout,inner:road.roundabout&&side===1});}
    }
  }
  for(const [id,list] of ports){
    const center=network.nodes[id];
    if(center.roundabout){
      const inner=list.filter(p=>p.inner),outer=list.filter(p=>p.ring&&!p.inner),approach=list.filter(p=>!p.ring);
      // Keep the island sidewalk separate from the circulating roadway.
      connect(inner[0].id,inner[1].id,inner.map(p=>nodes[p.id]));
      for(const p of outer){
        const nearest=approach.reduce((best,q)=>distance(nodes[p.id],nodes[q.id])<distance(nodes[p.id],nodes[best.id])?q:best);
        connect(p.id,nearest.id,[nodes[p.id],nodes[nearest.id]]);
      }
      connect(approach[0].id,approach[1].id,approach.map(p=>nodes[p.id]),'crossing');
      continue;
    }
    list.sort((a,b)=>Math.atan2(nodes[a.id].z-center.z,nodes[a.id].x-center.x)-Math.atan2(nodes[b.id].z-center.z,nodes[b.id].x-center.x));
    for(let i=0;i<(list.length===2?1:list.length);i++){
      const a=list[i],b=list[(i+1)%list.length],crossing=a.road===b.road;
      if(crossing&&!hasTrafficSignal(center))continue;
      connect(a.id,b.id,[nodes[a.id],nodes[b.id]],crossing?'crossing':'sidewalk');
    }
  }
  for(const lot of lots){
    const gate={x:lot.gate[0],z:lot.gate[1]},roadNode=lot.external?network.lotNodes[lot.id]:network.nodes.find(n=>n.x===lot.road[0]&&n.z===lot.road[1]).id;
    const nearest=ports.get(roadNode).reduce((best,p)=>distance(nodes[p.id],gate)<distance(nodes[best.id],gate)?p:best);
    const id=add(gate);destinations[lot.id]=id;connect(id,nearest.id,[gate,nodes[nearest.id]],lot.external?'boundary':'access');
  }
  function route(from,to){
    const key=`${from}:${to}`;if(cache.has(key))return cache.get(key);
    const start=destinations[from],end=destinations[to],d=nodes.map(()=>Infinity),prev=[],visited=new Set();d[start]=0;
    while(visited.size<nodes.length){let u=-1;for(let i=0;i<d.length;i++)if(!visited.has(i)&&(u<0||d[i]<d[u]))u=i;if(u===end||u<0||!Number.isFinite(d[u]))break;visited.add(u);
      for(const id of nodes[u].edges){const e=edges[id],v=e.a===u?e.b:e.a;if(d[u]+e.length<d[v]){d[v]=d[u]+e.length;prev[v]={u,id};}}
    }
    if(!Number.isFinite(d[end]))throw Error('Jalur pejalan kaki tidak terhubung.');
    const parts=[];for(let at=end;at!==start;){const {u,id}=prev[at],e=edges[id];parts.unshift(e.a===u?e.points:[...e.points].reverse());at=u;}
    const points=parts.flatMap((p,i)=>i?p.slice(1):p),lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
    const result={points,lengths,length:d[end]};cache.set(key,result);return result;
  }
  return {nodes,edges,route};
}
export function walkingPosition(route,units){
  if(!route.points.length)return null;
  const s=Math.max(0,Math.min(route.length,units));let i=1;while(i<route.lengths.length-1&&route.lengths[i]<s)i++;
  if(route.points.length===1)return {...route.points[0],angle:0};
  const a=route.points[i-1],b=route.points[i],t=(s-route.lengths[i-1])/(route.lengths[i]-route.lengths[i-1]||1);
  return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,angle:Math.atan2(b.x-a.x,b.z-a.z)};
}
