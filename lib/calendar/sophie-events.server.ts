import "server-only";
import type {Firestore} from "firebase-admin/firestore";
import {scheduledSophieItem,quotationSophieItem,invoiceSophieItem,type SophieCalendarItem} from "./sophie-events";

/** Only ranged, tenant-bound queries; never scans the whole automation queue. */
export async function loadSophieCalendar(db:Firestore,businessId:string,start:number,end:number,timezone:string,modules:{invoices:boolean;quotations:boolean}){
 const ranged=(collection:string,field:string)=>db.collection(collection).where("businessId","==",businessId)
  .where(field,">=",start).where(field,"<",end).orderBy(field,"desc").limit(101).get();
 const [scheduled,quotes,invoices]=await Promise.all([
  ranged("ai_scheduled_callbacks","scheduledAt"),modules.quotations?ranged("quotations","sophieFollowUpDueAt"):null,
  modules.invoices?ranged("ai_invoice_call_attempts","attemptedAt"):null,
 ]);
 const items:SophieCalendarItem[]=[];
 for(const doc of scheduled.docs.slice(0,100)){
  const row=doc.data();if(row.businessId!==businessId||row.purpose==="overdue_invoice"&&!modules.invoices)continue;
  const value=scheduledSophieItem(doc.id,row,timezone);if(value)items.push(value);
 }
 for(const doc of quotes?.docs.slice(0,100)??[]){const row=doc.data();if(row.businessId!==businessId)continue;const value=quotationSophieItem(doc.id,row,timezone);if(value)items.push(value);}
 const invoiceRows=(invoices?.docs.slice(0,100)??[]).filter(doc=>doc.get("businessId")===businessId);
 const invoiceIds=[...new Set(invoiceRows.flatMap(doc=>typeof doc.get("invoiceId")==="string"&&/^[^/]{1,1500}$/.test(doc.get("invoiceId"))?[doc.get("invoiceId") as string]:[]))];
 const invoiceDocs=invoiceIds.length?await db.getAll(...invoiceIds.map(id=>db.collection("invoices").doc(id))):[];
 const details=new Map(invoiceDocs.filter(doc=>doc.exists&&doc.get("businessId")===businessId).map(doc=>[doc.id,doc.data()!]));
 for(const doc of invoiceRows){const row=doc.data(),invoice=details.get(row.invoiceId);if(!invoice)continue;
  const value=invoiceSophieItem(doc.id,{...row,customerName:invoice.customer?.fullName,reference:invoice.invoiceCode},timezone);if(value)items.push(value);
 }
 return {items:items.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)),partial:scheduled.size>100||(quotes?.size??0)>100||(invoices?.size??0)>100};
}
