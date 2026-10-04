import { BUILTIN_SLASH_COMMAND_DEFS, resolveCommandDescription } from "../packages/coding-agent/src/slash-commands/builtin-registry";
import { en } from "../packages/coding-agent/src/i18n/en";
import { zh } from "../packages/coding-agent/src/i18n/zh";
const ev = new Set(Object.values(en).filter((v): v is string => typeof v === "string"));
const zv = new Set(Object.values(zh).filter((v): v is string => typeof v === "string"));
for (const cmd of BUILTIN_SLASH_COMMAND_DEFS) {
  const d = resolveCommandDescription(cmd.description);
  if (!ev.has(d) && !zv.has(d)) console.log(`/${cmd.name}\t${JSON.stringify(d)}`);
  for (const sub of cmd.subcommands ?? []) {
    const sd = resolveCommandDescription(sub.description);
    if (!ev.has(sd) && !zv.has(sd)) console.log(`/${cmd.name} ${sub.name}\t${JSON.stringify(sd)}`);
  }
}
