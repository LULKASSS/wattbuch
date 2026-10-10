/* Schreibt manifest.json: Prüfsummen aller Dateien, die die App ausmacht (index.html, app.css, js/).
 * Die Mac-App vergleicht beim Start mit dem Manifest der Webseite und lädt Neues nach.
 * Aufruf: node scripts/manifest.mjs   (npm run check meldet, wenn es veraltet ist) */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export async function build(root = ROOT) {
  const files = ['index.html', 'app.css', ...(await readdir(root + 'js')).filter(f => f.endsWith('.js')).sort().map(f => 'js/' + f)];
  const out = {};
  for (const f of files) out[f] = createHash('sha256').update(await readFile(root + f)).digest('hex');
  const version = createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 12);
  return { manifest: 'wattbuch-web', version, files: out };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const m = await build();
  await writeFile(ROOT + 'manifest.json', JSON.stringify(m, null, 1) + '\n');
  console.log(`manifest.json geschrieben (Version ${m.version}, ${Object.keys(m.files).length} Dateien)`);
}
