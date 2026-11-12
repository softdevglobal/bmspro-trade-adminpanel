"use client";

import { useAuth } from "@/lib/auth/auth-context";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type RealtimeEvent = {
  type: string;
  response?: {
    status?: string;
    output?: { type: string; name: string; arguments: string; call_id: string;
      content?: { type: string; text?: string }[];
    }[];
  };
};
type SophieSession = { close: () => void; ask: (question: string) => boolean };

export function OwnerVoiceSession() {
  const { user, businessId } = useAuth();
  const audioRef = useRef<HTMLAudioElement>(null);
  const current = useRef<SophieSession | null>(null);
  const [mode, setMode] = useState<"voice" | "chat">("voice");
  const [question, setQuestion] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [chat, setChat] = useState<{ role: "owner" | "sophie"; text: string }[]>([]);
  const [state, setState] = useState<"idle" | "connecting" | "connected">("idle");
  const [message, setMessage] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [missedCallsDate, setMissedCallsDate] = useState<string | null>(null);
  const [showOverdueInvoices, setShowOverdueInvoices] = useState(false);
  const [showInvoices, setShowInvoices] = useState(false);

  useEffect(() => () => current.current?.close(), [user?.uid, businessId]);

  async function start(firstQuestion?: string) {
    if (!user || current.current) return;
    const chatMode = firstQuestion !== undefined;
    if (typeof RTCPeerConnection === "undefined" || (!chatMode && !navigator.mediaDevices?.getUserMedia)) {
      setMessage(chatMode ? "Open Trade in a browser that supports WebRTC." :
        "Open Trade on HTTPS or localhost in a browser with microphone support.");
      return;
    }
    const controller = new AbortController();
    const handled = new Set<string>();
    let stream: MediaStream | undefined;
    let peer: RTCPeerConnection | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let responseInProgress = false;
    const session: SophieSession = {
      ask: () => false,
      close() {
        if (current.current !== session) return;
        current.current = null;
        controller.abort();
        clearTimeout(timer);
        peer?.close();
        stream?.getTracks().forEach((track) => track.stop());
        if (audioRef.current) audioRef.current.srcObject = null;
        setAudioBlocked(false);
        setWaiting(false);
        setState("idle");
      },
    };
    current.current = session;
    setState("connecting");
    setMessage("");
    setMissedCallsDate(null);
    setShowOverdueInvoices(false);
    setShowInvoices(false);
    if (chatMode) setWaiting(true);
    const fail = (text: string) => {
      if (current.current !== session) return;
      session.close();
      setMessage(text);
    };
    timer = setTimeout(() => fail("Sophie took too long to connect. Try again."), 40_000);

    try {
      if (!chatMode) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (controller.signal.aborted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
      }
      peer = new RTCPeerConnection();
      if (stream) {
        for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      } else {
        peer.addTransceiver("audio", { direction: "recvonly" });
      }
      peer.ontrack = (event) => {
        const audio = audioRef.current;
        if (chatMode || !audio || controller.signal.aborted) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => {
          if (!controller.signal.aborted) setAudioBlocked(true);
        });
      };
      peer.onconnectionstatechange = () => {
        if (peer?.connectionState === "failed" || peer?.connectionState === "closed") {
          fail("The Sophie connection ended. Start a new session to continue.");
        }
      };
      const channel = peer.createDataChannel("oai-events");
      const send = (event: object) => {
        if (channel.readyState === "open" && !controller.signal.aborted) channel.send(JSON.stringify(event));
      };
      const requestResponse = () => send(chatMode
        ? { type: "response.create", response: { output_modalities: ["text"] } }
        : { type: "response.create" });
      let chatTurnPending = false;
      session.ask = (text) => {
        if (!chatMode || channel.readyState !== "open" || chatTurnPending || controller.signal.aborted) return false;
        chatTurnPending = true;
        setWaiting(true);
        setMessage("");
        setChat(messages => [...messages, { role: "owner", text }]);
        send({ type: "conversation.item.create", item: {
          type: "message", role: "user", content: [{ type: "input_text", text }],
        } });
        requestResponse();
        return true;
      };
      channel.onopen = () => {
        if (controller.signal.aborted) return;
        clearTimeout(timer);
        setState("connected");
        timer = setTimeout(() => fail("This briefing ended after 10 minutes. Start a new session to continue."), 600_000);
        if (chatMode) session.ask(firstQuestion);
        else requestResponse();
      };
      channel.onclose = () => fail("The Sophie connection ended. Start a new session to continue.");
      channel.onmessage = async ({ data }) => {
        if (typeof data !== "string" || controller.signal.aborted) return;
        let event: RealtimeEvent;
        try { event = JSON.parse(data) as RealtimeEvent; } catch { return; }
        if (event.type === "response.created") responseInProgress = true;
        if (event.type === "error" && chatMode) {
          chatTurnPending = false;
          setWaiting(false);
          setMessage("Sophie could not finish that response. Try asking again.");
          return;
        }
        if (event.type !== "response.done") return;
        responseInProgress = false;
        if (event.response?.status !== "completed") {
          if (!chatMode && event.response?.status !== "failed") return;
          chatTurnPending = false;
          setWaiting(false);
          setMessage("Sophie could not finish that response. Try asking again.");
          return;
        }
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
              if (typeof text === "string" && !result.result?.isError) {
                output = text;
                if (call.name === "list_missed_calls" && !controller.signal.aborted) {
                  const report = JSON.parse(text) as { status?: string; date?: string };
                  if (report.status === "OK" && typeof report.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(report.date)) {
                    setMissedCallsDate(report.date);
                  }
                }
                if (call.name === "list_overdue_invoices" && !controller.signal.aborted) {
                  setShowOverdueInvoices(JSON.parse(text).status === "OK");
                }
                if (call.name === "list_invoices" && !controller.signal.aborted) {
                  setShowInvoices(JSON.parse(text).status === "OK");
                }
              }
            }
          } catch {
            // Report a tool failure to Sophie so it can answer without guessing.
          }
          send({ type: "conversation.item.create", item: {
            type: "function_call_output", call_id: call.call_id, output,
          } });
        }
        if (calls.length && !responseInProgress) requestResponse();
        if (chatMode && !calls.length) {
          const text = (event.response.output ?? []).flatMap(item =>
            (item.content ?? []).filter(part => part.type === "output_text" && typeof part.text === "string")
              .map(part => part.text)).join("\n").trim();
          if (text) setChat(messages => [...messages, { role: "sophie", text }]);
          else setMessage("Sophie did not return an answer. Try asking again.");
          chatTurnPending = false;
          setWaiting(false);
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch("/api/ai/owner-call", {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/sdp",
          ...(chatMode && { "X-Sophie-Mode": "chat" }) },
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

  function sendQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || waiting) return;
    if (current.current) {
      if (!current.current.ask(text)) return;
    } else {
      setChat([]);
      void start(text);
    }
    setQuestion("");
  }

  function changeMode(next: typeof mode) {
    if (next === mode) return;
    current.current?.close();
    setMode(next);
    setMessage("");
    setMissedCallsDate(null);
    setShowOverdueInvoices(false);
    setShowInvoices(false);
  }

  return (
    <div className="space-y-3 p-4 text-sm">
      <div className="flex gap-2" role="group" aria-label="How to ask Sophie">
        <button type="button" aria-pressed={mode === "voice"} onClick={() => changeMode("voice")}
          className={`rounded-lg border px-3 py-1.5 font-semibold ${mode === "voice" ? "border-primary text-primary" : "border-outline-variant"}`}>Voice</button>
        <button type="button" aria-pressed={mode === "chat"} onClick={() => changeMode("chat")}
          className={`rounded-lg border px-3 py-1.5 font-semibold ${mode === "chat" ? "border-primary text-primary" : "border-outline-variant"}`}>Chat</button>
      </div>
      {mode === "voice" ? <>
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
      </> : <>
        <div role="log" aria-label="Sophie chat" className="max-h-[min(22rem,45dvh)] space-y-2 overflow-y-auto">
          {chat.length === 0 && <p>Ask about your business, for example “Who did we miss today?”</p>}
          {chat.map(({ role, text }, index) => (
            <p key={index} className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2 ${role === "owner" ? "bg-primary/10" : "bg-surface-container-low"}`}>
              <span className="block text-xs font-semibold">{role === "owner" ? "You" : "Sophie"}</span>
              {text}
            </p>
          ))}
        </div>
        {waiting && <p role="status">{state === "connecting" ? "Connecting to Sophie…" : "Sophie is checking…"}</p>}
        <form onSubmit={sendQuestion} className="flex gap-2">
          <input aria-label="Ask Sophie" value={question} onChange={event => setQuestion(event.target.value)}
            maxLength={1000} placeholder="Ask Sophie a question" className="min-w-0 flex-1 rounded-lg border border-outline-variant px-2 py-2" />
          <button type="submit" disabled={!user || !question.trim() || waiting}
            className="rounded-lg bg-primary px-3 py-2 font-semibold text-on-primary disabled:opacity-50">Send</button>
        </form>
      </>}
      {message ? <p role="status">{message}</p> : null}
      {missedCallsDate && <Link href={`/dashboard/call-recordings?view=missed&date=${missedCallsDate}`}
        className="block font-semibold text-primary underline underline-offset-2">
        Open missed calls
      </Link>}
      {showOverdueInvoices && <Link href="/dashboard/invoices?filter=overdue"
        className="block font-semibold text-primary underline underline-offset-2">
        Open overdue invoices
      </Link>}
      {showInvoices && <Link href="/dashboard/invoices?filter=all"
        className="block font-semibold text-primary underline underline-offset-2">
        Open invoices
      </Link>}
    </div>
  );
}
