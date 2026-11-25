import assert from "node:assert/strict";
import test from "node:test";
import { commandCentreBackendUrl } from "../lib/commandCentreBackendUrl";
import { contentSecurityPolicy } from "../lib/security/csp";

test("owner review uses production backend by default and keeps localhost for development", () => {
  assert.equal(commandCentreBackendUrl(undefined, false), "https://command-api.bmspros.com.au/api");
  assert.equal(commandCentreBackendUrl(undefined, true), "http://127.0.0.1:5050/api");
  assert.equal(commandCentreBackendUrl(" https://staging.example.test/api/ ", false), "https://staging.example.test/api");
  assert.throws(() => commandCentreBackendUrl("http://localhost:5050/api", false));
  assert.throws(() => commandCentreBackendUrl("https://user:password@example.test/api", false));
  assert.throws(() => commandCentreBackendUrl("https://example.test/api#connect-src *", false));
});

test("generated CSP permits the exact owner-review API origin for read and approval requests", () => {
  const policy = contentSecurityPolicy("test-nonce");
  assert.ok(policy);
  const allowed = policy.split(";").map(part => part.trim()).find(part => part.startsWith("connect-src "))!.split(/\s+/);
  const backend = commandCentreBackendUrl(process.env.NEXT_PUBLIC_COMMAND_CENTRE_BACKEND_URL, process.env.NODE_ENV === "development");
  assert.ok(allowed.includes(new URL(backend).origin));
  assert.equal(allowed.includes("*"), false);
  assert.ok(policy.includes("object-src 'none'"));
});

import { ownerAudioEndpoint } from '../lib/ai/owner-call/audio-endpoint';
test('owner audio permits the exact configured endpoint and rejects insecure or injected CSP sources',()=>{
  assert.equal(ownerAudioEndpoint('ws://127.0.0.1:18787/owner-voice/audio',true)?.origin,'ws://127.0.0.1:18787');
  assert.equal(ownerAudioEndpoint('ws://127.0.0.1:18787/owner-voice/audio',false),null);
  assert.equal(ownerAudioEndpoint('wss://voice.example.test/owner-voice/audio',false)?.origin,'wss://voice.example.test');
  for(const value of ['ws://public.example.test/owner-voice/audio','wss://user:password@voice.example.test/owner-voice/audio','wss://voice.example.test/owner-voice/audio?token=secret','wss://voice.example.test/owner-voice/audio#connect-src *','wss://voice.example.test/media'])assert.equal(ownerAudioEndpoint(value,true),null);
});
test('CSP adds only the configured owner audio origin when its feature is enabled',()=>{
  const oldFlag=process.env.AI_OWNER_VOICE_DEEPGRAM_ENABLED,oldUrl=process.env.AI_OWNER_VOICE_PUBLIC_WS_URL;
  try{
    process.env.AI_OWNER_VOICE_PUBLIC_WS_URL='wss://voice.example.test/owner-voice/audio';
    process.env.AI_OWNER_VOICE_DEEPGRAM_ENABLED='true';assert.ok(contentSecurityPolicy('nonce').includes('wss://voice.example.test'));
    process.env.AI_OWNER_VOICE_DEEPGRAM_ENABLED='false';assert.ok(!contentSecurityPolicy('nonce').includes('wss://voice.example.test'));
  }finally{
    if(oldFlag===undefined)delete process.env.AI_OWNER_VOICE_DEEPGRAM_ENABLED;else process.env.AI_OWNER_VOICE_DEEPGRAM_ENABLED=oldFlag;
    if(oldUrl===undefined)delete process.env.AI_OWNER_VOICE_PUBLIC_WS_URL;else process.env.AI_OWNER_VOICE_PUBLIC_WS_URL=oldUrl;
  }
});
