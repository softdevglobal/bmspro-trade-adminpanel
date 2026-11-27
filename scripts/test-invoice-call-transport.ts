import assert from "node:assert/strict";
import test,{beforeEach,afterEach} from "node:test";
import {requestSophieCallback,callbackTransportCode} from "../lib/ai/calls/request-callback";
const input={id:"a".repeat(64),did:"0359111403",businessId:"fixture-business",number:"0412345678",customerName:"Fixture customer"};
const prior={url:process.env.AI_OWNER_VOICE_BRIDGE_URL,secret:process.env.AI_VOICE_BRIDGE_SECRET};
beforeEach(()=>{process.env.AI_OWNER_VOICE_BRIDGE_URL="http://127.0.0.1:8787";process.env.AI_VOICE_BRIDGE_SECRET="fixture-transport-secret-000000000000000000";});
afterEach(()=>{if(prior.url===undefined)delete process.env.AI_OWNER_VOICE_BRIDGE_URL;else process.env.AI_OWNER_VOICE_BRIDGE_URL=prior.url;if(prior.secret===undefined)delete process.env.AI_VOICE_BRIDGE_SECRET;else process.env.AI_VOICE_BRIDGE_SECRET=prior.secret;});
test("lost invoice response is recovered by one authenticated read without a second dial",async t=>{
 const methods:string[]=[];
 t.mock.method(globalThis,"fetch",async(url:URL,init:RequestInit)=>{
  methods.push(init.method!);
  if(init.method==="POST")throw Object.assign(new Error("socket lost"),{cause:{code:"ECONNRESET"}});
  assert.equal(url.pathname,"/sophie-callback/status");assert.equal(url.searchParams.get("id"),input.id);assert.equal(url.searchParams.get("businessId"),input.businessId);assert.equal(url.searchParams.get("number"),null);
  assert.match((init.headers as Record<string,string>).Authorization,/^Bearer fixture/);
  return Response.json({id:input.id,status:"ANSWERED",code:"PBX_ANSWERED"});
 });
 assert.equal((await (await requestSophieCallback(input)).json()).status,"ANSWERED");assert.deepEqual(methods,["POST","GET"]);
});
test("pending or foreign results remain unverified; transport diagnostics contain no credentials",async t=>{
 let posts=0,reads=0;
 t.mock.method(globalThis,"fetch",async(_url:URL,init:RequestInit)=>{if(init.method==="POST"){posts++;throw Object.assign(new Error("private internal URL"),{cause:{code:"ECONNREFUSED"}});}reads++;return Response.json({id:input.id,status:"REQUESTED"});});
 await assert.rejects(requestSophieCallback(input),error=>{assert.equal(callbackTransportCode(error),"ECONNREFUSED");assert.doesNotMatch(String(error),/private internal|fixture-transport-secret/);return true;});assert.equal(posts,1);assert.equal(reads,1);
});
test("server errors may recover a known no-answer result; unavailable status never retries",async t=>{
 let reads=0;
 t.mock.method(globalThis,"fetch",async(_url:URL,init:RequestInit)=>init.method==="POST"?new Response(null,{status:502}):(reads++,Response.json({id:input.id,status:"NO_ANSWER"})));
 assert.equal((await (await requestSophieCallback(input)).json()).status,"NO_ANSWER");assert.equal(reads,1);
});
test("non-invoice requests retain their existing transport without status recovery",async t=>{
 let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("offline");});
 await assert.rejects(requestSophieCallback({...input,customerName:undefined}),/offline/);assert.equal(calls,1);
});

test("a status result for another attempt cannot confirm a lost invoice request",async t=>{
 const methods:string[]=[];
 t.mock.method(globalThis,"fetch",async(_url:URL,init:RequestInit)=>{methods.push(init.method!);if(init.method==="POST")throw Object.assign(new Error("offline"),{code:"ECONNRESET"});return Response.json({id:"b".repeat(64),status:"ANSWERED"});});
 await assert.rejects(requestSophieCallback(input),/ECONNRESET/);assert.deepEqual(methods,["POST","GET"]);
});
