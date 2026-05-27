"use client";

import { auth, db } from "@/lib/firebase/client";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "super_admins", user.uid));
        if (!snap.exists() || snap.data()?.isActive === false) {
          await signOut(auth);
          router.replace("/login");
          return;
        }
        setIsReady(true);
      } catch {
        await signOut(auth);
        router.replace("/login");
      }
    });

    return () => unsubscribe();
  }, [router]);

  if (!isReady) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
            progress_activity
          </span>
          <p className="font-body text-body-md text-on-surface-variant">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
