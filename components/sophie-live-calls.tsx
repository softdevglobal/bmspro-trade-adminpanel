"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";

type LiveCall = { id: string; did: string; callerNumber?: string | null; canJoin?: boolean; joinStatus?: string };
const joinUnavailable: Record<string, string> = {
  NOT_CONFIGURED: "Live joining is disabled on the voice bridge. Enable it and restart the bridge before making a new call.",
  NOT_MAPPED: "No owner extension is mapped for this business.",
  INVALID_EXTENSION: "The mapped owner extension is invalid.",
  MISSING_CALLER_CHANNEL: "This call has no original caller channel available for joining.",
  INVALID_CALLER_CHANNEL: "This call’s original caller channel could not be verified.",
  ALREADY_REQUESTED: "A join was already requested for this call. Check your owner extension.",
};
const endpoint = "/api/business/live-calls";

async function requestLiveCalls(user: User, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set("Authorization", "Bearer " + await user.getIdToken());
  const response = await fetch(endpoint, { ...options, headers, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? "Could not check live calls.");
  }
  return response;
}

function decodeMuLaw(byte: number) {
  const value = byte ^ 255;
  const magnitude = ((((value & 15) << 3) + 132) << ((value >> 4) & 7)) - 132;
  return (value & 128 ? -magnitude : magnitude) / 32768;
}

