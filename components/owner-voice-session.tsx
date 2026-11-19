"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  checkVoiceSave, isVoiceDraftTool, voiceDraftInput, VOICE_DRAFT_BODY_MAX, VOICE_DRAFTS_PER_SESSION,
  type VoiceDraftToolName,
} from "@/lib/ai/owner-call/voice-draft";
import { discardVoiceDraft, getVoiceDraft, saveVoiceDraft, showVoiceDraft, useVoiceDraft } from "@/lib/ai/owner-call/voice-draft-store";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

const KNOWLEDGE_PAGE = "/dashboard/ai/knowledge";
/** Speech-to-text for the owner's side of the live transcript. Sophie's side comes with her audio. */
const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
/** Keep the on-screen transcript short; it is never stored. */
const TRANSCRIPT_LINES = 60;

type RealtimeEvent = {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  response?: {
    status?: string;
    output?: { type: string; name: string; arguments: string; call_id: string;
      content?: { type: string; text?: string }[];
    }[];
  };
};
type SophieSession = { close: () => void; ask: (question: string) => boolean };
const todayCallsQuestion = "Summarize today's calls. Tell me what callers wanted, who we missed, the callback results, and who still needs follow-up. Keep it short.";

type TranscriptLine = { id: string; speaker: "owner" | "sophie"; text: string; final: boolean };

