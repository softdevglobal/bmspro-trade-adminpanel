"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { usePageVisible } from "@/lib/notifications/use-page-visible";

const MissedCallsContext = createContext({ unread: 0, capped: false });

export function MissedCallsProvider({ children }: { children: ReactNode }) {
  const { user, businessId, role } = useAuth();
  const visible = usePageVisible();
  const scope = role === "business_owner" && user && businessId ? JSON.stringify([businessId, user.uid]) : null;
  const [snapshot, setSnapshot] = useState<{ scope: string; unread: number; capped: boolean } | null>(null);

  useEffect(() => {
    if (!user || !scope || !visible) return;
    const activeUser = user;
    const activeScope = scope;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let revision = 0;
    function clearBadge(event: Event) {
      const detail = (event as CustomEvent<{ businessId: string; uid: string }>).detail;
      if (JSON.stringify([detail?.businessId, detail?.uid]) !== activeScope) return;
      revision++;
      setSnapshot({ scope: activeScope, unread: 0, capped: false });
    }
    async function check() {
      const checkedRevision = revision;
      try {
        const token = await activeUser.getIdToken();
        const response = await fetch("/api/business/call-recordings?view=missed&summary=1", {
          headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: controller.signal,
        });
        if (response.ok) {
          const result = await response.json();
          if (!controller.signal.aborted && revision === checkedRevision && Number.isSafeInteger(result.unreadCount)) {
            setSnapshot({ scope: activeScope, unread: result.unreadCount, capped: result.unreadCountCapped === true });
          }
        }
      } catch {
        // Keep the last successful count while the provider is unavailable.
      }
      if (!controller.signal.aborted) timer = setTimeout(check, 60_000);
    }
    window.addEventListener("trade:missed-calls-read", clearBadge);
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("trade:missed-calls-read", clearBadge);
    };
  }, [user, scope, visible]);

  const value = snapshot?.scope === scope ? snapshot : { unread: 0, capped: false };
  return <MissedCallsContext.Provider value={value}>{children}</MissedCallsContext.Provider>;
}

export function useMissedCallsCount() {
  return useContext(MissedCallsContext);
}
