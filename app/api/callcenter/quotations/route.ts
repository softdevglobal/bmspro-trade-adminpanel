/**
 * Call-center: list all quotations for a specific business.
 *
 * GET — returns quotations for the business identified by the required
 *       `businessId` query parameter (newest first, up to 80). Only
 *       authenticated call-center agents may call this endpoint.
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
 * GET http://localhost:3000/api/callcenter/tenants
 * Headers:
 *   Authorization: Bearer <AGENT_ID_TOKEN>
 *
 * Pick the tenant "id" from the response — that is the businessId.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 3 — GET /api/callcenter/quotations?businessId=<id>
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:     http://localhost:3000/api/callcenter/quotations?businessId=biz001
 * Method:  GET
 * Headers:
 *   Authorization: Bearer <AGENT_ID_TOKEN>
 *
 * Required query parameter:
 *   businessId  — the Firestore document ID of the target business (tenant)
 *
 * Optional query parameter:
 *   status=sent   — only quotations with status "sent"
 *   status=draft  — only quotations with status "draft"
 *   (omit status to return all quotations)
 *
 * Example:
 *   GET http://localhost:3000/api/callcenter/quotations?businessId=biz001&status=sent
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Success response — 200:
 * ──────────────────────────────────────────────────────────────────────────────
 *   {
 *     "ok": true,
 *     "businessId": "biz001",
 *     "total": 2,
 *     "quotations": [
 *       {
 *         "id":                  "quo_abc123",
 *         "quotationCode":       "QUO-0042",
 *         "businessId":          "biz001",
 *         "inspectionRequestId": "insp_xyz789",
 *         "serviceTitle":        "Full Home Inspection",
 *         "customer": {
 *           "fullName": "Jane Smith",
 *           "email":    "jane@example.com",
 *           "phone":    "+61400111222"
 *         },
 *         "address": {
 *           "street":   "12 Example St",
 *           "suburb":   "Melbourne",
 *           "state":    "VIC",
 *           "postcode": "3000"
 *         },
 *         "lineItems": [
 *           {
 *             "description": "Request",
 *             "quantity":    1,
 *             "unitPriceAud": 250,
 *             "totalAud":    250
 *           }
 *         ],
 *         "subtotalAud":    250,
 *         "finalPriceAud":  250,
 *         "balanceDueAud":  250,
 *         "discountAud":    0,
 *         "status":         "sent",
 *         "validUntil":     "2024-07-01",
 *         "pdfUrl":         "https://storage.googleapis.com/...",
 *         "bookingId":      null,
 *         "bookingCode":    null,
 *         "createdAt":      1716000000000,
 *         "updatedAt":      1716100000000
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
 *   { "ok": false, "error": "Could not fetch quotations." }                 500
 */

import { adminDb } from "@/lib/firebase/admin";
import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import { listBusinessQuotations } from "@/lib/quotations/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["draft", "sent"]);

/**
 * Verifies that a business document exists in the `businesses` collection.
 */
async function businessExists(businessId: string): Promise<boolean> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  return snap.exists;
}

/**
 * GET /api/callcenter/quotations?businessId=<businessId>
 *
 * Returns all quotations for the given business (newest first, max 80).
 * Requires a valid call-center agent Bearer token.
 *
 * Steps:
 *  1. Verify call-center agent Bearer token.
 *  2. Read and validate the required `businessId` query parameter.
 *  3. Confirm the business exists in Firestore.
 *  4. Load quotations via listBusinessQuotations(businessId).
 *  5. Optionally filter by status if `status=draft` or `status=sent`.
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
  const statusFilter = url.searchParams.get("status")?.trim().toLowerCase() ?? "";

  if (!businessId) {
    return NextResponse.json(
      { ok: false, error: "businessId is required." },
      { status: 400 },
    );
  }

  if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
    return NextResponse.json(
      { ok: false, error: 'status must be "draft" or "sent".' },
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

    let quotations = await listBusinessQuotations(businessId);

    if (statusFilter) {
      quotations = quotations.filter((q) => q.status === statusFilter);
    }

    return NextResponse.json({
      ok: true,
      businessId,
      total: quotations.length,
      quotations,
    });
  } catch (error) {
    console.error("[callcenter] GET /quotations failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not fetch quotations." },
      { status: 500 },
    );
  }
}
