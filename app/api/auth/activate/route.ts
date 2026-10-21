import { activateAccount } from "@/lib/auth/activation";
import { allowResetCodeRequest } from "@/lib/auth/reset-codes";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();
    if (typeof token !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Invalid activation request." }, { status: 400 });
    }
    if (!(await allowResetCodeRequest("activation", token, request))) {
      return NextResponse.json({ error: "Please wait before trying again." }, { status: 429 });
    }
    const loginPath = await activateAccount(token, password);
    return NextResponse.json({ ok: true, loginPath });
  } catch {
    return NextResponse.json({ error: "Activation failed. The link may be expired or already used. Reset your password to continue." }, { status: 400 });
  }
}
