"use client";

import { auth } from "@/lib/firebase/client";
import type { KnowledgeKind, KnowledgeSource, KnowledgeStatus } from "@/lib/ai/data/knowledge-sources";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";
const CARD_CLASS = "rounded-2xl border border-outline-variant bg-surface p-5 shadow-sm sm:p-6";
const PRIMARY_BUTTON =
  "inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-1.5 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50";

/** Common topics callers ask about; clicking one pre-fills the title. */
const TOPIC_SUGGESTIONS: Array<{ title: string; kind: "faq" | "policy"; hint: string }> = [
  { title: "Opening hours", kind: "faq", hint: "e.g. We work Monday to Friday, 7am to 4pm. Closed weekends and public holidays." },
  { title: "Service areas", kind: "faq", hint: "e.g. We cover Lynbrook, Lyndhurst, Hampton Park and Dandenong." },
  { title: "Call-out fee", kind: "policy", hint: "e.g. We charge a $90 call-out fee within our service area." },
  { title: "Quotes", kind: "policy", hint: "e.g. Quotes are free. Bigger jobs get a site visit and a written quote." },
  { title: "Payment methods", kind: "policy", hint: "e.g. We accept card and bank transfer. Payment is due on completion." },
  { title: "Licensing and insurance", kind: "faq", hint: "e.g. All our electricians are licensed and we hold public liability insurance." },
  { title: "Warranty", kind: "policy", hint: "e.g. 12-month workmanship warranty; parts carry the manufacturer's warranty." },
  { title: "Emergency work", kind: "faq", hint: "e.g. We don't offer after-hours call-outs. In an emergency call 000." },
  { title: "Cancellations and rescheduling", kind: "policy", hint: "e.g. Please give 24 hours' notice to cancel or move a visit." },
  { title: "Types of work we do", kind: "faq", hint: "e.g. Power points, lighting, switchboards… We don't do solar." },
];

const KIND_LABEL: Record<KnowledgeKind, string> = {
  faq: "FAQ", policy: "Policy", note: "Note", business_facts: "Business facts", service_descriptions: "Services",
};
const STATUS_STYLE: Record<KnowledgeStatus, { label: string; className: string }> = {
  published: { label: "Published", className: "bg-primary/10 text-primary" },
  draft: { label: "Draft", className: "bg-surface-container-high text-on-surface-variant" },
  needs_review: { label: "Needs review", className: "bg-error-container/60 text-error" },
  archived: { label: "Deleted", className: "bg-surface-container-high text-on-surface-variant" },
};
const FLAG_LABEL: Record<string, string> = {
  personal_data: "contains a phone number, email or long number",
  instruction_like: "contains text that looks like instructions to the AI",
};

type Filter = "all" | "published" | "draft" | "needs_review";
type Unanswered = { id: string; question: string; count: number };
type TestMatch = { sourceId: string; title: string; text: string; distance: number };
type TestResult = { status: "FOUND" | "NO_MATCH"; durationMs: number; matches: TestMatch[] };
type Editor = { id: string | null; version: number; kind: "faq" | "policy" | "note"; title: string; body: string };
type ApiResult = { ok?: boolean; error?: string } & Record<string, unknown>;

const EMPTY_EDITOR: Editor = { id: null, version: 0, kind: "faq", title: "", body: "" };

async function authFetch(path: string, options: RequestInit = {}): Promise<ApiResult> {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again.");
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as ApiResult;
  if (!response.ok || body.ok === false) throw new Error(body.error || "Request failed.");
  return body;
}

async function fetchBoard(): Promise<
  | { ok: true; sources: KnowledgeSource[]; voiceEnabled: boolean; unanswered: Unanswered[] }
  | { ok: false; error: string }
