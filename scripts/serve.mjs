/* Lokaler Server für die Entwicklung: http://localhost:5173
 * Mit ?fake wird die simulierte Rolle (test/fake-ble.js) eingeblendet,
 * dann geht alles ohne echte Geräte. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = +(process.env.PORT || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.gpx': 'application/gpx+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root) || file.includes('node_modules')) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    if (path === '/index.html' && url.searchParams.has('fake'))
      body = body.toString().replace('<head>', '<head>\n<script src="/test/fake-ble.js"></script>');
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('nicht gefunden');
  }
}).listen(port, '127.0.0.1', () => console.log(`Wattbuch läuft auf http://localhost:${port}  (mit simulierter Rolle: http://localhost:${port}/?fake)`));
