import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function capture(rate,options){
  let Processor;const frames=[];
  const context=vm.createContext({sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>frames.push(new Uint8Array(data))};}},registerProcessor:(_name,value)=>{Processor=value;},Uint8Array,Math});
  vm.runInContext(readFileSync(new URL('../public/audio/sophie-capture.js',import.meta.url),'utf8'),context);
  return {processor:new Processor(options),frames};
}
test('microphone worklet converts silence into exact 20ms PCMU frames at common browser rates',()=>{
  for(const rate of [44100,48000]){
    const {processor,frames}=capture(rate);
    let count=0;while(count<rate){const length=Math.min(128,rate-count);processor.process([[new Float32Array(length)]]);count+=length;}
    assert.ok(frames.length>=49&&frames.length<=50);
    for(const frame of frames){assert.equal(frame.length,160);assert.ok(frame.every(byte=>byte===255));}
  }
});
test('microphone PCMU preserves speech polarity and amplitude instead of sending raw float/container bytes',()=>{
  for(const amplitude of [-0.3,0.3]){
    const {processor,frames}=capture(48000);
    for(let i=0;i<10;i++)processor.process([[new Float32Array(128).fill(amplitude)]]);
    const u=(~frames[0][0])&255;
    const magnitude=(((u&15)<<3)+132)<<((u>>4)&7);
    const decoded=((u&128)?132-magnitude:magnitude-132)/32768;
    assert.ok(Math.abs(decoded-amplitude)<0.02);
  }
});

test('browser capture produces 24kHz signed PCM frames with correct amplitude',()=>{
  for(const rate of [44100,48000]){
    const {processor,frames}=capture(rate,{processorOptions:{encoding:'linear16',sampleRate:24000}});
    let count=0;while(count<rate){const length=Math.min(128,rate-count);processor.process([[new Float32Array(length).fill(-0.25)]]);count+=length;}
    assert.ok(frames.length>=49&&frames.length<=50);
    for(const frame of frames){assert.equal(frame.length,960);assert.equal(new DataView(frame.buffer).getInt16(0,true),-8192);}
  }
});
