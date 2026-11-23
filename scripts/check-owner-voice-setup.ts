/** Read-only local diagnostic: builds a session with fixture auth; never contacts a bridge or reads tenant records. */
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
// @ts-expect-error Runtime supports module hooks; project typings target Node 20.
import {registerHooks} from 'node:module';
async function main(){
 const folder=mkdtempSync(join(tmpdir(),'owner-voice-setup-'));
 const authFile=join(folder,'auth.cjs'),rateFile=join(folder,'rate.cjs');
 writeFileSync(authFile,`exports.requireOwnerBriefing=async()=>({ok:true,uid:'fixture-owner',businessId:'fixture-business',timezone:'Australia/Melbourne'});`);
 writeFileSync(rateFile,`exports.consumeRateLimits=async()=>true;`);
 const fixture=new Map([['@/lib/ai/owner-call/auth',pathToFileURL(authFile).href],['@/lib/security/rate-limit',pathToFileURL(rateFile).href]]);
 const hook=registerHooks({resolve(specifier:string,context:unknown,next:(s:string,c:unknown)=>unknown){const url=fixture.get(specifier);return url?{url,format:'commonjs',shortCircuit:true}:next(specifier,context)}});
 process.env.AI_OWNER_VOICE_BRIDGE_URL='http://127.0.0.1:18787';
 process.env.AI_VOICE_BRIDGE_SECRET='fixture-secret-for-local-check-only-12345678';
 const originalFetch=globalThis.fetch;
 try{
  const {POST}=await import('../app/api/ai/owner-call/route');
  const bridgeSource=readFileSync(resolve('../voice-bridge/bmspro-voice-bridge/src/agents/trade/trade-owner-voice.mjs'),'utf8');
  const allowed=new Set([...bridgeSource.split('const toolNames = new Set([')[1].split(']);')[0].matchAll(/'([^']+)'/g)].map(match=>match[1]));
  for(const mode of ['voice','chat']){
   let captured:{instructions:string;tools:{name:string}[]}|undefined;
   globalThis.fetch=async(_url,init)=>{captured=JSON.parse(String(init?.body)).session;return new Response('v=0\r\nanswer',{headers:{'Content-Type':'application/sdp'}})};
   const response=await POST(new Request('http://localhost/api/ai/owner-call',{method:'POST',headers:{'Content-Type':'application/sdp',...(mode==='chat'?{'X-Sophie-Mode':'chat'}:{})},body:'v=0\r\nfixture'}));
   console.log({mode,status:response.status,visitsEnabled:process.env.AI_OWNER_VOICE_VISITS_ENABLED==='true',instructionCharacters:captured?.instructions.length,tools:captured?.tools.length,unknownTools:captured?.tools.filter(tool=>!allowed.has(tool.name)).map(tool=>tool.name),duplicateTools:captured?.tools.filter((tool,index,all)=>all.findIndex(other=>other.name===tool.name)!==index).map(tool=>tool.name)});
  }
 }finally{globalThis.fetch=originalFetch;hook.deregister();rmSync(folder,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Diagnostic failed');process.exitCode=1});
