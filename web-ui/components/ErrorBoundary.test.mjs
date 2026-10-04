import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	jsx: { runtime: "automatic" },
	tsconfigPaths: true,
});
const { ErrorBoundary } = await jiti.import("./ErrorBoundary.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderWithLocales(element) {
	return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

test("no-error state renders children untouched", () => {
	const boundary = new ErrorBoundary({ children: React.createElement("p", null, "workspace content") });
	const html = renderWithLocales(boundary.render());
	assert.match(html, /workspace content/);
	assert.doesNotMatch(html, /Something went wrong/);
});

test("error state swaps the whole tree for the recovery fallback", () => {
	const boundary = new ErrorBoundary({ children: React.createElement("p", null, "workspace content") });
	boundary.state = { error: new Error("render exploded") };
	const html = renderWithLocales(boundary.render());
	assert.match(html, /Something went wrong/);
	assert.match(html, /render exploded/);
	assert.match(html, /Reload/);
	// The crashed subtree must not leak into the fallback page.
	assert.doesNotMatch(html, /workspace content/);
});

test("getDerivedStateFromError promotes a thrown error into the fallback state", () => {
	const error = new Error("render exploded");
	assert.deepEqual(ErrorBoundary.getDerivedStateFromError(error), { error });
});

test("componentDidCatch records the error for diagnosis", () => {
	const errors = [];
	const originalError = console.error;
	console.error = (...args) => errors.push(args);
	try {
		const boundary = new ErrorBoundary({ children: null });
		boundary.componentDidCatch(new Error("render exploded"), { componentStack: "\n    in <Bomb>" });
	} finally {
		console.error = originalError;
	}
	assert.ok(errors.some(args => String(args[1]).includes("render exploded")));
	assert.ok(errors.some(args => String(args[2] ?? "").includes("in <Bomb>")));
});
