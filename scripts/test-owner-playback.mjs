import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function playback(rate=48000){
  let Processor;const events=[];
  const context=vm.createContext({sampleRate:rate,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:event=>events.push(event)};}},registerProcessor:(_name,value)=>{Processor=value;}});
  vm.runInContext(readFileSync(new URL('../public/audio/sophie-playback.js',import.meta.url),'utf8'),context);
  const processor=new Processor();
  return {processor,events,send:data=>processor.port.onmessage({data}),render:()=>{const output=new Float32Array(128);processor.process([],[[output]]);return output;}};
}
test('opening syllable waits for actual buffered audio and short replies flush on completion',()=>{
  const {send,render,events}=playback();
  send({type:'audio',samples:new Float32Array(480).fill(0.25)});
  assert.ok(render().every(x=>x===0));assert.ok(!events.some(e=>e.type==='started'));
  send({type:'done'});assert.ok(render().every(x=>x===0.25));assert.ok(events.some(e=>e.type==='started'));
});
test('one continuous resampling clock survives irregular packet boundaries without gaps',()=>{
  for(const rate of [44100,48000]){
    const {send,render,events}=playback(rate);
    for(const length of [31,253,17,999,3000,700])send({type:'audio',samples:new Float32Array(length).fill(0.3)});
    for(let block=0;block<40;block++){
      const output=render();assert.ok(output.every(x=>Math.abs(x-0.3)<0.00001));
      if(block%4===0)send({type:'audio',samples:new Float32Array(251).fill(0.3)});
    }
    assert.ok(!events.some(e=>e.type==='underrun'));
  }
});
test('an actual network underrun rebuffers and interruption immediately removes old samples',()=>{
  const {send,render,events}=playback();
  send({type:'audio',samples:new Float32Array(4400).fill(0.5)});
  for(let i=0;i<75;i++)render();
  assert.ok(events.some(e=>e.type==='underrun'));
  send({type:'clear'});assert.ok(render().every(x=>x===0));
  send({type:'audio',samples:new Float32Array(4400).fill(-0.25)});assert.ok(render().every(x=>x===-0.25));
});
test('valid 15-second replies fit while audio memory is bounded at 60 seconds',()=>{
  const {send,processor,events}=playback();
  send({type:'audio',samples:new Float32Array(24000*15)});assert.equal(processor.available,24000*15);
  send({type:'audio',samples:new Float32Array(24000*60)});assert.ok(events.some(e=>e.type==='overflow'));assert.equal(processor.available,24000*15);
});
