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

    // Serve static assets for main domain
    return env.ASSETS.fetch(request);
  },
};
