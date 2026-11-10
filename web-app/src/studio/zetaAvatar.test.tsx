import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ZETA_CLUSTER_MIN_PX,
	ZetaAvatar,
	ZetaMarkFallback,
	zetaMarkSrc,
} from "./zetaAvatar";

describe("zetaMarkSrc", () => {
	test("16–24px use the single-tile fallback drawing", () => {
		expect(zetaMarkSrc(16).endsWith("/zeta-mark-16.svg")).toBe(true);
		expect(zetaMarkSrc(24).endsWith("/zeta-mark-16.svg")).toBe(true);
	});

	test("32px and up use the two-tile cluster", () => {
		expect(ZETA_CLUSTER_MIN_PX).toBe(32);
		expect(zetaMarkSrc(32).endsWith("/zeta-mark.svg")).toBe(true);
		expect(zetaMarkSrc(34).endsWith("/zeta-mark.svg")).toBe(true);
		expect(zetaMarkSrc(512).endsWith("/zeta-mark.svg")).toBe(true);
		expect(zetaMarkSrc(32).endsWith("zeta-mark-16.svg")).toBe(false);
	});
});

describe("ZetaAvatar", () => {
	test("renders the fallback drawing at 18px and stays decorative beside the name", () => {
		const html = renderToStaticMarkup(<ZetaAvatar size={18} decorative />);
		expect(html).toContain("<img");
		expect(html).toContain("/zeta-mark-16.svg");
		expect(html).toContain('alt=""');
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain('width="18"');
		expect(html).toContain('height="18"');
		expect(html).toContain('class="zeta-avatar"');
		expect(html).not.toContain("title=");
	});

	test("renders the cluster at banner size", () => {
		const html = renderToStaticMarkup(<ZetaAvatar size={34} decorative />);
		expect(html).toContain("/zeta-mark.svg");
		expect(html).toContain('width="34"');
	});

	test("carries the accessible name when it stands alone", () => {
		const html = renderToStaticMarkup(<ZetaAvatar />);
		expect(html).toContain('alt="Zeta"');
		expect(html).toContain('title="Zeta"');
		expect(html).not.toContain('aria-hidden="true"');
	});
});

describe("ZetaMarkFallback", () => {
	test("draws the self-contained single-tile mark", () => {
		const html = renderToStaticMarkup(<ZetaMarkFallback size={18} />);
		expect(html).toContain("<svg");
		expect(html).toContain('role="img"');
		expect(html).toContain('aria-label="Zeta"');
		expect(html).toContain("<title>Zeta</title>");
		expect(html).toContain("M368 368H128V128H368L224 368H368");
		expect(html).toContain("#2AC9C1");
	});

	test("is silent when the surrounding row already names Zeta", () => {
		const html = renderToStaticMarkup(<ZetaMarkFallback decorative />);
		expect(html).toContain('aria-hidden="true"');
		expect(html).not.toContain("<title>");
		expect(html).not.toContain('role="img"');
	});
});
