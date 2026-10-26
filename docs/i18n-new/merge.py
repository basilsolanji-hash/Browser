# Дописать 6 языков (be, uz, ky, tg, kk, hy) в конец каждой строки listOf(...) в Tr*.kt и фразы в assets.
import re, glob, json, sys, os
S = os.path.dirname(os.path.abspath(__file__))
NEW = ["be", "uz", "ky", "tg", "kk", "hy"]
tr = {l: json.load(open(f"{S}/tr_{l}.json", encoding="utf-8")) for l in NEW}
def esc(v): return v.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$")
os.chdir(os.path.join(S, "..", ".."))
for f in glob.glob("app/src/main/java/ru/multibrowser/Tr*.kt"):
    s = open(f, encoding="utf-8").read()
    def rep(m):
        key, body = m.group(2), m.group(3)
        vals = re.findall(r'"((?:[^"\\]|\\.)*)"', body)
        if len(vals) != 10: return m.group(0)
        add = ", ".join('"%s"' % esc(tr[l][key]) for l in NEW)
        return f'{m.group(1)}"{key}" to listOf({body}, {add}){m.group(4)}'
    s2 = re.sub(r'^(\s+)"([a-z0-9_]+)" to listOf\((.*)\)(,?\s*)$', rep, s, flags=re.M)
    open(f, "w", encoding="utf-8").write(s2)
for l in NEW:
    lines = open(f"{S}/phrases_{l}.txt", encoding="utf-8").read().splitlines()
    lines = [x.strip() for x in lines if x.strip()]
    assert len(lines) == 300, (l, len(lines))
    open(f"app/src/main/assets/phrases/{l}.txt", "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("merged")
