"use client";

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
export type AuthRole = "super_admin" | "business_owner" | null;

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  role: AuthRole;
  businessId: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function verifySuperAdmin(user: User): Promise<boolean> {
  const snap = await getDoc(doc(db, "super_admins", user.uid));
  return snap.exists() && snap.data()?.isActive !== false;
}

async function resolveAuthRole(
  user: User
): Promise<{ role: AuthRole; businessId: string | null }> {
  const isSuperAdmin = await verifySuperAdmin(user);
  if (isSuperAdmin) {
    return { role: "super_admin", businessId: null };
  }

  const tokenResult = await user.getIdTokenResult();
  const businessId =
    typeof tokenResult.claims.businessId === "string"
      ? tokenResult.claims.businessId
      : null;
  const claimRole = tokenResult.claims.role;

  if (
    businessId &&
    (claimRole === "owner" || claimRole === "admin")
  ) {
    return { role: "business_owner", businessId };
  }

  return { role: null, businessId: null };
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

      setUser(firebaseUser);
      setStatus("loading");

      try {
        const resolved = await resolveAuthRole(firebaseUser);
        if (!resolved.role) {
          await signOut(auth);
          await waitForAuthSignedOut();
          setUser(null);
          setRole(null);
          setBusinessId(null);
          setStatus("unauthenticated");
          return;
        }
        setRole(resolved.role);
        setBusinessId(resolved.businessId);
        setStatus("authenticated");
      } catch {
        await signOut(auth);
        await waitForAuthSignedOut();
        setUser(null);
        setRole(null);
        setBusinessId(null);
        setStatus("unauthenticated");
      }
    });

    return () => unsubscribe();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(
      auth,
      email.trim(),
      password
    );
    await credential.user.getIdToken(true);

    const resolved = await resolveAuthRole(credential.user);
    if (!resolved.role) {
      await signOut(auth);
      await waitForAuthSignedOut();
      throw new Error("UNAUTHORIZED");
    }

    setUser(credential.user);
    setRole(resolved.role);
    setBusinessId(resolved.businessId);
    setStatus("authenticated");
    router.replace("/dashboard");
  }, [router]);

  const logout = useCallback(async () => {
    await signOut(auth);
    await waitForAuthSignedOut();
    setUser(null);
    setRole(null);
    setBusinessId(null);
    setStatus("unauthenticated");
    router.replace("/login");
  }, [router]);

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
