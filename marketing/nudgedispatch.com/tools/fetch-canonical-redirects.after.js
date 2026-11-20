// PROPOSED replacement for the path-resolution block in fetch().
// Keep the existing www->apex 301, method check, HeyCatch short links, and blog branch unchanged.
// Insert this in place of the two lines that set `path` and append `.html`.
// Do not copy SEC from preview workers: those add X-Robots-Tag: noindex, nofollow.

    // Homepage aliases should not stay in the index beside the canonical "/".
    if (url.pathname === '/index.html' || url.pathname === '/index') {
      url.pathname = '/';
      return Response.redirect(url.toString(), 301);
    }

    // Trailing slash on an inner page (currently 404) -> canonical .html URL.
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      const trimmed = url.pathname.slice(0, -1);
      if (A[trimmed + '.html'] || A[trimmed]) {
        url.pathname = A[trimmed + '.html'] ? trimmed + '.html' : trimmed;
        return Response.redirect(url.toString(), 301);
      }
    }

    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    // Extensionless alias (/trial, etc.) -> 301 to the sitemap/canonical .html URL.
    // Previously this was a silent rewrite that served the same HTML at two URLs with 200.
    if (!A[path] && A[path + '.html']) {
      url.pathname = path + '.html';
      return Response.redirect(url.toString(), 301);
    }
    const a = A[path];
    if (!a) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SEC } });
