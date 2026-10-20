import {TrafficEngine} from '../traffic/engine.js';
import {train} from './learn.js';
import {readChunks} from './store.js';

// Training off the main thread: reads the history from this browser's storage (the chunks
// listed) plus the records not stored yet, and trains the six models (src/analysis/learn.js).
self.onmessage=async({data:{map,options,key,seqs,partial,reg,total}})=>{
  try{
    const engine=new TrafficEngine(map,{...options,learned:null});   // the road layout
    async function* chunks(){yield* readChunks(key,seqs);if(partial)yield partial;}
    const out=await train(chunks(),{reg,engine,onProgress:n=>self.postMessage({type:'progress',fraction:total?n/total:1})});
    self.postMessage({type:'done',out});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
