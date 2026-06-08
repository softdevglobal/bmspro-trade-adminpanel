/**
 * Call-center: list staff members for a specific business.
 *
 * GET — returns all staff (role == "staff") belonging to the business
 *       identified by the required `businessId` query parameter.
 *       Only authenticated call-center agents may call this endpoint.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 1 — Log in as a call-center agent to get your idToken
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:    http://localhost:3000/api/callcenter/auth/login
 * Method: POST
 * Headers:
 *   Content-Type: application/json
 *
 * Request body:
 *   {
 *     "email":    "sarah.johnson@callcenter.com",
 *     "password": "Agent@1234"
 *   }
 *
 * Success response — 200:
 *   {
 *     "ok":       true,
 *     "idToken":  "<Firebase ID token — valid for 1 hour>",
 *     "uid":      "abc123xyz789",
 *     "email":    "sarah.johnson@callcenter.com",
 *     "fullName": "Sarah Johnson"
 *   }
 *
 * Copy the idToken — use it as the Bearer token in Step 2 below.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 2 — How to get a businessId
 * ──────────────────────────────────────────────────────────────────────────────
 * Call GET /api/callcenter/tenants first to get the list of all businesses.
 * Each business object contains an "id" field — that is the businessId.
 *
 * GET http://localhost:3000/api/callcenter/tenants
 * Headers:
 *   Authorization: Bearer <AGENT_ID_TOKEN>
 *
 * From the response, pick the "id" of the target business:
 *   { "ok": true, "tenants": [ { "id": "biz001", "businessName": "Ace Plumbing", ... } ] }
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 3 — GET /api/callcenter/staff?businessId=<id>
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:     http://localhost:3000/api/callcenter/staff?businessId=biz001
 * Method:  GET
 * Headers:
 *   Authorization: Bearer <AGENT_ID_TOKEN>
 *
 * Required query parameter:
 *   businessId  — the Firestore document ID of the target business (tenant)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Success response — 200:
 * ──────────────────────────────────────────────────────────────────────────────
 *   {
 *     "ok": true,
 *     "businessId": "biz001",
 *     "total": 2,
 *     "staff": [
 *       {
 *         "id":           "usr001",
 *         "fullName":     "Tom Reeves",
 *         "email":        "tom.reeves@aceplumbing.com.au",
 *         "phone":        "+61412000001",
 *         "staffType":    "Plumber",
 *         "status":       "active",
 *         "canget_qutaion": true,
 *         "createdAt":    "2024-05-18T10:00:00.000Z"
 *       },
 *       {
 *         "id":           "usr002",
 *         "fullName":     "Leah Park",
 *         "email":        "leah.park@aceplumbing.com.au",
 *         "phone":        null,
 *         "staffType":    "Apprentice",
 *         "status":       "active",
 *         "canget_qutaion": false,
 *         "createdAt":    "2024-06-01T08:30:00.000Z"
 *       }
 *     ]
 *   }
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Error responses:
 * ──────────────────────────────────────────────────────────────────────────────
 *   { "ok": false, "error": "Missing authorization header." }               401
 *   { "ok": false, "error": "Invalid or expired session." }                 401
 *   { "ok": false, "error": "Call-center or super admin access required." } 403
 *   { "ok": false, "error": "businessId is required." }                     400
 *   { "ok": false, "error": "Business not found." }                         404
 *   { "ok": false, "error": "Could not fetch staff." }                      500
 */

import { adminDb } from "@/lib/firebase/admin";
import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Safely trims a value to a string, returning "" for non-strings.
 */
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Converts a Firestore Timestamp-like or Date to an ISO string.
 * Returns null for unrecognised values.
 */
function timestampIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Returns epoch milliseconds from a Firestore Timestamp for sorting.
 */
function timestampMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && "toMillis" in value) {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Verifies that a business document exists in the `businesses` collection.
 */
async function businessExists(businessId: string): Promise<boolean> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  return snap.exists;
}

/**
 * GET /api/callcenter/staff?businessId=<businessId>
 *
 * Returns all staff members for the given business.
 * Requires a valid call-center agent Bearer token.
 *
 * Steps:
 *  1. Verify call-center agent Bearer token.
 *  2. Read and validate the required `businessId` query parameter.
 *  3. Confirm the business exists in Firestore.
 *  4. Query the `users` collection for documents with matching businessId.
 *  5. Filter to role == "staff", sort newest-first, and return.
 */
export async function GET(request: Request) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const businessId = url.searchParams.get("businessId")?.trim() ?? "";

  if (!businessId) {
    return NextResponse.json(
      { ok: false, error: "businessId is required." },
      { status: 400 },
    );
  }

  try {
    const exists = await businessExists(businessId);
    if (!exists) {
      return NextResponse.json(
        { ok: false, error: "Business not found." },
        { status: 404 },
      );
    }

    const snapshot = await adminDb
      .collection("users")
      .where("businessId", "==", businessId)
      .get();

    const staff = snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          fullName: str(d.fullName) || "Unnamed Staff",
          email: str(d.email),
          phone: str(d.phone) || null,
          role: str(d.role),
          staffType: str(d.staffType) || null,
          status: str(d.status) || "active",
          canget_qutaion: d.canget_qutaion === true,
          createdAt: timestampIso(d.createdAt),
          _sortKey: timestampMillis(d.createdAt),
        };
      })
      // Only return staff role members.
      .filter((member) => member.role === "staff")
      // Newest first.
      .sort((a, b) => b._sortKey - a._sortKey)
      // Strip the internal sort key.
      .map(({ _sortKey: _sk, role: _role, ...rest }) => rest);

    return NextResponse.json({
      ok: true,
      businessId,
      total: staff.length,
      staff,
    });
  } catch (error) {
    console.error("[callcenter] GET /staff failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not fetch staff." },
      { status: 500 },
    );
  }
}
