import { handlePortal } from './portal-app/portal.js';
import { ga4SyncAll } from './portal-app/ga4.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ga4SyncAll(env));
  },
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
      const dest = hostname.startsWith('g7.') ? target : target + url.pathname + url.search;
      return Response.redirect(dest, 301);
    }

    // Staging (testing.octaloop.com / workers.dev): never indexable
    const isStaging = hostname === 'testing.octaloop.com' || hostname.endsWith('.workers.dev');
    if (isStaging && url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' },
      });
    }

    // Client portal (/portal/) — only active where D1/KV bindings exist (staging for now)
    if (url.pathname === '/portal' || url.pathname.startsWith('/portal/')) {
      const pr = await handlePortal(request, env);
      if (pr) return pr;
    }

    // IBT microsite moved to its own domain
    if (url.pathname === '/indiablockchaintour' || url.pathname === '/indiablockchaintour/') {
      return Response.redirect('https://indiablockchaintour.com/', 301);
    }

    // Former slug for the new-domain AEO guide
    if (url.pathname === '/blog/aeo-new-startups' || url.pathname === '/blog/aeo-new-startups/') {
      const dest = new URL('/blog/aeo-for-new-startups/', url);
      dest.search = url.search;
      return Response.redirect(dest.toString(), 301);
    }

    let res;
    try {
      res = await env.ASSETS.fetch(request);
    } catch (e) {
      res = null;
    }

    if (!res || res.status === 404 || res.status >= 500) {
      let body = 'Page not found';
      let headers = { 'content-type': 'text/plain; charset=utf-8' };
      try {
        const nf = await env.ASSETS.fetch(new Request(new URL('/404.html', url), { redirect: 'manual' }));
        if (nf.ok) { body = await nf.text(); headers = { 'content-type': 'text/html; charset=utf-8' }; }
        else {
          const nf2 = await env.ASSETS.fetch(new Request(new URL('/404', url)));
          if (nf2.ok) { body = await nf2.text(); headers = { 'content-type': 'text/html; charset=utf-8' }; }
        }
      } catch (e) {}
      res = new Response(body, { status: 404, headers });
    } else if (res.status === 307 || res.status === 308 || res.status === 302) {
      // Make asset-normalisation redirects permanent
      const loc = res.headers.get('location');
      if (loc) res = new Response(null, { status: 301, headers: { location: loc } });
    }

    if (isStaging) {
      res = new Response(res.body, res);
      res.headers.set('x-robots-tag', 'noindex, nofollow');
    }
    return res;
  },
};
