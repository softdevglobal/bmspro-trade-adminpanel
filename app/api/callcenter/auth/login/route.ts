/**
 * Call-center agent login endpoint.
 *
 * Accepts an email + password, authenticates them against Firebase Auth via
 * the Identity Toolkit REST API, then returns the idToken and basic profile.
 *
 * Allowed accounts:
 *   - call-center agents  (JWT claim, users/, or call_center_agents/)
 *   - super admins        (`role: "super_admin"` claim or super_admins/{uid})
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/callcenter/auth/login
 * ──────────────────────────────────────────────────────────────────────────
 * Body example (agent):
 *   {
 *     "email":    "sri123@emai.com",
 *     "password": "111111"
 *   }
 *
 * Success — 200:
 *   { "ok": true, "idToken": "...", "uid": "...", "isSuperAdmin": false, ... }
 */

import {
  ensureCallCenterAgentClaims,
  resolveCallCenterAgentProfile,
  syncCallCenterUserDoc,
} from "@/lib/callcenter/agent-access";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

async function isSuperAdminAccount(
  decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>,
): Promise<boolean> {
  if (decoded.superAdmin === true || decoded.role === "super_admin") {
    return true;
  }
  const snap = await adminDb.collection("super_admins").doc(decoded.uid).get();
  return snap.exists && snap.data()?.isActive !== false;
}

/**
 * POST /api/callcenter/auth/login
 * Authenticates a call-center agent or super admin and returns a Firebase ID token.
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

  const signIn = await signInWithFirebase(email, password);
  if (!signIn.ok) {
    return NextResponse.json(
      { ok: false, error: signIn.error },
      { status: signIn.status },
    );
  }

  let activeSignIn = signIn.data;
  let activeDecoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
  try {
    activeDecoded = await adminAuth.verifyIdToken(activeSignIn.idToken);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Login failed. Please try again." },
      { status: 500 },
    );
  }

  let isSuperAdmin = await isSuperAdminAccount(activeDecoded);
  let agentProfile = await resolveCallCenterAgentProfile(
    activeDecoded.uid,
    email,
  );

  if (
    activeDecoded.role !== "call_center" &&
    !isSuperAdmin &&
    agentProfile?.isActive
  ) {
    await ensureCallCenterAgentClaims(activeDecoded.uid, agentProfile);
    await syncCallCenterUserDoc(activeDecoded.uid, email, agentProfile);

    const refreshed = await signInWithFirebase(email, password);
    if (!refreshed.ok) {
      return NextResponse.json(
        { ok: false, error: refreshed.error },
        { status: refreshed.status },
      );
    }

    activeSignIn = refreshed.data;
    activeDecoded = await adminAuth.verifyIdToken(activeSignIn.idToken);
    isSuperAdmin = await isSuperAdminAccount(activeDecoded);
    agentProfile = await resolveCallCenterAgentProfile(
      activeDecoded.uid,
      email,
    );
  }

  const isCallCenterAgent =
    activeDecoded.role === "call_center" ||
    (agentProfile?.isActive ?? false);

  if (!isCallCenterAgent && !isSuperAdmin) {
    if (agentProfile && !agentProfile.isActive) {
      return NextResponse.json(
        { ok: false, error: "This call-center account is inactive." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "This account does not have call-center access.",
      },
      { status: 403 },
    );
  }

  const superAdminSnap = isSuperAdmin
    ? await adminDb.collection("super_admins").doc(activeDecoded.uid).get()
    : null;
  const superAdminData = superAdminSnap?.data() ?? {};

  return NextResponse.json({
    ok: true,
    idToken: activeSignIn.idToken,
    uid: activeDecoded.uid,
    email: activeDecoded.email ?? email,
    isSuperAdmin,
    fullName:
      agentProfile?.fullName ??
      (typeof superAdminData.displayName === "string"
        ? superAdminData.displayName
        : null) ??
      activeSignIn.displayName ??
      activeDecoded.name ??
      null,
    extension: agentProfile?.extension ?? null,
    agentType: agentProfile?.agentType ?? null,
  });
}
