# Проверка переводов 6 новых языков: все ключи, подстановки, символы, по 300 уникальных фраз.
import json, re, collections, os, sys
S = os.path.dirname(os.path.abspath(__file__))
NEW = ["be", "uz", "ky", "tg", "kk", "hy"]
src = json.load(open(f"{S}/source.json", encoding="utf-8")); rx = re.compile(r'%(\d+\$)?[sd%]')
ph = lambda s: collections.Counter(m.group(0) for m in rx.finditer(s))
ok = True
# source.json должен покрывать все ключи Tr*.kt (включая многострочные listOf).
import glob
kt = set(re.findall(r'"([a-z0-9_]+)" to listOf\(', "".join(open(f, encoding="utf-8").read() for f in glob.glob(f"{S}/../../app/src/main/java/ru/multibrowser/Tr*.kt"))))
print('Tr*.kt keys', len(kt), 'not in source.json', sorted(kt - set(src)))
ok &= kt <= set(src)
for l in NEW:
    t = json.load(open(f"{S}/tr_{l}.json", encoding="utf-8"))
    bad = [k for k in src if not t.get(k, '').strip()]
    pm = [k for k in src if ph(src[k]['en']) != ph(t.get(k, ''))]
    ch = [k for k in t if ('\\' in t[k] or '"' in t[k])]
    ex = [k for k in src if (src[k]['en'].startswith('@') or src[k]['en'] in '+−—⋮') and t[k] != src[k]['en']]
    os_ = [k for k in src if 'Ось' in src[k]['ru'] and 'Ось' not in t[k] and 'Ос' not in t[k]]
    print(l, 'keys', len(t), 'missing', len(set(src) - set(t)), 'empty', bad, 'placeholder_mismatch', pm, 'bad_chars', ch, 'symbols', ex, 'no_brand', os_)
    ok &= len(t) == len(src) and not bad and not pm and not ch and not ex and not os_
    L = open(f"{S}/phrases_{l}.txt", encoding="utf-8").read().split('\n')
    if L and L[-1] == '': L = L[:-1]
    print(l, 'phrases lines', len(L), 'empty', sum(1 for x in L if not x.strip()), 'unique', len(set(L)))
    ok &= len(L) == 300 and all(x.strip() for x in L) and len(set(L)) == 300
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
