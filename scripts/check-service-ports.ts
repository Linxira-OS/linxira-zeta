#!/usr/bin/env bun
/**
 * Guard Zeta's local service ports.
 *
 * A side-by-side OMP install owns 30141/30142/3847, and common tools squat on
 * 3000/3847/8080/8787. The canonical block lives in
 * `packages/utils/src/ports.ts`; every default must derive from it, and the
 * standalone Electron shell (which cannot import workspace packages) must
 * carry the same literals.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	ZETA_BROWSER_RELAY_PORT,
	ZETA_GATEWAY_PORT,
	ZETA_STATS_PORT,
	ZETA_WEB_PORT,
} from "../packages/utils/src/ports";

const ROOT = path.resolve(import.meta.dir, "..");
const PORTS = [ZETA_WEB_PORT, ZETA_GATEWAY_PORT, ZETA_STATS_PORT, ZETA_BROWSER_RELAY_PORT] as const;
const FORBIDDEN = new Set([3000, 3001, 3847, 5000, 8000, 8080, 8787, 9224]);
const EXPECTED = { web: 43141, gateway: 43143, stats: 43147, relay: 43153 } as const;

async function main(): Promise<void> {
	const failures: string[] = [];

	if (new Set(PORTS).size !== PORTS.length) failures.push("service ports must be distinct");
	if (PORTS.some(port => !Number.isInteger(port) || port < 1024 || port > 65535)) {
		failures.push("service ports must be unprivileged TCP ports");
	}
	if (PORTS.some(port => FORBIDDEN.has(port))) failures.push("service ports must avoid OMP/common defaults");
	const sorted = [...PORTS].sort((a, b) => a - b);
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i]! - sorted[i - 1]! < 2)
			failures.push(`service ports must be at least 2 apart: ${sorted.join(", ")}`);
	}
	if (
		ZETA_WEB_PORT !== EXPECTED.web ||
		ZETA_GATEWAY_PORT !== EXPECTED.gateway ||
		ZETA_STATS_PORT !== EXPECTED.stats ||
		ZETA_BROWSER_RELAY_PORT !== EXPECTED.relay
	) {
		failures.push(
			`canonical ports changed: update desktop/src/main.ts and this guard together (expected ${EXPECTED.web}/${EXPECTED.gateway}/${EXPECTED.stats}/${EXPECTED.relay})`,
		);
	}

	const desktop = await fs.readFile(path.join(ROOT, "desktop/src/main.ts"), "utf8");
	for (const [name, port] of [
		["WEB_UI_URL", EXPECTED.web],
		["STATS_URL", EXPECTED.stats],
	] as const) {
		const pattern = new RegExp(`const ${name} = "http://127\\.0\\.0\\.1:${port}";`);
		if (!pattern.test(desktop)) failures.push(`desktop/src/main.ts ${name} must use port ${port}`);
	}

	if (failures.length > 0) {
		for (const failure of failures) console.error(`check-service-ports: ${failure}`);
		process.exit(1);
	}
	console.log(`check-service-ports: ok (${PORTS.join(", ")})`);
}

await main();
