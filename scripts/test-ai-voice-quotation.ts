import assert from "node:assert/strict";
import test from "node:test";
import {
  audioExtension,
  draftFromTranscript,
  draftUserMessage,
  isPromptEcho,
  resolveDraft,
  transcribeVoiceNote,
  VoiceDraftError,
  voiceDraftConfig,
  vocabularyPrompt,
  type VoiceDraftCatalogItem,
  type VoiceDraftConfig,
} from "../lib/ai/quotation/voice-draft";

const services = [
  { id: "svc-hws", name: "Hot water system replacement", requiredSkill: "plumbing" },
  { id: "svc-drain", name: "Blocked drain", requiredSkill: "plumbing" },
];
const items: VoiceDraftCatalogItem[] = [
  { id: "it-hws", name: "Rheem 250L electric hot water unit", code: "RH250", description: "Electric storage", priceAud: 1450 },
  { id: "it-valve", name: "Tempering valve 15mm", code: "TV15", description: null, priceAud: 85 },
  { id: "it-labour", name: "Labour per hour", code: "LAB", description: null, priceAud: 110 },
  { id: "it-free", name: "Site rubbish removal", code: null, description: null, priceAud: 0 },
];
const config: VoiceDraftConfig = {
  transcribeUrl: "https://stt.test/v1", transcribeKey: "stt-key", transcribeModel: "gpt-4o-transcribe",
  draftUrl: "https://llm.test/v1", draftKey: "llm-key", draftModel: "gpt-4.1-mini",
};

test("config is off unless enabled and keyed; VoiceStudio can serve speech-to-text", () => {
  assert.equal(voiceDraftConfig({ OPENAI_API_KEY: "k" }), null);
  assert.equal(voiceDraftConfig({ AI_VOICE_QUOTATION_ENABLED: "true" }), null);
  const openai = voiceDraftConfig({ AI_VOICE_QUOTATION_ENABLED: "true", OPENAI_API_KEY: "k" })!;
  assert.equal(openai.transcribeUrl, "https://api.openai.com/v1");
  assert.equal(openai.draftKey, "k");
  const studio = voiceDraftConfig({
    AI_VOICE_QUOTATION_ENABLED: "true", OPENAI_API_KEY: "k",
    AI_TRANSCRIBE_BASE_URL: "https://voicestudio.internal:3900/v1/", AI_TRANSCRIBE_API_KEY: "vs", AI_TRANSCRIBE_MODEL: "whisperx",
  })!;
  assert.deepEqual([studio.transcribeUrl, studio.transcribeKey, studio.transcribeModel], ["https://voicestudio.internal:3900/v1", "vs", "whisperx"]);
});

test("only supported audio formats are accepted", () => {
  assert.equal(audioExtension("note.M4A"), "m4a");
  assert.equal(audioExtension("note.aac"), null);
  assert.equal(audioExtension("note"), null);
});

test("catalog lines take catalog name and price; the model cannot set prices", () => {
  const draft = resolveDraft({
    serviceId: "svc-hws", title: "Replace hot water unit", scopeOfWork: "The unit is leaking. Replace it.",
    lines: [
      { catalogItemId: "it-hws", name: "rheem unit", quantity: 1, note: "Leaking tank", priceAud: 1 },
      { catalogItemId: "it-labour", name: "labour", quantity: 2.333, note: "Install" },
      { catalogItemId: "it-labour", name: "labour", quantity: 1, note: "Disposal" },
    ],
    checks: [],
  }, "transcript", services, items);
  assert.equal(draft.requestType, "existing_service");
  assert.equal(draft.serviceName, "Hot water system replacement");
  assert.deepEqual(draft.lineItems.map((l) => [l.name, l.code, l.quantity, l.rateAud, l.needsPrice]), [
    ["Rheem 250L electric hot water unit", "RH250", 1, 1450, false],
    ["Labour per hour", "LAB", 3.33, 110, false],
  ]);
  assert.deepEqual(draft.checks, []);
});

test("unknown service, unknown item ids and unmatched items are made safe", () => {
  const draft = resolveDraft({
    serviceId: "svc-other-business", title: "", scopeOfWork: 42,
    lines: [
      { catalogItemId: "it-from-elsewhere", name: "Tempering valve 15mm", quantity: -3, note: "" },
      { catalogItemId: null, name: "Copper pipe 20mm", quantity: 6, note: "Re-pipe" },
      { catalogItemId: null, name: "Site rubbish removal", quantity: 1, note: "" },
      { catalogItemId: null, name: "   ", quantity: 1, note: "" },
      "junk",
    ],
    checks: ["Confirm pipe length", 7],
  }, "transcript", services, items);
  assert.equal(draft.serviceId, null);
  assert.equal(draft.requestType, "custom_quote");
  assert.equal(draft.title, "Site inspection quotation");
  assert.equal(draft.scopeOfWork, "");
  assert.deepEqual(draft.lineItems.map((l) => [l.name, l.catalogItemId, l.quantity, l.rateAud, l.needsPrice]), [
    ["Tempering valve 15mm", "it-valve", 1, 85, false], // matched by exact name, bad quantity -> 1
    ["Copper pipe 20mm", null, 6, 0, true],
    ["Site rubbish removal", "it-free", 1, 0, true], // catalog item with no price
  ]);
  assert.equal(draft.checks[0], "Confirm pipe length");
  assert.match(draft.checks.at(-1)!, /2 items have no price/);
});

