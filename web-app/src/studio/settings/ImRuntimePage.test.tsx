import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImRuntimePage } from "./ImRuntimePage";

describe("IM runtime page shell", () => {
	test("renders the four contract tabs and no fabricated running state", () => {
		const html = renderToStaticMarkup(<ImRuntimePage visible initialTab="instances" />);
		expect(html).toContain('data-page="im-runtime"');
		expect(html).toContain('data-tab="instances"');
		expect(html).toContain('data-tab="bindings"');
		expect(html).toContain('data-tab="profiles"');
		expect(html).toContain('data-tab="bots"');
		// Effects do not run during SSR: every section must say loading, not invent data.
		expect(html).toContain("imr-empty");
		// No status chip can be green before the gateway answers.
		expect(html.includes('chip sm green')).toBe(false);
	});

	test("binding and profile tabs open on their own loading state", () => {
		const bindings = renderToStaticMarkup(<ImRuntimePage visible initialTab="bindings" />);
		expect(bindings).toContain('data-tab="bindings"');
		expect(bindings).toContain("imr-empty");

		const profiles = renderToStaticMarkup(<ImRuntimePage visible initialTab="profiles" />);
		expect(profiles).toContain('data-tab="profiles"');
		expect(profiles).toContain("imr-empty");
	});

	test("hidden pages render nothing", () => {
		expect(renderToStaticMarkup(<ImRuntimePage visible={false} />)).toBe("");
	});
});