export function OwnerVoiceSession() {
  const { user, businessId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const current = useRef<SophieSession | null>(null);
  const activeCallback = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<"voice" | "chat">("voice");
  const [question, setQuestion] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [chat, setChat] = useState<{ role: "owner" | "sophie"; text: string }[]>([]);
  const [state, setState] = useState<"idle" | "connecting" | "connected">("idle");
  const [message, setMessage] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [missedCallsDate, setMissedCallsDate] = useState<string | null>(null);
  const [showOverdueInvoices, setShowOverdueInvoices] = useState(false);
  const [showInvoices, setShowInvoices] = useState(false);
  const [callLinks, setCallLinks] = useState<{ callId: string; date: string }[]>([]);
  const [callback, setCallback] = useState<{ grant: string; number: string; name?: string; requestId: string } | null>(null);
  const [callbackBusy, setCallbackBusy] = useState(false);
  const [callbackStatus, setCallbackStatus] = useState("");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const voiceDraft = useVoiceDraft();

  useEffect(() => () => {
    current.current?.close();
    activeCallback.current?.abort();
  }, [user?.uid, businessId]);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  // Keep the newest line in view.
  useEffect(() => {
    const list = transcriptRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lines]);

  async function start(firstQuestion?: string, voice = false) {
    if (!user || current.current || activeCallback.current) return;
    const chatMode = firstQuestion !== undefined && !voice;
    if (typeof RTCPeerConnection === "undefined" || (!chatMode && !navigator.mediaDevices?.getUserMedia)) {
      setMessage(chatMode ? "Open Trade in a browser that supports WebRTC." :
        "Open Trade on HTTPS or localhost in a browser with microphone support.");
      return;
    }
    const controller = new AbortController();
    const handled = new Set<string>();
    const sessionId = crypto.randomUUID();
    let stream: MediaStream | undefined;
    let peer: RTCPeerConnection | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let responseInProgress = false;
    /**
     * Confirmation guardrail for save_knowledge_draft: which note is on screen, how many
     * times the owner has spoken since it was shown, and what they said last.
     */
    const confirm = {
      draftId: null as string | null, turns: 0, replyItems: new Set<string>(),
      latestReply: null as string | null, saved: 0,
    };
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
        setSpeaking(false);
        setCallback(null);
        setWaiting(false);
        setState("idle");
      },
    };
    current.current = session;
    setState("connecting");
    setMessage("");
    setLines([]);
    setMissedCallsDate(null);
    setShowOverdueInvoices(false);
    setShowInvoices(false);
    setCallLinks([]);
    setCallback(null);
    setCallbackStatus("");
    if (chatMode) setWaiting(true);
    const fail = (text: string) => {
      if (current.current !== session) return;
      session.close();
      setMessage(text);
    };
    timer = setTimeout(() => fail("Sophie took too long to connect. Try again."), 40_000);

    /** Adds or updates one transcript line, keyed by the realtime conversation item. */
    const write = (id: string | undefined, speaker: TranscriptLine["speaker"], update: (text: string) => string, final: boolean) => {
      if (!id || controller.signal.aborted) return;
      setLines((previous) => {
        const index = previous.findIndex((line) => line.id === id);
        if (index === -1) return [...previous, { id, speaker, text: update(""), final }].slice(-TRANSCRIPT_LINES);
        const next = previous.slice();
        next[index] = { ...previous[index], text: update(previous[index].text), final: final || previous[index].final };
        return next;
      });
    };

    /** The draft tools run here in the browser. They never reach the Trade MCP route. */
    async function runDraftTool(name: VoiceDraftToolName, rawArguments: string): Promise<object> {
      let args: unknown;
      try { args = JSON.parse(rawArguments || "{}"); } catch { return { status: "REJECTED", message: "Send valid arguments." }; }

      if (name === "prepare_knowledge_draft") {
        if (confirm.saved >= VOICE_DRAFTS_PER_SESSION) {
          return { status: "LIMIT_REACHED", message: "The voice draft limit for this session is reached. Ask the owner to add more on the AI knowledge page." };
        }
        const parsed = voiceDraftInput.safeParse(args);
        if (!parsed.success) {
          return { status: "REJECTED", message: `Use kind faq, policy or note, a title of 2-120 characters and text of 10-${VOICE_DRAFT_BODY_MAX} characters.` };
        }
        const draft = showVoiceDraft(parsed.data, sessionId);
        Object.assign(confirm, { draftId: draft.id, turns: 0, latestReply: null });
        confirm.replyItems.clear();
        if (pathnameRef.current !== KNOWLEDGE_PAGE) router.push(KNOWLEDGE_PAGE);
        return {
          status: "SHOWN_FOR_REVIEW", title: draft.title, text: draft.body, warnings: draft.warnings,
          message: "Nothing is saved yet. The note is shown on the AI knowledge page. Read the title and text back exactly, " +
            "mention any warnings, then ask: Should I save this as a draft?",
        };
      }

      if (name === "discard_knowledge_draft") {
        const shown = getVoiceDraft();
        if (shown.draft?.sessionId === sessionId && shown.status !== "saved" && shown.status !== "saving") discardVoiceDraft();
        confirm.draftId = null;
        return { status: "DISCARDED", message: "The note was removed. Nothing was saved." };
      }

      const shown = getVoiceDraft();
      const decision = checkVoiceSave({
        hasDraft: !!shown.draft,
        alreadySaved: shown.status === "saved" || shown.status === "saving",
        sameSession: shown.draft?.sessionId === sessionId && shown.draft.id === confirm.draftId,
        confirmed: (args as { confirmed?: unknown } | null)?.confirmed,
        ownerTurnsSinceShown: confirm.turns,
        latestOwnerReply: confirm.latestReply,
        savedThisSession: confirm.saved,
      });
      if (!decision.ok) return { status: decision.status, message: decision.message };
      const saved = await saveVoiceDraft();
      if (!saved.ok) {
        return { status: "FAILED", message: `It was not saved: ${saved.error} The owner can press Save as draft on the AI knowledge page.` };
      }
      confirm.saved += 1;
      return {
        status: "SAVED_AS_DRAFT", needsReview: saved.needsReview,
        message: saved.needsReview
          ? "Saved as a draft but held for review, because it may contain contact details or AI-like instructions. Tell the owner to check it on the AI knowledge page."
          : "Saved as an unpublished draft. Tell the owner to check it and press Publish on the AI knowledge page. Sophie does not use it on calls until then.",
      };
    }

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
        setCallLinks([]);
        setMissedCallsDate(null);
        setCallback(null);
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
        // Turn on speech-to-text for the owner's side, for the live transcript and the
        // save confirmation check. If it is not available, Sophie still works normally.
        if (!chatMode) {
          send({
            type: "session.update",
            session: { type: "realtime", audio: { input: { transcription: { model: TRANSCRIPTION_MODEL, language: "en" } } } },
          });
        }
        if (chatMode && firstQuestion) session.ask(firstQuestion);
        else if (firstQuestion) {
          send({ type: "conversation.item.create", item: {
            type: "message", role: "user", content: [{ type: "input_text", text: firstQuestion }],
          } });
          requestResponse();
        }
        else send({ type: "response.create", response: { tool_choice: "none",
          instructions: "Say only: Hi, it’s Sophie. How can I help? Then wait for the owner." } });
      };
      channel.onclose = () => fail("The Sophie connection ended. Start a new session to continue.");
      channel.onmessage = async ({ data }) => {
        if (typeof data !== "string" || controller.signal.aborted) return;
        let event: RealtimeEvent;
        try { event = JSON.parse(data) as RealtimeEvent; } catch { return; }
        if (!chatMode && event.type === "output_audio_buffer.started") setSpeaking(true);
        if (event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared") setSpeaking(false);

        switch (event.type) {
          // The owner finished speaking: one owner turn.
          case "input_audio_buffer.committed":
            write(event.item_id, "owner", (text) => text, false);
            if (confirm.draftId && event.item_id) {
              confirm.turns += 1;
              confirm.replyItems.add(event.item_id);
            }
            return;
          case "conversation.item.input_audio_transcription.delta":
            write(event.item_id, "owner", (text) => text + (event.delta ?? ""), false);
            return;
          case "conversation.item.input_audio_transcription.completed":
            write(event.item_id, "owner", () => event.transcript ?? "", true);
            if (event.item_id && confirm.replyItems.has(event.item_id)) confirm.latestReply = event.transcript ?? null;
            return;
          case "conversation.item.input_audio_transcription.failed":
            write(event.item_id, "owner", (text) => text || "(could not transcribe)", true);
            return;
          // Sophie's words, as she says them (GA and older event names).
          case "response.output_audio_transcript.delta":
          case "response.audio_transcript.delta":
            write(event.item_id, "sophie", (text) => text + (event.delta ?? ""), false);
            return;
          case "response.output_audio_transcript.done":
          case "response.audio_transcript.done":
            write(event.item_id, "sophie", (text) => event.transcript ?? text, true);
            return;
          case "response.created":
            responseInProgress = true;
            return;
        }
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
          if (isVoiceDraftTool(call.name)) {
            try { output = JSON.stringify(await runDraftTool(call.name, call.arguments)); } catch { /* reported as UNAVAILABLE */ }
          } else {
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
                    const report = JSON.parse(text) as { status?: string; date?: string; calls?: {
                      callbackAttempts?: { callbackConversation?: { callId: string; date: string } | null }[]
                    }[]; name?: string; callbackConfirmation?: { grant: string; number: string } };
                    const { callbackConfirmation, ...briefing } = report;
                    output = JSON.stringify(briefing);
                    if (report.status === "READY_TO_CONFIRM" && callbackConfirmation) {
                      setCallback({ ...callbackConfirmation, name: report.name, requestId: crypto.randomUUID() });
                      setCallbackStatus("");
                    }
                    if (report.status === "FOLLOW_UP_STATUS") setCallback(null);
                    if ((report.status === "OK" || report.status === "FOLLOW_UP_STATUS") &&
                        typeof report.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(report.date)) {
                      setMissedCallsDate(report.date);
                      const transcripts = (report.calls ?? []).flatMap(row => (row.callbackAttempts ?? [])
                        .flatMap(attempt => attempt.callbackConversation ? [attempt.callbackConversation] : []))
                        .filter(item => /^[a-f0-9-]{36}$/i.test(item.callId) && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
                      setCallLinks(current => [...new Map([...transcripts, ...current].map(item => [item.callId, item])).values()].slice(0, 3));
                    }
                  }
                  if (call.name === "list_overdue_invoices" && !controller.signal.aborted) {
                    const report = JSON.parse(text) as { status?: string; reminderCalls?: {
                      customerResponse?: { callId: string; date: string } | null;
                    }[] };
                    setShowOverdueInvoices(report.status === "OK");
                    const transcripts = (report.reminderCalls ?? []).flatMap(row => row.customerResponse ? [row.customerResponse] : [])
                      .filter(item => /^[a-f0-9-]{36}$/i.test(item.callId) && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
                    if (transcripts.length) setCallLinks(current =>
                      [...new Map([...transcripts, ...current].map(item => [item.callId, item])).values()].slice(0, 3));
                  }
                  if (call.name === "list_invoices" && !controller.signal.aborted) {
                    setShowInvoices(JSON.parse(text).status === "OK");
                  }
                  if (["get_customer_call_history", "get_sophie_call_summaries"].includes(call.name) && !controller.signal.aborted) {
                    const report = JSON.parse(text) as { calls?: { callId: string; date: string }[] };
                    const transcripts = (report.calls ?? []).filter(item =>
                      /^[a-f0-9-]{36}$/i.test(item.callId) && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
                    setCallLinks(current => [...new Map([...transcripts, ...current].map(item => [item.callId, item])).values()].slice(0, 3));
                  }
                }
              }
            } catch {
              // Report a tool failure to Sophie so it can answer without guessing.
            }
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
    if (next === mode || activeCallback.current) return;
    current.current?.close();
    setMode(next);
    setMessage("");
    setLines([]);
    setMissedCallsDate(null);
    setShowOverdueInvoices(false);
    setShowInvoices(false);
    setCallLinks([]);
  }

  function getTodayCalls() {
    if (waiting || !user || activeCallback.current) return;
    if (mode === "chat" && current.current) {
      current.current.ask(todayCallsQuestion);
      return;
    }
    changeMode("chat");
    setChat([]);
    void start(todayCallsQuestion);
  }

  async function confirmCallback() {
    if (!user || !callback || activeCallback.current) return;
    const selected = callback;
    const controller = new AbortController();
    activeCallback.current = controller;
    current.current?.close();
    setCallback(null);
    setCallbackBusy(true);
    setCallbackStatus("Sophie is calling. This session is paused.");
    let summaryCallId: string | undefined;
    try {
      const response = await fetch("/api/business/sophie-callback", {
        method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "x-callback-grant": selected.grant,
          "x-owner-call-now": selected.requestId },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not start the callback.");
      if (result.status === "ANSWERED" || result.status === "UNKNOWN") {
        if (!/^[a-f0-9]{64}$/.test(result.attemptId ?? "")) throw new Error("Check Calls for the callback outcome.");
        setCallbackStatus(result.status === "ANSWERED"
          ? "Sophie is on the customer call. This session is paused."
          : "Waiting for the callback outcome. This session is paused.");
        const deadline = Date.now() + 15 * 60_000;
        while (!controller.signal.aborted && Date.now() < deadline) {
          const check = await fetch(`/api/business/sophie-callback?attemptId=${result.attemptId}`, {
            headers: { Authorization: `Bearer ${await user.getIdToken()}` }, signal: controller.signal, cache: "no-store",
          });
          if (check.status === 401 || check.status === 403) throw new Error("Sign in again to check your callback.");
          if (check.ok) {
            const log = await check.json();
            if (typeof log.callId === "string" && /^[a-f0-9-]{36}$/i.test(log.callId)) {
              if (log.hasTranscript) summaryCallId = log.callId;
              else setCallbackStatus("The callback ended. No transcript was saved.");
              return;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 5_000));
        }
        if (!controller.signal.aborted) setCallbackStatus("The callback summary isn’t ready. Check it in Calls.");
        return;
      }
      const status: Record<string, string> = {
        ANSWERED: "The phone answered.", NO_ANSWER: "The customer didn’t answer.",
        FAILED: "The callback failed.", UNKNOWN: "The callback outcome couldn’t be verified.",
      };
      setCallbackStatus(status[result.status] ?? status.UNKNOWN);
    } catch (error) {
      if (!controller.signal.aborted) setCallbackStatus(error instanceof Error ? error.message : "Could not verify the callback outcome.");
    } finally {
      if (activeCallback.current === controller) {
        activeCallback.current = null;
        setCallbackBusy(false);
        if (!controller.signal.aborted && summaryCallId) {
          void start(`Summarize the completed callback using call history ID ${summaryCallId}. Tell me what the customer said and any follow-up. Keep it short.`, mode === "voice");
        }
      }
    }
  }

  const latest = lines.length - 1;
  return (
    <div className="space-y-3 p-4 text-sm">
      <div className="flex gap-2" role="group" aria-label="How to ask Sophie">
        <button type="button" disabled={callbackBusy} aria-pressed={mode === "voice"} onClick={() => changeMode("voice")}
          className={`rounded-lg border px-3 py-1.5 font-semibold ${mode === "voice" ? "border-primary text-primary" : "border-outline-variant"}`}>Voice</button>
        <button type="button" disabled={callbackBusy} aria-pressed={mode === "chat"} onClick={() => changeMode("chat")}
          className={`rounded-lg border px-3 py-1.5 font-semibold ${mode === "chat" ? "border-primary text-primary" : "border-outline-variant"}`}>Chat</button>
      </div>
      <button type="button" disabled={!user || waiting || callbackBusy}
        onClick={getTodayCalls}
        className="rounded-lg border border-outline-variant px-3 py-1.5 font-semibold text-primary disabled:opacity-50">
        Today’s call summary
      </button>
      {mode === "voice" ? <>
        <p>Try saying “Summarize today’s calls.”</p>
        <audio ref={audioRef} autoPlay />
      <button type="button" disabled={!user || callbackBusy}
        onClick={() => state === "idle" ? void start() : current.current?.close()}
        className="rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary disabled:opacity-50">
        {state === "idle" ? "Talk to Sophie" : state === "connecting" ? "Cancel connection" : "End voice session"}
      </button>
      {state === "connecting" ? <p role="status">Connecting to Sophie…</p> : null}
      {state === "connected" && (
        <div className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2">
          <Image src="/sophie-avatar.webp" alt="" width={40} height={40} className="size-10 rounded-full object-cover" />
          <p role="status" className="flex-1">{audioBlocked ? "Audio paused" : speaking ? "Sophie is speaking" : "Listening · Microphone on"}</p>
          <div aria-hidden="true" className="flex h-6 items-center gap-1 text-primary">
            {[0, 1, 2, 3, 4].map(index => (
              <span key={index} className={`h-5 w-1 rounded-full bg-current ${speaking && !audioBlocked ? "sophie-speaking-bar" : "scale-y-25 opacity-50"}`}
                style={{ animationDelay: `${index * -110}ms` }} />
            ))}
          </div>
        </div>
      )}
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
          <button type="submit" disabled={!user || !question.trim() || waiting || callbackBusy}
            className="rounded-lg bg-primary px-3 py-2 font-semibold text-on-primary disabled:opacity-50">Send</button>
        </form>
      </>}
      {message ? <p role="status">{message}</p> : null}

      {voiceDraft.draft ? (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">
            {voiceDraft.status === "saved" ? "Saved as a draft, not published yet." : "Draft note waiting for your OK."}
          </p>
          <p className="mt-0.5 truncate">{voiceDraft.draft.title}</p>
          {pathname !== KNOWLEDGE_PAGE ? (
            <button type="button" onClick={() => router.push(KNOWLEDGE_PAGE)} className="mt-1 font-semibold underline underline-offset-2">
              Open AI knowledge
            </button>
          ) : null}
        </div>
      ) : null}

      {lines.length ? (
        <section aria-label="Live transcript" className="rounded-xl border border-outline-variant">
          <h3 className="flex items-center justify-between border-b border-outline-variant px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Live transcript
            <span className="font-normal normal-case tracking-normal">Not saved</span>
          </h3>
          <ol ref={transcriptRef} className="max-h-64 space-y-1.5 overflow-y-auto p-2">
            {lines.map((line, index) => (
              <li key={line.id}
                className={`rounded-lg px-2 py-1.5 ${index === latest ? "bg-primary/10" : ""} ${line.speaker === "owner" ? "text-right" : ""}`}>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                  {line.speaker === "owner" ? "You" : "Sophie"}
                </span>
                <span className={`whitespace-pre-wrap ${line.final ? "" : "text-on-surface-variant"}`}>
                  {line.text || "…"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {callback && <div className="space-y-2 rounded-xl border border-outline-variant p-3">
        <p>Have Sophie call {callback.name ? `${callback.name} · ${callback.number}` : callback.number}?</p>
        <div className="flex gap-2">
          <button type="button" disabled={callbackBusy} onClick={() => void confirmCallback()}
            className="rounded-lg bg-primary px-3 py-2 font-semibold text-on-primary disabled:opacity-50">Confirm callback</button>
          <button type="button" onClick={() => setCallback(null)} className="rounded-lg border border-outline-variant px-3 py-2">Cancel</button>
        </div>
      </div>}
      {callbackStatus && <p role="status">{callbackStatus}</p>}
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
      {callLinks.map(call => <Link key={call.callId}
        href={`/dashboard/call-recordings?view=ai&callId=${call.callId}`}
        className="block font-semibold text-primary underline underline-offset-2">
        Open call transcript · {call.date}
      </Link>)}
    </div>
  );
}
