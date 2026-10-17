"use client";

import { useRef } from "react";

/** Controlled dialogs opened from table/card actions still restore keyboard focus. */
export function useDialogFocus() {
  const previous = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => { previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; },
    onCloseAutoFocus: (event: Event) => { if (previous.current?.isConnected) { event.preventDefault(); previous.current.focus(); } },
  };
}
