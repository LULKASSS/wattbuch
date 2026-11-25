/* Baut „Wattbuch Neu“ und legt sie in den Programme-Ordner, neben die alte Wattbuch.app (die bleibt unberührt). */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const run = c => execSync(c, { stdio: 'inherit' });
run('npm run check'); run('npx vite build'); run('npx electron-builder --mac --arm64 --dir');
const src = 'dist/mac-arm64/Wattbuch Neu.app', ziel = '/Applications/Wattbuch Neu.app';
if (!fs.existsSync(src)) throw new Error('Build fehlt: ' + src);
run(`codesign --force --deep --sign - "${src}"`);
try { execSync('osascript -e \'quit app "Wattbuch Neu"\'', { stdio: 'ignore' }); } catch {}
fs.rmSync(ziel, { recursive: true, force: true });
run(`cp -R "${src}" "${ziel}"`);
console.log('Installiert:', ziel);
