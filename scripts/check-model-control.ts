#!/usr/bin/env bun
/**
 * Model-control kernel guard (ADR-0102, REQ-152).
 *
 * Merge damage is the risk this exists for: an OMP merge can drop the Zeta-only
 * provider/fallback modules, the ADR row, or the roadmap phase without any
 * runtime test noticing. This gate pins the layer-1 surface and the paused
 * capability policy; behavior itself is covered by the two test files run in
 * the same CI step.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
	PAUSED_MODEL_CAPABILITIES,
	PRODUCT_MODEL_CAPABILITIES,
	isPausedCapability,
	isProductCapability,
} from "../packages/coding-agent/src/config/provider-capabilities";

const ROOT = path.resolve(import.meta.dir, "..");
const findings: string[] = [];

async function read(relative: string): Promise<string | undefined> {
	try {
		return await fs.readFile(path.join(ROOT, relative), "utf8");
	} catch {
		findings.push(`missing ${relative}`);
		return undefined;
	}
}

const adr = await read("document/adr/0102-layered-model-control-provider-fallback.md");
if (adr && !adr.includes("Layer 1 — provider/fallback kernel")) {
	findings.push("ADR-0102 lost the Layer 1 section");
}
const adrIndex = await read("document/adr/README.md");
if (adrIndex && !adrIndex.includes("0102-layered-model-control-provider-fallback.md")) {
	findings.push("document/adr/README.md is missing the ADR-0102 row");
}
const roadmap = await read("document/roadmap.md");
if (roadmap && !roadmap.includes("P0 — Model control, layer by layer")) {
	findings.push("document/roadmap.md is missing the model-control P0 phase");
}
const ledger = await read("document/requirements-ledger.md");
if (ledger && !ledger.includes("| REQ-152 |")) {
	findings.push("document/requirements-ledger.md is missing REQ-152");
}

for (const kind of PAUSED_MODEL_CAPABILITIES) {
	if ((PRODUCT_MODEL_CAPABILITIES as readonly string[]).includes(kind)) {
		findings.push(`paused capability ${kind} is exposed as a product capability`);
	}
	if (isProductCapability(kind)) findings.push(`isProductCapability accepts paused ${kind}`);
	if (!isPausedCapability(kind)) findings.push(`isPausedCapability rejects paused ${kind}`);
}
for (const kind of ["image", "judge", "rerank"] as const) {
	if (!isProductCapability(kind)) findings.push(`product capability ${kind} is not visible`);
}

if (findings.length > 0) {
	console.error("Model-control kernel guard failed:");
	for (const finding of findings) console.error(`- ${finding}`);
	process.exit(1);
}
console.log(
	`Model-control kernel OK: ${PRODUCT_MODEL_CAPABILITIES.length} product capabilities, ` +
		`${PAUSED_MODEL_CAPABILITIES.length} paused, ADR/roadmap/ledger present.`,
);
