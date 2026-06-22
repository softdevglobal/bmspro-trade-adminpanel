"use client";

import { CustomerAuthModal } from "@/components/customer-auth-modal";
import { postSessionAudit } from "@/lib/audit/log-session-client";
import { buildCustomerAuthEmail } from "@/lib/customer/scoped-auth";
import {
  type CustomerProfile,
  type CustomerProfileInput,
} from "@/lib/customer/types";
import { customerAuth } from "@/lib/firebase/customer-client";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
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
  activeBookingSlug: string | undefined;
  setActiveBookingSlug: (slug: string | undefined) => void;
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
  getIdToken: () => Promise<string | null>;
  openAuth: (options?: OpenAuthOptions) => void;
  closeAuth: () => void;
};

const CustomerAuthContext = createContext<CustomerAuthContextValue | null>(
  null,
);

const PROFILE_CACHE_KEY = "bms.customer.profile";
const PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;

type ProfileCache = {
  uid: string;
  bookingSlug: string | null;
  profile: CustomerProfile;
  cachedAt: number;
};

function profileMatchesActiveBusiness(
  profile: CustomerProfile | null,
  activeSlug: string | undefined,
): boolean {
  if (!profile) return false;
  if (!activeSlug?.trim()) return true;
  const profileSlug = profile.registeredBookingSlug?.trim().toLowerCase();
  // Profile may not be linked to a business yet during first signup/load.
  if (!profileSlug) return true;
  return profileSlug === activeSlug.trim().toLowerCase();
}

function resolveEffectiveStatus(
  user: User | null,
  profile: CustomerProfile | null,
  activeSlug: string | undefined,
  loading: boolean,
): CustomerAuthStatus {
  if (!user) return "unauthenticated";
  if (loading) return "loading";
  if (!profileMatchesActiveBusiness(profile, activeSlug)) {
    return "unauthenticated";
  }
  return "authenticated";
}

function readProfileCache(
  uid: string,
  activeSlug: string | undefined,
): CustomerProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileCache;
    if (parsed.uid !== uid) return null;
    if (Date.now() - parsed.cachedAt > PROFILE_CACHE_TTL_MS) return null;
    if (!profileMatchesActiveBusiness(parsed.profile, activeSlug)) return null;
    return parsed.profile;
  } catch {
    return null;
  }
}

function writeProfileCache(uid: string, profile: CustomerProfile): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({
        uid,
        bookingSlug: profile.registeredBookingSlug,
        profile,
        cachedAt: Date.now(),
      } satisfies ProfileCache),
    );
  } catch {
    /* storage unavailable */
  }
}

function clearProfileCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function profileRequestHeaders(
  idToken: string,
  bookingSlug?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${idToken}`,
  };
  if (bookingSlug?.trim()) {
    headers["x-booking-slug"] = bookingSlug.trim();
  }
  return headers;
}

async function fetchProfile(
  user: User,
  bookingSlug?: string,
): Promise<CustomerProfile | null> {
  const idToken = await user.getIdToken();
  const response = await fetch("/api/customer/profile", {
    headers: profileRequestHeaders(idToken, bookingSlug),
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
  bookingSlug?: string,
): Promise<CustomerProfile> {
  const idToken = await user.getIdToken();
  const response = await fetch("/api/customer/profile", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...profileRequestHeaders(idToken, bookingSlug),
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

function resolveBookingSlug(
  explicit?: string,
  sessionRef?: string,
  registrationRef?: string,
): string {
  const slug =
    explicit?.trim() || sessionRef?.trim() || registrationRef?.trim() || "";
  if (!slug) {
    throw new Error("Open this page from a business booking link to continue.");
  }
  return slug;
}

function isRecoverableSignInError(code: string | undefined): boolean {
  return (
    code === "auth/invalid-credential" ||
    code === "auth/user-not-found" ||
    code === "auth/wrong-password"
  );
}

export function CustomerAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [activeBookingSlug, setActiveBookingSlugState] = useState<
    string | undefined
  >(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalOptions, setModalOptions] = useState<OpenAuthOptions>({});
  const userRef = useRef<User | null>(null);
  const profileRef = useRef<CustomerProfile | null>(null);
  const pendingCallbackRef = useRef<(() => void) | null>(null);
  const registrationSlugRef = useRef<string | undefined>(undefined);
  const sessionBookingSlugRef = useRef<string | undefined>(undefined);
  const activeBookingSlugRef = useRef<string | undefined>(undefined);

  const setActiveBookingSlug = useCallback((slug: string | undefined) => {
    const next = slug?.trim() || undefined;
    activeBookingSlugRef.current = next;
    sessionBookingSlugRef.current = next ?? sessionBookingSlugRef.current;
    setActiveBookingSlugState(next);
  }, []);

  useEffect(() => {
    userRef.current = firebaseUser;
  }, [firebaseUser]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const status = useMemo(
    () =>
      resolveEffectiveStatus(
        firebaseUser,
        profile,
        activeBookingSlug,
        profileLoading,
      ),
    [firebaseUser, profile, activeBookingSlug, profileLoading],
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(customerAuth, async (next) => {
      if (!next) {
        clearProfileCache();
        setFirebaseUser(null);
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      const slug = activeBookingSlugRef.current;
      const cachedProfile = readProfileCache(next.uid, slug);
      setFirebaseUser(next);
      if (cachedProfile) {
        setProfile(cachedProfile);
        setProfileLoading(false);
        void fetchProfile(next, slug)
          .then((loaded) => {
            if (loaded) {
              setProfile(loaded);
              writeProfileCache(next.uid, loaded);
            }
          })
          .catch(() => {});
        return;
      }

      setProfileLoading(true);
      try {
        const loaded = await fetchProfile(next, slug);
        if (loaded) writeProfileCache(next.uid, loaded);
        setProfile(loaded);
      } catch {
        setProfile(null);
      } finally {
        setProfileLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const current = userRef.current;
    if (!current) return;
    setProfileLoading(true);
    void fetchProfile(current, activeBookingSlug)
      .then((loaded) => {
        if (loaded) writeProfileCache(current.uid, loaded);
        setProfile(loaded);
      })
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false));
  }, [activeBookingSlug]);

  const refreshProfile = useCallback(async () => {
    const current = userRef.current;
    if (!current) return null;
    const next = await fetchProfile(current, activeBookingSlugRef.current);
    if (next) writeProfileCache(current.uid, next);
    setProfile(next);
    return next;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const slug = resolveBookingSlug(
      undefined,
      sessionBookingSlugRef.current,
      registrationSlugRef.current,
    );
    const authEmail = await buildCustomerAuthEmail(slug, email);

    let credential;
    try {
      credential = await signInWithEmailAndPassword(
        customerAuth,
        authEmail,
        password,
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!isRecoverableSignInError(code)) throw error;

      try {
        credential = await signInWithEmailAndPassword(
          customerAuth,
          email.trim(),
          password,
        );
        const loaded = await fetchProfile(credential.user, slug);
        if (!profileMatchesActiveBusiness(loaded, slug)) {
          await signOut(customerAuth);
          throw new Error(
            "No account found for this email with this business. Create an account to continue.",
          );
        }
      } catch (legacyError) {
        if (
          legacyError instanceof Error &&
          legacyError.message.includes("No account found")
        ) {
          throw legacyError;
        }
        throw error;
      }
    }

    const token = await credential.user.getIdToken();
    void postSessionAudit(token, "login", { bookingSlug: slug });
  }, []);

  const register = useCallback(
    async (params: {
      email: string;
      password: string;
      fullName: string;
      phone: string;
      bookingSlug?: string;
    }) => {
      const slug = resolveBookingSlug(
        params.bookingSlug,
        sessionBookingSlugRef.current,
        registrationSlugRef.current,
      );
      const authEmail = await buildCustomerAuthEmail(slug, params.email);
      const credential = await createUserWithEmailAndPassword(
        customerAuth,
        authEmail,
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
        const saved = await patchProfile(
          credential.user,
          {
            fullName: params.fullName.trim(),
            phone: params.phone.replace(/\D/g, ""),
            email: params.email.trim(),
            bookingSlug: slug,
          },
          slug,
        );
        writeProfileCache(credential.user.uid, saved);
        setProfile(saved);
      } catch (error) {
        await signOut(customerAuth);
        throw error instanceof Error
          ? error
          : new Error("Could not save your profile. Please try again.");
      }

      const token = await credential.user.getIdToken();
      void postSessionAudit(token, "login", { bookingSlug: slug });
    },
    [],
  );

  const logout = useCallback(async () => {
    const current = userRef.current;
    if (current) {
      const slug =
        profileRef.current?.registeredBookingSlug?.trim() ||
        sessionBookingSlugRef.current?.trim() ||
        registrationSlugRef.current?.trim();
      const token = await current.getIdToken();
      await postSessionAudit(token, "logout", { bookingSlug: slug });
    }
    clearProfileCache();
    await signOut(customerAuth);
  }, []);

  const saveProfile = useCallback(async (input: CustomerProfileInput) => {
    const current = userRef.current;
    if (!current) {
      throw new Error("Sign in to update your profile.");
    }
    const slug = activeBookingSlugRef.current;
    const next = await patchProfile(current, input, slug);
    writeProfileCache(current.uid, next);
    setProfile(next);
    return next;
  }, []);

  const getIdToken = useCallback(async () => {
    const current = userRef.current;
    if (!current) return null;
    if (
      !profileMatchesActiveBusiness(
        profileRef.current,
        activeBookingSlugRef.current,
      )
    ) {
      return null;
    }
    return current.getIdToken();
  }, []);

  const openAuth = useCallback((options: OpenAuthOptions = {}) => {
    pendingCallbackRef.current = options.onAuthenticated ?? null;
    const slug = options.bookingSlug?.trim();
    registrationSlugRef.current = slug;
    sessionBookingSlugRef.current = slug ?? sessionBookingSlugRef.current;
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
      user: firebaseUser,
      profile,
      activeBookingSlug,
      setActiveBookingSlug,
      refreshProfile,
      login,
      register,
      logout,
      saveProfile,
      getIdToken,
      openAuth,
      closeAuth,
    }),
    [
      status,
      firebaseUser,
      profile,
      activeBookingSlug,
      setActiveBookingSlug,
      refreshProfile,
      login,
      register,
      logout,
      saveProfile,
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

/** Pins the active business portal so auth only applies to that booking slug. */
export function useCustomerBookingSlug(slug: string) {
  const { setActiveBookingSlug } = useCustomerAuth();
  useEffect(() => {
    setActiveBookingSlug(slug);
    return () => setActiveBookingSlug(undefined);
  }, [slug, setActiveBookingSlug]);
}
