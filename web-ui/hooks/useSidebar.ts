"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "zeta-sidebar-visible";

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

function setVisible(next: boolean) {
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
  listeners.forEach((cb) => cb());
}

export function useSidebar() {
  const visible = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);
  const toggle = useCallback(() => setVisible(!getSnapshot()), []);

  return { visible, show, hide, toggle };
}
