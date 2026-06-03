/**
 * Call-center agent management — super admin only.
 *
 * POST — creates a Firebase auth user with the `call_center` role claim and a
 *        matching `users/{uid}` document. The super admin supplies the agent's
 *        real password at registration time. These agents are platform-wide (not
 *        tied to a single business), so they carry no `businessId` claim.
 * GET  — lists existing call-center agents.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 1 — Get a super admin token (Postman)
 * ──────────────────────────────────────────────────────────────────────────────
 * POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyCSNbcUWFdpueif3XMB85yHt29uho96bm0
 * Body (raw JSON):
 *   {
 *     "email": "superadmin@yourdomain.com",
 *     "password": "yourSuperAdminPassword",
 *     "returnSecureToken": true
 *   }
 * Copy the `idToken` from the response — use it as the Bearer token below.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 2 — POST /api/admin/callcenter-agents  (Register / create an agent)
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:     http://localhost:3000/api/admin/callcenter-agents
 * Method:  POST
 * Headers:
 *   Authorization: Bearer <SUPER_ADMIN_ID_TOKEN>
 *   Content-Type:  application/json
 *
 * Request body:
 *   {
 *     "fullName": "Sarah Johnson",
 *     "email":    "sarah.johnson@callcenter.com",
 *     "phone":    "+61400123456",
 *     "password": "Agent@1234"
 *   }
 *   NOTE: password must be at least 8 characters.
 *
 * Success response — 201:
 *   {
 *     "ok": true,
 *     "agentId": "abc123xyz789"
 *   }
 *
 * Error responses:
 *   { "ok": false, "error": "Full name is required." }                       400
 *   { "ok": false, "error": "A valid email is required." }                   400
 *   { "ok": false, "error": "Password must be at least 8 characters." }      400
 *   { "ok": false, "error": "A user with this email already exists." }       400
 *   { "ok": false, "error": "Super admin access required." }                 403
 *   { "ok": false, "error": "Could not create call-center agent." }          500
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 3 — Agent login (call this from the call-center app)
 * ──────────────────────────────────────────────────────────────────────────────
 * POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyCSNbcUWFdpueif3XMB85yHt29uho96bm0
 * Body (raw JSON):
 *   {
 *     "email":             "sarah.johnson@callcenter.com",
 *     "password":          "Agent@1234",
 *     "returnSecureToken": true
 *   }
 * The response contains `idToken` — use it as `Authorization: Bearer <idToken>`
 * in all call-center API requests.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET /api/admin/callcenter-agents  — List all call-center agents
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:     http://localhost:3000/api/admin/callcenter-agents
 * Method:  GET
 * Headers:
 *   Authorization: Bearer <SUPER_ADMIN_ID_TOKEN>
 *
 * Success response — 200:
 *   {
 *     "ok": true,
 *     "agents": [
 *       {
 *         "id":       "abc123xyz789",
 *         "fullName": "Sarah Johnson",
 *         "email":    "sarah.johnson@callcenter.com",
 *         "phone":    "+61400123456",
 *         "status":   "active",
 *         "isActive": true
 *       },
 *       {
 *         "id":       "def456uvw321",
 *         "fullName": "Mike Torres",
 *         "email":    "mike.torres@callcenter.com",
 *         "phone":    "+61411222333",
 *         "status":   "active",
 *         "isActive": true
 *       }
 *     ]
 *   }
 */

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type CallCenterAgentInput = {
  fullName: string;
  email: string;
  phone: string;
  password: string;
};

/**
 * Validates and normalises the raw POST body for creating a call-center agent.
 *
 * Required fields : fullName, email (valid format), password (≥ 8 chars)
 * Optional fields : phone (defaults to "")
 *
 * Returns { ok: true, value } on success or { ok: false, error } on failure.
 */
