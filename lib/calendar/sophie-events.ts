import {platformTodayIso,formatInPlatformTimeZone} from "@/lib/platform/timezone";

/** Add future Sophie activity categories here; calendar filters render this registry. */
export const SOPHIE_CALENDAR_TYPES={
 invoice_follow_up:{label:"Overdue invoice follow-ups",icon:"receipt_long"},
 quotation_follow_up:{label:"Quotation follow-ups",icon:"request_quote"},
 scheduled_call:{label:"Scheduled calls",icon:"phone_callback"},
} as const;
export type SophieCalendarKind=keyof typeof SOPHIE_CALENDAR_TYPES;
export type SophieCalendarItem={id:string;kind:SophieCalendarKind;date:string;time:string;at:number;
 title:string;recipient:string;reference:string|null;status:string;statusLabel:string;href:string;timing:"scheduled"|"queued"|"attempted";reason:string|null};
type Row=Record<string,unknown>;
const str=(v:unknown)=>typeof v==="string"?v:"";
const number=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:null;
const labels:Record<string,string>={SCHEDULED:"Scheduled",QUEUED:"Queued",OWNER_SCHEDULED:"Scheduled",OWNER_NUMBER_SCHEDULED:"Scheduled",
 CALLING:"Calling",REQUESTED:"Call requested",ANSWERED:"Phone answered",NO_ANSWER:"No answer",UNKNOWN:"Outcome unverified",FAILED:"Failed",
 CANCELLED:"Cancelled",SKIPPED:"Skipped",DECIDED:"Decision recorded",DISABLED:"Disabled"};
function item(id:string,kind:SophieCalendarKind,at:number,row:Row,timezone:string,href:string,timing:SophieCalendarItem["timing"]):SophieCalendarItem{
 return {id,kind,at,date:platformTodayIso(new Date(at),timezone),time:formatInPlatformTimeZone(at,{hour:"2-digit",minute:"2-digit",hourCycle:"h23"},timezone),
  title:SOPHIE_CALENDAR_TYPES[kind].label,recipient:str(row.customerName)||(str(row.number)?`Number ending ${str(row.number).slice(-4)}`:"Recipient unavailable"),reference:str(row.reference)||null,status:str(row.status),
  statusLabel:labels[str(row.status)]||str(row.status)||"Unknown",href,timing,reason:str(row.instructions)||str(row.reason)||null};
}
const callHref=(row:Row)=>typeof row.callLogId==="string"&&/^[a-f0-9-]{36}$/i.test(row.callLogId)?`/dashboard/call-recordings?view=ai&callId=${encodeURIComponent(row.callLogId)}`:null;
export function scheduledSophieItem(id:string,row:Row,timezone:string):SophieCalendarItem|null{
 const at=number(row.scheduledAt);if(at===null)return null;
 const kind=row.purpose==="overdue_invoice"?"invoice_follow_up":"scheduled_call";
 const value=item(`scheduled:${id}`,kind,at,{...row,reference:row.requestCode},timezone,callHref(row)||`/dashboard/call-recordings?view=scheduled&date=${platformTodayIso(new Date(at),timezone)}`,"scheduled");
 if(row.purpose==="owner_notification")value.title="Sophie owner notification";
 return value;
}
export function quotationSophieItem(id:string,row:Row,timezone:string):SophieCalendarItem|null{
 const at=number(row.sophieFollowUpDueAt);if(at===null||row.sophieFollowUpEnabled!==true)return null;
 const customer=row.customer as Row|undefined;
 const status=row.status==="cancelled"?"CANCELLED":row.customerDecision&&row.sophieFollowUpStatus==="QUEUED"?"SKIPPED":row.sophieFollowUpStatus;
 return item(`quotation:${id}`,"quotation_follow_up",at,{status,customerName:customer?.fullName,reference:row.quotationCode,reason:row.sophieFollowUpReason},timezone,
  `/dashboard/quotations/new?quotationId=${encodeURIComponent(id)}`,"scheduled");
}
export function invoiceSophieItem(id:string,row:Row,timezone:string):SophieCalendarItem|null{
 // Customer-requested later calls are represented by ai_scheduled_callbacks.
 if(row.status==="SCHEDULED"||row.source==="scheduled"||number(row.scheduledAt)!==null)return null;
 const at=number(row.attemptedAt)??number(row.queuedAt);if(at===null)return null;
 const timing=row.status==="QUEUED"?"queued":"attempted";
 return item(`invoice:${id}`,"invoice_follow_up",at,row,timezone,callHref(row)||`/dashboard/invoices?view=${encodeURIComponent(str(row.invoiceId))}`,timing);
}
