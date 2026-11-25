import assert from 'node:assert/strict';
import test from 'node:test';
import {createOwnerDeepgramAudio} from '../lib/ai/owner-call/deepgram-browser.ts';

test('browser sends decoded PCM to one continuous player and forwards interruption/completion controls',async t=>{
  const failures=[],players=new Map();let socket;
  const node=()=>({connect(){},disconnect(){},port:{}});
  class Context {
    audioWorklet={addModule:async()=>{}};destination={};
    async resume(){}async close(){}
    createMediaStreamSource(){return node();}createGain(){return {...node(),gain:{}};}
  }
  class Worklet {
    constructor(_context,name){const value=node();value.messages=[];value.port.postMessage=data=>value.messages.push(data);players.set(name,value);return value;}
  }
  class Socket {
    static OPEN=1;static instances=[];readyState=1;bufferedAmount=0;
    constructor(_url,protocols){assert.equal(protocols[0],'bms-owner-audio-v2');Socket.instances.push(this);}
    send(){}close(){}
  }
  for(const [key,value] of Object.entries({AudioContext:Context,AudioWorkletNode:Worklet,WebSocket:Socket})){
    const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});
  }
  const audio=await createOwnerDeepgramAudio({},message=>failures.push(message));t.after(()=>audio.close());
  audio.connect('ws://127.0.0.1:18787/owner-voice/audio','a'.repeat(64));socket=Socket.instances.at(-1);
  socket.onmessage({data:JSON.stringify({type:'owner.audio.ready',encoding:'linear16',sampleRate:24000})});
  const chunk=new ArrayBuffer(48000);new DataView(chunk).setInt16(0,8192,true);
  for(let i=0;i<15;i++)socket.onmessage({data:chunk});
  const player=players.get('sophie-playback');
  assert.equal(player.messages.length,15);assert.equal(player.messages[0].samples[0],0.25);assert.deepEqual(failures,[]);
  socket.onmessage({data:JSON.stringify({type:'output_audio_buffer.cleared'})});assert.equal(player.messages.at(-1).type,'clear');
  socket.onmessage({data:new Uint8Array([0]).buffer});socket.onmessage({data:new Uint8Array([32]).buffer});
  assert.equal(player.messages.at(-1).samples[0],0.25);
  socket.onmessage({data:JSON.stringify({type:'owner.audio.synthesis_done'})});assert.equal(player.messages.at(-1).type,'done');
  assert.deepEqual(failures,[]);
});
