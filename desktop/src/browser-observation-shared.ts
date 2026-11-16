import type { BrowserObservationEvent, BrowserObservationInput } from "./browser-observation-protocol";
export const BROWSER_OBSERVATION_CHANNELS = { attach: "zeta-studio:desktop:browser-attach", input: "zeta-studio:desktop:browser-input", detach: "zeta-studio:desktop:browser-detach", event: "zeta-studio:desktop:browser-event" } as const;
export interface BrowserObservationAttach { observationId: string; sessionId: string; tabId: string }
export interface BrowserObservationResult { ok: boolean; message?: string }
export interface BrowserObservationControl { observationId: string; input: BrowserObservationInput }
export type { BrowserObservationEvent };
