"""GA4 for Nudge (Nov 20, 2026, Jesse voice OK). Base = live nudge-sandbox 514b4832 (../publish/worker.js).
Adds gtag.js (G-KDG43ZJHVK) to all 7 HTML pages via external /ga-init.js (CSP has no 'unsafe-inline'),
and GA hosts to the Worker CSP header + per-page meta CSP. Nothing else changes."""
import json,re
MID='G-KDG43ZJHVK'
s=open('worker_base_514b4832.js').read()
st=s.index('const A = ')+10; en=s.index('\n',st)
line=s[st:en]; semi=';' if line.endswith(';') else ''
A=json.loads(line.rstrip(';')); assert json.dumps(A)+semi==line
def csp(c):
    c2=c.replace("img-src 'self'","img-src 'self' https://www.google-analytics.com https://www.googletagmanager.com",1)
    c2=c2.replace("script-src 'self' https://in.heycatch.ai https://static.cloudflareinsights.com","script-src 'self' https://in.heycatch.ai https://static.cloudflareinsights.com https://www.googletagmanager.com",1)
    c2=c2.replace("connect-src 'self' https://in.heycatch.ai https://cloudflareinsights.com","connect-src 'self' https://in.heycatch.ai https://cloudflareinsights.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",1)
    assert c2.count('googletagmanager')==3 and "default-src 'none'" in c2,c
    return c2
TAG=f'<script async src="https://www.googletagmanager.com/gtag/js?id={MID}"></script>\n<script src="/ga-init.js"></script>\n'
pages=[k for k in A if k.endswith('.html')]; assert len(pages)==7,pages
for k in pages:
    d=A[k]['d']
    m=re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">\n',d); assert m,k
    new=d[:m.start(1)]+csp(m.group(1))+d[m.end(1):m.end()]+TAG+d[m.end():]
    A[k]['d']=new
A['/ga-init.js']={'t':'text/javascript; charset=utf-8','b':False,'d':f"window.dataLayer = window.dataLayer || [];\nfunction gtag(){{dataLayer.push(arguments);}}\ngtag('js', new Date());\ngtag('config', '{MID}');\n"}
A=dict(sorted(A.items()))
out=s[:st]+json.dumps(A)+semi+s[en:]
m=re.search(r'const CSP = "([^"]*)"',out); out=out[:m.start(1)]+csp(m.group(1))+out[m.end(1):]
assert 'X-Robots-Tag' not in out and 'noindex' not in out and 'G-XXXX' not in out and 'G-L9F93MFNHG' not in out
assert out.count(MID)==8
open('worker.js','w').write(out); print('ok',len(out))
