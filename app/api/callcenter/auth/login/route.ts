/**
 * Call-center agent login endpoint.
 *
 * Accepts an email + password, authenticates them against Firebase Auth via
 * the Identity Toolkit REST API, verifies the returned token carries the
 * `call_center` role claim, then returns the idToken and basic profile.
 *
 * Call-center agents use this token as `Authorization: Bearer <idToken>` in
 * all subsequent call-center API requests.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POSTMAN — Agent Login
 * ──────────────────────────────────────────────────────────────────────────
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
 * Use idToken in all call-center API requests:
 *   Authorization: Bearer <idToken>
 *
 * Error responses:
 *   { "ok": false, "error": "Email and password are required." }            400
 *   { "ok": false, "error": "Invalid email or password." }                  401
 *   { "ok": false, "error": "This account does not have call-center access." } 403
 *   { "ok": false, "error": "Login failed. Please try again." }             500
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Token Refresh
 * ──────────────────────────────────────────────────────────────────────────
 * Firebase ID tokens expire after 1 hour. Call this endpoint again with the
 * same credentials to obtain a fresh token.
 */

import { adminAuth } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Errors returned by the Firebase Identity Toolkit REST API. */
const FIREBASE_AUTH_ERRORS: Record<string, string> = {
  EMAIL_NOT_FOUND: "Invalid email or password.",
  INVALID_PASSWORD: "Invalid email or password.",
  USER_DISABLED: "This account has been disabled.",
  INVALID_LOGIN_CREDENTIALS: "Invalid email or password.",
  TOO_MANY_ATTEMPTS_TRY_LATER:
    "Too many failed attempts. Please wait a moment before trying again.",
};

interface FirebaseSignInResponse {
  idToken: string;
  localId: string;
  email: string;
  displayName?: string;
  error?: { message: string };
}

/**
 * Calls the Firebase Identity Toolkit signInWithPassword endpoint.
 *
 * Returns { ok: true, data } on success, or { ok: false, error, status } on
 * failure. Never throws — all errors are caught and mapped to a friendly
 * message.
 */
async function signInWithFirebase(
  email: string,
  password: string,
): Promise<
  | { ok: true; data: FirebaseSignInResponse }
  | { ok: false; error: string; status: number }
> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "Server configuration error.",
      status: 500,
    };
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
  } catch {
    return { ok: false, error: "Login failed. Please try again.", status: 500 };
  }

  const json = (await res.json()) as FirebaseSignInResponse;

  if (!res.ok) {
    const firebaseCode = json.error?.message ?? "";
    const message =
      FIREBASE_AUTH_ERRORS[firebaseCode] ?? "Invalid email or password.";
    return { ok: false, error: message, status: 401 };
  }

  return { ok: true, data: json };
}

/**
 * POST /api/callcenter/auth/login
 *
 * Authenticates a call-center agent and returns a Firebase ID token.
 *
 * Steps:
 *  1. Validate request body (email + password required).
 *  2. Call Firebase REST API to sign in and get an ID token.
 *  3. Decode the token server-side to read custom claims.
 *  4. Reject if the user's role claim is not "call_center".
 *  5. Return idToken, uid, email, and fullName.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const email =
    typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const password = typeof raw.password === "string" ? raw.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "Email and password are required." },
      { status: 400 },
    );
  }

  // Authenticate with Firebase.
  const signIn = await signInWithFirebase(email, password);
  if (!signIn.ok) {
    return NextResponse.json(
      { ok: false, error: signIn.error },
      { status: signIn.status },
    );
  }

  // Verify the token server-side and check the call_center role claim.
  let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
  try {
    decoded = await adminAuth.verifyIdToken(signIn.data.idToken);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Login failed. Please try again." },
      { status: 500 },
    );
  }

  if (decoded.role !== "call_center") {
    return NextResponse.json(
      {
        ok: false,
        error: "This account does not have call-center access.",
      },
      { status: 403 },
    );
  }

  return NextResponse.json({
    ok: true,
    idToken: signIn.data.idToken,
    uid: decoded.uid,
    email: decoded.email ?? email,
    fullName: signIn.data.displayName ?? decoded.name ?? null,
  });
}
