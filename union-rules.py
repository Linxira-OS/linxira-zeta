import re
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
        m2 = re.search(r"file:\s*\"([^\"]+)\"", block)
        key = (m.group(1).strip() if m else "?", m2.group(1) if m2 else "")
        out.setdefault(key, block)
        i = j+1
    return out
ours = open("temp/br-ours.ts", encoding="utf-8").read()
theirs = open("temp/br-theirs.ts", encoding="utf-8").read()
eo, et = entries(ours), entries(theirs)
missing = {k:v for k,v in et.items() if k not in eo}
print("ours entries:", len(ours and eo), "theirs:", len(et), "theirs-only:", len(missing))
for k in list(missing)[:5]: print("  +", k[0][:70])
# insert theirs-only entries before the closing `];` of the LAST array (MUST_NOT_CONTAIN) or the array that holds the key
def array_of(text, needle):
    idx = text.find(needle)
    start = text.rfind("export const", 0, idx)
    end = text.find("\n];", idx)
    name = text[start:start+60]
    return start, end, name
new = ours
for k, blk in missing.items():
    needle = k[0]
    if needle in new: continue
    # find the array that contains similar entries: MUST_NOT_CONTAIN if needle starts with '/', else MUST_CONTAIN
    is_re = needle.startswith("/") or needle.startswith("RegExp")
    anchor = "export const MUST_NOT_CONTAIN" if is_re else "export const MUST_CONTAIN"
    end = new.find("\n];", new.find(anchor))
    if end == -1:
        print("!! anchor not found for", needle[:50]); continue
    block = blk if blk.endswith("\n") else blk + "\n"
    new = new[:end+1] + block + new[end+1:]
open("scripts/brand/brand-rules.ts","w",encoding="utf-8").write(new)
print("written")
