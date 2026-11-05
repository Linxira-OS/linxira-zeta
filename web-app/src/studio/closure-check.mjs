import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const seeds = [
 "conversation/ConversationVirtualList.tsx","conversation/ConversationItemView.tsx","conversation/ConvoTranscript.tsx",
 "conversation/ConversationPane.tsx","conversation/ConversationMinimap.tsx","conversation/ConversationSkeleton.tsx",
 "conversation/ConversationEmpty.tsx","conversation/ActivityLine.tsx","conversation/activityStatus.ts",
 "conversation/activityHeatmap.ts","conversation/ToolBody.tsx","conversation/toolMeta.ts","conversation/bashDisplay.ts",
 "conversation/UserMessageBody.tsx","conversation/TurnDiffCard.tsx","conversation/ChangesPanel.tsx",
 "conversation/NumericMarkdownTable.tsx","conversation/LazyMermaid.tsx","conversation/compactSummary.ts",
 "conversation/rowHeightCache.ts","conversation/conversationReflow.ts","conversation/conversationViewModel.ts",
 "conversation/conversationViews.ts","conversation/textChunks.tsx","conversation/sessionDiff.ts",
 "composer/ChipComposer.tsx","composer/CommandMenu.tsx","composer/MentionMenu.tsx","composer/ImagePreview.tsx",
 "composer/RuntimeQueueBar.tsx","MessageQueueBar.tsx","composer/commands.ts","composer/mentions.ts",
 "composer/serialize.ts","composer/types.ts","composer/editorDom.ts","composer/ingest.ts","composer/dispatch.ts","composer/queueEdit.ts",
];
const seen = new Set(); const external = new Map();
const isTest = p => /\.test\.tsx?$/.test(p) || /(^|\/)(test|preview|recordings)\//.test(p) || /harness-entry/.test(p);
function resolve(spec, fromDir) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(fromDir, spec);
  for (const cand of [base, base+".ts", base+".tsx", base+".css", base+".json", base+"/index.ts", base+"/index.tsx"]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}
const stack = seeds.map(s => path.resolve(root, s));
while (stack.length) {
  const file = stack.pop();
  if (seen.has(file)) continue;
  if (isTest(file)) { external.set(path.relative(root,file), "TEST"); continue; }
  seen.add(file);
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
    const spec = m[1];
    if (spec.startsWith(".")) {
      const r = resolve(spec, path.dirname(file));
      if (r) { if (!seen.has(r)) stack.push(r); } else external.set("MISSING "+spec+" in "+path.relative(root,file), "MISSING");
    } else if (!spec.startsWith("@linxiraos/studio-")) {
      external.set(spec.split("/").slice(0, spec.startsWith("@")?2:1).join("/"), "PKG");
    } else external.set(spec, "STUDIO");
  }
  for (const m of src.matchAll(/import\("([^"]+)"\)/g)) {
    const spec = m[1];
    if (spec.startsWith(".")) { const r = resolve(spec, path.dirname(file)); if (r && !seen.has(r)) stack.push(r); }
  }
}
console.log("INTERNAL", seen.size);
console.log([...seen].map(f=>path.relative(root,f)).sort().join("\n"));
console.log("EXTERNAL");
console.log([...external.entries()].map(([k,v])=>`${v}\t${k}`).sort().join("\n"));
