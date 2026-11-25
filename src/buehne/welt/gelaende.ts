/* Gelände der Welt. Die Höhe ist eine reine Funktion der Stelle: erzeugte Hügel und Berge, die sich an die Straße
   schmiegen (an der Straße genau Straßenhöhe). Gezeichnet wird in Kacheln mit Stufen: nah fein (4 m), fern grob
   (bis 256 m). So passt eine 100-km-Strecke in echter Größe hinein, in der Lobby von weit oben wie in der Fahrt.
   Kacheln entstehen nach und nach (wenige pro Bild) und werden wieder freigegeben, wenn sie lange unsichtbar sind. */
import * as THREE from 'three';
import type { Kurve, Naehe } from '../../kern/kurve';
import { fbm, hash, lerp, smooth } from './rauschen';

const N = 16, ROOT = 4096, MIN = 64, RAND = 8000;
const cLow = new THREE.Color('#141032'), cMid = new THREE.Color('#4B2458'), cHi = new THREE.Color('#D9737C'), cTop = new THREE.Color('#FFD2A8');

interface Knoten { x: number; z: number; size: number; mesh: THREE.Mesh | null; kids: Knoten[] | null; gesehen: number; y: number }

export class Gelaende {
  readonly group = new THREE.Group();
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .95, metalness: 0 });
  private index: THREE.BufferAttribute;
  private roots: Knoten[] = [];
  private zeigt = new Set<THREE.Mesh>();
  private A: number; private B: number; private y0: number; private y1: number; private yMittel: number;
  private budget = 0; private uhr = 0; private fegen = 0;
  kacheln = 0;

  constructor(k: Kurve, private nh: Naehe, private seed: number) {
    const relief = k.max[1] - k.min[1];
    this.A = 60 + relief * .1; this.B = 240 + relief * .6;
    this.yMittel = (k.min[1] + k.max[1]) / 2;
    this.y0 = k.min[1] - 120 - this.A; this.y1 = k.max[1] + this.A * .6 + this.B * .55;
    /* gleiche Dreiecke für jede Kachel: (N+3)² Punkte, der äußere Ring hängt als Schürze nach unten und deckt Fugen */
    const M = N + 3, idx: number[] = [];
    for (let b = 0; b < M - 1; b++) for (let a = 0; a < M - 1; a++) { const i = b * M + a; idx.push(i, i + M, i + 1, i + 1, i + M, i + M + 1); }
    this.index = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    const x0 = Math.floor((k.min[0] - RAND) / ROOT), x1 = Math.ceil((k.max[0] + RAND) / ROOT), z0 = Math.floor((k.min[2] - RAND) / ROOT), z1 = Math.ceil((k.max[2] + RAND) / ROOT);
    for (let a = x0; a < x1; a++) for (let b = z0; b < z1; b++) { const n = this.knoten(a * ROOT, b * ROOT, ROOT); this.baue(n); this.roots.push(n); }
  }
  private knoten(x: number, z: number, size: number): Knoten { return { x, z, size, mesh: null, kids: null, gesehen: 0, y: this.yMittel }; }

  /* Höhe an einer Stelle; cell = Maschenweite der Kachel (grobe Kacheln lassen der Straße mehr Platz) */
  hoehe(x: number, z: number, cell = 4): number {
    const [dF, yF] = this.nh.fern(x, z);
    let d = dF, yN = yF;
    if (dF < 420) [d, yN] = this.nh.nah(x, z);
    const s = this.seed;
    const yRef = lerp(yF, this.yMittel, smooth(1500, 6000, dF));
    const hill = (fbm(x * .0011 + s, z * .0011) - .47) * this.A * (.22 + .78 * smooth(40, 900, d));
    const fein = (fbm(x * .007 + 3, z * .007 + 7) - .5) * 20 * smooth(8, 90, d);
    const berg = smooth(700, 3500, dF) * this.B * (.3 + fbm(x * .0004 + 9 + s, z * .0004 + 4));
    const flat = Math.max(6.5, 1.3 * cell), sink = .35 + .04 * cell;
    return lerp(yN - sink, yRef + hill + fein + berg, smooth(flat, flat + 110, d));
  }
  wald(x: number, z: number) { return fbm(x * .003 + 40, z * .003 + this.seed); }

  private baue(n: Knoten) {
    const M = N + 3, cell = n.size / N, pos = new Float32Array(M * M * 3), col = new Float32Array(M * M * 3), c = new THREE.Color();
    let sum = 0, o = 0;
    for (let b = 0; b < M; b++) for (let a = 0; a < M; a++) {
      const ia = Math.min(N, Math.max(0, a - 1)), ib = Math.min(N, Math.max(0, b - 1)), rand = a === 0 || b === 0 || a === M - 1 || b === M - 1;
      const x = n.x + ia * cell, z = n.z + ib * cell, y = this.hoehe(x, z, cell);
      pos[o] = x; pos[o + 1] = rand ? y - cell * .9 - 2 : y; pos[o + 2] = z;
      const t = Math.min(1, Math.max(0, (y - this.y0) / (this.y1 - this.y0)));
      c.copy(cLow).lerp(cMid, smooth(0, .35, t)).lerp(cHi, smooth(.3, .75, t)).lerp(cTop, smooth(.8, 1, t));
      const j = (1 + (hash(x * .37, z * .37) - .5) * .16) * (1 - .32 * smooth(.5, .62, this.wald(x, z)));
      col[o] = c.r * j; col[o + 1] = c.g * j; col[o + 2] = c.b * j;
      sum += y; o += 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(this.index);
    g.computeBoundingSphere();
    n.y = sum / (M * M);
    n.mesh = new THREE.Mesh(g, this.mat); n.mesh.visible = false; n.mesh.matrixAutoUpdate = false;
    this.group.add(n.mesh); this.kacheln++;
  }
  private weg(n: Knoten) {
    if (n.kids) { for (const k of n.kids) this.weg(k); n.kids = null; }
    if (n.mesh) { this.group.remove(n.mesh); n.mesh.geometry.dispose(); this.zeigt.delete(n.mesh); n.mesh = null; this.kacheln--; }
  }

  /* Jedes Bild: entscheiden, welche Kacheln zu sehen sind. K = wie früh verfeinert wird, sicht = Sichtweite */
  update(cam: THREE.Vector3, sy: number, K: number, sicht: number, dt: number) {
    this.budget = 10; this.uhr += dt;
    const neu = new Set<THREE.Mesh>();
    const besuch = (n: Knoten) => {
      const dx = Math.max(n.x - cam.x, 0, cam.x - n.x - n.size), dz = Math.max(n.z - cam.z, 0, cam.z - n.z - n.size), dy = cam.y - n.y * sy;
      const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
      n.gesehen = this.uhr;
      if (Math.hypot(dx, dz) > sicht) return;
      if (n.size > MIN && dist < n.size * K) {
        if (!n.kids) { const h = n.size / 2; n.kids = [this.knoten(n.x, n.z, h), this.knoten(n.x + h, n.z, h), this.knoten(n.x, n.z + h, h), this.knoten(n.x + h, n.z + h, h)]; }
        let fertig = true;
        for (const k of n.kids) if (!k.mesh) { if (this.budget > 0) { this.baue(k); this.budget--; } else fertig = false; }
        if (fertig) { for (const k of n.kids) besuch(k); return; }
      }
      neu.add(n.mesh!);
    };
    for (const r of this.roots) besuch(r);
    for (const m of this.zeigt) if (!neu.has(m)) m.visible = false;
    for (const m of neu) m.visible = true;
    this.zeigt = neu;
    /* alle 3 s: Kacheln freigeben, die 20 s nicht gebraucht wurden */
    if (this.uhr - this.fegen > 3) {
      this.fegen = this.uhr;
      const fege = (n: Knoten) => { if (!n.kids) return; if (n.kids.every(k => this.uhr - k.gesehen > 20)) { for (const k of n.kids) this.weg(k); n.kids = null; } else for (const k of n.kids) fege(k); };
      for (const r of this.roots) fege(r);
    }
  }
  dispose() { for (const r of this.roots) this.weg(r); this.mat.dispose(); }
}