test("prompts carry the catalog and context, and stay within limits", () => {
  const vocab = vocabularyPrompt(services, items);
  assert.match(vocab, /Rheem 250L/);
  assert.ok(vocabularyPrompt(services, Array.from({ length: 500 }, (_, i) => ({ ...items[0], id: `x${i}`, name: `Item number ${i}` }))).length <= 800);
  const message = JSON.parse(draftUserMessage("the tank leaks", services, items, { serviceName: "Hot water", customerNotes: "Leak in garage" }));
  assert.equal(message.transcript, "the tank leaks");
  assert.equal(message.catalog.length, 4);
  assert.equal(message.catalog[0].priceAud, undefined, "prices are not sent to the model");
  assert.deepEqual(message.visit, { requestedService: "Hot water", customerNotes: "Leak in garage" });
});

function fakeFetch(transcript: string, answer: unknown, calls: Array<{ url: string; init: RequestInit }>) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).endsWith("/audio/transcriptions")) return new Response(JSON.stringify({ text: transcript }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
  }) as typeof fetch;
}

test("a transcript that only repeats the spelling hint counts as nothing heard", async () => {
  const prompt = vocabularyPrompt(services, items);
  assert.equal(prompt.startsWith("Hot water system replacement"), true, "names only, no sentence");
  assert.equal(isPromptEcho("Rheem 250L electric hot water unit, Tempering valve 15mm.", prompt), true);
  assert.equal(isPromptEcho("   ", prompt), true);
  assert.equal(isPromptEcho("The Rheem 250L electric hot water unit is leaking, replace it", prompt), false);
  await assert.rejects(
    transcribeVoiceNote({ config, audio: new Blob(["x"]), filename: "a.m4a", services, items,
      fetchImpl: fakeFetch("Hot water system replacement, Blocked drain, Rheem 250L electric hot water unit.", {}, []) }),
    (error: unknown) => error instanceof VoiceDraftError && error.status === 422,
  );
});

test("step 1 transcribes with vocabulary hints and returns text only", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const text = await transcribeVoiceNote({
    config, audio: new Blob([new Uint8Array(10)], { type: "audio/mp4" }), filename: "note.m4a",
    services, items, fetchImpl: fakeFetch("  The hot water unit in the garage is leaking badly ", {}, calls),
  });
  assert.equal(text, "The hot water unit in the garage is leaking badly");
  assert.equal(calls.length, 1, "no AI drafting until the staff member confirms the text");
  assert.equal(calls[0].url, "https://stt.test/v1/audio/transcriptions");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer stt-key");
  const form = calls[0].init.body as FormData;
  assert.equal(form.get("model"), "gpt-4o-transcribe");
  assert.match(String(form.get("prompt")), /Rheem 250L/);
  assert.ok(form.get("file") instanceof Blob);
});

test("step 2 drafts from the confirmed (edited) text with strict JSON schema", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const answer = { serviceId: "svc-hws", title: "Hot water", scopeOfWork: "Replace unit.", checks: [],
    lines: [{ catalogItemId: "it-hws", name: "unit", quantity: 1, note: "" }] };
  const edited = "Replace the leaking hot water unit with a Rheem 250 litre";
  const draft = await draftFromTranscript({ config, transcript: edited, services, items, fetchImpl: fakeFetch("", answer, calls) });
  assert.equal(draft.transcript, edited);
  assert.equal(draft.lineItems[0].rateAud, 1450);
  assert.equal(calls.length, 1, "no transcription in step 2");
  assert.equal(calls[0].url, "https://llm.test/v1/chat/completions");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.model, "gpt-4.1-mini");
  assert.equal(JSON.parse(body.messages[1].content).transcript, edited);
});

test("silent recordings, empty text and service failures give clear errors", async () => {
  const audio = new Blob(["x"]);
  await assert.rejects(
    transcribeVoiceNote({ config, audio, filename: "a.m4a", services, items, fetchImpl: fakeFetch("um", {}, []) }),
    (error: unknown) => error instanceof VoiceDraftError && error.status === 422,
  );
  await assert.rejects(
    draftFromTranscript({ config, transcript: "  ok  ", services, items, fetchImpl: fakeFetch("", {}, []) }),
    (error: unknown) => error instanceof VoiceDraftError && error.status === 422,
  );
  const down = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  await assert.rejects(
    transcribeVoiceNote({ config, audio, filename: "a.m4a", services, items, fetchImpl: down }),
    (error: unknown) => error instanceof VoiceDraftError && error.status === 502,
  );
  const badJson = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }))) as typeof fetch;
  await assert.rejects(
    draftFromTranscript({ config, transcript: "replace the leaking hot water unit", services, items, fetchImpl: badJson }),
    (error: unknown) => error instanceof VoiceDraftError && error.status === 502,
  );
});
