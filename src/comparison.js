import {LiveSimulation} from './live-simulation.js';
import {SmartSimulation} from './smart-simulation.js';
import {DEFAULTS,validate} from './simulation.js';

export class SimulationComparison {
  constructor(config={}){this.reset(config);}
  reset(config){
    const valid=validate({...DEFAULTS,...config});
    this.baseline=new LiveSimulation(valid);this.smart=new SmartSimulation(valid);
  }
  applyConfig(config){
    const valid=validate({...DEFAULTS,...config});
    this.baseline.applyConfig(valid);this.smart.applyConfig(valid);
  }
  step(dt=.25){this.baseline.step(dt);this.smart.step(dt);}
  get stats(){
    const baseline=this.baseline.stats,smart=this.smart.stats;
    return {baseline,smart,time:this.baseline.time,queueSavedSeconds:baseline.totalQueueSeconds-smart.totalQueueSeconds,fuelSavedLiters:baseline.idleFuelLiters-smart.idleFuelLiters};
  }
}
