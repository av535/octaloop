export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hostname = url.hostname;

    // Subdomain redirects — 301 permanent
    const subdomainRedirects = {
      'metamorphosis.octaloop.com':      'https://metamorphosisconf.com',
      'metamorphosis24.octaloop.com':    'https://metamorphosisconf.com',
      'test.metamorphosis.octaloop.com': 'https://metamorphosisconf.com',
      'g7.octaloop.com':                 'https://octaloop.com',
    };

    const target = subdomainRedirects[hostname];
    if (target) {
      // Preserve path + query for metamorphosis domains, drop for g7
      const dest = hostname.startsWith('g7.')
        ? target
        : target + url.pathname + url.search;
      return Response.redirect(dest, 301);
    }

    // Browsers request /favicon.ico by default; the published tree only has PNG icons.
    if (url.pathname === '/favicon.ico') {
      url.pathname = '/assets/images/wp-content/themes/octaloop/assets/images/Favicon.png';
      request = new Request(url.toString(), request);
    }

    // Missing assets previously threw (Cloudflare 1101) instead of a clean 404.
    try {
      return await env.ASSETS.fetch(request);
    } catch {
      return new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  },
};
