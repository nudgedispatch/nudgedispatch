// Pure helpers for the public booking page shell (title, iOS home-screen name, HTML escaping).

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function bookingShortName(name) {
  const text = String(name || "").trim() || "Book a ride";
  if (text.length <= 12) return text;
  const first = text.split(/\s+/)[0];
  if (first.length >= 3 && first.length <= 12) return first;
  return text.slice(0, 12).trim();
}

export function applyBookingPageHtml(template, { jsSrc, companyName } = {}) {
  let html = String(template);
  if (jsSrc) html = html.replace('src="/book.js"', 'src="' + jsSrc + '"');
  const name = String(companyName || "").trim();
  if (!name) return html;
  const title = escapeHtml(name);
  const apple = escapeHtml(bookingShortName(name));
  html = html.replace(
    '<meta name="apple-mobile-web-app-title" content="Book a ride">',
    '<meta name="apple-mobile-web-app-title" content="' + apple + '">',
  );
  html = html.replace("<title>Book a ride</title>", "<title>" + title + "</title>");
  return html;
}
