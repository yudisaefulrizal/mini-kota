import {TrafficEngine} from '../traffic/engine.js';
import {collect,train,evaluate} from './learn.js';

// One learning round off the main thread: collect a day of the smart city (with the model in
// use), train on it, then compare the same test day with the model in use and with the new one.
// The new model is adopted only when it does clearly better: at least MARGIN fewer seconds
// spent queueing over the test days (a smaller gain may be chance).
const MARGIN=0.02,DAYS=4;
self.onmessage=({data:{map,options,collectSeconds,evalSeconds,previous,applied}})=>{
  const progress=(stage,fraction)=>self.postMessage({type:'progress',stage,fraction});
  try{
    const round=(previous?.round||0)+1;
    const engine=new TrafficEngine(map,{...options,seed:options.seed+round*101,learned:applied});
    const data=collect(engine,{seconds:collectSeconds,onProgress:f=>progress('collect',f)});
    const model=train(engine,data,previous,applied);progress('train',1);
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
