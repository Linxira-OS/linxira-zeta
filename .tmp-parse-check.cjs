const ts = require("typescript");
const fs = require("node:fs");
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, "utf8");
  const r = ts.transpileModule(src, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const d = r.diagnostics ?? [];
  if (d.length) { d.forEach(x => console.log("ERR", x.code, x.messageText)); process.exitCode = 1; }
  else console.log(f, "parses OK");
}
