#!/usr/bin/env bun
import { createRequire } from "node:module";
import * as path from "node:path";
import type ts from "../web-app/node_modules/typescript";

const root = path.resolve(import.meta.dir, "..");
const emitDesktop = process.argv.includes("--emit-desktop");
let failed = false;
for (const project of emitDesktop
	? ["desktop/tsconfig.json"]
	: ["web-app/tsconfig.app.json", "web-app/tsconfig.node.json", "desktop/tsconfig.json"]) {
	const file = path.join(root, project);
	// Each independent npm surface owns its compiler version and module resolver.
	const compiler = createRequire(path.join(path.dirname(file), "package.json"))("typescript") as typeof ts;
	const config = compiler.readConfigFile(file, compiler.sys.readFile);
	const parsed = compiler.parseJsonConfigFileContent(config.config, compiler.sys, path.dirname(file));
	const program = compiler.createProgram(parsed.fileNames, {
		...parsed.options,
		noEmit: !emitDesktop,
		incremental: false,
		composite: false,
	});
	const diagnostics = [
		...(config.error ? [config.error] : []),
		...parsed.errors,
		...compiler.getPreEmitDiagnostics(program),
	];
	if (diagnostics.length) {
		failed = true;
		console.error(
			compiler.formatDiagnosticsWithColorAndContext(diagnostics, {
				getCanonicalFileName: name => name,
				getCurrentDirectory: () => root,
				getNewLine: () => "\n",
			}),
		);
	} else if (emitDesktop) {
		const emitted = program.emit();
		if (emitted.emitSkipped || emitted.diagnostics.length) {
			failed = true;
			console.error(emitted.diagnostics);
		} else console.log(`${project}: emitted current desktop source`);
	} else console.log(`${project}: ${program.getSourceFiles().length} files clean`);
}
process.exitCode = failed ? 1 : 0;
