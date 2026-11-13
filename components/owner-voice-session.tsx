"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  checkVoiceSave, isVoiceDraftTool, voiceDraftInput, VOICE_DRAFT_BODY_MAX, VOICE_DRAFTS_PER_SESSION,
  type VoiceDraftToolName,
} from "@/lib/ai/owner-call/voice-draft";
import { discardVoiceDraft, getVoiceDraft, saveVoiceDraft, showVoiceDraft, useVoiceDraft } from "@/lib/ai/owner-call/voice-draft-store";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
    output?: { type: string; name: string; arguments: string; call_id: string }[];
  };
};

type TranscriptLine = { id: string; speaker: "owner" | "sophie"; text: string; final: boolean };

export function OwnerVoiceSession() {
  const { user, businessId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const current = useRef<{ close: () => void } | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "connected">("idle");
  const [message, setMessage] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const voiceDraft = useVoiceDraft();

  useEffect(() => () => current.current?.close(), [user?.uid, businessId]);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  // Keep the newest line in view.
  useEffect(() => {
    const list = transcriptRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lines]);

  async function start() {
    if (!user || current.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      setMessage("Open Trade on HTTPS or localhost in a browser with microphone support.");
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
    setLines([]);
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
        // Turn on speech-to-text for the owner's side, for the live transcript and the
        // save confirmation check. If it is not available, Sophie still works normally.
        send({
          type: "session.update",
          session: { type: "realtime", audio: { input: { transcription: { model: TRANSCRIPTION_MODEL, language: "en" } } } },
        });
        send({ type: "response.create" });
      };
      channel.onclose = () => fail("The voice connection ended. Start a new session to continue.");
      channel.onmessage = async ({ data }) => {
        if (typeof data !== "string" || controller.signal.aborted) return;
        let event: RealtimeEvent;
        try { event = JSON.parse(data) as RealtimeEvent; } catch { return; }

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
                if (typeof text === "string" && !result.result?.isError) output = text;
              }
            } catch {
              // Report a tool failure to Sophie so it can answer without guessing.
            }
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

  const latest = lines.length - 1;
  return (
    <div className="space-y-3 p-4 text-sm">
      <p>Ask Sophie for today’s summary, jobs awaiting scheduling, who’s working, or what your AI knowledge says.</p>
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
    </div>
  );
}
