/* Bluetooth: Rolle (FTMS 0x1826, sonst Leistungsmesser 0x1818), Pulsgurt (0x180D), Trittfrequenzsensor (0x1816).
   Auswertung und Steuerung wie in der alten App. Verbunden wird ohne Auswahldialog: verbinden() sucht alles, was
   fehlt; welches Gerät genommen wird, entscheidet der Hauptprozess (gemerktes Gerät). */
import type { GeraetStand } from '../kern/typen';

type Art = 'rolle' | 'puls' | 'kadenz';
const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);

export class Geraete {
  stand: Record<Art, GeraetStand> = { rolle: 'aus', puls: 'aus', kadenz: 'aus' };
  name: Partial<Record<Art, string>> = {};
  private dev: Partial<Record<Art, any>> = {};
  private raw: { t: number; v: number }[] = [];
  private hr = 0; private tH = 0; private cad = 0; private tC = 0; private cadSeen = false;
  private cp: any = null; private ctrl = false; private denied = false; private busy = false;
  private sent: number | string | null = null; private tSent = 0;
  private cpQ: Promise<unknown> = Promise.resolve();
  private kurbel: Record<string, { rev: number; t: number; at: number } | null> = {};
  private sucht = false;

  /* ---------- Werte ---------- */
  private feed(r: { pow?: number; cad?: number; hr?: number }, src: Art) {
    const now = performance.now();
    if (fin(r.pow)) this.raw.push({ t: now, v: Math.max(0, r.pow) });
    if (fin(r.cad) && (src === 'kadenz' || this.stand.kadenz !== 'an')) { this.cad = r.cad; this.tC = now; if (r.cad > 0) this.cadSeen = true; }
    if (fin(r.hr) && r.hr > 0 && (src === 'puls' || this.stand.puls !== 'an')) { this.hr = r.hr; this.tH = now; }
    while (this.raw.length && now - this.raw[0].t > 5000) this.raw.shift();
  }
  private seit(ms: number): number | null { const now = performance.now(); let s = 0, n = 0; for (const x of this.raw) if (now - x.t <= ms) { s += x.v; n++; } return n ? s / n : null; }
  /* Angezeigte Leistung: Schnitt der letzten 2 s */
  get watt(): number | null { if (this.stand.rolle !== 'an') return null; const v = this.seit(2000); return v == null ? 0 : v; }
  /* Letzter gemeldeter Wert, ohne Glättung (für schnelle Entscheidungen wie den Abbruch im Countdown) */
  get wattJetzt(): number | null { const l = this.raw[this.raw.length - 1]; return this.stand.rolle === 'an' && l && performance.now() - l.t < 1500 ? l.v : this.stand.rolle === 'an' ? 0 : null; }
  /* Leistung für die Aufnahme: letzte gute Sekunde */
  get wattSekunde(): number { let v = this.seit(1100); if (v == null) v = this.seit(3000); return v == null ? 0 : Math.round(v); }
  get puls(): number | null { return this.hr && performance.now() - this.tH <= 5000 ? this.hr : null; }
  get kadenz(): number | null { return this.cadSeen && performance.now() - this.tC <= 3000 ? this.cad : null; }

  private onIBD = (e: any) => {
    const dv: DataView = e.target.value;
    try {
      const f = dv.getUint16(0, true); let o = 2; const r: { pow?: number; cad?: number; hr?: number } = {};
      if (!(f & 1)) o += 2;
      if (f & 2) o += 2;
      if (f & 4) { r.cad = Math.round(dv.getUint16(o, true) / 2); o += 2; }
      if (f & 8) { if (!(f & 4)) r.cad = Math.round(dv.getUint16(o, true) / 2); o += 2; }
      if (f & 16) o += 3;
      if (f & 32) o += 2;
      if (f & 64) { r.pow = dv.getInt16(o, true); o += 2; }
      if (f & 128) o += 2;
      if (f & 256) o += 5;
      if (f & 512) { r.hr = dv.getUint8(o); o += 1; }
      this.feed(r, 'rolle');
    } catch { /* kaputtes Paket überspringen */ }
  };
  /* Kurbelumdrehungen mit Zeitstempel (1/1024 s) → Trittfrequenz */
  private ausKurbel(key: string, rev: number, t: number): number | null {
    const now = performance.now(), L = this.kurbel[key]; let cad: number | null = null;
    if (L && rev !== L.rev) { const dr = (rev - L.rev + 65536) % 65536, dt = ((t - L.t + 65536) % 65536) / 1024; if (dt > 0 && dr < 10) cad = Math.round(dr / dt * 60); }
    else if (L && now - L.at > 2500) cad = 0;
    if (!L || rev !== L.rev) this.kurbel[key] = { rev, t, at: now };
    return cad;
  }
  private onCPM = (src: Art, mitWatt: boolean) => (e: any) => {
    const dv: DataView = e.target.value;
    try {
      const f = dv.getUint16(0, true); const r: { pow?: number; cad?: number } = {}; let o = 4;
      if (mitWatt) r.pow = dv.getInt16(2, true);
      if (f & 1) o += 1; if (f & 4) o += 2; if (f & 16) o += 6;
      if (f & 32) { const c = this.ausKurbel(src + 'p', dv.getUint16(o, true), dv.getUint16(o + 2, true)); if (c != null) r.cad = c; }
      this.feed(r, src);
    } catch { /* überspringen */ }
  };
  private onCSC = (src: Art) => (e: any) => {
    const dv: DataView = e.target.value;
    try {
      const f = dv.getUint8(0); let o = 1; if (f & 1) o += 6;
      if (f & 2) { const c = this.ausKurbel(src + 'c', dv.getUint16(o, true), dv.getUint16(o + 2, true)); if (c != null) this.feed({ cad: c }, src); }
    } catch { /* überspringen */ }
  };
  private onHRM = (e: any) => { const dv: DataView = e.target.value; try { const f = dv.getUint8(0); this.feed({ hr: f & 1 ? dv.getUint16(1, true) : dv.getUint8(1) }, 'puls'); } catch { /* überspringen */ } };
  private onCP = (e: any) => { const dv: DataView = e.target.value; try { if (dv.getUint8(0) === 0x80 && dv.getUint8(1) === 0x00 && dv.getUint8(2) !== 1) { this.ctrl = false; this.denied = true; } } catch { /* überspringen */ } };

