import { afterEach, describe, expect, it, vi } from "bun:test";
import { parseHTML } from "@linxiraos/pi-utils/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setLocale, setUserLocale } from "../src/client/i18n";
import { useLocale } from "../src/client/i18n/useLocale";
import { OverviewRoute } from "../src/client/routes/OverviewRoute";
import type { OverviewStats } from "../src/client/types";

type FetchInput = string | URL | Request;
type FetchInit = RequestInit | BunFetchRequestInit;

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let root: Root | null = null;

function installGlobal(name: string, value: unknown): void {
	originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}

const emptyAggregate = {
	totalRequests: 1,
	successfulRequests: 1,
	failedRequests: 0,
	errorRate: 0,
	totalInputTokens: 10,
	totalOutputTokens: 5,
	totalCacheReadTokens: 3,
	totalCacheWriteTokens: 2,
	cacheRate: 0.3,
	cacheSavings: 0.1,
	totalCost: 0.01,
	unpricedRequests: 0,
	totalPremiumRequests: 0,
	avgDuration: 1_000,
	avgTtft: 200,
	avgTokensPerSecond: 5,
	firstTimestamp: Date.now() - 60_000,
	lastTimestamp: Date.now(),
};

const overviewStats: OverviewStats = {
	overall: emptyAggregate,
	byAgentType: [
		{ agentType: "main", ...emptyAggregate },
		{ agentType: "subagent", ...emptyAggregate },
	],
	timeSeries: [],
};

/** Mirrors the dashboard: the topbar switch re-renders `useLocale` subscribers. */
function Harness() {
	useLocale();
	return <OverviewRoute active range="24h" onRequestClick={() => {}} />;
}

afterEach(async () => {
	const activeRoot = root;
	if (activeRoot) {
		await act(async () => {
			activeRoot.unmount();
		});
		root = null;
	}
	setLocale("en");
	vi.restoreAllMocks();
	for (const [name, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
	originalGlobals.clear();
});

describe("stats locale rerender", () => {
	it("flips module-built labels after mounting in Chinese and switching to English", async () => {
		const domWindow = parseHTML('<html><body><div id="root"></div></body></html>').window;
		installGlobal("window", domWindow);
		installGlobal("document", domWindow.document);
		installGlobal("navigator", domWindow.navigator);
		installGlobal("Node", domWindow.Node);
		installGlobal("Element", domWindow.Element);
		installGlobal("HTMLElement", domWindow.HTMLElement);
		installGlobal("SVGElement", domWindow.SVGElement);
		installGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		installGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);

		const fetchStub = Object.assign(
			async (input: FetchInput, _init?: FetchInit) => {
				const url = input instanceof Request ? input.url : input.toString();
				if (url.includes("/api/stats/overview")) return Response.json(overviewStats);
				if (url.includes("/api/stats/recent")) return Response.json([]);
				return Response.json({});
			},
			{ preconnect: globalThis.fetch.preconnect },
		);
		vi.spyOn(globalThis, "fetch").mockImplementation(fetchStub);

		const container = domWindow.document.getElementById("root");
		if (!container) throw new Error("Expected test root");
		root = createRoot(container as unknown as Element);

		setLocale("zh-CN");
		await act(async () => {
			root?.render(<Harness />);
		});
		await act(async () => {
			await Bun.sleep(20);
		});

		const chinese = container.textContent ?? "";
		expect(chinese).toContain("请求");
		expect(chinese).toContain("主代理");
		expect(chinese).toContain("子代理");
		expect(chinese).toContain("未缓存输入");
		expect(chinese).toContain("缓存读取");

		await act(async () => {
			setUserLocale("en");
		});

		const english = container.textContent ?? "";
		expect(english).toContain("Requests");
		expect(english).toContain("Main agent");
		expect(english).toContain("Subagent");
		expect(english).toContain("Uncached input");
		expect(english).toContain("Cache read");
		expect(english).toContain("Cache write");
		for (const label of ["请求", "费用", "主代理", "子代理", "未缓存输入", "缓存读取", "缓存写入"]) {
			expect(english).not.toContain(label);
		}
	});
});
