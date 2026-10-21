"use client";

import { useState } from "react";

export function ActivationForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <form className="space-y-5" onSubmit={async (event) => {
    event.preventDefault();
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.location.assign(data.loginPath);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not activate your account."); setBusy(false); }
  }}>
    <h1 className="text-2xl font-semibold">Activate your account</h1>
    <p>Choose your password to verify your email and activate your account.</p>
    <label className="block">New password<input className="mt-2 w-full rounded-lg border p-3" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <label className="block">Confirm password<input className="mt-2 w-full rounded-lg border p-3" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button disabled={busy} className="w-full rounded-lg bg-primary p-3 text-white" type="submit">{busy ? "Activating…" : "Activate account"}</button>
  </form>;
}
