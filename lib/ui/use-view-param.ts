"use client";

import { useEffect, useRef } from "react";

/**
 * Deep link support: on first render, opens the record named by `?view=<id>`
 * and removes the parameter so a refresh or back navigation doesn't reopen it.
 */
export function useOpenFromViewParam(onOpen: (id: string) => void): void {
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("view")?.trim();
    if (!id) return;
    params.delete("view");
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${params.toString() ? `?${params}` : ""}`,
    );
    queueMicrotask(() => onOpenRef.current(id));
  }, []);
}