function parseAgentPayload(
  raw: unknown,
): { ok: true; value: CallCenterAgentInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid request body." };
  }
  const data = raw as Record<string, unknown>;

  const fullName =
    typeof data.fullName === "string" ? data.fullName.trim() : "";
  const email =
    typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const phone = typeof data.phone === "string" ? data.phone.trim() : "";
  const password =
    typeof data.password === "string" ? data.password : "";

  if (!fullName) {
    return { ok: false, error: "Full name is required." };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "A valid email is required." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  return { ok: true, value: { fullName, email, phone, password } };
}

/**
 * POST /api/admin/callcenter-agents
 *
 * Creates a new call-center agent. Super admin access required.
 *
 * Steps:
 *  1. Verify super admin Bearer token.
 *  2. Validate request body (fullName, email, password required).
 *  3. Check Firestore + Firebase Auth for duplicate email.
 *  4. Create Firebase Auth user with the supplied password.
 *  5. Set custom claim  { role: "call_center" }  (no businessId — platform-wide).
 *  6. Write users/{uid} document to Firestore.
 *  7. Roll back the Auth user if the Firestore write fails.
 *
 * Request body:
 *   { fullName, email, password, phone? }
 *
 * Success: 201  { ok: true, agentId: string }
 * Errors : 400 (validation / duplicate), 403 (not super admin), 500 (server)
 */
export async function POST(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsed = parseAgentPayload(body);
  if (!parsed.ok) {
    return NextResponse.json(parsed, { status: 400 });
  }

  const existing = await adminDb
    .collection("users")
    .where("email", "==", parsed.value.email)
    .limit(1)
    .get();
  if (!existing.empty) {
    return NextResponse.json(
      { ok: false, error: "A user with this email already exists." },
      { status: 400 },
    );
  }

  try {
    await adminAuth.getUserByEmail(parsed.value.email);
    return NextResponse.json(
      { ok: false, error: "A user with this email already exists." },
      { status: 400 },
    );
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") {
      return NextResponse.json(
        { ok: false, error: "Could not verify email availability." },
        { status: 400 },
      );
    }
  }

  let authUid: string | null = null;
  const now = FieldValue.serverTimestamp();

  try {
    const authUser = await adminAuth.createUser({
      email: parsed.value.email,
      password: parsed.value.password,
      displayName: parsed.value.fullName,
      emailVerified: false,
    });
    authUid = authUser.uid;

    await adminAuth.setCustomUserClaims(authUid, {
      role: "call_center",
    });

    await adminDb.collection("users").doc(authUid).set({
      uid: authUid,
      email: parsed.value.email,
      fullName: parsed.value.fullName,
      phone: parsed.value.phone,
      role: "call_center",
      status: "active",
      isActive: true,
      createdByUid: auth.uid,
      createdByEmail: auth.email ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json(
      { ok: true, agentId: authUid },
      { status: 201 },
    );
  } catch (error) {
    console.error("[callcenter] agent creation failed:", error);
    // Roll back the auth user if the Firestore write failed.
    if (authUid) {
      try {
        await adminAuth.deleteUser(authUid);
      } catch (rollbackError) {
        console.error("[callcenter] rollback failed:", rollbackError);
      }
    }
    return NextResponse.json(
      { ok: false, error: "Could not create call-center agent." },
      { status: 500 },
    );
  }
}

/**
 * GET /api/admin/callcenter-agents
 *
 * Returns all call-center agent accounts. Super admin access required.
 *
 * Queries the `users` collection where role == "call_center" (max 200).
 *
 * Success: 200  { ok: true, agents: Agent[] }
 * Errors : 403 (not super admin), 500 (server)
 */
export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const snapshot = await adminDb
    .collection("users")
    .where("role", "==", "call_center")
    .limit(200)
    .get();

  const agents = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      fullName: typeof data.fullName === "string" ? data.fullName : "",
      email: typeof data.email === "string" ? data.email : "",
      phone: typeof data.phone === "string" ? data.phone : "",
      status: typeof data.status === "string" ? data.status : "active",
      isActive: data.isActive !== false,
    };
  });

  return NextResponse.json({ ok: true, agents });
}
