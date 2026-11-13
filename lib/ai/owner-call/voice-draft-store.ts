/**
 * Browser-only state for the voice knowledge draft that is waiting for the owner's OK.
 *
 * Talk to Sophie (components/owner-voice-session.tsx) writes it when the model calls
 * prepare_knowledge_draft; the AI knowledge page (components/voice-draft-card.tsx)
 * shows it as a highlighted card the owner can edit, save or discard. Both live in
 * the persistent dashboard shell, so the voice session keeps running while the
 * owner moves to the AI knowledge page.
 *
 * Kept in memory only. Nothing is stored until the owner (or Sophie, after the
 * owner says yes) saves it, and then it is saved as an unpublished draft.
 */
import { useSyncExternalStore } from "react";
import { auth } from "@/lib/firebase/client";
import { voiceDraftInput, voiceDraftWarnings, type VoiceDraftInput, type VoiceDraftKind } from "./voice-draft";

export type VoiceDraft = {
  /** Changes every time Sophie prepares a new version, so the card can scroll to it. */
  id: string;
  kind: VoiceDraftKind;
  title: string;
  body: string;
  warnings: string[];
  /** The voice session that prepared it. Sophie can only save drafts from her own session. */
  sessionId: string;
  /** The owner changed the text on screen after Sophie prepared it. */
  edited: boolean;
};

export type VoiceDraftState = {
  draft: VoiceDraft | null;
  status: "pending" | "saving" | "saved" | "error";
  savedId: string | null;
  /** The server held the saved draft for review (contact details or AI-like instructions). */
  needsReview: boolean;
  error: string | null;
};

export type VoiceDraftSaveResult =
  | { ok: true; id: string; needsReview: boolean }
  | { ok: false; error: string };

const EMPTY: VoiceDraftState = { draft: null, status: "pending", savedId: null, needsReview: false, error: null };
let state: VoiceDraftState = EMPTY;
const listeners = new Set<() => void>();

function set(next: VoiceDraftState) {
  state = next;
  for (const listener of listeners) listener();
}

export function getVoiceDraft() { return state; }

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** React hook for the current voice draft. Empty during server rendering. */
export function useVoiceDraft(): VoiceDraftState {
  return useSyncExternalStore(subscribe, getVoiceDraft, () => EMPTY);
}

/** Shows Sophie's proposed note. Replaces any earlier unsaved one. */
export function showVoiceDraft(input: VoiceDraftInput, sessionId: string): VoiceDraft {
  const draft: VoiceDraft = {
    id: crypto.randomUUID(), kind: input.kind, title: input.title, body: input.body,
    warnings: voiceDraftWarnings(input), sessionId, edited: false,
  };
  set({ ...EMPTY, draft });
  return draft;
}

/** The owner edits the note on screen before saving. */
export function editVoiceDraft(patch: Partial<Pick<VoiceDraft, "kind" | "title" | "body">>) {
  if (!state.draft || state.status === "saving" || state.status === "saved") return;
  const draft = { ...state.draft, ...patch, edited: true };
  set({ ...state, status: "pending", error: null, draft: { ...draft, warnings: voiceDraftWarnings(draft) } });
}

export function discardVoiceDraft() {
  if (state.status === "saving") return;
  set(EMPTY);
}

/**
 * Saves exactly what is on screen as an unpublished draft through the normal owner
 * API, which checks the owner's login, scans the text again and rate-limits voice drafts.
 */
export async function saveVoiceDraft(): Promise<VoiceDraftSaveResult> {
  const draft = state.draft;
  if (!draft) return { ok: false, error: "There is no note to save." };
  if (state.status === "saving" || state.status === "saved") return { ok: false, error: "This note is already being saved." };
  const parsed = voiceDraftInput.safeParse({ kind: draft.kind, title: draft.title, body: draft.body });
  if (!parsed.success) {
    const error = "Use a title of 2–120 characters and a note of 10–2,000 characters.";
    set({ ...state, status: "error", error });
    return { ok: false, error };
  }
  set({ ...state, status: "saving", error: null });
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("Please sign in again.");
    const response = await fetch("/api/ai/knowledge", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ ...parsed.data, createdVia: "owner_voice" }),
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; id?: string; flags?: string[]; error?: string };
    if (!response.ok || body.ok === false || typeof body.id !== "string") throw new Error(body.error || "Could not save the draft.");
    const needsReview = (body.flags ?? []).length > 0;
    // Only update if the owner did not discard or replace the note while it was saving.
    if (state.draft?.id === draft.id) set({ ...state, status: "saved", savedId: body.id, needsReview, error: null });
    return { ok: true, id: body.id, needsReview };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the draft.";
    if (state.draft?.id === draft.id) set({ ...state, status: "error", error: message });
    return { ok: false, error: message };
  }
}
