// Continuous 24kHz PCM playback. Resampling state survives network packet
// boundaries; new packets never create independent browser resamplers.
class SophiePlayback extends AudioWorkletProcessor {
  constructor(){
    super();this.rate=24000;this.capacity=this.rate*60;this.ring=new Float32Array(this.capacity);
    this.read=0;this.write=0;this.available=0;this.phase=0;this.running=false;this.complete=false;
    this.port.onmessage=({data})=>{
      if(data.type==='clear'){
        this.read=0;this.write=0;this.available=0;this.phase=0;this.running=false;this.complete=false;
        this.port.postMessage({type:'stopped'});return;
      }
      if(data.type==='done'){this.complete=true;return;}
      if(data.type!=='audio'||!(data.samples instanceof Float32Array))return;
      if(this.available+data.samples.length>this.capacity){this.port.postMessage({type:'overflow'});return;}
      this.complete=false;
      for(const sample of data.samples){this.ring[this.write]=sample;this.write=(this.write+1)%this.capacity;}
      this.available+=data.samples.length;
    };
  }
  process(_inputs,outputs){
    const output=outputs[0]?.[0];if(!output)return true;output.fill(0);
    if(!this.running){
      if(this.available<4320&&!(this.complete&&this.available))return true;
      this.running=true;this.port.postMessage({type:'started'});
    }
    const step=this.rate/sampleRate;
    for(let i=0;i<output.length;i++){
      if(this.available<2&&!(this.complete&&this.available===1)){
        this.running=false;
        this.port.postMessage({type:this.complete?'stopped':'underrun'});
        if(!this.available)this.phase=0;
        break;
      }
      const a=this.ring[this.read],b=this.available>1?this.ring[(this.read+1)%this.capacity]:a;
      output[i]=a+(b-a)*this.phase;
      this.phase+=step;
      while(this.phase>=1&&this.available){this.phase-=1;this.read=(this.read+1)%this.capacity;this.available--;}
    }
    return true;
  }
}
registerProcessor('sophie-playback',SophiePlayback);
