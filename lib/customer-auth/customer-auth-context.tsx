"use client";

import { CustomerAuthModal } from "@/components/customer-auth-modal";
import { customerAuth } from "@/lib/firebase/customer-client";
import {
  type CustomerProfile,
  type CustomerProfileInput,
} from "@/lib/customer/types";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type CustomerAuthStatus = "loading" | "authenticated" | "unauthenticated";

export type AuthModalMode = "signin" | "signup";

export type OpenAuthOptions = {
  mode?: AuthModalMode;
  businessName?: string;
  bookingSlug?: string;
  defaults?: { fullName?: string; phone?: string; email?: string };
  onAuthenticated?: () => void;
};

type CustomerAuthContextValue = {
  status: CustomerAuthStatus;
  user: User | null;
  profile: CustomerProfile | null;
  refreshProfile: () => Promise<CustomerProfile | null>;
  login: (email: string, password: string) => Promise<void>;
  register: (params: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
    bookingSlug?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  saveProfile: (input: CustomerProfileInput) => Promise<CustomerProfile>;
  resetPassword: (email: string) => Promise<void>;
  getIdToken: () => Promise<string | null>;
  openAuth: (options?: OpenAuthOptions) => void;
  closeAuth: () => void;
};

const CustomerAuthContext = createContext<CustomerAuthContextValue | null>(
  null,
);

async function fetchProfile(user: User): Promise<CustomerProfile | null> {
  const idToken = await user.getIdToken();
  const response = await fetch("/api/customer/profile", {
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as {
    ok?: boolean;
    profile?: CustomerProfile;
  };
  return payload.ok && payload.profile ? payload.profile : null;
}

async function patchProfile(
  user: User,
  input: CustomerProfileInput,
): Promise<CustomerProfile> {
  const idToken = await user.getIdToken();
  const response = await fetch("/api/customer/profile", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    profile?: CustomerProfile;
    error?: string;
  };
  if (!response.ok || !payload.ok || !payload.profile) {
    throw new Error(payload.error ?? "Could not save your profile.");
  }
  return payload.profile;
}

export function CustomerAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<CustomerAuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalOptions, setModalOptions] = useState<OpenAuthOptions>({});
  const userRef = useRef<User | null>(null);
  const pendingCallbackRef = useRef<(() => void) | null>(null);
  const registrationSlugRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(customerAuth, async (next) => {
      if (!next) {
        setUser(null);
        setProfile(null);
        setStatus("unauthenticated");
        return;
      }
      setUser(next);
      setStatus("loading");
      try {
        const loaded = await fetchProfile(next);
        setProfile(loaded);
        setStatus("authenticated");
      } catch {
        setProfile(null);
        setStatus("authenticated");
      }
    });
    return () => unsubscribe();
  }, []);

  const refreshProfile = useCallback(async () => {
    const current = userRef.current;
    if (!current) return null;
    const next = await fetchProfile(current);
    setProfile(next);
    return next;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(customerAuth, email.trim(), password);
  }, []);

  const register = useCallback(
    async (params: {
      email: string;
      password: string;
      fullName: string;
      phone: string;
      bookingSlug?: string;
    }) => {
      const credential = await createUserWithEmailAndPassword(
        customerAuth,
        params.email.trim(),
        params.password,
      );
      try {
        await updateProfile(credential.user, {
          displayName: params.fullName.trim(),
        });
      } catch {
        /* non-fatal */
      }
      try {
        const slug =
          params.bookingSlug?.trim() || registrationSlugRef.current?.trim();
        await patchProfile(credential.user, {
          fullName: params.fullName.trim(),
          phone: params.phone.replace(/\D/g, ""),
          bookingSlug: slug,
        });
      } catch {
        /* profile saved on first PATCH attempt next time */
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await signOut(customerAuth);
  }, []);

  const saveProfile = useCallback(async (input: CustomerProfileInput) => {
    const current = userRef.current;
    if (!current) {
      throw new Error("Sign in to update your profile.");
    }
    const next = await patchProfile(current, input);
    setProfile(next);
    return next;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(customerAuth, email.trim());
  }, []);

  const getIdToken = useCallback(async () => {
    const current = userRef.current;
    if (!current) return null;
    return current.getIdToken();
  }, []);

  const openAuth = useCallback((options: OpenAuthOptions = {}) => {
    pendingCallbackRef.current = options.onAuthenticated ?? null;
    registrationSlugRef.current = options.bookingSlug?.trim();
    setModalOptions(options);
    setModalOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    pendingCallbackRef.current = null;
    registrationSlugRef.current = undefined;
    setModalOpen(false);
    setModalOptions({});
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!modalOpen && !pendingCallbackRef.current) return;
    setModalOpen(false);
    const cb = pendingCallbackRef.current;
    pendingCallbackRef.current = null;
    if (cb) cb();
  }, [status, modalOpen]);

  const value = useMemo<CustomerAuthContextValue>(
    () => ({
      status,
      user,
      profile,
      refreshProfile,
      login,
      register,
      logout,
      saveProfile,
      resetPassword,
      getIdToken,
      openAuth,
      closeAuth,
    }),
    [
      status,
      user,
      profile,
      refreshProfile,
      login,
      register,
      logout,
      saveProfile,
      resetPassword,
      getIdToken,
      openAuth,
      closeAuth,
    ],
  );

  return (
    <CustomerAuthContext.Provider value={value}>
      {children}
      <CustomerAuthModal
        open={modalOpen}
        onClose={closeAuth}
        businessName={modalOptions.businessName ?? "BMS Pro Trade"}
        bookingSlug={modalOptions.bookingSlug}
        defaultMode={modalOptions.mode}
        defaults={modalOptions.defaults}
      />
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const context = useContext(CustomerAuthContext);
  if (!context) {
    throw new Error(
      "useCustomerAuth must be used within a CustomerAuthProvider",
    );
  }
  return context;
}
