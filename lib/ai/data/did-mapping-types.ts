import { z } from "zod";
import type { VoiceBusiness } from "../config";

export const didMappingInput = z.object({
  did: z.string().trim().regex(/^\d{6,15}$/, "Enter 6-15 digits, including any leading zero. Do not use + or spaces."),
  businessId: z.string().trim().min(1).max(128).refine(value => !value.includes("/") && value !== "." && value !== "..", "Choose a valid business."),
  isActive: z.boolean(),
  version: z.number().int().nonnegative(),
}).strict();
export type DidMappingInput = z.infer<typeof didMappingInput>;
export type StoredDidMapping = VoiceBusiness & { isActive: boolean; version: number };
export type DidMappingRow = StoredDidMapping & {
  businessName: string; businessActive: boolean; source: "dashboard" | "setup"; updatedAt: number | null;
};
export type DidBusinessOption = { id: string; name: string; isActive: boolean };

export class DidMappingError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function assertMappingVersion(current: StoredDidMapping | null, expected: number) {
  if ((current?.version ?? 0) !== expected) throw new DidMappingError(409, "This mapping changed. Refresh the list before saving again.");
}
