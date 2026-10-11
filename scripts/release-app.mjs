/* Baut Wattbuch.app, packt sie als Zip und stellt sie als neues GitHub-Release bereit.
 * Die Webseite verlinkt immer das jüngste Release (MAC_APP in js/basis.js). Braucht gh (angemeldet). */
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sh = (c, o = {}) => execSync(c, { cwd: root, stdio: 'inherit', ...o });

sh('node scripts/check.mjs');
sh('npx electron-builder --mac --arm64 --dir', { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
const built = join(root, 'dist/mac-arm64/Wattbuch.app');
if (!existsSync(built)) { console.error('Build fehlgeschlagen: ' + built + ' fehlt'); process.exit(1); }
sh(`codesign --force --deep --sign - "${built}"`);
sh(`codesign --verify --deep --strict "${built}"`);
const zip = join(root, 'dist/Wattbuch-mac-arm64.zip');
rmSync(zip, { force: true });
sh(`ditto -c -k --keepParent "${built}" "${zip}"`);

const d = new Date(), p = n => String(n).padStart(2, '0');
const tag = `mac-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
const notes = [
  'Wattbuch für Mac (Apple-Chip, M1 oder neuer).',
  '',
  '1. Zip öffnen, Wattbuch.app in den Programme-Ordner ziehen und starten.',
  '2. Die App ist nicht bei Apple beglaubigt: beim ersten Start „Fertig“ klicken, dann Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“.',
  '3. Bluetooth erlauben, Einstellungen → Strava → „Mit Strava verbinden“.'
].join('\n');
sh(`gh release create ${tag} "${zip}" --latest --target main --title "Wattbuch für Mac (${d.toLocaleDateString('de-DE')})" --notes-file -`, { input: notes, stdio: ['pipe', 'inherit', 'inherit'] });
console.log('✅ Bereit: https://github.com/LULKASSS/wattbuch/releases/latest/download/Wattbuch-mac-arm64.zip');
