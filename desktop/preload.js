/* Brücke zwischen Seite und Mac-App: Sicherung und Bluetooth-Geräteauswahl.
 * Die Seite merkt an window.wattbuchDesktop, dass sie in der App läuft. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wattbuchDesktop', {
  backup: json => ipcRenderer.invoke('backup:write', json),
  latestBackup: () => ipcRenderer.invoke('backup:latest'),
  backupDir: () => ipcRenderer.invoke('backup:dir'),
  pendingImports: () => ipcRenderer.invoke('import:pending'),
  importsDone: names => ipcRenderer.invoke('import:done', names),
  onUpdate: cb => ipcRenderer.on('update:ready', (_e, v) => cb(v))
});

/* Geräteauswahl: Chrome zeigt dafür ein eigenes Fenster, in Electron bauen wir es selbst.
 * Gleiche Optik wie die Dialoge der App (nutzt deren CSS-Variablen). */
let box = null, timer = null;
const css = `
#btPick{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(0,0,0,.38);backdrop-filter:blur(3px);font-family:Geist,system-ui,sans-serif}
#btPick .in{width:min(380px,calc(100vw - 32px));background:var(--surface,#fff);color:var(--fg,#111);border:1px solid var(--line,#ddd);border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
#btPick h2{margin:0 0 4px;font-size:17px;font-weight:600}
#btPick p{margin:0 0 14px;font-size:13px;color:var(--fg-3,#777)}
#btPick ul{list-style:none;margin:0 0 14px;padding:0;display:grid;gap:6px;max-height:280px;overflow:auto}
#btPick li button{width:100%;text-align:left;padding:11px 12px;border-radius:10px;border:1px solid var(--line,#ddd);background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer}
#btPick li button:hover{border-color:var(--accent,#7F5FE8);background:var(--accent-soft,rgba(127,95,232,.12))}
#btPick .scan{font-size:13px;color:var(--fg-3,#777);padding:6px 2px}
#btPick .scan i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent,#7F5FE8);margin-right:8px;animation:btp 1.2s ease-in-out infinite}
@keyframes btp{50%{opacity:.25}}
#btPick .cancel{float:right;padding:8px 14px;border-radius:10px;border:1px solid var(--line,#ddd);background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer}
`;

function close(id) {
  clearTimeout(timer);
  if (box) { box.remove(); box = null; }
  ipcRenderer.send('bt:choose', id || '');
}

function openBox() {
  if (box) return;
  if (!document.getElementById('btPickCss')) { const s = document.createElement('style'); s.id = 'btPickCss'; s.textContent = css; document.head.appendChild(s); }
  box = document.createElement('div');
  box.id = 'btPick';
  box.innerHTML = `<div class="in" role="dialog" aria-label="Gerät wählen"><h2>Gerät wählen</h2><p>Gerät wecken (in die Pedale treten), es erscheint hier.</p><ul></ul><div class="scan"><i></i>Suche läuft …</div><button type="button" class="cancel">Abbrechen</button></div>`;
  box.querySelector('.cancel').onclick = () => close('');
  box.addEventListener('click', e => { if (e.target === box) close(''); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape' && box) { document.removeEventListener('keydown', esc); close(''); } });
  document.body.appendChild(box);
  /* Nach 60 s ohne Wahl abbrechen, sonst hängt die Suche */
  timer = setTimeout(() => close(''), 60000);
}
ipcRenderer.on('bt:open', openBox);

ipcRenderer.on('bt:list', (_e, list) => {
  if (!box) openBox(); /* falls das Öffnen-Signal verloren ging */
  const ul = box.querySelector('ul');
  ul.replaceChildren(...list.map(d => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.textContent = d.name; b.onclick = () => close(d.id);
    li.appendChild(b); return li;
  }));
});
