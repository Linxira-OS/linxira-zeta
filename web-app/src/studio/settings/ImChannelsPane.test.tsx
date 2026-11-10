import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BindingsTable, RuntimeChip, WechatQrFrame } from "./ImChannelsPane";
import type { ChatBinding } from "./imChannelsApi";

const noop = (_row: ChatBinding): void => undefined;

describe("WeChat QR frame", () => {
	test("the gateway's SVG is what the pane draws", () => {
		const qr = { pending: true, qrcodeUrl: "https://liteapp.weixin.qq.com/q/abc", status: "wait", svg: '<svg viewBox="0 0 21 21"></svg>' };
		const html = renderToStaticMarkup(<WechatQrFrame qr={qr} stage="pending" />);
		expect(html).toContain('data-qr="svg"');
		expect(html).toContain("<svg");
		expect(html).not.toContain("<img");
	});

	test("an image payload is shown as an image, not re-encoded", () => {
		const qr = { pending: true, qrcodeUrl: "data:image/png;base64,AAAA", status: "wait" };
		const html = renderToStaticMarkup(<WechatQrFrame qr={qr} stage="pending" />);
		expect(html).toContain("<img");
		expect(html).toContain("data:image/png;base64,AAAA");
		expect(html).not.toContain('data-qr="svg"');
	});

	test("no pending login shows the stage word", () => {
		const html = renderToStaticMarkup(<WechatQrFrame qr={{ pending: false }} stage="unbound" />);
		expect(html).toContain("im-qr-placeholder");
		expect(html).not.toContain("<svg");
		expect(html).not.toContain("<img");
	});
});

describe("runtime chip", () => {
	test("each runtime word is a distinct, stable state hook", () => {
		const html = ["running", "stopped", "error"].map(state =>
			renderToStaticMarkup(<RuntimeChip state={state as "running" | "stopped" | "error"} />),
		);
		expect(html[0]).toContain('data-state="running"');
		expect(html[1]).toContain('data-state="stopped"');
		expect(html[2]).toContain('data-state="error"');
		expect(html[2]).toContain("red");
		expect(new Set(html).size).toBe(3);
	});
});

describe("bindings table", () => {
	test("an empty list explains how to create a binding instead of showing headers", () => {
		const html = renderToStaticMarkup(<BindingsTable rows={[]} onEdit={noop} onRemove={noop} />);
		expect(html).toContain('class="im-empty"');
		expect(html.includes("<table")).toBe(false);
		expect(html.length).toBeGreaterThan(20);
	});

	test("rows show the target, keep unknown fields, and mark agentId unavailable", () => {
		const rows: ChatBinding[] = [
			{ platform: "feishu", chatId: "oc_1", workspaceAlias: "alpha", userId: "ou_1", lang: "zh", label: "kept" },
			{ platform: "telegram", chatId: "42", sessionId: "s1" },
		];
		const html = renderToStaticMarkup(<BindingsTable rows={rows} onEdit={noop} onRemove={noop} />);
		expect(html.includes("<table")).toBe(true);
		const tableBody = /<tbody>([\s\S]*)<\/tbody>/.exec(html)?.[1] ?? "";
		expect(tableBody.match(/<tr[\s>]/g)?.length).toBe(2);
		expect(html).toContain("oc_1");
		expect(html).toContain("alpha");
		expect(html).toContain('data-unavailable="agent"');
		expect(/1 other field|保留 1 个其他字段/.test(html)).toBe(true);
		expect(html).not.toContain("agentId");
	});

	test("a pending write disables the row actions", () => {
		const rows: ChatBinding[] = [{ platform: "wechat", chatId: "wx", workspaceAlias: "alpha" }];
		const html = renderToStaticMarkup(<BindingsTable rows={rows} onEdit={noop} onRemove={noop} disabled />);
		expect(html.match(/disabled/g)?.length).toBe(2);
	});
});
