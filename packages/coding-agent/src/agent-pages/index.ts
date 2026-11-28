/**
 * Agent pages — public surface.
 *
 * Pages are self-contained directories under the agent-pages root: a
 * `page.json` manifest, an HTML/ESM entry, and static files. The manifest
 * declares default-deny permissions and DAG workflows; the gateway serves the
 * inventory, one manifest at a time, the page's own static files, and a
 * workflow runner.
 */

export * from "./types";
export * from "./manifest";
export * from "./permissions";
export * from "./executor";
