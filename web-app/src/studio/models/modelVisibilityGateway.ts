/**
 * Gateway fallback for the visibility pane.
 *
 * The Studio host does not answer `models.get` in every build. The model
 * visibility tab only needs the available-model list and one settings value,
 * both of which the gateway already exposes (`GET /api/models`,
 * `GET|PUT /api/settings`). Keeping this fallback here lets the tab work
 * without inventing a second model catalog.
 */
import { gatewayJson, defaultGatewayFetch, type GatewayFetch } from "../settings/gatewayRequest";
import { isRecord } from "../typeGuards";

export interface VisibilityModelRow {
	readonly provider: string;
	readonly id: string;
	readonly selector: string;
	readonly name: string;
	/** Catalog kind; absent means `chat`. */
	readonly kind?: string;
	/** Role ids this model is assigned to. */
	readonly roles: ReadonlyArray<string>;
}

function parseModels(payload: unknown): VisibilityModelRow[] {
	if (!isRecord(payload) || !Array.isArray(payload.modelList)) return [];
	const rows: VisibilityModelRow[] = [];
	const seen = new Set<string>();
	for (const entry of payload.modelList) {
		if (!isRecord(entry)) continue;
		const provider = typeof entry.provider === "string" ? entry.provider : "";
		const id = typeof entry.id === "string" ? entry.id : "";
		if (!provider || !id) continue;
		const selector = `${provider}/${id}`;
		if (seen.has(selector)) continue;
		seen.add(selector);
		rows.push({
			provider,
			id,
			selector,
			name: typeof entry.name === "string" && entry.name ? entry.name : id,
			...(typeof entry.kind === "string" && entry.kind ? { kind: entry.kind } : {}),
			roles: Array.isArray(entry.roles)
				? entry.roles.filter((role): role is string => typeof role === "string")
				: [],
		});
	}
	return rows;
}

function parseHiddenModels(payload: unknown): string[] {
	if (!isRecord(payload) || !isRecord(payload.values)) return [];
	const value = payload.values.hiddenModels;
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string");
}

export interface VisibilityGatewaySnapshot {
	readonly models: ReadonlyArray<VisibilityModelRow>;
	readonly hiddenModels: ReadonlyArray<string>;
}

/** Read the gateway's available models and the shared hidden list. */
export async function loadVisibilitySnapshot(
	fetcher: GatewayFetch = defaultGatewayFetch,
): Promise<VisibilityGatewaySnapshot> {
	const [modelsPayload, settingsPayload] = await Promise.all([
		gatewayJson(fetcher, "/api/models"),
		gatewayJson(fetcher, "/api/settings/values?path=hiddenModels"),
	]);
	return {
		models: parseModels(modelsPayload),
		hiddenModels: parseHiddenModels(settingsPayload),
	};
}

/** Persist `hiddenModels` through the same settings route the CLI uses. */
export async function saveHiddenModels(
	selectors: ReadonlyArray<string>,
	fetcher: GatewayFetch = defaultGatewayFetch,
): Promise<void> {
	await gatewayJson(fetcher, "/api/settings", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ path: "hiddenModels", value: selectors }),
	});
}
