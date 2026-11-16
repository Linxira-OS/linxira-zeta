export const MEMORY_CREDENTIAL_CHANNELS = {
  status: "zeta-studio:memory-credential-status",
  set: "zeta-studio:memory-credential-set",
  remove: "zeta-studio:memory-credential-remove",
} as const;

export interface MemoryCredentialInput { targetId: string | null; url: string }
export type MemoryCredentialResult = { ok: true; configured: boolean; syncSupported: boolean } | { ok: false; message: string };
