/** plan-image — renders a markdown plan to PNG via Puppeteer, falls back to text. */

import { logger } from "@linxiraos/pi-utils";
import puppeteer from "puppeteer-core";

const HTML_TEMPLATE = [
	'<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>',
	"body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;background:#fff;padding:24px 32px;max-width:720px}",
	"h1{font-size:20px;border-bottom:1px solid #e0e0e0;padding-bottom:6px}",
	"h2{font-size:17px}",
	"pre,code{font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace;font-size:13px}",
	"pre{background:#f5f5f5;padding:10px 14px;border-radius:5px;overflow-x:auto}",
	"code{background:#f0f0f0;padding:1px 4px;border-radius:3px}",
	"ul,ol{padding-left:20px}",
	"li{margin-bottom:2px}",
	".plan-content{padding:8px 0}",
	'</style><body><div class="plan-content">',
	"{{CONTENT}}",
	"</div></body></html>",
].join("");

function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mdToHtml(md: string): string {
	let html = md
		.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => `<pre><code>${esc(code.trim())}</code></pre>`)
		.replace(/`([^`]+)`/g, (_, code) => `<code>${esc(code)}</code>`)
		.replace(/^### (.+)$/gm, "<h3>$1</h3>")
		.replace(/^## (.+)$/gm, "<h2>$1</h2>")
		.replace(/^# (.+)$/gm, "<h1>$1</h1>")
		.replace(/^[-*] (.+)$/gm, "<li>$1</li>")
		.replace(/^\d+\.\s(.+)$/gm, "<li>$1</li>")
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/\*(.+?)\*/g, "<em>$1</em>")
		.replace(/\n\n/g, "</p><p>");
	html = html.replace(/^([^<\n].*)$/gm, "<p>$1</p>");
	html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
	return html;
}

export interface PlanImageResult {
	pngData: Uint8Array | null;
	markdown: string;
}

export async function renderPlanToPng(markdown: string): Promise<PlanImageResult> {
	const html = HTML_TEMPLATE.replace("{{CONTENT}}", mdToHtml(markdown));

	let browser: import("puppeteer-core").Browser | null = null;
	try {
		browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
	} catch {
		logger.warn("Puppeteer launch failed (no Chromium binary?) — plan image degraded to text.");
		return { pngData: null, markdown };
	}

	try {
		const page = await browser.newPage();
		await page.setContent(html, { waitUntil: "load" });
		const screenshot = await page.screenshot({ type: "png", fullPage: true });
		await browser.close();
		return { pngData: new Uint8Array(screenshot), markdown };
	} catch (error) {
		if (browser) await browser.close().catch(() => {});
		logger.warn("Plan PNG screenshot failed; falling back to text.", {
			error: error instanceof Error ? error.message : String(error),
		});
		return { pngData: null, markdown };
	}
}
