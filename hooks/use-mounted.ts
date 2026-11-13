"use client";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** false during SSR and hydration, true afterwards. Avoids wallet-state hydration mismatches. */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