> {
  try {
    const [knowledge, open] = await Promise.all([
      authFetch("/api/ai/knowledge"),
      authFetch("/api/ai/unanswered").catch(() => ({ questions: [] }) as ApiResult),
    ]);
    return {
      ok: true,
      sources: (knowledge.sources as KnowledgeSource[]) ?? [],
      voiceEnabled: knowledge.voiceEnabled === true,
      unanswered: (open.questions as Unanswered[]) ?? [],
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load AI knowledge." };
  }
}

function indexState(source: KnowledgeSource): { label: string; pending: boolean; error: boolean } {
  if (source.indexError) return { label: source.indexError, pending: false, error: true };
  if (source.indexedVersion < source.version) return { label: "Preparing for Sophie…", pending: true, error: false };
  return { label: `Ready · ${source.chunkCount} passage${source.chunkCount === 1 ? "" : "s"}`, pending: false, error: false };
}

export function AiKnowledgeBoard() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [unanswered, setUnanswered] = useState<Unanswered[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [editor, setEditor] = useState<Editor>(EMPTY_EDITOR);
  const [hint, setHint] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const editorRef = useRef<HTMLDivElement>(null);

  /** Applies a fetch result to state. Kept separate so effects only set state in promise callbacks. */
  const apply = useCallback((result: Awaited<ReturnType<typeof fetchBoard>>) => {
    if (result.ok) {
      setSources(result.sources);
      setVoiceEnabled(result.voiceEnabled);
      setUnanswered(result.unanswered);
    } else {
      setNotice({ tone: "error", text: result.error });
    }
    setLoading(false);
  }, []);

  const load = useCallback(async () => { apply(await fetchBoard()); }, [apply]);

  useEffect(() => {
    let cancelled = false;
    void fetchBoard().then(result => { if (!cancelled) apply(result); });
    return () => { cancelled = true; };
  }, [apply]);

  // While anything is being indexed, refresh every few seconds so the status updates by itself.
  const anyPending = sources.some(source => indexState(source).pending);
  useEffect(() => {
    if (!anyPending) return;
    const timer = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(timer);
  }, [anyPending, load]);

  /** Runs an action; if it resolves to a string, that replaces the default success message. */
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNotice(null);
    try {
      const override = await action();
      setNotice({ tone: "info", text: typeof override === "string" ? override : done });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => ({
    all: sources.length,
    published: sources.filter(source => source.status === "published").length,
    draft: sources.filter(source => source.status === "draft").length,
    needs_review: sources.filter(source => source.status === "needs_review").length,
  }), [sources]);
  const visible = filter === "all" ? sources : sources.filter(source => source.status === filter);
  const existingTitles = useMemo(() => new Set(sources.map(source => source.title.trim().toLowerCase())), [sources]);
  const editorValid = editor.title.trim().length >= 2 && editor.body.trim().length >= 10;

  function startNew(topic?: (typeof TOPIC_SUGGESTIONS)[number]) {
    setEditor({ ...EMPTY_EDITOR, kind: topic?.kind ?? "faq", title: topic?.title ?? "" });
    setHint(topic?.hint ?? null);
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startEdit(source: KnowledgeSource) {
    if (source.generated) return;
    setEditor({ id: source.id, version: source.version, kind: source.kind as Editor["kind"], title: source.title, body: source.body });
    setHint(null);
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const save = (publish: boolean) => run(async () => {
    const payload = { title: editor.title.trim(), body: editor.body.trim() };
    let message: string | undefined;
    if (editor.id) {
      const result = await authFetch(`/api/ai/knowledge/${editor.id}`, {
        method: "PATCH", body: JSON.stringify({ version: editor.version, ...payload }),
      });
      if (result.status === "needs_review") {
        message = "Saved, but held for review because it may contain contact details or AI instructions. Check it, then publish from the list.";
      } else if (publish && result.status !== "published") {
        await authFetch(`/api/ai/knowledge/${editor.id}`, {
          method: "PATCH", body: JSON.stringify({ version: Number(result.version), status: "published" }),
        });
      } else if (!publish && result.status === "published") {
        message = "Saved. It's still published, so Sophie will use the new wording.";
      }
    } else {
      const created = await authFetch("/api/ai/knowledge", { method: "POST", body: JSON.stringify({ kind: editor.kind, ...payload }) });
      const flags = (created.flags as string[]) ?? [];
      if (flags.length) {
        message = `Saved, but held for review: it ${flags.map(flag => FLAG_LABEL[flag] ?? flag).join(" and ")}. Check it, then publish from the list.`;
      } else if (publish) {
        await authFetch(`/api/ai/knowledge/${String(created.id)}`, { method: "PATCH", body: JSON.stringify({ version: 1, status: "published" }) });
      }
    }
    setEditor(EMPTY_EDITOR);
    setHint(null);
    return message;
  }, publish ? "Saved and published. Sophie can use it on new calls once it shows Ready." : "Saved as a draft. Sophie won't use it until you publish it.");

  const setStatus = (source: KnowledgeSource, status: "draft" | "published") => {
    let acknowledgeFlags = false;
    if (status === "published" && source.flags.length) {
      acknowledgeFlags = window.confirm(
        `"${source.title}" ${source.flags.map(flag => FLAG_LABEL[flag] ?? flag).join(" and ")}.\n\nSophie may say this text to callers. Publish anyway?`,
      );
      if (!acknowledgeFlags) return;
    }
    void run(() => authFetch(`/api/ai/knowledge/${source.id}`, {
      method: "PATCH", body: JSON.stringify({ version: source.version, status, ...(acknowledgeFlags ? { acknowledgeFlags: true } : {}) }),
    }), status === "published" ? "Published. Sophie can use it on new calls." : "Unpublished. Sophie will stop using it.");
  };

  const remove = (source: KnowledgeSource) => {
    if (!window.confirm(`Delete "${source.title}"? Sophie will stop using it.`)) return;
    if (editor.id === source.id) setEditor(EMPTY_EDITOR);
    void run(() => authFetch(`/api/ai/knowledge/${source.id}`, { method: "DELETE" }), "Deleted.");
  };

  const refreshFacts = () => run(
    () => authFetch("/api/ai/knowledge/reindex", { method: "POST" }),
    "Refreshing business facts and services from your settings. New facts arrive as drafts for you to check and publish.",
  );

  async function test() {
    if (question.trim().length < 3) return;
    setTesting(true);
    setTestResult(null);
    setNotice(null);
    try {
      const result = await authFetch("/api/ai/knowledge/search", { method: "POST", body: JSON.stringify({ question: question.trim() }) });
      setTestResult({ status: result.status as TestResult["status"], durationMs: Number(result.durationMs), matches: (result.matches as TestMatch[]) ?? [] });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Search failed." });
    } finally {
      setTesting(false);
    }
  }

  const answer = (item: Unanswered) => {
    const text = answers[item.id]?.trim() ?? "";
    if (text.length < 10) return;
    void run(async () => {
      await authFetch(`/api/ai/unanswered/${item.id}/approve`, { method: "POST", body: JSON.stringify({ answer: text }) });
      setAnswers(current => { const next = { ...current }; delete next[item.id]; return next; });
    }, "Answer saved as a published FAQ. Sophie can use it on new calls once it shows Ready.");
  };
  const dismiss = (item: Unanswered) =>
    void run(() => authFetch(`/api/ai/unanswered/${item.id}/dismiss`, { method: "POST" }), "Question dismissed.");

  if (loading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-on-surface">AI knowledge</h1>
          <p className="mt-1 max-w-2xl font-body text-[13px] text-on-surface-variant">
            What Sophie, your AI receptionist, can tell callers about your business. She only uses <strong>published</strong> entries,
            and live details like availability and bookings always come from your calendar, not from here.
          </p>
        </div>
        <button type="button" disabled={busy} onClick={refreshFacts} className={SECONDARY_BUTTON}>
          <span className="material-symbols-outlined text-[16px]">sync</span>
          Refresh business facts
        </button>
      </div>

      {!voiceEnabled && (
        <div className="flex items-start gap-2 rounded-lg bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface-variant">
          <span className="material-symbols-outlined text-[18px]">info</span>
          Phone calls aren&apos;t using this knowledge yet. You can add and test entries now; they&apos;ll be used once AI knowledge is switched on for calls.
        </div>
      )}

      {notice && (
        <p className={`rounded-lg px-3 py-2 font-body text-[13px] ${notice.tone === "error" ? "bg-error-container/60 text-error" : "bg-primary/10 text-primary"}`}>
          {notice.text}
        </p>
      )}

      {/* Test a question */}
      <div className={CARD_CLASS}>
        <div className="mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">record_voice_over</span>
          <h3 className="font-display text-[17px] font-bold text-on-surface">Test a question</h3>
        </div>
        <p className="mb-3 font-body text-[13px] text-on-surface-variant">Ask it the way a caller would. You&apos;ll see what Sophie would find.</p>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); void test(); }}>
          <input value={question} onChange={event => setQuestion(event.target.value)} maxLength={300}
            placeholder="e.g. Do you charge to come out?" className={INPUT_CLASS} />
          <button type="submit" disabled={testing || question.trim().length < 3} className={PRIMARY_BUTTON}>
            <span className={`material-symbols-outlined text-[18px] ${testing ? "animate-spin" : ""}`}>{testing ? "progress_activity" : "search"}</span>
            Test
          </button>
        </form>
        {testResult && (
          <div className="mt-4 flex flex-col gap-2">
            {testResult.status === "NO_MATCH" ? (
              <p className="rounded-lg bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface-variant">
                No published entry matches. Sophie would say she doesn&apos;t have that detail on hand. Add an entry to cover it.
              </p>
            ) : (
              <>
                <p className="font-body text-[12px] text-on-surface-variant">
                  Sophie would answer from {testResult.matches.length === 1 ? "this entry" : "these entries"} (best match first, {testResult.durationMs} ms):
                </p>
                {testResult.matches.map((match, index) => (
                  <div key={`${match.sourceId}-${index}`} className="rounded-xl border border-outline-variant p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-body text-[13px] font-semibold text-on-surface">{match.title}</p>
                      <span className="font-body text-[11px] text-on-surface-variant" title="Lower is a closer match">
                        {match.distance < 0.3 ? "Strong match" : match.distance < 0.45 ? "Good match" : "Weak match"} · {match.distance}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap font-body text-[12px] text-on-surface-variant">{match.text}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Editor */}
      <div ref={editorRef} className={CARD_CLASS}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">{editor.id ? "edit" : "add_notes"}</span>
            <h3 className="font-display text-[17px] font-bold text-on-surface">{editor.id ? "Edit entry" : "Add an entry"}</h3>
          </div>
          {editor.id && (
            <button type="button" onClick={() => startNew()} className={SECONDARY_BUTTON}>Cancel edit</button>
          )}
        </div>

        {!editor.id && (
          <div className="mb-4">
            <p className="mb-2 font-body text-[12px] font-semibold text-on-surface-variant">Common topics</p>
            <div className="flex flex-wrap gap-2">
              {TOPIC_SUGGESTIONS.map(topic => {
                const done = existingTitles.has(topic.title.toLowerCase());
                return (
                  <button key={topic.title} type="button" onClick={() => startNew(topic)} disabled={done}
                    className="inline-flex items-center gap-1 rounded-full border border-outline-variant px-3 py-1 font-body text-[12px] font-medium text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:cursor-default disabled:opacity-50 disabled:hover:border-outline-variant disabled:hover:text-on-surface-variant">
                    <span className="material-symbols-outlined text-[14px]">{done ? "check" : "add"}</span>
                    {topic.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <div>
              <label className="mb-1 block font-body text-[13px] font-semibold text-on-surface">Type</label>
              <select value={editor.kind} disabled={!!editor.id}
                onChange={event => setEditor({ ...editor, kind: event.target.value as Editor["kind"] })} className={INPUT_CLASS}>
                <option value="faq">FAQ</option>
                <option value="policy">Policy</option>
                <option value="note">Note</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-body text-[13px] font-semibold text-on-surface">Topic</label>
              <input value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} maxLength={120}
                placeholder="e.g. Call-out fee" className={INPUT_CLASS} />
            </div>
          </div>
          <div>
            <label className="mb-1 block font-body text-[13px] font-semibold text-on-surface">Answer</label>
            <textarea value={editor.body} onChange={event => setEditor({ ...editor, body: event.target.value })} rows={5} maxLength={20000}
              placeholder={hint ?? "Write it the way you'd want Sophie to explain it on the phone. One topic per entry works best."}
              className={INPUT_CLASS} />
            <p className="mt-1 font-body text-[11px] text-on-surface-variant">
              Only include what&apos;s true and approved. Don&apos;t include customer details. Your business phone and email are already known to Sophie.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !editorValid} onClick={() => save(true)} className={PRIMARY_BUTTON}>
              <span className="material-symbols-outlined text-[18px]">publish</span>
              Save and publish
            </button>
            <button type="button" disabled={busy || !editorValid} onClick={() => save(false)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-outline-variant px-4 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50">
              Save as draft
            </button>
          </div>
        </div>
      </div>

      {/* Questions Sophie couldn't answer */}
      {unanswered.length > 0 && (
        <div className={CARD_CLASS}>
          <div className="mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">help</span>
            <h3 className="font-display text-[17px] font-bold text-on-surface">Questions Sophie couldn&apos;t answer</h3>
          </div>
          <p className="mb-3 font-body text-[13px] text-on-surface-variant">
            Callers asked these and there was no published answer. Answer one to add it as a FAQ.
          </p>
          <ul className="flex flex-col gap-3">
            {unanswered.map(item => (
              <li key={item.id} className="rounded-xl border border-outline-variant p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-body text-[13px] font-semibold text-on-surface">
                    “{item.question}” <span className="font-normal text-on-surface-variant">· asked {item.count}×</span>
                  </p>
                  <button type="button" disabled={busy} onClick={() => dismiss(item)} className={SECONDARY_BUTTON}>Dismiss</button>
                </div>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <textarea value={answers[item.id] ?? ""} rows={2} maxLength={20000}
                    onChange={event => setAnswers(current => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="Type the answer Sophie should give…" className={INPUT_CLASS} />
                  <button type="button" disabled={busy || (answers[item.id]?.trim().length ?? 0) < 10} onClick={() => answer(item)} className={PRIMARY_BUTTON}>
                    Answer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Entries */}
      <div className={CARD_CLASS}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">menu_book</span>
            <h3 className="font-display text-[17px] font-bold text-on-surface">Entries</h3>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "published", "draft", "needs_review"] as const).map(key => (
              <button key={key} type="button" onClick={() => setFilter(key)}
                className={`rounded-full px-3 py-1 font-body text-[12px] font-medium transition-colors ${filter === key ? "bg-primary text-on-primary" : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"}`}>
                {key === "all" ? "All" : STATUS_STYLE[key].label} ({counts[key]})
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="px-3 py-6 text-center font-body text-[13px] text-on-surface-variant">
            {sources.length === 0 ? "No entries yet. Pick a common topic above to start." : "Nothing here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visible.map(source => {
              const state = indexState(source);
              const status = STATUS_STYLE[source.status];
              return (
                <li key={source.id} className={`rounded-xl border p-4 ${editor.id === source.id ? "border-primary" : "border-outline-variant"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-body text-[14px] font-semibold text-on-surface">{source.title}</p>
                        <span className={`rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${status.className}`}>{status.label}</span>
                        <span className="rounded-full border border-outline-variant px-2 py-0.5 font-body text-[11px] text-on-surface-variant">{KIND_LABEL[source.kind] ?? source.kind}</span>
                      </div>
                      <p className={`mt-1 flex items-center gap-1 font-body text-[11px] ${state.error ? "text-error" : "text-on-surface-variant"}`}>
                        {state.pending && <span className="material-symbols-outlined animate-spin text-[12px]">progress_activity</span>}
                        {state.label}
                      </p>
                      {source.flags.length > 0 && (
                        <p className="mt-1 font-body text-[11px] text-error">
                          Check before publishing: {source.flags.map(flag => FLAG_LABEL[flag] ?? flag).join("; ")}.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!source.generated && (
                        <button type="button" disabled={busy} onClick={() => startEdit(source)} className={SECONDARY_BUTTON}>
                          <span className="material-symbols-outlined text-[14px]">edit</span>Edit
                        </button>
                      )}
                      {source.status === "published" ? (
                        <button type="button" disabled={busy} onClick={() => setStatus(source, "draft")} className={SECONDARY_BUTTON}>Unpublish</button>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => setStatus(source, "published")} className={SECONDARY_BUTTON}>
                          <span className="material-symbols-outlined text-[14px]">publish</span>Publish
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={() => remove(source)} className={SECONDARY_BUTTON}>
                        <span className="material-symbols-outlined text-[14px]">delete</span>Delete
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-4 whitespace-pre-wrap font-body text-[13px] text-on-surface">{source.body}</p>
                  {source.generated && (
                    <p className="mt-2 font-body text-[11px] text-on-surface-variant">
                      Built from your business settings and services. To change it, update your settings, then press Refresh business facts.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
