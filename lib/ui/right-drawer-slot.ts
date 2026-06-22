"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";

export type RightDrawerWidth = "sm" | "md" | "lg";

const DESKTOP_WIDTH: Record<RightDrawerWidth, number> = {
  sm: 520,
  md: 512,
  lg: 720,
};

const registrations = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function register(id: string, width: number) {
  registrations.set(id, width);
  emit();
}

function unregister(id: string) {
  if (!registrations.delete(id)) return;
  emit();
}

function getMaxInset() {
  let max = 0;
  for (const width of registrations.values()) {
    max = Math.max(max, width);
  }
  return max;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRightDrawerInset() {
  return useSyncExternalStore(subscribe, getMaxInset, () => 0);
}

function resolveDrawerWidth(preset: RightDrawerWidth) {
  if (typeof window === "undefined") return DESKTOP_WIDTH[preset];

  if (window.matchMedia("(min-width: 640px)").matches) {
    return DESKTOP_WIDTH[preset];
  }

  return Math.max(0, window.innerWidth - 20);
}

export function useResponsiveDrawerWidth(preset: RightDrawerWidth) {
  const [width, setWidth] = useState(() => resolveDrawerWidth(preset));

  useEffect(() => {
    function update() {
      setWidth(resolveDrawerWidth(preset));
    }

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [preset]);

  return width;
}

/** Register a right-side drawer so floating UI (e.g. chat) can move aside. */
export function useRegisterRightDrawer(
  open: boolean,
  preset: RightDrawerWidth = "md",
) {
  const id = useId();
  const width = useResponsiveDrawerWidth(preset);

  useEffect(() => {
    if (!open) return;
    register(id, width);
    return () => unregister(id);
  }, [open, width, id]);
}
