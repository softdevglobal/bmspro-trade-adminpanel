// Local AudioWorklet: browser voice uses 24kHz PCM; PCMU remains available
// for codec regression checks. No network access or credentials exist here.
class SophieCapture extends AudioWorkletProcessor {
  constructor(options){super();this.rate=options?.processorOptions?.sampleRate||8000;this.linear=options?.processorOptions?.encoding==='linear16';this.frameBytes=this.rate/50*(this.linear?2:1);this.sum=0;this.count=0;this.phase=0;this.frame=new Uint8Array(this.frameBytes);this.used=0;}
  encode(value){
    let pcm=Math.max(-32768,Math.min(32767,Math.round(value*32768)));
    const sign=pcm<0?128:0;if(pcm<0)pcm=-pcm;
    pcm=Math.min(pcm,32635)+132;
    let exponent=7;for(let mask=16384;exponent>0&&!(pcm&mask);exponent--,mask>>=1){}
    return (~(sign|(exponent<<4)|((pcm>>(exponent+3))&15)))&255;
  }
  process(inputs){
    const samples=inputs[0]?.[0];if(!samples)return true;
    for(const value of samples){
      this.sum+=value;this.count++;this.phase+=this.rate;
      if(this.phase>=sampleRate){
        this.phase-=sampleRate;
        const sample=this.sum/this.count;
        if(this.linear){const pcm=Math.max(-32768,Math.min(32767,Math.round(sample*32768)));this.frame[this.used++]=pcm&255;this.frame[this.used++]=(pcm>>8)&255;}
        else this.frame[this.used++]=this.encode(sample);
        this.sum=0;this.count=0;
        if(this.used===this.frameBytes){this.port.postMessage(this.frame.buffer,[this.frame.buffer]);this.frame=new Uint8Array(this.frameBytes);this.used=0;}
      }
    }
    return true;
  }
}
registerProcessor('sophie-capture',SophieCapture);
