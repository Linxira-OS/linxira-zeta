import re, subprocess, sys
KEEP = re.compile(r"my\.omp\.sh|omp\.sh|\.omp\b|\.omp/|OMP_|__omp|\bomp-|omptype|omp compat|scl\.so|ompcast", re.I)
def bad_count(text):
    out = 0
    for line in text.split("\n"):
        if KEEP.search(line): continue
        out += len(re.findall(r"\bomp\b", line, re.I))
    return out
files = subprocess.run(["git","diff","--name-only","--diff-filter=U"],capture_output=True,text=True,encoding="utf-8").stdout.split()
report = []
for f in files:
    src = open(f, encoding="utf-8").read()
    blocks = re.findall(r"<<<<<<< [^\n]*\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]*\n", src, re.S|re.M)
    if not blocks:
        report.append((f,0,"NO-BLOCK")); continue
    decisions = []
    for ours, theirs in blocks:
        co, ct = bad_count(ours), bad_count(theirs)
        decisions.append("ours" if co < ct else ("theirs" if ct < co else "tie->ours"))
        report.append((f, f"{co}vs{ct}", decisions[-1]))
    # rebuild file with chosen sides
    def repl(m):
        ours, theirs = m.group(1), m.group(2)
        co, ct = bad_count(ours), bad_count(theirs)
        pick = ours if co <= ct else theirs
        return pick
    new = re.sub(r"<<<<<<< [^\n]*\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]*\n", repl, src, flags=re.S|re.M)
    open(f,"w",encoding="utf-8").write(new)
for r in report: print(*r, sep=" | ")