async function playBridgeAudio(body: ReadableStream<Uint8Array>, audio: AudioContext) {
  const reader = body.getReader();
  const samplesPerPacket = 160;
  const packetsPerBatch = 2;
  const packetBytes = samplesPerPacket * 2;
  const batch = new Uint8Array(packetBytes * packetsPerBatch);
  let filled = 0;
  let nextAt = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let offset = 0; offset < value.length;) {
        const length = Math.min(batch.length - filled, value.length - offset);
        batch.set(value.subarray(offset, offset + length), filled);
        filled += length;
        offset += length;
        if (filled !== batch.length) continue;
        filled = 0;
        const now = audio.currentTime;
        if (nextAt > now + 0.25) continue;
        const buffer = audio.createBuffer(1, samplesPerPacket * packetsPerBatch, 8000);
        const samples = buffer.getChannelData(0);
        for (let packet = 0; packet < packetsPerBatch; packet++) {
          for (let sample = 0; sample < samplesPerPacket; sample++) {
            const index = packet * packetBytes + sample;
            samples[packet * samplesPerPacket + sample] = (decodeMuLaw(batch[index]) + decodeMuLaw(batch[index + samplesPerPacket])) / 2;
          }
        }
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.destination);
        if (nextAt < now + 0.005) nextAt = now + 0.03;
        source.start(nextAt);
        nextAt += buffer.duration;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function SophieLiveCalls({ user, children }: {
  user: User;
  children: (activeCount: number, panel: ReactNode) => ReactNode;
}) {
  const [calls, setCalls] = useState<LiveCall[] | null>(null);
  const [joinCalls, setJoinCalls] = useState<LiveCall[]>([]);
  const [confirmJoin, setConfirmJoin] = useState<string | null>(null);
  const [pollError, setPollError] = useState("");
  const [listenError, setListenError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [bridgeAudio, setBridgeAudio] = useState(false);
  const [listening, setListening] = useState<string | null>(null);
  const audioRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      let enabled = true;
      try {
        if (!document.hidden) {
          const response = await requestLiveCalls(user, { signal: controller.signal });
          const result = await response.json().catch(() => null) as { enabled: boolean; source?: string; calls: LiveCall[] } | null;
          if (!result || !Array.isArray(result.calls)) throw new Error("Could not read the live calls response.");
          if (controller.signal.aborted) return;
          enabled = result.enabled;
          if (!enabled) audioRequest.current?.abort();
          setCalls(enabled ? result.calls : null);
          if (!enabled) setJoinCalls([]);
          else setJoinCalls(result.source === "bridge" ? result.calls.filter(call => call.canJoin) : result.calls);
          setBridgeAudio(result.source === "bridge");
          setPollError("");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setCalls(null);
        setJoinCalls([]);
        setPollError(error instanceof Error ? error.message : "Could not check live calls.");
      }
      if (enabled && !controller.signal.aborted) timer = setTimeout(refresh, 10_000);
    }
    void refresh();
    return () => { controller.abort(); audioRequest.current?.abort(); clearTimeout(timer); };
  }, [user]);

  async function listen(id: string) {
    if (audioRequest.current) return;
    const controller = new AbortController();
    audioRequest.current = controller;
    let audio: AudioContext | undefined;
    setPending(true);
    setListenError("");
    setNotice("");
    try {
      if (bridgeAudio) {
        audio = new AudioContext();
        await audio.resume();
      }
      const response = await requestLiveCalls(user, {
        method: "POST", headers: { "X-Live-Call-Id": id }, signal: controller.signal,
      });
      if (response.headers.get("content-type") === "application/octet-stream") {
        if (!audio || !response.body) {
          await response.body?.cancel();
          throw new Error("Refresh the softphone and try listening again.");
        }
        setListening(id);
        setPending(false);
        await playBridgeAudio(response.body, audio);
      } else {
        setNotice("Answer the monitoring call on your Yeastar extension to listen.");
      }
    } catch (error) {
      if (!controller.signal.aborted) setListenError(error instanceof Error ? error.message : "Could not start listening.");
    } finally {
      await audio?.close().catch(() => {});
      audioRequest.current = null;
      setListening(null);
      setPending(false);
    }
  }

  async function join(id: string) {
    if (audioRequest.current) return;
    const controller = new AbortController();
    audioRequest.current = controller;
    setPending(true);
    setConfirmJoin(null);
    setListenError("");
    setNotice("");
    try {
      await requestLiveCalls(user, {
        method: "POST", headers: { "X-Live-Call-Id": id, "X-Live-Call-Mode": "barge" },
        signal: controller.signal,
      });
      setJoinCalls(current => current.filter(call => call.id !== id));
      setNotice("Join requested. Answer the call on your Yeastar extension to speak with both parties. Sophie remains on the call. Hang up your extension to leave.");
    } catch (error) {
      if (!controller.signal.aborted) setListenError(error instanceof Error ? error.message : "Could not request joining. Check your extension before retrying.");
    } finally {
      audioRequest.current = null;
      setPending(false);
    }
  }

  const panel = calls || pollError || listenError || notice ? (
    <section className="space-y-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
      <h3 className="font-display text-base font-semibold text-on-surface">Live Sophie calls</h3>
      {pollError && <p role="status" className="text-sm text-error">{pollError}</p>}
      {listenError && <p role="alert" className="text-sm text-error">{listenError}</p>}
      {notice && <p role="status" className="text-sm text-on-surface-variant">{notice}</p>}
      {calls?.length === 0 && <p className="text-sm text-on-surface-variant">No verified live calls for your business.</p>}
      {calls?.map(call => (
        <div key={call.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/60 pt-3 text-sm">
          <div>
            <p className="font-semibold text-on-surface">{call.callerNumber ?? "Sophie is on a call"}</p>
            <p className="text-xs text-on-surface-variant">Business number {call.did}</p>
            {bridgeAudio && !call.canJoin && <p className="mt-1 text-xs text-on-surface-variant">
              {joinUnavailable[call.joinStatus ?? ""] ?? "Join status unavailable. Check that the updated voice bridge is running."}
            </p>}
          </div>
          <button type="button" disabled={pending || (listening !== null && listening !== call.id)}
            onClick={() => listening === call.id ? audioRequest.current?.abort() : void listen(call.id)}
            className="rounded-lg border border-outline-variant px-3 py-2 font-semibold text-primary hover:bg-surface-container-low disabled:opacity-45">
            {listening === call.id ? "Stop listening" : "Listen live"}
          </button>
        </div>
      ))}
      {joinCalls.length > 0 && <div className="space-y-3 border-t border-outline-variant/60 pt-3">
        <p className="text-sm font-semibold text-on-surface">Join through your Yeastar extension</p>
        <p className="text-xs text-on-surface-variant">Both parties will hear you. Sophie stays on the call. Stop browser listening before joining to avoid echo.</p>
        {joinCalls.map(call => <div key={call.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p>{call.callerNumber ?? "Live Sophie call"} · {call.did}</p>
          {confirmJoin === call.id ? <div className="flex flex-wrap items-center gap-2">
            <span>Join this conversation?</span>
            <button type="button" disabled={pending || listening !== null} onClick={() => void join(call.id)}
              className="rounded-lg bg-primary px-3 py-2 font-semibold text-on-primary disabled:opacity-45">Confirm join</button>
            <button type="button" onClick={() => setConfirmJoin(null)} className="rounded-lg border border-outline-variant px-3 py-2">Cancel</button>
          </div> : <button type="button" disabled={pending || listening !== null} onClick={() => setConfirmJoin(call.id)}
            className="rounded-lg border border-outline-variant px-3 py-2 font-semibold text-primary disabled:opacity-45">Join call</button>}
        </div>)}
      </div>}
    </section>
  ) : null;
  return children(calls?.length ?? 0, panel);
}
