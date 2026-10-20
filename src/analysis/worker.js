import {TrafficEngine} from '../traffic/engine.js';
import {train,evaluate} from './learn.js';

// One learning round off the main thread: train on the history the smart city recorded as it
// ran (with the model in use), then compare test days with the model in use and with the new
// one (simulated here, as a digital twin: the real city cannot run both at once).
// The new model is adopted only when it does clearly better: at least MARGIN fewer seconds
// spent queueing over the test days (a smaller gain may be chance).
const MARGIN=0.02,DAYS=4;
self.onmessage=({data:{map,options,history,evalSeconds,previous,applied}})=>{
  const progress=(stage,fraction)=>self.postMessage({type:'progress',stage,fraction});
  try{
    const engine=new TrafficEngine(map,{...options,learned:applied});   // the layout the history came from
    const model=train(engine,history,previous,applied);progress('train',1);
    const make=(learned,seed)=>new TrafficEngine(map,{...options,seed,learned});
    const seeds=Array.from({length:DAYS},(_,i)=>options.seed+i);
    const current=evaluate(make,applied,{seconds:evalSeconds,seeds,onProgress:f=>progress('evaluate',f*0.5)});
    const candidate=evaluate(make,model.learned,{seconds:evalSeconds,seeds,onProgress:f=>progress('evaluate',0.5+f*0.5)});
    model.evaluation={seconds:evalSeconds,days:seeds.length,current,candidate};
    const cost=r=>r.queueSeconds+r.backlogSeconds;
    model.adopted=cost(candidate)<cost(current)*(1-MARGIN);
    self.postMessage({type:'done',model});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
