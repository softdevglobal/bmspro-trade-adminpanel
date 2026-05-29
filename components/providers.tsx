"use client";

import { AuthProvider } from "@/lib/auth/auth-context";
import { CustomerAuthProvider } from "@/lib/customer-auth/customer-auth-context";
import { CustomerNotificationsProvider } from "@/lib/notifications/customer-notifications-context";
import { useEffect } from "react";

const CHUNK_RELOAD_KEY = "bms.chunk-reload";

/** After HMR or a dev rebuild, the browser may still request an old chunk hash. */
function isChunkLoadFailure(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const name = "name" in reason ? String(reason.name) : "";
  const message = "message" in reason ? String(reason.message) : "";
  return (
    name === "ChunkLoadError" ||
    message.includes("ChunkLoadError") ||
    message.includes("Loading chunk")
  );
}

function ChunkLoadRecovery() {
  useEffect(() => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);

    function onRejection(event: PromiseRejectionEvent) {
      if (!isChunkLoadFailure(event.reason)) return;
      event.preventDefault();
      if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        return;
      }
      sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
      window.location.reload();
    }
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CustomerAuthProvider>
        <CustomerNotificationsProvider>
          <ChunkLoadRecovery />
          {children}
        </CustomerNotificationsProvider>
      </CustomerAuthProvider>
    </AuthProvider>
  );
}
