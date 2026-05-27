"use client";

import { auth, db } from "@/lib/firebase/client";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type FirebaseAuthError = { code?: string; message?: string };

function describeAuthError(error: FirebaseAuthError): string {
  switch (error.code) {
    case "auth/invalid-email":
      return "That email address looks invalid.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please try again later.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return error.message ?? "Something went wrong. Please try again.";
  }
}

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const uid = credential.user.uid;

      const superAdminSnap = await getDoc(doc(db, "super_admins", uid));
      if (!superAdminSnap.exists()) {
        await signOut(auth);
        setErrorMessage(
          "This account is not authorized for the admin portal."
        );
        return;
      }

      const data = superAdminSnap.data();
      if (data?.isActive === false) {
        await signOut(auth);
        setErrorMessage("Your admin access has been deactivated.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setErrorMessage(describeAuthError(error as FirebaseAuthError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
            error
          </span>
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant"
        >
          Email Address
        </label>
        <div className="relative">
          <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-outline">
            mail
          </span>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="admin@business.com"
            className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-low pl-12 pr-3 font-body text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="password"
            className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant"
          >
            Password
          </label>
          <a
            href="#"
            className="font-body text-[13px] font-semibold text-primary hover:text-primary-container transition-colors"
          >
            Forgot?
          </a>
        </div>
        <div className="relative">
          <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-outline">
            lock
          </span>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-low pl-12 pr-11 font-body text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-outline hover:bg-surface-container hover:text-primary transition-colors"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            <span className="material-symbols-outlined text-[18px]">
              {showPassword ? "visibility_off" : "visibility"}
            </span>
          </button>
        </div>
      </div>

      <label className="-mt-0.5 flex cursor-pointer select-none items-center gap-2">
        <input
          type="checkbox"
          name="remember"
          className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-2 focus:ring-primary/20 focus:ring-offset-0"
        />
        <span className="font-body text-[13px] text-on-surface-variant">
          Keep me signed in on this device
        </span>
      </label>

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 font-body text-[14px] font-semibold tracking-wide text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? (
          <>
            <span className="material-symbols-outlined animate-spin text-[18px]">
              progress_activity
            </span>
            Signing in...
          </>
        ) : (
          <>
            Sign In
            <span className="material-symbols-outlined text-[18px]">
              arrow_forward
            </span>
          </>
        )}
      </button>
    </form>
  );
}
