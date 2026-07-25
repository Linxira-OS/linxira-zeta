import { readFileSync, existsSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { getOmpAgentDir } from "./file-paths";

export interface OmpAuthCredential {
  id?: number;
  provider: string;
  credential_type: string;
  data: string;
  disabled_cause?: string | null;
  identity_key?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface OmpRuntimeCredential {
  provider: string;
  apiKey: string;
  credentialType: "api_key" | "oauth";
}

function parseRuntimeCredential(credential: OmpAuthCredential): OmpRuntimeCredential | null {
  const data = credential.data.trim();
  if (!data) return null;

  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : undefined;
    const accessToken = typeof parsed.access === "string"
      ? parsed.access
      : typeof parsed.access_token === "string"
        ? parsed.access_token
        : typeof parsed.accessToken === "string"
          ? parsed.accessToken
          : typeof parsed.token === "string"
            ? parsed.token
            : undefined;
    const token = credential.credential_type === "oauth" ? accessToken : apiKey ?? accessToken;
    if (!token?.trim()) return null;
    return {
      provider: credential.provider,
      apiKey: token.trim(),
      credentialType: credential.credential_type === "oauth" ? "oauth" : "api_key",
    };
  } catch {
    // API-key credentials written by older OMP versions may be stored as plain text.
    if (credential.credential_type !== "oauth") {
      return { provider: credential.provider, apiKey: data, credentialType: "api_key" };
    }
    return null;
  }
}

export function getUsableOmpRuntimeCredentials(): OmpRuntimeCredential[] {
  const latestByProvider = new Map<string, OmpAuthCredential>();
  for (const credential of getOmpAuthCredentials()) {
    const current = latestByProvider.get(credential.provider);
    if (!current || (credential.updated_at ?? 0) > (current.updated_at ?? 0)) {
      latestByProvider.set(credential.provider, credential);
    }
  }

  return [...latestByProvider.values()]
    .map(parseRuntimeCredential)
    .filter((credential): credential is OmpRuntimeCredential => credential !== null);
}

export function getOmpAuthCredentials(): OmpAuthCredential[] {
  const dbPath = join(getOmpAgentDir(), "agent.db");
  if (!existsSync(dbPath)) return [];

  // Strategy 1: Try better-sqlite3
  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT * FROM auth_credentials WHERE disabled_cause IS NULL").all() as OmpAuthCredential[];
    db.close();
    if (rows.length > 0) return rows;
  } catch {
    // continue to fallback
  }

  // Strategy 2: Fallback text scan if native sqlite driver fails
  try {
    const fileBuffer = readFileSync(dbPath);
    const fileStr = fileBuffer.toString("utf8");
    const credentials: OmpAuthCredential[] = [];
    const jsonMatches = fileStr.match(/\{"access":[\s\S]*?\}|\{"apiKey":[\s\S]*?\}/g);
    if (jsonMatches) {
      for (const match of jsonMatches) {
        try {
          const parsed = JSON.parse(match) as Record<string, unknown>;
          if (parsed.access || parsed.apiKey) {
            credentials.push({
              provider: (parsed.provider as string) || "google-antigravity",
              credential_type: parsed.access ? "oauth" : "api_key",
              data: match,
            });
          }
        } catch {
          // ignore
        }
      }
    }
    return credentials;
  } catch {
    return [];
  }
}

export function saveOmpApiKeyCredential(provider: string, apiKey: string): void {
  const dbPath = join(getOmpAgentDir(), "agent.db");
  if (!existsSync(dbPath)) return;
  try {
    const db = new Database(dbPath);
    const now = Math.floor(Date.now() / 1000);
    const dataStr = JSON.stringify({ apiKey });
    db.prepare(`
      INSERT INTO auth_credentials (provider, credential_type, data, created_at, updated_at)
      VALUES (?, 'api_key', ?, ?, ?)
    `).run(provider, dataStr, now, now);
    db.close();
  } catch {
    // ignore
  }
}

export function deleteOmpCredential(provider: string): void {
  const dbPath = join(getOmpAgentDir(), "agent.db");
  if (!existsSync(dbPath)) return;
  try {
    const db = new Database(dbPath);
    db.prepare("DELETE FROM auth_credentials WHERE provider = ?").run(provider);
    db.close();
  } catch {
    // ignore
  }
}
