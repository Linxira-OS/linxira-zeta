import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelsConfigImportDialog } from "./ModelsConfigImportDialog";

const noop = () => undefined;

describe("model configuration import dialog", () => {
	test("renders nothing while closed", () => {
		expect(renderToStaticMarkup(
			<ModelsConfigImportDialog open={false} busy={false} onClose={noop} onImport={noop} />,
		)).toBe("");
	});

	test("renders the whole-document import surface and both formats", () => {
		const html = renderToStaticMarkup(
			<ModelsConfigImportDialog open busy={false} onClose={noop} onImport={noop} />,
		);
		expect(html).toContain('role="dialog"');
		expect(html).toContain('aria-modal="true"');
		expect(html).toContain("<textarea");
		expect(html).toContain('aria-label="Import Model Configuration"');
		expect(html).toContain("Block-style YAML");
		expect(html).toContain("standard JSON");
		expect(html).toContain("providers:");
	});
});
