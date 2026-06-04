/**
 * Call-center: list all tenants (businesses) with their full details.
 *
 * GET — returns every active/inactive business registered on the platform.
 *       Call-center agents or super admins may call this endpoint.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 1 — Get a Bearer token (agent OR super admin)
 * ──────────────────────────────────────────────────────────────────────────────
 * Option A — Call-center agent:
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
 * Option B — Super admin (same token as /api/callcenter/agents):
 * POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<FIREBASE_API_KEY>
 * Body: { "email": "superadmin@...", "password": "...", "returnSecureToken": true }
 *
 * Use the idToken as: Authorization: Bearer <idToken>
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 2 — GET /api/callcenter/tenants  (List all tenants / businesses)
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:     http://localhost:3000/api/callcenter/tenants
 * Method:  GET
 * Headers:
 *   Authorization: Bearer <AGENT_OR_SUPER_ADMIN_ID_TOKEN>
 *
 * Query parameters (all optional):
 *   ?status=active          — filter by status (active | inactive | pending_review | suspended)
 *   ?search=plumbing        — filter by businessName (case-insensitive prefix)
 *   ?limit=50               — max results per page (default 100, max 200)
 *
 * Example:
 *   GET http://localhost:3000/api/callcenter/tenants?status=active&limit=20
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Success response — 200:
 * ──────────────────────────────────────────────────────────────────────────────
 *   {
 *     "ok": true,
 *     "total": 2,
 *     "tenants": [
 *       {
 *         "id":              "biz001",
 *         "businessName":    "Ace Plumbing Services",
 *         "businessEmail":   "info@aceplumbing.com.au",
 *         "businessPhone":   "+61412345678",
 *         "businessType":    "plumbing",
 *         "businessAddress": "12 Example St, Melbourne VIC 3000",
 *         "state":           "VIC",
 *         "postcode":        "3000",
 *         "mainSuburb":      "Melbourne",
 *         "serviceAreas":    ["Melbourne CBD", "South Yarra", "Richmond"],
 *         "abn":             "12 345 678 901",
 *         "registeredForGst": true,
 *         "bookingSlug":     "ace-plumbing",
 *         "bookingPath":     "/booknow/ace-plumbing",
 *         "status":          "active",
 *         "isActive":        true,
 *         "owner": {
 *           "fullName": "James Ace",
 *           "email":    "james@aceplumbing.com.au"
 *         },
 *         "plan": {
 *           "name":      "Professional",
 *           "price":     99,
 *           "period":    "monthly",
 *           "trialDays": null
 *         },
 *         "createdAt": 1716000000000,
 *         "updatedAt": 1716100000000
 *       },
 *       {
 *         "id":              "biz002",
 *         "businessName":    "Swift Electrical",
 *         "businessEmail":   "contact@swiftelectrical.com.au",
 *         "businessPhone":   "+61498765432",
 *         "businessType":    "electrical",
 *         "businessAddress": "88 Trade Ave, Sydney NSW 2000",
 *         "state":           "NSW",
 *         "postcode":        "2000",
 *         "mainSuburb":      "Sydney",
 *         "serviceAreas":    ["Sydney CBD", "Surry Hills"],
 *         "abn":             "98 765 432 100",
 *         "registeredForGst": false,
 *         "bookingSlug":     "swift-electrical",
 *         "bookingPath":     "/booknow/swift-electrical",
 *         "status":          "active",
 *         "isActive":        true,
 *         "owner": {
 *           "fullName": "Mia Swift",
 *           "email":    "mia@swiftelectrical.com.au"
 *         },
 *         "plan": null,
 *         "createdAt": 1716200000000,
 *         "updatedAt": 1716300000000
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
 *   { "ok": false, "error": "Could not fetch tenants." }                    500
 */

import { adminDb } from "@/lib/firebase/admin";
import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

type TenantSummary = {
  id: string;
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessType: string;
  businessAddress: string | null;
  state: string;
  postcode: string;
  mainSuburb: string;
  serviceAreas: string[];
  abn: string | null;
  registeredForGst: boolean;
  bookingSlug: string | null;
  bookingPath: string | null;
  status: string;
  isActive: boolean;
  owner: { fullName: string | null; email: string | null } | null;
  plan: {
    name: string;
    price: number;
    period: string;
    trialDays: number | null;
  } | null;
  createdAt: number | null;
  updatedAt: number | null;
};

