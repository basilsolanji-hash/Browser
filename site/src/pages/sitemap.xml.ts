// sitemap.xml с hreflang для всех языков.
import type { APIRoute } from 'astro';
import { LANGS, PAGES, href } from '../lib/i18n';

export const GET: APIRoute = ({ site }) => {
  const abs = (p: string) => site!.toString().replace(/\/$/, '') + p;
  const urls = PAGES.flatMap((p) => LANGS.map((l) => `<url><loc>${abs(href(l, p))}</loc>${LANGS.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${abs(href(a, p))}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${abs(href('en', p))}"/></url>`));
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml' } });
};
