"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useEffect, useRef, useState } from "react";

type RealtimeEvent = {
  type: string;
  response?: {
    status?: string;
    output?: { type: string; name: string; arguments: string; call_id: string }[];
  };
};

export function OwnerVoiceSession() {
  const { user, businessId } = useAuth();
  const audioRef = useRef<HTMLAudioElement>(null);
  const current = useRef<{ close: () => void } | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "connected">("idle");
  const [message, setMessage] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => () => current.current?.close(), [user?.uid, businessId]);

  async function start() {
    if (!user || current.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      setMessage("Open Trade on HTTPS or localhost in a browser with microphone support.");
      return;
    }
    const controller = new AbortController();
    const handled = new Set<string>();
    let stream: MediaStream | undefined;
    let peer: RTCPeerConnection | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let responseInProgress = false;
    const session = {
      close() {
        if (current.current !== session) return;
        current.current = null;
        controller.abort();
        clearTimeout(timer);
        peer?.close();
        stream?.getTracks().forEach((track) => track.stop());
        if (audioRef.current) audioRef.current.srcObject = null;
        setAudioBlocked(false);
        setState("idle");
      },
    };
    current.current = session;
    setState("connecting");
    setMessage("");
    const fail = (text: string) => {
      if (current.current !== session) return;
      session.close();
      setMessage(text);
    };
    timer = setTimeout(() => fail("Sophie took too long to connect. Try again."), 40_000);

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (controller.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      peer = new RTCPeerConnection();
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      peer.ontrack = (event) => {
        const audio = audioRef.current;
        if (!audio || controller.signal.aborted) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => {
          if (!controller.signal.aborted) setAudioBlocked(true);
        });
      };
      peer.onconnectionstatechange = () => {
        if (peer?.connectionState === "failed" || peer?.connectionState === "closed") {
          fail("The voice connection ended. Start a new session to continue.");
        }
      };
      const channel = peer.createDataChannel("oai-events");
      const send = (event: object) => {
        if (channel.readyState === "open" && !controller.signal.aborted) channel.send(JSON.stringify(event));
      };
      channel.onopen = () => {
        if (controller.signal.aborted) return;
        clearTimeout(timer);
        setState("connected");
        timer = setTimeout(() => fail("This briefing ended after 10 minutes. Start a new session to continue."), 600_000);
        send({ type: "response.create" });
      };
      channel.onclose = () => fail("The voice connection ended. Start a new session to continue.");
      channel.onmessage = async ({ data }) => {
        if (typeof data !== "string" || controller.signal.aborted) return;
        let event: RealtimeEvent;
        try { event = JSON.parse(data) as RealtimeEvent; } catch { return; }
        if (event.type === "response.created") responseInProgress = true;
        if (event.type !== "response.done") return;
        responseInProgress = false;
        if (event.response?.status === "failed") {
          setMessage("Sophie could not finish that response. Try asking again.");
          return;
        }
        if (event.response?.status !== "completed") return;
        const calls = (event.response.output ?? []).filter((item) =>
          item.type === "function_call" && !handled.has(item.call_id));
        for (const call of calls) {
          handled.add(call.call_id);
          let output = JSON.stringify({ status: "UNAVAILABLE" });
          try {
            const response = await fetch("/api/ai/owner-call/mcp", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${await user.getIdToken()}`,
                Accept: "application/json, text/event-stream",
                "Content-Type": "application/json",
              },
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
              body: JSON.stringify({
                jsonrpc: "2.0", id: call.call_id, method: "tools/call",
                params: { name: call.name, arguments: JSON.parse(call.arguments) },
              }),
            });
            if (response.status === 401 || response.status === 403) {
              fail("Your owner session expired. Sign in again to continue.");
              return;
            }
            if (response.ok) {
              const result = await response.json();
              const text = result.result?.content?.find((item: { type: string }) => item.type === "text")?.text;
              if (typeof text === "string" && !result.result?.isError) output = text;
            }
          } catch {
            // Report a tool failure to Sophie so it can answer without guessing.
          }
          send({ type: "conversation.item.create", item: {
            type: "function_call_output", call_id: call.call_id, output,
          } });
        }
        if (calls.length && !responseInProgress) send({ type: "response.create" });
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch("/api/ai/owner-call", {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/sdp" },
        body: offer.sdp,
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Could not connect to Sophie.");
      }
      const sdp = await response.text();
      if (!controller.signal.aborted) await peer.setRemoteDescription({ type: "answer", sdp });
    } catch (error) {
      fail(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Allow microphone access in your browser to talk to Sophie."
        : error instanceof Error ? error.message : "Could not connect to Sophie.");
    }
  }

  return (
    <div className="space-y-3 p-4 text-sm">
      <p>Ask Sophie for today’s summary, jobs awaiting scheduling, or who’s working.</p>
      <audio ref={audioRef} autoPlay />
      <button type="button" disabled={!user}
        onClick={() => state === "idle" ? void start() : current.current?.close()}
        className="rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary disabled:opacity-50">
        {state === "idle" ? "Talk to Sophie" : state === "connecting" ? "Cancel connection" : "End voice session"}
      </button>
      {state === "connecting" ? <p role="status">Connecting to Sophie…</p> : null}
      {state === "connected" ? <p role="status">Connected. Your microphone is on.</p> : null}
      {audioBlocked ? (
        <button type="button" className="font-semibold text-primary" onClick={() => {
          void audioRef.current?.play().then(() => setAudioBlocked(false)).catch(() => {});
        }}>Play Sophie’s audio</button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
