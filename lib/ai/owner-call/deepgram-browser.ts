export type OwnerAudioChannel = {
  readyState: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  send: (data: string) => void;
};

/** Browser audio only. Provider secrets and model/tool decisions stay on the bridge. */
export async function createOwnerDeepgramAudio(stream: MediaStream, fail: (message: string) => void) {
  const context = new AudioContext();
  await context.resume();
  try {
    await context.audioWorklet.addModule("/audio/sophie-capture.js");
    await context.audioWorklet.addModule("/audio/sophie-playback.js");
  }
  catch (error) { await context.close(); throw error; }
  const capture = new AudioWorkletNode(context, "sophie-capture", { processorOptions: { encoding: "linear16", sampleRate: 24000 } });
  const source = context.createMediaStreamSource(stream);
  const mute = context.createGain(); mute.gain.value = 0;
  source.connect(capture); capture.connect(mute); mute.connect(context.destination);
  const playback = new AudioWorkletNode(context, "sophie-playback", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  playback.connect(context.destination);
  let socket: WebSocket | undefined, closed = false;
  let partial = new Uint8Array(0);
  const notify = (event: object) => channel.onmessage?.({ data: JSON.stringify(event) });
  const clear = () => { playback.port.postMessage({ type: "clear" }); partial = new Uint8Array(0); };
  const channel: OwnerAudioChannel = {
    readyState: "connecting", onopen: null, onclose: null, onmessage: null,
    send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(data); },
  };
  playback.port.onmessage = ({ data }) => {
    if (closed) return;
    if (data.type === "started") notify({ type: "output_audio_buffer.started" });
    if (data.type === "stopped") notify({ type: "output_audio_buffer.stopped" });
    if (data.type === "underrun") console.debug("[owner-audio] Playback waiting for more audio.");
    if (data.type === "overflow") fail("Sophie’s spoken reply is too long. Ask for a shorter summary.");
  };
  capture.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
    if (socket?.readyState !== WebSocket.OPEN || channel.readyState !== "open") return;
    if (socket.bufferedAmount > 64000) { fail("Sophie’s microphone connection is too slow. Start a new session."); return; }
    socket.send(data);
  };
  return {
    channel,
    connect(url: string, token: string) {
      if (closed) return;
      const endpoint = new URL(url);
      if (!/^[a-f0-9]{64}$/.test(token) ||
          (endpoint.protocol !== "wss:" && !(endpoint.protocol === "ws:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname)))) {
        throw new Error("Sophie’s browser audio endpoint is invalid.");
      }
      socket = new WebSocket(endpoint, ["bms-owner-audio-v2", token]);
      socket.binaryType = "arraybuffer";
      socket.onmessage = ({ data }) => {
        if (closed) return;
        if (typeof data === "string") {
          const event = JSON.parse(data);
          if (event.type === "owner.audio.ready") {
            if (event.encoding !== "linear16" || event.sampleRate !== 24000) { fail("Update the Sophie voice bridge to match this browser’s audio version."); return; }
            channel.readyState = "open"; channel.onopen?.(); return;
          }
          if (event.type === "output_audio_buffer.cleared") clear();
          if (event.type === "owner.audio.synthesis_done") playback.port.postMessage({ type: "done" });
          if (event.type === "error") { fail("Sophie’s audio connection failed. Start a new session."); return; }
          channel.onmessage?.({ data }); return;
        }
        if (!(data instanceof ArrayBuffer) || data.byteLength > 256000) { fail("Sophie received invalid audio."); return; }
        // Browser sessions use raw 24kHz signed little-endian PCM, not SIP PCMU.
        let bytes = new Uint8Array(data);
        if (partial.length) {
          const joined = new Uint8Array(bytes.length + 1); joined[0] = partial[0]; joined.set(bytes, 1); bytes = joined;
        }
        partial = bytes.length % 2 ? bytes.slice(-1) : new Uint8Array(0);
        bytes = bytes.subarray(0, bytes.length - partial.length);
        if (!bytes.length) return;
        const pcm = new Float32Array(bytes.length / 2);
        const samples = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < pcm.length; i++) pcm[i] = samples.getInt16(i * 2, true) / 32768;
        playback.port.postMessage({ type: "audio", samples: pcm }, [pcm.buffer]);
      };
      socket.onerror = () => { if (!closed) fail("Could not connect Sophie’s browser audio. Check the secure bridge endpoint."); };
      socket.onclose = () => { if (!closed) fail("Sophie’s audio session ended. Start a new session to continue."); };
    },
    close() {
      if (closed) return; closed = true; channel.readyState = "closed";
      socket?.close(); clear(); source.disconnect(); capture.disconnect(); mute.disconnect(); playback.disconnect(); void context.close();
    },
  };
}
