/* Brücke zwischen den beiden Seiten und dem Hauptprozess. Beide Fenster bekommen dieselbe Brücke,
 * die Bühne (sichtbar) nutzt den oberen Teil, der Maschinenraum (unsichtbar) den unteren. */
const { contextBridge, ipcRenderer } = require('electron');
const auf = kanal => cb => { const f = (_e, x) => cb(x); ipcRenderer.on(kanal, f); return () => ipcRenderer.off(kanal, f); };

contextBridge.exposeInMainWorld('wattbuch', {
  /* Daten (lesen) */
  strecken: () => ipcRenderer.invoke('daten:strecken'),
  fahrten: () => ipcRenderer.invoke('daten:fahrten'),
  werte: () => ipcRenderer.invoke('daten:werte'),
  /* Bühne */
  befehl: b => ipcRenderer.send('b:befehl', b),
  aufZustand: auf('zustand'),
  aufEreignis: auf('ereignis'),
  aufVollbild: auf('vollbild'),
  bereit: () => ipcRenderer.send('b:bereit'),
  /* Maschinenraum */
  zustand: z => ipcRenderer.send('m:zustand', z),
  ereignis: e => ipcRenderer.send('m:ereignis', e),
  aufBefehl: auf('befehl'),
  streckeSpeichern: s => ipcRenderer.invoke('daten:strecke', s),
  rivale: (id, rev) => ipcRenderer.invoke('daten:rivale', id, rev),
  fahrtStart: kopf => ipcRenderer.send('m:start', kopf),
  sekunde: z => ipcRenderer.send('m:sekunde', z),
  fahrtFertig: r => ipcRenderer.invoke('m:fertig', r),
  fahrtWeg: () => ipcRenderer.send('m:weg'),
  laufend: () => ipcRenderer.invoke('daten:laufend'),
  suche: art => ipcRenderer.send('bt:suche', art)
});
