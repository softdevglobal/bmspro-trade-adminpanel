"use client";

import { auth, db } from "@/lib/firebase/client";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LoginRedirect() {
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return;

      try {
        const snap = await getDoc(doc(db, "super_admins", user.uid));
        if (snap.exists() && snap.data()?.isActive !== false) {
          router.replace("/dashboard");
        }
      } catch {
        // Stay on login if check fails
      }
    });

    return () => unsubscribe();
  }, [router]);

  return null;
}
