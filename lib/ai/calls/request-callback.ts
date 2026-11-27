import "server-only";

export function callbackTransportCode(error:unknown):string {
  const failure=error as {code?:unknown;name?:unknown;cause?:{code?:unknown}};
  const code=failure?.cause?.code??failure?.code??failure?.name;
  return typeof code==="string"&&/^[A-Za-z0-9_]{1,64}$/.test(code)?code:"BRIDGE_TRANSPORT_ERROR";
}

/** Recovery reads status only. It must never retry the POST after an uncertain result. */
async function recoverInvoiceCallback(url:URL,input:{id:string;did:string;businessId:string},secret:string){
  const statusUrl=new URL(url);statusUrl.pathname="/sophie-callback/status";
  statusUrl.search=new URLSearchParams({id:input.id,did:input.did,businessId:input.businessId}).toString();
  try{
    const response=await fetch(statusUrl,{method:"GET",redirect:"error",signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${secret}`}});
    if(!response.ok)return null;
    const result=await response.json();
    if(result?.id!==input.id||!["ANSWERED","NO_ANSWER","FAILED"].includes(result.status))return null;
    return Response.json({status:result.status,code:typeof result.code==="string"&&/^[A-Z0-9_]{1,64}$/.test(result.code)?result.code:"BRIDGE_STATUS_RECOVERED"});
  }catch{return null;}
}

export async function requestSophieCallback(input: {
  id: string; did: string; businessId: string; number: string; automatic?: boolean; customerName?: string;
  ownerRequest?:{category:string;instructions:string;recipientNameKnown?:boolean};
  ownerNotification?:{requestCode:string};
  quotationFollowUp?:{quotationCode:string};
}) {
  const url = new URL(process.env.AI_OWNER_VOICE_BRIDGE_URL ?? "");
  const secret = process.env.AI_VOICE_BRIDGE_SECRET?.trim() ?? "";
  if (secret.length < 32 || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Sophie callback connection is unavailable.");
  }
  url.pathname = input.quotationFollowUp ? "/sophie-quotation-call" : input.ownerNotification ? "/sophie-owner-notification" : input.ownerRequest ? "/sophie-owner-call" : input.customerName === undefined ? "/sophie-callback" : "/sophie-invoice-call";
  const isInvoice=url.pathname==="/sophie-invoice-call";
  try{
  const response=await fetch(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(isInvoice?45_000:55_000),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if(isInvoice&&response.status>=500)return await recoverInvoiceCallback(url,input,secret)??response;
  return response;
  }catch(error){
    if(isInvoice){
      const recovered=await recoverInvoiceCallback(url,input,secret);if(recovered)return recovered;
      const failure=new Error(`Bridge request could not be verified (${callbackTransportCode(error)}).`);
      Object.assign(failure,{code:callbackTransportCode(error)});throw failure;
    }
    throw error;
  }
}
