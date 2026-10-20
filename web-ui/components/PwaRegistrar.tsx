"use client";

/**
 * Registers the offline-shell service worker after mount. A silent no-op on
 * unsupported browsers, insecure non-localhost origins, and dev builds (see
 * `lib/pwa.ts`); registration failure is reported to the console only, never
 * to the UI.
 */

import { useEffect } from "react";
import { browserServiceWorkerEnvironment, registerServiceWorker } from "@/lib/pwa";

export function PwaRegistrar() {
  useEffect(() => {
    void registerServiceWorker(browserServiceWorkerEnvironment()).then((registration) => {
      if (registration) {
        console.info(`Zeta offline shell registered for ${registration.scope}`);
      }
    });
  }, []);
  return null;
}
