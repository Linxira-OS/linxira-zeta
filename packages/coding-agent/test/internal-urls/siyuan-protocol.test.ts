import { afterEach, describe, expect, test } from "bun:test";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import {
	parseSiyuanUrl,
	SiyuanProtocolHandler,
	setSiyuanConfigForTests,
	setSiyuanFetchForTests,
} from "../../src/internal-urls/siyuan-protocol";

const DOC_ID = "20210808180117-6v0mkxr";

interface RecordedCall {
	api: string;
	body: Record<string, unknown>;
	headers: Headers;
}

function mockSiyuan(handler: (call: RecordedCall) => unknown): RecordedCall[] {
	const calls: RecordedCall[] = [];
	setSiyuanFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
		const href = String(input);
		const api = href.replace("http://127.0.0.1:6806", "");
		const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
		const headers = new Headers(init?.headers);
		const call = { api, body, headers };
		calls.push(call);
		return new Response(JSON.stringify({ code: 0, msg: "", data: handler(call) }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch);
	return calls;
}

afterEach(() => {
	setSiyuanConfigForTests(undefined);
	setSiyuanFetchForTests(undefined);
});

describe("parseSiyuanUrl", () => {
	test("parses notebooks, documents, ops, and search", () => {
		expect(parseSiyuanUrl("siyuan://").kind).toBe("notebooks");
		expect(parseSiyuanUrl(`siyuan://doc/${DOC_ID}`)).toMatchObject({ kind: "doc", id: DOC_ID });
		expect(parseSiyuanUrl(`siyuan://doc/${DOC_ID}?op=outline`)).toMatchObject({ kind: "doc-op", op: "outline" });
		expect(parseSiyuanUrl(`siyuan://doc/${DOC_ID}?op=append`)).toMatchObject({ kind: "doc-op", op: "append" });
		expect(parseSiyuanUrl("siyuan://search?q=hello")).toMatchObject({ kind: "search", query: "hello" });
	});

	test("rejects unsupported URLs", () => {
		expect(() => parseSiyuanUrl("siyuan://elsewhere")).toThrow(/Unsupported siyuan:\/\//);
		expect(() => parseSiyuanUrl("siyuan://search")).toThrow(/requires a 'q'/);
	});
});

describe("SiyuanProtocolHandler", () => {
	test("lists notebooks through the kernel API with the token header", async () => {
		setSiyuanConfigForTests({ enabled: true, token: "secret", url: "http://127.0.0.1:6806" });
		const calls = mockSiyuan(() => ({ notebooks: [{ id: "nb1", name: "Work" }] }));
		const handler = new SiyuanProtocolHandler();
		const resource = await handler.resolve(parseInternalUrl("siyuan://"));
		expect(resource.content).toContain("[Work](siyuan://notebook/nb1)");
		expect(calls[0]?.api).toBe("/api/notebook/lsNotebooks");
		expect(calls[0]?.headers.get("authorization")).toBe("Token secret");
	});

	test("reads a document as Markdown", async () => {
		setSiyuanConfigForTests({ enabled: true, token: "secret" });
		mockSiyuan(() => ({ hPath: "/Work/Architecture", content: "Body text" }));
		const handler = new SiyuanProtocolHandler();
		const resource = await handler.resolve(parseInternalUrl(`siyuan://doc/${DOC_ID}`));
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toBe("# /Work/Architecture\n\nBody text");
	});

	test("renders search results with document links", async () => {
		setSiyuanConfigForTests({ enabled: true, token: "secret" });
		mockSiyuan(() => ({ blocks: [{ id: DOC_ID, content: "hello world", hPath: "/Work/Hello" }] }));
		const handler = new SiyuanProtocolHandler();
		const resource = await handler.resolve(parseInternalUrl("siyuan://search?q=hello"));
		expect(resource.content).toContain(`[\/Work\/Hello](siyuan:\/\/doc\/${DOC_ID})`.replaceAll("\\", ""));
	});

	test("appends Markdown through the write hook", async () => {
		setSiyuanConfigForTests({ enabled: true, token: "secret" });
		const calls = mockSiyuan(() => ({ id: "newblock" }));
		const handler = new SiyuanProtocolHandler();
		const result = await handler.write(parseInternalUrl(`siyuan://doc/${DOC_ID}?op=append`), "Appended text");
		expect(calls[0]?.api).toBe("/api/block/appendBlock");
		expect(calls[0]?.body).toMatchObject({ dataType: "markdown", data: "Appended text", parentID: DOC_ID });
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain(DOC_ID);
	});

	test("refuses to resolve when disabled", async () => {
		setSiyuanConfigForTests({ enabled: false, token: "secret" });
		const handler = new SiyuanProtocolHandler();
		await expect(handler.resolve(parseInternalUrl("siyuan://"))).rejects.toThrow(/disabled/);
	});

	test("refuses network calls without a token", async () => {
		setSiyuanConfigForTests({ enabled: true, token: "" });
		mockSiyuan(() => ({}));
		const handler = new SiyuanProtocolHandler();
		await expect(handler.resolve(parseInternalUrl("siyuan://"))).rejects.toThrow(/requires an API token/);
	});
});
