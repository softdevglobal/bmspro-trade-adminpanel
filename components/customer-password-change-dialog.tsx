"use client";
import { useEffect, useRef } from "react";
import { CustomerSecuritySettings } from "@/components/customer-security-settings";
export function CustomerPasswordChangeDialog({ onChanged, onSignOut }: { onChanged: () => void; onSignOut: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="required-password-title" onCancel={(event) => event.preventDefault()} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl backdrop:bg-black/50">
    <h2 id="required-password-title" className="font-display text-xl font-semibold">Change your default password</h2>
    <p className="my-3 text-sm text-on-surface-variant">You signed in with the default password. Choose your own password to continue using your customer account.</p>
    <CustomerSecuritySettings onPasswordChanged={onChanged} />
    <button type="button" className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-primary" onClick={onSignOut}>Sign out</button>
  </dialog>;
}
