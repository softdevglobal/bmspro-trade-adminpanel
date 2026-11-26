import "server-only";
import {adminDb} from "@/lib/firebase/admin";
import {normalizeInvoiceCallbackNumber} from "./callback-number";
/** Only explicitly supplied external numbers; mapped reception DIDs could loop. */
export async function isDirectOwnerCallNumberAllowed(number:string){
 if(normalizeInvoiceCallbackNumber(number)!==number)return false;
 const dids=[...new Set([number,number.startsWith("0")?`61${number.slice(1)}`:number])];
 const mappings=await Promise.all(dids.map(did=>adminDb.collection("ai_did_mappings").doc(did).get()));
 return mappings.every(doc=>!doc.exists);
}