/**
 * Converts a Firestore Timestamp-like value to milliseconds since epoch.
 * Returns null for any unrecognised shape.
 */
function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

/**
 * Maps a single `businesses` Firestore document to the TenantSummary shape
 * returned to call-center agents.
 */
function mapTenantDoc(doc: QueryDocumentSnapshot): TenantSummary {
  const d = doc.data();

  const owner = d.owner as
    | { fullName?: string; email?: string; firstName?: string; lastName?: string }
    | null
    | undefined;

  const ownerFullName =
    owner?.fullName ||
    [owner?.firstName, owner?.lastName].filter(Boolean).join(" ") ||
    null;

  const plan = d.plan as
    | { name?: string; price?: number; period?: string; trialDays?: number | null }
    | null
    | undefined;

  return {
    id: doc.id,
    businessName: typeof d.businessName === "string" ? d.businessName : "",
    businessEmail: typeof d.businessEmail === "string" ? d.businessEmail : "",
    businessPhone: typeof d.businessPhone === "string" ? d.businessPhone : "",
    businessType: typeof d.businessType === "string" ? d.businessType : "",
    businessAddress:
      typeof d.businessAddress === "string" && d.businessAddress.trim()
        ? d.businessAddress
        : null,
    state: typeof d.state === "string" ? d.state : "",
    postcode: typeof d.postcode === "string" ? d.postcode : "",
    mainSuburb: typeof d.mainSuburb === "string" ? d.mainSuburb : "",
    serviceAreas: Array.isArray(d.serviceAreas)
      ? (d.serviceAreas as unknown[])
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter((v): v is string => v.length > 0)
      : [],
    abn: typeof d.abn === "string" && d.abn.trim() ? d.abn : null,
    registeredForGst: Boolean(d.registeredForGst),
    bookingSlug:
      typeof d.bookingSlug === "string" && d.bookingSlug.length > 0
        ? d.bookingSlug
        : null,
    bookingPath:
      typeof d.bookingPath === "string" && d.bookingPath.length > 0
        ? d.bookingPath
        : typeof d.bookingSlug === "string" && d.bookingSlug.length > 0
          ? `/booknow/${d.bookingSlug}`
          : null,
    status: typeof d.status === "string" ? d.status : "pending_review",
    isActive: Boolean(d.isActive),
    owner: owner
      ? {
          fullName: ownerFullName || null,
          email:
            typeof owner.email === "string"
              ? owner.email
              : typeof d.businessEmail === "string"
                ? d.businessEmail
                : null,
        }
      : null,
    plan: plan?.name
      ? {
          name: plan.name,
          price: typeof plan.price === "number" ? plan.price : 0,
          period: typeof plan.period === "string" ? plan.period : "",
          trialDays: plan.trialDays ?? null,
        }
      : null,
    createdAt: toMillis(d.createdAt),
    updatedAt: toMillis(d.updatedAt),
  };
}

/**
 * GET /api/callcenter/tenants
 *
 * Returns a list of all businesses (tenants) on the platform.
 * Requires a valid call-center agent Bearer token.
 *
 * Optional query params:
 *   status  — filter by business status string (e.g. "active")
 *   search  — prefix-match on businessName (case-insensitive, client-side)
 *   limit   — max results (1–200, default 100)
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
  const statusFilter = url.searchParams.get("status")?.trim() ?? "";
  const searchQuery = url.searchParams.get("search")?.trim().toLowerCase() ?? "";
  const limitParam = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

  try {
    let query = adminDb
      .collection("businesses")
      .orderBy("createdAt", "desc") as
      FirebaseFirestore.Query<FirebaseFirestore.DocumentData>;

    // Apply server-side status filter when provided.
    if (statusFilter) {
      query = query.where("status", "==", statusFilter);
    }

    const snapshot = await query.limit(limit).get();
    let tenants = snapshot.docs.map(mapTenantDoc);

    // Apply client-side search filter on businessName (Firestore has no
    // native case-insensitive prefix query without extra indexing).
    if (searchQuery) {
      tenants = tenants.filter((t) =>
        t.businessName.toLowerCase().includes(searchQuery),
      );
    }

    return NextResponse.json({ ok: true, total: tenants.length, tenants });
  } catch (error) {
    console.error("[callcenter] GET /tenants failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not fetch tenants." },
      { status: 500 },
    );
  }
}
