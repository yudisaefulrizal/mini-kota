// Fixed scenario assumptions, expressed as hours from the start of day one.
export const WORK_SHIFTS = [[7,15],[15,23],[23,31]];
export const UNIVERSITY_SHIFTS = [[7,11],[13,17],[18,22]];

export function destinationCount(config,rng){
  const draw=rng()*100;
  return draw<config.oneDestination?1:draw<config.oneDestination+config.twoDestinations?2:3;
}

// Construct a feasible itinerary around one mandatory activity. Optional stops
// can be before or after it; home and the previous night's return are not stops.
export function planActivities({home,primary,earliest,requested,worker,config,travel,rng,day=0}){
  const stops=[{...primary,optional:false}];
  const candidates=[
    {id:'shop',open:config.shopStart*3600,close:config.shopEnd*3600,duration:(.5+rng())*3600},
    {id:'park',open:6*3600,close:20*3600,duration:(.5+rng()*.5)*3600},
    {id:'cityCenter',open:8*3600,close:22*3600,duration:(.5+rng())*3600},
    ...(worker?[{id:'university',open:18*3600,close:22*3600,duration:4*3600,fixed:true}]:[]),
  ].filter(s=>s.id!==primary.id);
  for(const candidate of candidates){candidate.open+=day*86400;candidate.close+=day*86400;}
  for(let i=candidates.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  for(const candidate of candidates){
    if(stops.length>=requested)break;
    // Prefer after the main activity, then try gaps before it.
    for(let i=stops.length;i>=0;i--){
      const previous=stops[i-1],next=stops[i];
      const arrival=(previous?previous.end:earliest)+travel(previous?.id??home,candidate.id)+180;
      const start=candidate.fixed?candidate.open:Math.max(candidate.open,arrival),end=start+candidate.duration;
      if(start<arrival||end>candidate.close)continue;
      const limit=next?next.start:(day+1)*86400;
      if(end+travel(candidate.id,next?.id??home)+180>limit)continue;
      stops.splice(i,0,{...candidate,start,end,optional:true});break;
    }
  }
  let from=home,at=earliest;
  const jobs=stops.map(stop=>{
    const departure=Math.max(at,stop.start-travel(from,stop.id)-180);
    const job={from,to:stop.id,at:departure,due:stop.start,until:stop.end,stay:stop.optional?stop.duration:120,optional:stop.optional,close:stop.close,activityDuration:stop.duration??stop.end-stop.start};
    from=stop.id;at=stop.end;return job;
  });
  jobs.push({from,to:home,at,stay:0});
  return {stops,jobs};
}
