/**
 * Mounted AuthStepUpBoundary regression for the real browser bucket.
 *
 * This follows the existing `chromium-probe` + real-Chromium convention used by
 * the other `tools/browser-*` suites. The fixture server consumes one TOTP
 * step. A mounted boundary that verifies the code itself would make the wrapper
 * verify a second time (401) and never replay; the counters fail on that old
 * path.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import { acquireBrowser, releaseBrowser, type BrowserHandle } from "@linxiraos/zeta/tools/browser/registry";
import { chromiumAvailable } from "./chromium-probe";

const CHROMIUM_AVAILABLE = await chromiumAvailable();
const CODE = "123456";
const REPO_ROOT = resolve(import.meta.dir, "../../../..");

let browser: Browser | undefined;
let browserHandle: BrowserHandle | undefined;
let page: Page | undefined;
let base = "";
let server: Server<undefined> | undefined;
let bundleName = "";
let outdir = "";

const state = { verifyHits: 0, commandHits: 0, acceptedHits: 0, grant: 0, consumed: false };

function reset(): void {
	state.verifyHits = 0;
	state.commandHits = 0;
	state.acceptedHits = 0;
	state.grant = 0;
	state.consumed = false;
}

beforeAll(async () => {
	if (!CHROMIUM_AVAILABLE) return;
	await mkdir(join(REPO_ROOT, "temp"), { recursive: true });
	outdir = await mkdtemp(join(REPO_ROOT, "temp", "auth-stepup-browser-"));
	const build = await Bun.build({
		entrypoints: [join(REPO_ROOT, "web-app/src/studio/settings/__fixtures__/auth-stepup-browser.tsx")],
		outdir,
		target: "browser",
	});
	if (!build.success) throw new Error(build.logs.map(String).join("\n"));
	bundleName = build.outputs[0] ? basename(build.outputs[0].path) : "auth-stepup-browser.js";

	server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/") {
				return new Response(
					`<!doctype html><html><body><div id="root"></div><script type="module" src="/${bundleName}"></script></body></html>`,
					{ headers: { "content-type": "text/html" } },
				);
			}
			if (url.pathname === `/${bundleName}`) return new Response(Bun.file(join(outdir, bundleName)));
			if (url.pathname === "/api/auth/2fa/verify") {
				state.verifyHits += 1;
				const body = (await req.json()) as { code?: string };
				if (state.consumed || body.code !== CODE) {
					return Response.json({ error: "invalid code" }, { status: 401 });
				}
				state.consumed = true;
				state.grant = 1;
				return Response.json({ verifiedUntil: "fixture", method: "totp" });
			}
			if (url.pathname === "/api/v1/command") {
				state.commandHits += 1;
				if (state.grant > 0) {
					state.grant -= 1;
					state.acceptedHits += 1;
					return Response.json({ accepted: true }, { status: 202 });
				}
				return Response.json({ error: "totp_required", stepUp: true }, { status: 403 });
			}
			return new Response("missing", { status: 404 });
		},
	});
	base = `http://127.0.0.1:${server.port}`;
	browserHandle = await acquireBrowser({ kind: "headless", headless: true }, { cwd: REPO_ROOT });
	if (!("browser" in browserHandle)) throw new Error("Expected a Puppeteer browser");
	browser = browserHandle.browser;
});

afterEach(async () => {
	await page?.close().catch(() => {});
	page = undefined;
});

afterAll(async () => {
	if (browserHandle) await releaseBrowser(browserHandle, { kill: true }).catch(() => {});
	server?.stop(true);
	if (outdir) await rm(outdir, { recursive: true, force: true }).catch(() => {});
});

async function openPage(): Promise<Page> {
	const next = await browser!.newPage();
	page = next;
	const problems: string[] = [];
	next.on("pageerror", error => problems.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`));
	next.on("console", message => {
		if (message.type() === "error") problems.push(`console: ${message.text()}`);
	});
	next.on("requestfailed", request =>
		problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`),
	);
	try {
		await next.goto(base);
		try {
			await next.waitForSelector("#challenge", { timeout: 8_000 });
		} catch {
			throw new Error(`driver did not mount: ${problems.join(" | ")}`);
		}
		await next.click("#challenge");
		await next.waitForSelector("[data-auth-stepup]");
		return next;
	} catch (error) {
		await next.close().catch(() => {});
		page = undefined;
		throw error;
	}
}

async function submit(code: string): Promise<void> {
	await page!.type('input[autocomplete="one-time-code"]', code);
	await page!.click("[data-auth-stepup] .sec-actions button:first-of-type");
	await page!.waitForFunction("document.getElementById('status')?.textContent !== 'idle'", {
		timeout: 10_000,
	});
}

describe.skipIf(!CHROMIUM_AVAILABLE)("mounted AuthStepUpBoundary protocol", () => {
	beforeEach(() => reset());

	test("one consumed code verifies once and replays the protected command once", async () => {
		page = await openPage();
		await submit(CODE);
		expect(state.verifyHits).toBe(1);
		expect(state.commandHits).toBe(2);
		expect(state.acceptedHits).toBe(1);
		expect(await page.$eval("#status", element => element.textContent)).toBe("202");
	}, 30_000);

	test("a wrong code grants nothing and never replays", async () => {
		page = await openPage();
		await submit("000000");
		expect(state.verifyHits).toBe(1);
		expect(state.commandHits).toBe(1);
		expect(state.acceptedHits).toBe(0);
		expect(await page.$eval("#status", element => element.textContent)).toBe("403");
	}, 30_000);
});
