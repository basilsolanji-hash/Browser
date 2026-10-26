import json,re,collections
src=json.load(open('tr6/source.json')); rx=re.compile(r'%(\d+\$)?[sd%]')
ok=True
for l in ('uz','ky'):
    t=json.load(open(f'tr6/tr_{l}.json'))
    bad=[k for k in src if not t.get(k,'').strip()]
    ph=[k for k in src if collections.Counter(m.group(0) for m in rx.finditer(src[k]['en']))!=collections.Counter(m.group(0) for m in rx.finditer(t.get(k,'')))]
    ch=[k for k in t if ('\\' in t[k] or '"' in t[k])]
    ex=[k for k in src if (src[k]['en'].startswith('@') or src[k]['en'] in '+−—⋮') and t[k]!=src[k]['en']]
    print(l,'keys',len(t),'missing',len(set(src)-set(t)),'empty',bad,'placeholder_mismatch',ph,'bad_chars',ch,'symbols',ex)
    ok&=len(t)==601 and not bad and not ph and not ch and not ex
    L=open(f'tr6/phrases_{l}.txt',encoding='utf-8').read().split('\n')
    if L and L[-1]=='': L=L[:-1]
    print(l,'phrases lines',len(L),'empty',sum(1 for x in L if not x.strip()),'unique',len(set(L)))
    ok&=len(L)==300 and all(x.strip() for x in L) and len(set(L))==300
print('PASS' if ok else 'FAIL')
