// LIVE (nudge-sandbox deployment 8151938f) relevant fetch lines.
// www already 301s to apex. Extensionless paths are rewritten in memory
// and served as 200, which creates duplicate URLs.
    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!A[path] && A[path + '.html']) path += '.html';
    const a = A[path];
    if (!a) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SEC } });