  /* ---------- Verbinden ---------- */
  async verbinden() {
    const bt = navigator.bluetooth;
    if (this.sucht || !bt || !bt.requestDevice) return;
    this.sucht = true;
    try {
      for (const art of ['rolle', 'puls', 'kadenz'] as Art[]) {
        if (this.stand[art] !== 'aus') continue;
        if (this.dev[art]) { await this.aufbau(art); continue; }   // bekanntes Gerät: ohne Suche neu verbinden
        this.stand[art] = 'sucht';
        try {
          window.wattbuch.suche(art);
          const dev = await bt.requestDevice(art === 'rolle' ? { filters: [{ services: [0x1826] }, { services: [0x1818] }], optionalServices: [0x1826, 0x1818, 0x1816] }
            : art === 'puls' ? { filters: [{ services: ['heart_rate'] }] } : { filters: [{ services: [0x1816] }], optionalServices: [0x1816, 0x1818] });
          this.dev[art] = dev;
          dev.addEventListener('gattserverdisconnected', () => { this.stand[art] = 'aus'; if (art === 'rolle') { this.ctrl = false; this.cp = null; this.raw = []; } setTimeout(() => this.verbinden(), 2000); });
          await this.aufbau(art);
        } catch { this.stand[art] = 'aus'; }
      }
    } finally { this.sucht = false; }
  }
  private async aufbau(art: Art) {
    const dev = this.dev[art]; this.stand[art] = 'sucht';
    try {
      const srv = await dev.gatt.connect();
      const hoer = async (svc: number | string, chr: number | string, fn: (e: any) => void) => { const s = await srv.getPrimaryService(svc), c = await s.getCharacteristic(chr); c.addEventListener('characteristicvaluechanged', fn); await c.startNotifications(); return c; };
      if (art === 'rolle') {
        let ftms = false;
        try {
          await hoer(0x1826, 0x2ad2, this.onIBD); ftms = true;
          try { this.cp = await hoer(0x1826, 0x2ad9, this.onCP); this.ctrl = false; this.denied = false; this.sent = null; } catch { this.cp = null; }
        } catch { /* keine FTMS-Rolle */ }
        if (!ftms) { await hoer(0x1818, 0x2a63, this.onCPM('rolle', true)); this.cp = null; }
        else {
          /* manche Rollen schicken die Trittfrequenz über einen eigenen Dienst */
          let k = false;
          try { await hoer(0x1816, 0x2a5b, this.onCSC('rolle')); k = true; } catch { /* fehlt */ }
          if (!k) try { await hoer(0x1818, 0x2a63, this.onCPM('rolle', false)); } catch { /* fehlt */ }
        }
      } else if (art === 'puls') await hoer('heart_rate', 'heart_rate_measurement', this.onHRM);
      else { try { await hoer(0x1816, 0x2a5b, this.onCSC('kadenz')); } catch { await hoer(0x1818, 0x2a63, this.onCPM('kadenz', false)); } }
      this.name[art] = dev.name || ''; this.stand[art] = 'an';
    } catch { this.stand[art] = 'aus'; }
  }

  /* ---------- Steuerung (FTMS Control Point) ---------- */
  private cpWrite(bytes: number[]) {
    const cp = this.cp; if (!cp) return Promise.reject(new Error('keine Steuerung'));
    const d = new Uint8Array(bytes);
    const job = this.cpQ.catch(() => {}).then(() => cp.writeValueWithResponse ? cp.writeValueWithResponse(d) : cp.writeValue(d)).then(() => new Promise(r => setTimeout(r, 120)));
    this.cpQ = job; return job;
  }
  /* Steigung der Strecke (in Prozent, schon mit Steigungsstärke) oder feste Zielleistung an die Rolle.
     Beides zugleich geht nicht: erg gesetzt = Zielleistung, sonst Steigung. */
  async steuere(grade: number, erg: number | null = null) {
    if (this.stand.rolle !== 'an' || !this.cp || this.busy || this.denied) return;
    const now = performance.now();
    try {
      this.busy = true; let force = false;
      if (!this.ctrl) { await this.cpWrite([0x00]); if (this.denied) return; this.ctrl = true; await this.cpWrite([0x07]).catch(() => {}); force = true; }
      if (erg != null) {
        if (force || this.sent !== 'erg' + erg) { const t = Math.min(2000, Math.max(0, Math.round(erg))); await this.cpWrite([0x05, t & 255, (t >> 8) & 255]); this.sent = 'erg' + erg; this.tSent = now; }
      } else {
        const g = Math.round(grade * 10) / 10;
        if (force || typeof this.sent !== 'number' || Math.abs(g - this.sent) >= 0.2 || (now - this.tSent > 8000 && g !== this.sent)) {
          const gi = Math.round(g * 100) & 0xffff;   // 0,01 %, int16
          await this.cpWrite([0x11, 0, 0, gi & 255, (gi >> 8) & 255, 40, 51]);   // Wind 0, Crr 0,004, Cw 0,51
          this.sent = g; this.tSent = now;
        }
      }
    } catch { /* nächster Takt versucht es wieder */ }
    finally { this.busy = false; }
  }
}
