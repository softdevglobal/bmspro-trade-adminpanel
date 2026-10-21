"use client";

import { useEffect } from "react";

let locks = 0;
let previousOverflow = "";

/**
 * Stops the page behind a dialog from scrolling while `active`. Counted, so
 * stacked dialogs (e.g. an image viewer over the composer) unlock correctly.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
