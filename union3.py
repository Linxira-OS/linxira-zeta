import re, subprocess
def entries(text):
    out = {}
    i = 0
    while True:
        s = text.find("\t{\n", i)
        if s == -1: break
        depth = 0; j = s
        while j < len(text):
            if text[j] == "{": depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0: break
            j += 1
        block = text[s:j+1]
        m = re.search(r"needle:\s*(.+?),(?:\s*//.*)?\n", block)
        out.setdefault(m.group(1).strip() if m else "?", block)
        i = j+1
    return out
base = open("scripts/brand/brand-rules.ts", encoding="utf-8").read()
extra = entries(open("br-carryover.ts", encoding="utf-8").read())
have = entries(base)
missing = {k: v for k, v in extra.items() if k not in have}
print("carryover entries:", len(extra), "base:", len(have), "missing from base:", len(missing))
for k in list(missing)[:8]: print("  +", k[:80])
for k, blk in missing.items():
    is_re = k.startswith("/")
    anchor = "export const MUST_NOT_CONTAIN" if is_re else "export const MUST_CONTAIN"
    end = base.find("\n];", base.find(anchor))
    base = base[:end+1] + (blk if blk.endswith("\n") else blk+"\n") + base[end+1:]
base = re.sub(r"(?m)^\t\}$\n(?=\t\{)", "\t},\n", base)
open("scripts/brand/brand-rules.ts","w",encoding="utf-8").write(base)
print("written")
