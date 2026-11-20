"""SEO fix publish build (Nov 20, 2026). Base = LIVE nudge-sandbox version 0935b165 (deployment 864e3520),
worker_live_0935b165.js downloaded from Cloudflare API (byte-identical to site_allpages_nov19/publish/worker.js).
Changes: small-fleet page (../src overlay), sitemap.xml (../src), worker 301 redirects. No GA4, no CSP, no noindex."""
import json
s=open('worker_live_0935b165.js').read()
st=s.index('const A = ')+10; en=s.index('\n',st)
line=s[st:en]; semi=';' if line.endswith(';') else ''
A=json.loads(line.rstrip(';'))
assert json.dumps(A)+semi==line,'roundtrip mismatch'
old_sf=A['/small-fleet-dispatch-software.html']['d']
allp=open('../../site_allpages_nov19/src/small-fleet-dispatch-software.html').read()
assert old_sf==allp,'live small-fleet != allpages src'
A['/small-fleet-dispatch-software.html']['d']=open('../src/small-fleet-dispatch-software.html').read()
print('old sitemap:\n'+A['/sitemap.xml']['d'])
A['/sitemap.xml']['d']=open('../src/sitemap.xml').read()
out=s[:st]+json.dumps(A)+semi+s[en:]
before="""    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!A[path] && A[path + '.html']) path += '.html';
"""
after=open('../worker/fetch-canonical-redirects.after.js').read()
after=after[after.index("    // Homepage aliases"):after.index("    const a = A[path];")]
assert out.count(before)==1,out.count(before)
out=out.replace(before,after)
assert 'X-Robots-Tag' not in out and 'noindex' not in out and 'G-XXXX' not in out and 'googletagmanager' not in out
open('worker.js','w').write(out); print('ok', len(out))
