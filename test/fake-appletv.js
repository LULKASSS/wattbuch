/* Nachgestelltes Apple-TV-Hilfsprogramm für die Tests (statt desktop/appletv.py mit pyatv).
 * Spricht dasselbe JSON-Zeilen-Protokoll. Ein Gerät „Wohnzimmer“, Koppeln mit zwei Codes (1234, dann 5678).
 * Jede gedrückte Taste landet als Zeile in der Protokolldatei (zweites Argument). */
const fs = require('node:fs');
const [store, logFile] = process.argv.slice(2);
const emit = m => process.stdout.write(JSON.stringify(m) + '\n');
let step = 0, connected = false, state = 'playing';
const play = () => emit({ ev: 'play', state, title: 'Testfolge', app: 'Testkino' });
const cmds = {
  scan: () => ({ devices: [{ id: 'ATV1', name: 'Wohnzimmer', model: 'Apple TV 4K' }] }),
  pair: () => { step = 1; return { protocol: 'AirPlay', pin: true }; },
  pin: ({ pin }) => {
    if (pin !== ['', '1234', '5678'][step]) throw new Error('Code stimmt nicht');
    if (step === 1) { step = 2; return { next: { protocol: 'Companion', pin: true } }; }
    step = 0; fs.writeFileSync(store, '{"gekoppelt":true}'); return { done: true };
  },
  cancel: () => { step = 0; return {}; },
  connect: () => { connected = true; emit({ ev: 'state', connected: true, name: 'Wohnzimmer' }); setTimeout(play, 10); return { name: 'Wohnzimmer' }; },
  key: ({ key }) => {
    if (!connected) throw new Error('Nicht verbunden');
    fs.appendFileSync(logFile, key + '\n');
    const s = { play: 'playing', pause: 'paused', play_pause: state === 'playing' ? 'paused' : 'playing' }[key];
    if (s) { state = s; setTimeout(play, 10); }
    return {};
  },
  disconnect: () => { connected = false; return {}; }
};
let buf = '';
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    try { emit({ id: req.id, ok: true, ...cmds[req.cmd](req) }); } catch (e) { emit({ id: req.id, ok: false, error: e.message }); }
  }
});
process.stdin.on('end', () => process.exit(0));
emit({ ev: 'ready' });
