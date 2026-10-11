import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { JSONC, YAML } from "bun";
import { logger } from "@linxiraos/pi-utils";
import { type ModelsConfig, ModelsConfigSchema } from "./models-config-schema";

/**
 * Read-only compatibility with upstream OMP model configuration.
 *
 * Users migrating from OMP may already have model providers (`~/.zeta/agent/models.yml`)
 * and plaintext API keys (`~/.zeta/agent/agent.db`) on disk. This module probes
 * that upstream state without ever writing to it: the YAML file is only parsed
 * and the SQLite database is only opened in readonly mode. Anything the probe
 * finds is surfaced as an in-memory overlay by the model registry — no key is
 * ever persisted into Zeta's own config.
 *
 * Every failure mode is silent (debug log + "disabled"): the feature must be
 * zero-impact for machines without an upstream installation, and a corrupt or
 * half-migrated upstream state must never break Zeta startup.
 */

/** Minimum upstream agent.db auth schema version this probe understands. */
const OMP_AUTH_SCHEMA_VERSION = 8;

/** Short busy timeout (ms) for the readonly SQLite open — never block startup. */
const OMP_DB_BUSY_TIMEOUT_MS = 250;

export interface OmpCompatSnapshot {
	/** Validated upstream providers from `models.yml` (parsed with the same schema Zeta uses). */
	config: ModelsConfig;
	/** provider id → plaintext API key from upstream `agent.db` (`credential_type='api_key'`, not disabled). */
	credentialKeys: Record<string, string>;
}

/**
 * Upstream OMP agent directory. The upstream default root is fixed
 * (`~/.zeta/agent`); upstream env-var path variants are deliberately not
 * followed — this is a best-effort compatibility shim, not a full config merge.
 */
export function defaultOmpAgentDir(): string {
	return path.join(os.homedir(), ".zeta", "agent");
}

function parseOmpModelsConfig(content: string): ModelsConfig | undefined {
	let parsed: unknown;
	try {
		parsed = YAML.parse(content);
	} catch {
		try {
			parsed = JSONC.parse(content);
		} catch {
			return undefined;
		}
	}
	const checked = ModelsConfigSchema(parsed);
	if (checked instanceof Error) return undefined;
	return checked as ModelsConfig;
}

function loadOmpModelsConfig(agentDir: string): ModelsConfig | undefined {
	const ymlPath = path.join(agentDir, "models.yml");
	let content: string;
	try {
		content = fs.readFileSync(ymlPath, "utf8");
	} catch {
		return undefined;
	}
	const config = parseOmpModelsConfig(content);
	if (!config) {
		logger.debug("zeta compat: upstream models.yml unparsable; compatibility disabled", { path: ymlPath });
		return undefined;
	}
	return config;
}

function loadOmpSchemaVersion(db: Database): number | undefined {
	try {
		const row = db.query("SELECT * FROM auth_schema_version LIMIT 1").get() as
			| Record<string, unknown>
			| null
			| undefined;
		if (!row) return undefined;
		for (const value of Object.values(row)) {
			if (typeof value === "number") return value;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Read plaintext API-key credentials from the upstream agent.db, strictly
 * readonly. OAuth rows are never mapped (their refresh ecosystem — leases,
 * identity keys, blocks — cannot be replicated read-only), and soft-deleted
 * rows (`disabled_cause` set) are excluded. Missing table or an older schema
 * version means "nothing compatible" rather than an error.
 */
function loadOmpCredentialKeys(agentDir: string): Record<string, string> | undefined {
	const dbPath = path.join(agentDir, "agent.db");
	if (!fs.existsSync(dbPath)) return undefined;
	let db: Database | undefined;
	try {
		db = new Database(dbPath, { readonly: true });
		db.exec(`PRAGMA busy_timeout = ${OMP_DB_BUSY_TIMEOUT_MS}`);
		const tables = db
			.query("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_credentials'")
			.all() as { name: string }[];
		if (tables.length === 0) return undefined;
		const schemaVersion = loadOmpSchemaVersion(db);
		if (schemaVersion !== undefined && schemaVersion < OMP_AUTH_SCHEMA_VERSION) return undefined;
		const rows = db
			.query(
				"SELECT provider, data FROM auth_credentials WHERE credential_type='api_key' AND disabled_cause IS NULL",
			)
			.all() as { provider: string; data: string }[];
		const keys: Record<string, string> = {};
		for (const row of rows) {
			try {
				const parsed = JSON.parse(row.data) as { key?: unknown };
				if (typeof parsed.key === "string" && parsed.key) keys[row.provider] = parsed.key;
			} catch {
				// Undecodable credential row — skip it, keep the rest.
			}
		}
		return keys;
	} catch (error) {
		logger.debug("zeta compat: upstream agent.db unreadable; credentials not mapped", {
			path: dbPath,
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	} finally {
		// Close eagerly: on Windows an open handle keeps the db (and its WAL/SHM)
		// locked, which must never be the case for an upstream file we don't own.
		db?.close();
	}
}

/**
 * Probe the upstream OMP configuration. Returns `undefined` (feature fully
 * disabled, zero ongoing cost) when neither a parsable `models.yml` nor
 * compatible credentials exist.
 */
export function probeOmpCompat(agentDir: string = defaultOmpAgentDir()): OmpCompatSnapshot | undefined {
	if (!fs.existsSync(agentDir)) return undefined;
	const config = loadOmpModelsConfig(agentDir);
	const credentialKeys = loadOmpCredentialKeys(agentDir);
	if (!config && !credentialKeys) return undefined;
	return {
		config: config ?? { providers: {} },
		credentialKeys: credentialKeys ?? {},
	};
}
