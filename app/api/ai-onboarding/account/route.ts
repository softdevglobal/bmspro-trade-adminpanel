import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";

export const runtime = "nodejs";
const attempts = new Map<string, number[]>();

export async function POST(req: NextRequest) {
  const client = (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown").split(",")[0]!.trim();
  const now = Date.now(), recent = (attempts.get(client) ?? []).filter(time => now - time < 3600000);
  if (recent.length >= 3) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  recent.push(now); attempts.set(client, recent);
  if (attempts.size > 5000) for (const [key, times] of attempts) if (times.every(time => now - time >= 3600000)) attempts.delete(key);
  try {
    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128)
      return NextResponse.json({ error: "Enter a valid email and a password of 12–128 characters." }, { status: 400 });
    const auth = adminAuth;
    const user = await auth.createUser({ email, password: body.password, emailVerified: false, disabled: true });
    await auth.setCustomUserClaims(user.uid, { onboardingOnly: true });
    await auth.updateUser(user.uid, { disabled: false });
    return NextResponse.json({ created: true }, { status: 201 });
  } catch (error) {
    const exists = (error as { code?: string }).code === "auth/email-already-exists";
    return NextResponse.json({ error: exists ? "An account already exists. Sign in with that account." : "Login could not be created." }, { status: exists ? 409 : 400 });
  }
}
