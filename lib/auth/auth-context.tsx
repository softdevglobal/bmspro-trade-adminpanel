"use client";

import { postSessionAudit } from "@/lib/audit/log-session-client";
import { auth, db } from "@/lib/firebase/client";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";
export type AuthRole = "super_admin" | "business_owner" | "staff" | null;
type WebAppAuthRole = Exclude<AuthRole, "staff" | null>;

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  role: AuthRole;
  businessId: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function canAccessWebApp(role: AuthRole): role is WebAppAuthRole {
  return role === "super_admin" || role === "business_owner";
}

async function verifySuperAdmin(user: User): Promise<boolean> {
  const snap = await getDoc(doc(db, "super_admins", user.uid));
  return snap.exists() && snap.data()?.isActive !== false;
}

async function resolveAuthRole(
  user: User,
): Promise<{ role: AuthRole; businessId: string | null }> {
  // Check JWT claims first — avoids a Firestore round-trip for most business owners.
  const tokenResult = await user.getIdTokenResult();
  const businessId =
    typeof tokenResult.claims.businessId === "string"
      ? tokenResult.claims.businessId
      : null;
  const claimRole = tokenResult.claims.role;
  const superAdminClaim =
    tokenResult.claims.superAdmin === true || claimRole === "super_admin";

  if (
    businessId &&
    (claimRole === "owner" || claimRole === "admin")
  ) {
    return { role: "business_owner", businessId };
  }

  if (businessId && claimRole === "staff") {
    return { role: "staff", businessId };
  }

  if (superAdminClaim) {
    return { role: "super_admin", businessId: null };
  }

  const isSuperAdmin = await verifySuperAdmin(user);
  if (isSuperAdmin) {
    return { role: "super_admin", businessId: null };
  }

  return { role: null, businessId: null };
}

const AUTH_CACHE_KEY = "bms.auth.session";

type AuthSessionCache = {
  uid: string;
  role: AuthRole;
  businessId: string | null;
};

function readAuthCache(uid: string): AuthSessionCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSessionCache;
    if (parsed.uid !== uid || !canAccessWebApp(parsed.role)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAuthCache(
  uid: string,
  role: AuthRole,
  businessId: string | null,
): void {
  if (typeof window === "undefined" || !role) return;
  try {
    sessionStorage.setItem(
      AUTH_CACHE_KEY,
      JSON.stringify({ uid, role, businessId }),
    );
  } catch {
    /* storage unavailable */
  }
}

function clearAuthCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function waitForAuthSignedOut(): Promise<void> {
  if (!auth.currentUser) return Promise.resolve();

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        unsubscribe();
        resolve();
      }
    });
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AuthRole>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const statusRef = useRef<AuthStatus>("loading");
  const userRef = useRef<User | null>(null);
  const loginInProgressRef = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setRole(null);
        setBusinessId(null);
        setStatus("unauthenticated");
        return;
      }

      if (
        userRef.current?.uid === firebaseUser.uid &&
        statusRef.current === "authenticated"
      ) {
        setUser(firebaseUser);
        return;
      }

      if (loginInProgressRef.current) {
        setUser(firebaseUser);
        setRole(null);
        setBusinessId(null);
        setStatus("loading");
        return;
      }

      const cached = readAuthCache(firebaseUser.uid);
      setUser(firebaseUser);
      if (cached) {
        setRole(cached.role);
        setBusinessId(cached.businessId);
        setStatus("authenticated");
      } else {
        setStatus("loading");
      }

      const applyResolved = async () => {
        try {
          const resolved = await resolveAuthRole(firebaseUser);
          if (!canAccessWebApp(resolved.role)) {
            clearAuthCache();
            await signOut(auth);
            await waitForAuthSignedOut();
            setUser(null);
            setRole(null);
            setBusinessId(null);
            setStatus("unauthenticated");
            return;
          }
          writeAuthCache(
            firebaseUser.uid,
            resolved.role,
            resolved.businessId,
          );
          setRole(resolved.role);
          setBusinessId(resolved.businessId);
          setStatus("authenticated");
        } catch {
          clearAuthCache();
          await signOut(auth);
          await waitForAuthSignedOut();
          setUser(null);
          setRole(null);
          setBusinessId(null);
          setStatus("unauthenticated");
        }
      };

      if (cached) {
        void applyResolved();
      } else {
        await applyResolved();
      }
    });

    return () => unsubscribe();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    clearAuthCache();
    setUser(null);
    setRole(null);
    setBusinessId(null);
    setStatus("loading");
    loginInProgressRef.current = true;

    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      await credential.user.getIdToken(true);

      const resolved = await resolveAuthRole(credential.user);
      if (!canAccessWebApp(resolved.role)) {
        await signOut(auth);
        await waitForAuthSignedOut();
        setUser(null);
        setRole(null);
        setBusinessId(null);
        setStatus("unauthenticated");
        if (resolved.role === "staff") {
          throw new Error("STAFF_WEB_LOGIN_DISABLED");
        }
        throw new Error("UNAUTHORIZED");
      }

      writeAuthCache(
        credential.user.uid,
        resolved.role,
        resolved.businessId,
      );
      setUser(credential.user);
      setRole(resolved.role);
      setBusinessId(resolved.businessId);
      setStatus("authenticated");
      if (resolved.role === "business_owner") {
        const token = await credential.user.getIdToken();
        void postSessionAudit(token, "login");
      }
      router.replace("/dashboard");
    } catch (error) {
      if (!auth.currentUser) {
        setUser(null);
        setRole(null);
        setBusinessId(null);
        setStatus("unauthenticated");
      }
      throw error;
    } finally {
      loginInProgressRef.current = false;
    }
  }, [router]);

  const logout = useCallback(async () => {
    const currentUser = userRef.current;
    if (role === "business_owner" && currentUser) {
      const token = await currentUser.getIdToken();
      await postSessionAudit(token, "logout");
    }
    clearAuthCache();
    await signOut(auth);
    await waitForAuthSignedOut();
    setUser(null);
    setRole(null);
    setBusinessId(null);
    setStatus("unauthenticated");
    router.replace("/login");
  }, [router, role]);

  const value = useMemo(
    () => ({ status, user, role, businessId, login, logout }),
    [status, user, role, businessId, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
