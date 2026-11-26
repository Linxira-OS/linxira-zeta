import { TtsrManager } from "./src/export/ttsr";
import { getCapability } from "./src/capability";
import { BUILTIN_DEFAULTS_PROVIDER_ID, ruleCapability, compileRuleCondition } from "./src/capability/rule";
import "./src/discovery";

const cap = getCapability<any>(ruleCapability.id);
const provider = cap?.providers.find((p: any) => p.id === BUILTIN_DEFAULTS_PROVIDER_ID);
const res = await provider.load({ cwd: "/tmp", home: "/tmp/home", repoRoot: null });
const rules = res.items;
console.log(
	"names",
	rules.map((r: any) => r.name),
);
for (const name of ["ts-no-test-timers", "ts-no-local-is-record", "ts-promise-with-resolvers"]) {
	const rule = rules.find((r: any) => r.name === name);
	console.log("RULE", name, JSON.stringify({ scope: rule?.scope, condition: rule?.condition }));
	const manager = new TtsrManager();
	console.log("add", manager.addRule(rule));
	const ctx = { source: "tool", toolName: "write", filePaths: ["packages/x/test/foo.test.ts"] };
	console.log(
		"check1",
		manager.checkDelta("await Bun.sleep(10)", ctx as any).map((r: any) => r.name),
	);
	manager.resetBuffer();
	console.log(
		"check2",
		manager.checkDelta("new Promise(resolve => { setTimeout(resolve, ms); });", {
			source: "tool",
			toolName: "write",
			filePaths: ["packages/x/src/foo.ts"],
		} as any).map((r: any) => r.name),
	);
}
try {
	console.log("compile", compileRuleCondition("Bun\\.sleep\\(")?.test?.("await Bun.sleep(10)"));
} catch (e) {
	console.log("compile err", e);
}
