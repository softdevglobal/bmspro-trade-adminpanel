import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { INSPECTION_COLLECTION } from "@/lib/inspection/types";
import {
  buildBookingCode,
  buildInspectionRequestCode,
} from "@/lib/reference-codes";
import { BOOKING_COLLECTION } from "@/lib/bookings/types";

const QUOTATION_COLLECTION = "quotations";

const MAX_ALLOCATION_ATTEMPTS = 12;

async function codeExists(
  collection: string,
  field: string,
  code: string,
): Promise<boolean> {
  const snap = await adminDb
    .collection(collection)
    .where(field, "==", code)
    .limit(1)
    .get();
  return !snap.empty;
}

export async function allocateInspectionRequestCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const code = buildInspectionRequestCode();
    const taken = await codeExists(
      INSPECTION_COLLECTION,
      "requestCode",
      code,
    );
    if (!taken) return code;
  }
  throw new Error("Could not allocate a unique inspection request code.");
}

export async function allocateBookingCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const code = buildBookingCode();
    const taken = await codeExists(BOOKING_COLLECTION, "bookingCode", code);
    if (!taken) return code;
  }
  throw new Error("Could not allocate a unique booking code.");
}
