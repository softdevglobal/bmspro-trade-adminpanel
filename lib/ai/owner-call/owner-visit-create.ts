import {z} from "zod";

/** Contact and visit fields shared by owner-created jobs and inspections. */
export const ownerVisitCreateFields = {
  customerFullName: z.string().trim().min(2).max(120),
  customerEmail: z.string().trim().email().max(254),
  customerPhone: z.string().trim().min(6).max(30).regex(/^[+\d\s()-]+$/).refine(value => /^\d{6,15}$/.test(value.replace(/\D/g,""))),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  address: z.object({street:z.string().trim().max(200), suburb:z.string().trim().max(100), state:z.string().trim().max(80), postcode:z.string().trim().max(10)}).strict().optional(),
  notes: z.string().trim().max(2000).optional(),
};
