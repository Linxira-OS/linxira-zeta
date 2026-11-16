import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/** Keep Bun/Node tests out of Vitest's DOM worker without dropping their gate. */
export function testFilesFor(runtime: "vitest" | "bun:test" | "node:test", root: string): string[] {
  const files: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.test\.(?:tsx?|mjs)$/.test(entry.name)) {
        const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, false);
        if (source.statements.some(statement => ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === runtime)) files.push(file.replaceAll("\\", "/"));
      }
    }
  }
  visit("src");
  return files.sort();
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const files = [...testFilesFor("bun:test", root), ...testFilesFor("node:test", root)];
  if (files.length === 0) throw new Error("No Bun/Node Studio contract tests discovered");
  const child = Bun.spawn([process.execPath, "test", "--tsconfig-override", "tsconfig.app.json", ...files], { cwd: root, stdin: "ignore", stdout: "inherit", stderr: "inherit", windowsHide: true });
  process.exitCode = await child.exited;
}
