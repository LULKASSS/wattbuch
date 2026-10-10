/* Baut Wattbuch.app und legt sie in /Applications (oder ~/Applications, falls kein Schreibrecht).
 * Läuft die App gerade, wird sie vorher beendet und danach wieder geöffnet. */
import { execSync } from 'node:child_process';
import { existsSync, accessSync, constants, rmSync, cpSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sh = (c, o = {}) => execSync(c, { cwd: root, stdio: 'inherit', ...o });

sh('node scripts/check.mjs');
sh('npx electron-builder --mac --arm64 --dir', { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
const built = join(root, 'dist/mac-arm64/Wattbuch.app');
if (!existsSync(built)) { console.error('Build fehlgeschlagen: ' + built + ' fehlt'); process.exit(1); }
/* Ad-hoc signieren: ohne gültige Signatur startet die App auf Apple-Silicon-Macs nicht */
sh(`codesign --force --deep --sign - "${built}"`);
sh(`codesign --verify --deep --strict "${built}"`);

let dest = '/Applications';
try { accessSync(dest, constants.W_OK); } catch { dest = join(homedir(), 'Applications'); }
const target = join(dest, 'Wattbuch.app');
let wasRunning = false;
try { execSync('pgrep -f "Wattbuch.app/Contents/MacOS/Wattbuch"', { stdio: 'ignore' }); wasRunning = true; } catch {}
if (wasRunning) { try { execSync(`osascript -e 'quit app "Wattbuch"'`); execSync('sleep 2'); } catch {} }
rmSync(target, { recursive: true, force: true });
cpSync(built, target, { recursive: true, verbatimSymlinks: true });
console.log(`✅ Installiert: ${target}`);
if (wasRunning) execSync(`open "${target}"`);
