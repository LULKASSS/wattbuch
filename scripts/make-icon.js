/* Rendert desktop/icon.svg zu desktop/icon.png (1024 px, transparente Ecken).
 * Aufruf: npx electron scripts/make-icon.js */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const svg = fs.readFileSync(path.join(__dirname, '../desktop/icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  let frames = 0;
  win.webContents.on('paint', (_e, _dirty, img) => {
    if (++frames < 3) return; /* erst ein paar Bilder abwarten, bis alles gezeichnet ist */
    fs.writeFileSync(path.join(__dirname, '../desktop/icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG());
    console.log('desktop/icon.png geschrieben');
    app.quit();
  });
  win.webContents.setFrameRate(10);
  win.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden">${svg}<script>setInterval(()=>document.body.style.opacity=document.body.style.opacity==='1'?'0.999':'1',50)</script></body></html>`));
});
