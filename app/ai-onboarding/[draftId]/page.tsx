"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { commandCentreBackendUrl } from "@/lib/commandCentreBackendUrl";

type Review = {
  draftId: string;
  version: number;
  status: string;
  configuration: Record<string, any>;
  approval: unknown;
};

const backend = commandCentreBackendUrl(process.env.NEXT_PUBLIC_COMMAND_CENTRE_BACKEND_URL, process.env.NODE_ENV === "development");

export default function AiOnboardingReviewPage() {
  const params = useParams<{ draftId: string }>();
  const draftId = params.draftId;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [verified, setVerified] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const config = review?.configuration;
  const terms = config?.terms;
  const setup = useMemo(() => ({
    name: config?.business?.tradingName,
    owner: config?.business?.ownerName,
    phone: config?.business?.ownerPhone,
    address: config?.business?.address,
    type: config?.tradeBusiness?.businessType,
    areas: config?.tradeBusiness?.serviceAreas,
  }), [config]);

  async function readReview(token: string) {
    const response = await fetch(`${backend}/onboarding/${encodeURIComponent(draftId)}/review`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load this review.");
    setReview(data);
  }

  async function createLogin() {
    setBusy(true); setMessage("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const response = await fetch("/api/ai-onboarding/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizedEmail, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create your login.");
      const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      await sendEmailVerification(credential.user);
      setMessage("We sent a verification email. Open it, then return here and choose “I verified my email”.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create your login."); }
    finally { setBusy(false); }
  }

  async function signIn() {
    setBusy(true); setMessage("");
    try {
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      await verifyAndLoad();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }

  async function verifyAndLoad() {
    const user = auth.currentUser;
    if (!user) throw new Error("Sign in first.");
    await user.reload();
    if (!user.emailVerified) { setVerified(false); throw new Error("Verify your email before reviewing this setup."); }
    setVerified(true);
    const token = await user.getIdToken(true);
    await readReview(token);
  }

  async function approve() {
    if (!confirmed || !review || !auth.currentUser) return;
    setBusy(true); setMessage("");
    try {
      const token = await auth.currentUser.getIdToken(true);
      const response = await fetch(`${backend}/onboarding/${encodeURIComponent(draftId)}/approve`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: review.version, accepted: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Approval was not recorded.");
      setReview(data); setMessage("Approval recorded. The setup is prepared for Trade review; this does not activate the account or authorize billing.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Approval was not recorded."); }
    finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setMessage("");
    try { await verifyAndLoad(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not refresh the review."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto min-h-screen max-w-2xl px-5 py-10 text-slate-900">
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">BMS Pro Trade</p>
      <h1 className="mt-2 text-2xl font-bold">Review your AI-assisted setup</h1>
      <p className="mt-2 text-sm text-slate-600">Sign in or create a login with the email you gave the onboarding assistant. Email verification is required to approve.</p>

      {!review && <section className="mt-6 space-y-3">
        <label className="block text-sm font-medium">Owner email<input className="mt-1 w-full rounded-lg border p-3" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="block text-sm font-medium">Password<input className="mt-1 w-full rounded-lg border p-3" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={signIn} className="rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white disabled:opacity-50">Sign in</button>
          <button disabled={busy} onClick={createLogin} className="rounded-lg border border-blue-700 px-4 py-2.5 font-semibold text-blue-800 disabled:opacity-50">Create login and send verification</button>
        </div>
        {auth.currentUser && <button disabled={busy} onClick={refresh} className="text-sm font-medium text-blue-700 underline">I verified my email — load setup</button>}
      </section>}

      {review && <section className="mt-6 space-y-5">
        <div className="rounded-lg bg-slate-50 p-4">
          <h2 className="font-semibold">Business details</h2>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {[["Business", setup.name], ["Owner", setup.owner], ["Business phone", setup.phone], ["Address", setup.address], ["Type", setup.type], ["State / postcode", `${config?.tradeBusiness?.state || ""} ${config?.tradeBusiness?.postcode || ""}`], ["Service areas", Array.isArray(setup.areas) ? setup.areas.join(", ") : ""]].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="font-medium">{value || "—"}</dd></div>)}
          </dl>
        </div>
        <div className="rounded-lg border p-4 text-sm"><h2 className="font-semibold">Published terms · {terms?.version || "Unavailable"}</h2><p className="mt-2"><strong>Billing:</strong> {terms?.billingSummary || "—"}</p><p className="mt-2"><strong>Privacy:</strong> {terms?.privacySummary || "—"}</p><p className="mt-2">Recording: {terms?.recording || "—"}; retention: {terms?.retentionDays ?? "—"} days; marketing: off.</p></div>
        {review.status === "approved" || review.status === "provisioning" || review.status === "provisioning_failed" || review.status === "provisioned" ? <p className="rounded-lg bg-green-50 p-4 text-sm">Owner approval status: {review.status}. The Trade account remains inactive until plan, billing and launch review are complete.</p> : <>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" /><span>I reviewed these business details and the terms above. I approve this exact setup for preparation as an inactive Trade account. I understand that this does not select or authorize a subscription, charge a payment method, or activate the account.</span></label>
          <button disabled={!verified || !confirmed || busy} onClick={approve} className="rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white disabled:opacity-50">Approve this setup</button>
        </>}
      </section>}
      {message && <p role="status" className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{message}</p>}
      <p className="mt-6 break-all text-xs text-slate-400">Reference: {draftId}</p>
      {review && <button onClick={() => { void signOut(auth); setReview(null); setVerified(false); }} className="mt-3 text-sm text-slate-500 underline">Sign out</button>}
    </div>
  </main>;
}
