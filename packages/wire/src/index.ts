/**
 * Shared wire constants for Zeta packages.
 *
 * This file carries only the cross-package values that do not belong to a
 * feature-specific protocol; TSP and the stream wire live in their own modules.
 */

/** Parameter key used for intent tracing (e.g. prompt explanation/reasoning). */
export const INTENT_FIELD = "i";

export * from "./shell-trace";
export * from "./shell-viz";
export * from "./stream";
export * from "./tsp";
