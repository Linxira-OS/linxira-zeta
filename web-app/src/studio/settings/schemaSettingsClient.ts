/**
 * Gateway requests for the complete settings catalog.
 *
 * GET returns the schema the CLI and `/settings` share. PUT writes one path and
 * the pane re-reads the catalog; no optimistic value is kept locally because
 * another layer (project, env, overlay) can still win.
 */

import { isRecord } from "../typeGuards";
import { readSchemaSettingsCatalog, type SchemaSettingsCatalog } from "./schemaSettings";
import { defaultGatewayFetch, gatewayJson, type GatewayFetch } from "./gatewayRequest";

export interface SchemaSettingsWriteResult {
  readonly value?: unknown;
  readonly error?: string;
}

function headers(cwd?: string | null, json = false): Record<string, string> {
  return { ...(json ? { "content-type": "application/json" } : {}), ...(cwd ? { "x-zeta-cwd": cwd } : {}) };
}

export async function fetchSchemaSettings(
  lang: "en" | "zh",
  cwd?: string | null | undefined,
  fetcher: GatewayFetch = defaultGatewayFetch,
): Promise<SchemaSettingsCatalog> {
  const body = await gatewayJson(fetcher, `/api/settings?lang=${lang}`, { headers: headers(cwd) });
  return readSchemaSettingsCatalog(body);
}

export async function writeSchemaSetting(
  path: string,
  value: unknown,
  cwd?: string | null | undefined,
  fetcher: GatewayFetch = defaultGatewayFetch,
): Promise<SchemaSettingsWriteResult> {
  const body = await gatewayJson(fetcher, "/api/settings", {
    method: "PUT",
    headers: headers(cwd, true),
    body: JSON.stringify({ path, value }),
  });
  if (!isRecord(body)) throw new Error("PUT /api/settings returned a non-object document");
  const record = body as { ok?: unknown; value?: unknown; error?: unknown };
  if (record.ok !== true) {
    throw new Error(typeof record.error === "string" ? record.error : "PUT /api/settings did not confirm the write");
  }
  return {
    ...(record.value === undefined ? {} : { value: record.value }),
    ...(typeof record.error === "string" ? { error: record.error } : {}),
  };
}
