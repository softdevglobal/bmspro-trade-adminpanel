/**
 * Call-center: list all catalog items (price list) for a specific business.
 *
 * Items live in the Firestore `items` collection — name, code, price, description.
 * They are used as quotation line items and pricing catalog entries.
 *
 * GET — returns all items for the business identified by the required
 *       `businessId` query parameter. Only authenticated call-center agents
 *       may call this endpoint.
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
 * Copy the idToken — use it as `Authorization: Bearer <idToken>` below.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 2 — Get businessId from tenants
 * ──────────────────────────────────────────────────────────────────────────────
 * GET http://localhost:3000/api/callcenter/tenants
 * Headers:
 *   Authorization: Bearer <AGENT_ID_TOKEN>
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 3 — GET /api/callcenter/items?businessId=<id>
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:     http://localhost:3000/api/callcenter/items?businessId=biz001
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
 *     "items": [
 *       {
 *         "id":          "item001",
 *         "name":        "Labour — hourly",
 *         "code":        "LAB-HR",
 *         "description": "Standard labour rate per hour",
 *         "priceAud":    95.00,
 *         "imageUrl":    null,
 *         "createdAt":   1716000000000,
 *         "updatedAt":   1716100000000
 *       },
 *       {
 *         "id":          "item002",
 *         "name":        "Call-out fee",
 *         "code":        "CALLOUT",
 *         "description": null,
 *         "priceAud":    120.00,
 *         "imageUrl":    null,
 *         "createdAt":   1716050000000,
 *         "updatedAt":   1716050000000
 *       }
 *     ]
 *   }
 *
 * Note: `/api/callcenter/services?businessId=` returns the same catalog data
 * but uses the response key `services` instead of `items`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Error responses:
 * ──────────────────────────────────────────────────────────────────────────────
 *   { "ok": false, "error": "Missing authorization header." }               401
 *   { "ok": false, "error": "Invalid or expired session." }                 401
 *   { "ok": false, "error": "Call-center or super admin access required." } 403
 *   { "ok": false, "error": "businessId is required." }                     400
 *   { "ok": false, "error": "Business not found." }                         404
 *   { "ok": false, "error": "Could not fetch items." }                      500
 */

import { adminDb } from "@/lib/firebase/admin";
import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import { listCatalogItems } from "@/lib/items/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Verifies that a business document exists in the `businesses` collection.
 */
async function businessExists(businessId: string): Promise<boolean> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  return snap.exists;
}

/**
 * GET /api/callcenter/items?businessId=<businessId>
 *
 * Returns all catalog items for the given business (sorted by name).
 * Requires a valid call-center agent Bearer token.
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

    const items = await listCatalogItems(businessId);

    return NextResponse.json({
      ok: true,
      businessId,
      total: items.length,
      items,
    });
  } catch (error) {
    console.error("[callcenter] GET /items failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not fetch items." },
      { status: 500 },
    );
  }
}
