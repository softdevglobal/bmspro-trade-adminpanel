/**
 * Call-center: list services (catalog items) for a specific business.
 *
 * GET — returns all catalog items belonging to the business identified by the
 *       required `businessId` query parameter. Only authenticated call-center
 *       agents may call this endpoint.
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
 * From the response, pick the "id" of the business whose services you need:
 *   { "ok": true, "tenants": [ { "id": "biz001", "businessName": "Ace Plumbing", ... } ] }
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 3 — GET /api/callcenter/services?businessId=<id>
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:     http://localhost:3000/api/callcenter/services?businessId=biz001
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
 *     "total": 3,
 *     "services": [
 *       {
 *         "id":          "svc001",
 *         "name":        "Full Home Inspection",
 *         "code":        "FHI-01",
 *         "description": "Comprehensive inspection of all areas of the home.",
 *         "priceAud":    250.00,
 *         "imageUrl":    "https://storage.googleapis.com/...",
 *         "createdAt":   1716000000000,
 *         "updatedAt":   1716100000000
 *       },
 *       {
 *         "id":          "svc002",
 *         "name":        "Roof Inspection",
 *         "code":        null,
 *         "description": null,
 *         "priceAud":    120.00,
 *         "imageUrl":    null,
 *         "createdAt":   1716050000000,
 *         "updatedAt":   1716050000000
 *       },
 *       {
 *         "id":          "svc003",
 *         "name":        "Plumbing Check",
 *         "code":        "PLB-03",
 *         "description": "Inspection of all visible plumbing fixtures and pipes.",
 *         "priceAud":    95.00,
 *         "imageUrl":    null,
 *         "createdAt":   1716060000000,
 *         "updatedAt":   1716060000000
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
 *   { "ok": false, "error": "Could not fetch services." }                   500
 */

import { adminDb } from "@/lib/firebase/admin";
import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import { listCatalogItems } from "@/lib/items/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Verifies that a business document exists in the `businesses` collection.
 * Returns true if found, false otherwise.
 */
async function businessExists(businessId: string): Promise<boolean> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  return snap.exists;
}

/**
 * GET /api/callcenter/services?businessId=<businessId>
 *
 * Returns all catalog services/items for the given business.
 * Requires a valid call-center agent Bearer token.
 *
 * Steps:
 *  1. Verify call-center agent Bearer token.
 *  2. Read and validate the required `businessId` query parameter.
 *  3. Confirm the business exists in Firestore.
 *  4. Load all catalog items (services) for that business, sorted by name.
 *  5. Return the list with a total count.
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

    const services = await listCatalogItems(businessId);

    return NextResponse.json({
      ok: true,
      businessId,
      total: services.length,
      services,
    });
  } catch (error) {
    console.error("[callcenter] GET /services failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not fetch services." },
      { status: 500 },
    );
  }
}
