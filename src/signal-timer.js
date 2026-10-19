// Seconds until the displayed colour changes. Adaptive green durations use
// their maximum as a conservative estimate, since future demand is unknown.
export function signalTimer(sim,node,axis){
  const phase=sim.phase(node,axis),signal=sim.adaptiveSignals?.get(node.id);
  let remaining;
  if(signal){
    const maximum=Math.min(90,Math.max(10,sim.config.green*2));
    const elapsed=Math.max(0,sim.time-signal.since);
    const stageLeft=Math.max(0,({green:maximum,yellow:3,red:1})[signal.stage]-elapsed);
    remaining=signal.axis===axis
      ? (signal.stage==='red'?stageLeft+maximum+4:stageLeft)
      : stageLeft+(signal.stage==='green'?4:signal.stage==='yellow'?1:0);
  }else{
    const green=node.signalGreen??sim.config.green,period=2*(green+4);
    const anchor=node.signalAnchor??-node.id*3;
    const own=((sim.time-anchor+(axis==='x'?0:green+4))%period+period)%period;
    remaining=(phase==='green'?green:phase==='yellow'?green+3:period)-own;
    // A red Z approach can span the boundary where a new cycle is applied.
    if(phase==='red'&&axis==='z'&&node.switchAt>sim.time&&node.switchAt<sim.time+remaining){
      remaining=node.switchAt-sim.time+node.requestedGreen+4;
    }
  }
  return {phase,seconds:Math.max(1,Math.ceil(remaining)),estimated:!!signal};
}
