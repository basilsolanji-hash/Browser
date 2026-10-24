// Мини-сервер dist/ под базовым путём, как на GitHub Pages: /Browser/… и 404.html на всё неизвестное.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain' };

export function serve(dist, base = '/Browser', port = 0) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!url.startsWith(base + '/') && url !== base) { res.writeHead(404); return res.end(); }
    let p = join(dist, url.slice(base.length));
    try {
      if ((await stat(p)).isDirectory()) {
        if (!url.endsWith('/')) { res.writeHead(301, { location: url + '/' }); return res.end(); }
        p = join(p, 'index.html');
      }
      let body = await readFile(p);
      const headers = { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' };
      // Текст сжимаем, как GitHub Pages, чтобы Lighthouse мерил то же, что увидит посетитель.
      if (/text|javascript|svg|json|xml/.test(headers['content-type']) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
        body = gzipSync(body);
        headers['content-encoding'] = 'gzip';
      }
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      return res.end(await readFile(join(dist, '404.html')));
    }
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

if (process.argv[1]?.endsWith('serve.mjs')) {
  const { origin } = await serve(new URL('../dist', import.meta.url).pathname, '/Browser', Number(process.argv[2] ?? 4321));
  console.log(origin + '/Browser/');
}
