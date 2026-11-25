"use client";
import {useEffect,useState} from "react";
import {useAuth} from "@/lib/auth/auth-context";
type Settings={enabled:boolean;newInspections:boolean;phone:string;did:string};
export function OwnerCallNotifications(){
 const {user}=useAuth();const [settings,setSettings]=useState<Settings>({enabled:false,newInspections:false,phone:"",did:""});
 const [available,setAvailable]=useState(false),[numbers,setNumbers]=useState<string[]>([]),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[consent,setConsent]=useState(false);
 useEffect(()=>{
  if(!user)return;const controller=new AbortController();
  void (async()=>{try{const response=await fetch("/api/business/owner-call-notifications",{headers:{Authorization:`Bearer ${await user.getIdToken()}`},signal:controller.signal,cache:"no-store"});const result=await response.json();if(!response.ok)throw Error(result.error||"Could not load owner call settings.");if(!controller.signal.aborted){setSettings(result.settings);setNumbers(result.numbers);setAvailable(result.available);setConsent(result.settings.enabled);setReady(true);}}catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"Could not load settings.");}})();return()=>controller.abort();
 },[user]);
 async function save(){if(!user)return;setBusy(true);setMessage("");try{const response=await fetch("/api/business/owner-call-notifications",{method:"PATCH",headers:{Authorization:`Bearer ${await user.getIdToken()}`,"Content-Type":"application/json"},body:JSON.stringify({...settings,consent:settings.enabled?consent:true})});const result=await response.json();if(!response.ok)throw Error(result.error||"Could not save settings.");setSettings(result.settings);setMessage("Owner call settings saved.");}catch(error){setMessage(error instanceof Error?error.message:"Could not save settings.");}finally{setBusy(false);}}
 return <section className="space-y-3 rounded-xl border border-outline-variant p-4">
  <h4 className="font-display text-sm font-semibold">Calls to the owner</h4>
  <p className="text-xs text-on-surface-variant">Let Sophie phone you when a new inspection request arrives. Calls use your business calling hours and timezone. Customer callbacks have separate permissions.</p>
  {!available&&ready&&<p className="text-xs text-amber-700">Owner calls are not enabled on the platform yet. You can save your preference; no owner calls will be placed until rollout is enabled.</p>}
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.enabled} disabled={!ready||busy} onChange={e=>setSettings(s=>({...s,enabled:e.target.checked}))}/>Allow Sophie to call me</label>
  <label className="grid gap-1 text-sm">My contact number<input type="tel" value={settings.phone} disabled={!ready||busy} onChange={e=>setSettings(s=>({...s,phone:e.target.value}))} placeholder="Owner mobile or direct phone" className="rounded border border-outline-variant bg-surface px-3 py-2"/></label>
  <p className="text-xs text-on-surface-variant">Use your personal contact number, not a reception number answered by Sophie.</p>
  <label className="grid gap-1 text-sm">Call from business number<select value={settings.did} disabled={!ready||busy} onChange={e=>setSettings(s=>({...s,did:e.target.value}))} className="rounded border border-outline-variant bg-surface px-3 py-2"><option value="">Choose a number</option>{numbers.map(number=><option key={number} value={number}>{number}</option>)}</select></label>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.newInspections} disabled={!ready||busy} onChange={e=>setSettings(s=>({...s,newInspections:e.target.checked}))}/>Automatically call me for new inspection requests</label>
  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={consent} disabled={!ready||busy} onChange={e=>setConsent(e.target.checked)}/>This is my contact number and I agree to receive these calls.</label>
  <button type="button" disabled={!ready||busy||settings.enabled&&!consent} onClick={()=>void save()} className="rounded-lg bg-primary px-3 py-2 text-sm text-on-primary disabled:opacity-50">{busy?"Working…":"Save owner call settings"}</button>
  {message&&<p role="status" className="text-xs">{message}</p>}
 </section>;
}
