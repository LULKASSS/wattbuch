/* Baut Wattbuch.app, packt sie als Zip und stellt sie als neues GitHub-Release bereit. Danach baut GitHub die
 * Windows-App (.github/workflows/windows.yml) und hängt sie an dasselbe Release.
 * Die Webseite verlinkt immer das jüngste Release (MAC_APP/WIN_APP in js/basis.js). Braucht gh (angemeldet). */
import { execSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sh = (c, o = {}) => execSync(c, { cwd: root, stdio: 'inherit', ...o });

sh('node scripts/check.mjs');
/* Versionsnummer hochzählen (1.0.4 → 1.0.5) und auf main bringen: daran erkennen installierte Apps die neue Version
   (desktop/selfupdate.js liest app-version.json aus dem jüngsten Release), und der Windows-Build baut dieselbe Nummer */
const pkgFile = join(root, 'package.json'), pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
const v = pkg.version.split('.').map(Number); v[2]++; pkg.version = v.join('.');
writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
sh(`git commit -q -m "App ${pkg.version}" package.json`);
sh('git push -q');
sh('npx electron-builder --mac --arm64 --dir', { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
const built = join(root, 'dist/mac-arm64/Wattbuch.app');
if (!existsSync(built)) { console.error('Build fehlgeschlagen: ' + built + ' fehlt'); process.exit(1); }
sh(`codesign --force --deep --sign - "${built}"`);
sh(`codesign --verify --deep --strict "${built}"`);
const zip = join(root, 'dist/Wattbuch-mac-arm64.zip'), ver = join(root, 'dist/app-version.json');
writeFileSync(ver, JSON.stringify({ version: pkg.version }));
rmSync(zip, { force: true });
sh(`ditto -c -k --keepParent "${built}" "${zip}"`);

const d = new Date(), p = n => String(n).padStart(2, '0');
const tag = `app-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
const notes = [
  'Wattbuch für Mac (Apple-Chip, M1 oder neuer) und Windows 10/11 (64 Bit). Die Windows-Datei kommt ein paar Minuten später dazu.',
  '',
  'Mac: Zip öffnen, Wattbuch.app in den Programme-Ordner ziehen. Die App ist nicht bei Apple beglaubigt: beim ersten Start „Fertig“ klicken, dann Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“.',
  'Windows: Installer starten. Bei „Der Computer wurde durch Windows geschützt“: „Weitere Informationen“ → „Trotzdem ausführen“.',
  '',
  'Danach Bluetooth erlauben und in den Einstellungen mit deinem Konto anmelden.'
].join('\n');
sh(`gh release create ${tag} "${zip}" "${ver}" --latest --target main --title "Wattbuch ${pkg.version} für Mac und Windows (${d.toLocaleDateString('de-DE')})" --notes-file -`, { input: notes, stdio: ['pipe', 'inherit', 'inherit'] });
sh('gh workflow run windows.yml --ref main');
console.log('✅ Mac bereit: https://github.com/LULKASSS/wattbuch/releases/latest/download/Wattbuch-mac-arm64.zip');
console.log('⏳ Windows wird auf GitHub gebaut (gh run watch), danach: …/releases/latest/download/Wattbuch-Setup-win-x64.exe');
