/* Bäume rund um den Fahrer: Felder von 256 m, die mit der Fahrt entstehen und hinten wieder verschwinden. */
import * as THREE from 'three';
import type { Gelaende } from './gelaende';
import type { Naehe } from '../../kern/kurve';
import { rng } from './rauschen';

const FELD = 256;
export class Baeume {
  readonly group = new THREE.Group();
  private geo = new THREE.ConeGeometry(2.4, 9, 5);
  private mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 });
  private felder = new Map<string, THREE.InstancedMesh | null>();
  constructor(private gel: Gelaende, private nh: Naehe, private seed: number) {}

  private feld(cx: number, cz: number): THREE.InstancedMesh | null {
    const r = rng((cx * 73856093) ^ (cz * 19349663) ^ this.seed), d = new THREE.Object3D(), c = new THREE.Color(), list: [THREE.Matrix4, THREE.Color][] = [];
    for (let i = 0; i < 150; i++) {
      const x = (cx + r()) * FELD, z = (cz + r()) * FELD, s = .6 + r() * 1.1, rot = r() * 6, h = .70 + r() * .06, l = .07 + r() * .06;
      const w = this.gel.wald(x, z);
      if (w < .5 && r() > .1) continue;
      const [dd] = this.nh.nah(x, z);
      if (dd < 15) continue;
      d.position.set(x, this.gel.hoehe(x, z) + 4.3 * s, z); d.scale.setScalar(s); d.rotation.y = rot; d.updateMatrix();
      list.push([d.matrix.clone(), c.setHSL(h, .45, l).clone()]);
    }
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(this.geo, this.mat, list.length);
    list.forEach(([mx, col], i) => { m.setMatrixAt(i, mx); m.setColorAt(i, col); });
    m.frustumCulled = false; this.group.add(m);
    return m;
  }
  /* Felder im Umkreis halten, höchstens zwei neue pro Bild */
  update(x: number, z: number, radius: number) {
    const cx = Math.floor(x / FELD), cz = Math.floor(z / FELD), R = Math.ceil(radius / FELD); let neu = 0;
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      if (Math.hypot(a, b) * FELD > radius + FELD) continue;
      const key = (cx + a) + ',' + (cz + b);
      if (!this.felder.has(key) && neu < 2) { this.felder.set(key, this.feld(cx + a, cz + b)); neu++; }
    }
    for (const [key, m] of this.felder) {
      const [a, b] = key.split(',').map(Number);
      if (Math.hypot(a - cx, b - cz) * FELD > radius + FELD * 2.5) { if (m) { this.group.remove(m); m.dispose(); } this.felder.delete(key); }
    }
  }
  leeren() { for (const m of this.felder.values()) if (m) { this.group.remove(m); m.dispose(); } this.felder.clear(); }
  dispose() { this.leeren(); this.geo.dispose(); this.mat.dispose(); }
}
