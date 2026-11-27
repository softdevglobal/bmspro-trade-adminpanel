import {z} from "zod";

export const INVOICE_RESPONSE_LABELS = {
  reported_paid: "Customer reports payment — verify receipt",
  disputed: "Invoice disputed — owner review required",
  hardship: "Customer needs support — owner review required",
  payment_plan_requested: "Payment plan requested — owner decision required",
  promised_payment: "Payment date promised — owner review required",
  needs_help: "Customer requested help — owner review required",
  call_outcome_unknown: "Call outcome unverified — check call history before retrying",
  wrong_person: "Wrong person answered — correct the invoice contact before calling again",
} as const;
export const invoiceResponseInput = z.object({
  outcome:z.enum(["reported_paid","disputed","hardship","payment_plan_requested","promised_payment","needs_help","wrong_person"]),
  promisedDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.outcome==="promised_payment"&&!value.promisedDate)ctx.addIssue({code:"custom",message:"Confirm the promised date."});
  if(value.outcome!=="promised_payment"&&value.promisedDate)ctx.addIssue({code:"custom",message:"A promised date is only valid for a payment promise."});
  if(value.promisedDate){const date=new Date(`${value.promisedDate}T12:00:00Z`);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value.promisedDate)ctx.addIssue({code:"custom",message:"Invalid date."});}
});
export type InvoiceCustomerResponse=z.infer<typeof invoiceResponseInput>;
export type InvoiceCollectionHold={active:boolean;id:string;reviewToken:string;reason:keyof typeof INVOICE_RESPONSE_LABELS;createdAt:number;promisedDate?:string;destinationKey?:string};
export function invoiceHoldMessage(data:Record<string,unknown>):string|null {
  const hold=data.sophieCollectionHold as InvoiceCollectionHold|undefined;
  return hold?.active ? INVOICE_RESPONSE_LABELS[hold.reason]||"Invoice follow-ups are paused for owner review." : null;
}

export function invoiceCallLogMatches(id:string,attempt:Record<string,unknown>,log:Record<string,unknown>):boolean {
  return log.callbackAttemptId===id&&log.businessId===attempt.businessId&&typeof attempt.did==="string"&&log.did===attempt.did&&
    (typeof attempt.numberKey!=="string"||log.callerKey===attempt.numberKey);
}
