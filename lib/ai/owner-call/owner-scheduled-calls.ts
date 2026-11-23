import {z} from "zod";
export const OWNER_CALL_PREPARE_TOOL="prepare_customer_scheduled_call";
export const ownerScheduledCallsEnabled=(env:Readonly<Record<string,string|undefined>>=process.env)=>env.AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED==="true";
export const ownerCallInput=z.object({customerName:z.string().trim().min(2).max(120),customerEmail:z.string().trim().email().optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),category:z.enum(["service","complaint","quotation","invoice","other"]),instructions:z.string().trim().min(10).max(1000),businessNumber:z.string().regex(/^\d{6,15}$/).optional()}).strict();
export const ownerCallRecordInput=z.object({customerId:z.string().min(1).max(128).refine(value=>!value.includes('/')),customerName:z.string().min(1).max(120),category:z.enum(["service","complaint","quotation","invoice","other"]),instructions:z.string().min(10).max(1000)});
