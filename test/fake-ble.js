/* Simulierte Bluetooth-Geräte für Tests und Entwicklung.
 * Ersetzt navigator.bluetooth durch eine Rolle (FTMS), einen Pulsgurt und einen
 * Trittfrequenzsensor. Kommt nie in die App selbst: Playwright lädt sie per
 * addInitScript, der Dev-Server bei ?fake.
 *
 * Steuerung von außen über window.__fakeBle:
 *   set({power, cad, hr, speed})  Werte, die die Geräte senden
 *   writes                        alle Befehle an den Control Point (Arrays)
 *   ergTarget, grade              zuletzt gesetzte Zielleistung / Steigung
 *   drop('trainer'|'hr'|'cd')     Verbindung abreißen lassen
 *   refuseControl = true          Rolle verweigert die Steuerung
 *   noControl = true              Rolle ohne Control Point (vor dem Verbinden setzen)
 *   requests                      Filter aller requestDevice-Aufrufe
 *   fail = {name, message}        requestDevice schlägt so fehl
 *   cdViaPower = true             Kadenzsensor nur mit Leistungsdienst (vor dem Verbinden setzen)
 */
(() => {
  const SVC = { ftms: 0x1826, cps: 0x1818, hr: 0x180d, csc: 0x1816 };
  const CHR = { ibd: 0x2ad2, cp: 0x2ad9, hrm: 0x2a37, csc: 0x2a5b, cpm: 0x2a63 };
  const norm = u => (u === 'heart_rate' ? SVC.hr : u === 'heart_rate_measurement' ? CHR.hrm : u);

  const F = {
    vals: { power: 180, cad: 88, hr: 132, speed: 31.5 },
    writes: [], requests: [], ergTarget: null, grade: null,
    refuseControl: false, noControl: false, interval: 500,
    set(v) { Object.assign(F.vals, v); },
    drop(kind) { const d = devices[kind]; if (d) d._drop(); }
  };

  class Char extends EventTarget {
    constructor(uuid, dev) { super(); this.uuid = uuid; this.dev = dev; this.value = null; this.notifying = false; }
    async startNotifications() { this.notifying = true; return this; }
    async stopNotifications() { this.notifying = false; return this; }
    emit(bytes) {
      if (!this.notifying || !this.dev.gatt.connected) return;
      this.value = new DataView(new Uint8Array(bytes).buffer);
      this.dispatchEvent(new Event('characteristicvaluechanged'));
    }
    async writeValueWithResponse(data) {
      if (!this.dev.gatt.connected) throw new DOMException('GATT getrennt', 'NetworkError');
      const b = [...new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data)];
      F.writes.push(b);
      const op = b[0];
      if (op === 0x05) F.ergTarget = b[1] | (b[2] << 8);
      if (op === 0x11) { let g = b[3] | (b[4] << 8); if (g & 0x8000) g -= 0x10000; F.grade = g / 100; F.ergTarget = null; }
      const ok = !(op === 0x00 && F.refuseControl);
      setTimeout(() => this.emit([0x80, op, ok ? 0x01 : 0x05]), 20);
    }
    writeValue(d) { return this.writeValueWithResponse(d); }
  }

  class Service {
    constructor(uuid, chars) { this.uuid = uuid; this.chars = chars; }
    async getCharacteristic(u) {
      const c = this.chars[norm(u)];
      if (!c) throw new DOMException('Merkmal fehlt', 'NotFoundError');
      return c;
    }
  }

  class Device extends EventTarget {
    constructor(kind, name, makeServices) {
      super(); this.kind = kind; this.name = name; this.id = 'fake-' + kind;
      this.services = {};
      this._make = makeServices;
      const dev = this;
      this.gatt = {
        connected: false, device: dev,
        async connect() {
          await new Promise(r => setTimeout(r, 50));
          dev.services = dev._make(dev); this.connected = true; dev._start(); return this;
        },
        disconnect() { if (!this.connected) return; this.connected = false; dev._stop(); dev.dispatchEvent(new Event('gattserverdisconnected')); },
        async getPrimaryService(u) {
          const s = dev.services[norm(u)];
          if (!s) throw new DOMException('Dienst fehlt', 'NotFoundError');
          return s;
        }
      };
    }
    _start() { this._stop(); this._t = setInterval(() => this._send(), F.interval); }
    _stop() { clearInterval(this._t); }
    _drop() { this.gatt.disconnect(); }
  }

  /* Rolle: Indoor Bike Data mit Tempo, Trittfrequenz, Leistung, Puls */
  const trainer = new Device('trainer', 'Fake D100', dev => {
    dev.ibd = new Char(CHR.ibd, dev);
    const chars = { [CHR.ibd]: dev.ibd };
    if (!F.noControl) { dev.cp = new Char(CHR.cp, dev); chars[CHR.cp] = dev.cp; } else dev.cp = null;
    return { [SVC.ftms]: new Service(SVC.ftms, chars) };
  });
  trainer._send = function () {
    const v = F.vals, pow = F.ergTarget != null ? F.ergTarget : v.power;
    const spd = Math.round(v.speed * 100), cad = Math.round(v.cad * 2), p = Math.round(pow) & 0xffff;
    const flags = 0x04 | 0x40 | 0x200; /* Tempo (Bit 0 = 0), Trittfrequenz, Leistung, Puls */
    this.ibd.emit([flags & 255, flags >> 8, spd & 255, spd >> 8, cad & 255, cad >> 8, p & 255, p >> 8, v.hr & 255]);
  };

  /* Pulsgurt */
  const hrm = new Device('hr', 'Fake Pulsgurt', dev => {
    dev.c = new Char(CHR.hrm, dev);
    return { [SVC.hr]: new Service(SVC.hr, { [CHR.hrm]: dev.c }) };
  });
  hrm._send = function () { this.c.emit([0x00, F.vals.hr & 255]); };

  /* Trittfrequenzsensor: Kurbelumdrehungen mit Zeitstempel in 1/1024 s */
  /* cdViaPower = true: Sensor ohne Kadenzdienst, liefert Kurbeldaten nur über den Leistungsdienst */
  const cd = new Device('cd', 'Fake Kadenz', dev => {
    dev.rev = 0; dev.t = 0; dev.frac = 0;
    if (F.cdViaPower) { dev.c = new Char(CHR.cpm, dev); return { [SVC.cps]: new Service(SVC.cps, { [CHR.cpm]: dev.c }) }; }
    dev.c = new Char(CHR.csc, dev);
    return { [SVC.csc]: new Service(SVC.csc, { [CHR.csc]: dev.c }) };
  });
  cd._send = function () {
    const dt = F.interval / 1000, revs = F.vals.cad / 60 * dt + this.frac, whole = Math.floor(revs);
    this.frac = revs - whole;
    if (whole > 0) { this.rev = (this.rev + whole) & 0xffff; this.t = (this.t + Math.round(whole / (F.vals.cad / 60) * 1024)) & 0xffff; }
    if (F.cdViaPower) this.c.emit([0x20, 0x00, 0, 0, this.rev & 255, this.rev >> 8, this.t & 255, this.t >> 8]);
    else this.c.emit([0x02, this.rev & 255, this.rev >> 8, this.t & 255, this.t >> 8]);
  };

  const devices = { trainer, hr: hrm, cd };

  const bluetooth = {
    async getAvailability() { return true; },
    async requestDevice(opts) {
      F.requests.push(opts);
      if (F.fail) throw new DOMException(F.fail.message, F.fail.name); /* z. B. Bluetooth aus oder keine Erlaubnis */
      const svcs = (opts.filters || []).flatMap(f => f.services || []).map(norm);
      if (svcs.includes(SVC.csc)) return cd;
      if (svcs.includes(SVC.ftms) || svcs.includes(SVC.cps)) return trainer;
      if (svcs.includes(SVC.hr)) return hrm;
      throw new DOMException('Kein Gerät gefunden', 'NotFoundError');
    }
  };
  Object.defineProperty(navigator, 'bluetooth', { value: bluetooth, configurable: true });
  window.__fakeBle = F;
})();
