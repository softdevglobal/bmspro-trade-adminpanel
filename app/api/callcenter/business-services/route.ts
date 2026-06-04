/**
 * Call-center: list all template-based services configured for a business.
 *
 * These are the services a business owner has set up from the service template
 * catalog (stored in the `services` Firestore collection, not `items`). Each
 * service includes its checklist tasks, duration, trade type, and activity state.
 *
 * GET — returns all services for the business identified by the required
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
 * STEP 3 — GET /api/callcenter/business-services?businessId=<id>
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:     http://localhost:3000/api/callcenter/business-services?businessId=biz001
 * Method:  GET
 * Headers:
 *   Authorization: Bearer <AGENT_ID_TOKEN>
 *
 * Required query parameter:
 *   businessId  — the Firestore document ID of the target business (tenant)
 *
 * Optional query parameter:
 *   activeOnly=true  — when present, only active services are returned
 *                      (default: all services are returned)
 * Example:
 *   GET http://localhost:3000/api/callcenter/business-services?businessId=biz001&activeOnly=true
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Success response — 200:
 * ──────────────────────────────────────────────────────────────────────────────
 *   {
 *     "ok": true,
 *     "businessId": "biz001",
 *     "total": 2,
 *     "services": [
 *       {
 *         "id":                 "svc_abc123",
 *         "name":               "Full Home Inspection",
 *         "businessType":       "plumbing",
 *         "requiredSkill":      "plumbing",
 *         "defaultDurationMin": 90,
 *         "isActive":           true,
 *         "imageUrl":           "https://storage.googleapis.com/...",
 *         "templateId":         "tmpl_xyz456",
 *         "taskCount":          3,
 *         "tasks": [
 *           {
 *             "id":              "task001",
 *             "title":          "Check water pressure",
 *             "description":    "Measure pressure at mains and fixtures.",
 *             "isRequired":     true,
 *             "photoRequired":  false,
 *             "customerVisible": true,
 *             "sortOrder":      0
 *           },
 *           {
 *             "id":              "task002",
 *             "title":          "Inspect hot water system",
 *             "description":    "Check age, condition and pressure relief valve.",
 *             "isRequired":     true,
 *             "photoRequired":  true,
 *             "customerVisible": true,
 *             "sortOrder":      1
 *           }
 *         ],
 *         "createdAt": 1716000000000,
 *         "updatedAt": 1716100000000
 *       },
 *       {
 *         "id":                 "svc_def789",
 *         "name":               "Roof Plumbing Check",
 *         "businessType":       "plumbing",
 *         "requiredSkill":      "plumbing",
 *         "defaultDurationMin": 60,
 *         "isActive":           true,
 *         "imageUrl":           null,
 *         "templateId":         null,
 *         "taskCount":          1,
 *         "tasks": [
 *           {
 *             "id":              "task003",
 *             "title":          "Inspect gutters and downpipes",
 *             "description":    "Check for blockages, rust and loose fixings.",
 *             "isRequired":     true,
 *             "photoRequired":  false,
 *             "customerVisible": true,
 *             "sortOrder":      0
 *           }
 *         ],
 *         "createdAt": 1716050000000,
 *         "updatedAt": 1716050000000
 *       }
 *     ]
 *   }
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Difference from /api/callcenter/services
 * ──────────────────────────────────────────────────────────────────────────────
 * /api/callcenter/services      → catalog price items (lib/items — `items` collection)
 *                                  simple name + price list used for quotation line items
 * /api/callcenter/business-services → structured services with checklist tasks
 *                                  (lib/onboarding/services — `services` collection)
 *                                  richer objects with trade type, duration, and tasks
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Error responses:
 * ──────────────────────────────────────────────────────────────────────────────
 *   { "ok": false, "error": "Missing authorization header." }               401
 *   { "ok": false, "error": "Invalid or expired session." }                 401
 *   { "ok": false, "error": "Call-center or super admin access required." } 403
 *   { "ok": false, "error": "businessId is required." }                     400
 *   { "ok": false, "error": "Business not found." }                         404
 *   { "ok": false, "error": "Could not fetch business services." }          500
 */

import { adminDb } from "@/lib/firebase/admin";
import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import { listBusinessServices } from "@/lib/onboarding/services/server";
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
 * GET /api/callcenter/business-services?businessId=<businessId>
 *
 * Returns all template-based services configured for the given business.
 * Requires a valid call-center agent Bearer token.
 *
 * Steps:
 *  1. Verify call-center agent Bearer token.
 *  2. Read and validate the required `businessId` query parameter.
 *  3. Confirm the business exists in Firestore.
 *  4. Load all services for that business (newest first).
 *  5. Optionally filter to active-only if `activeOnly=true` is passed.
 *  6. Return the list with a total count.
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
  const activeOnly = url.searchParams.get("activeOnly") === "true";

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

    const result = await listBusinessServices(businessId);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not fetch business services." },
        { status: 500 },
      );
    }

    const services = activeOnly
      ? result.services.filter((s) => s.isActive)
      : result.services;

    return NextResponse.json({
      ok: true,
      businessId,
      total: services.length,
      services,
    });
  } catch (error) {
    console.error("[callcenter] GET /business-services failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not fetch business services." },
      { status: 500 },
    );
  }
}
