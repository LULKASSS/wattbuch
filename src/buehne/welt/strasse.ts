/* Straße der Welt: Asphaltband mit Markierung, Leitpfosten, Tore am größten Anstieg und am Ziel,
   dazu die Leuchtlinie, die in der Lobby die Strecke nachzeichnet. */
import * as THREE from 'three';
import type { Kurve } from '../../kern/kurve';
import { stelle } from '../../kern/kurve';

export const HALB = 4.2;
let asphalt: THREE.CanvasTexture | null = null;
function textur() {
  if (asphalt) return asphalt;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = '#1b1626'; g.fillRect(0, 0, 128, 256);
  let s = 7; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(255,255,255,' + (r() * .035) + ')'; g.fillRect(r() * 128, r() * 256, 2, 2); }
  g.fillStyle = '#FFB347'; g.fillRect(6, 0, 3, 256); g.fillRect(119, 0, 3, 256); g.fillStyle = '#F3E9D8'; g.fillRect(61, 24, 6, 110);
  const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return asphalt = t;
}
export function leuchtpunkt() {
  const sz = 128, c = document.createElement('canvas'); c.width = c.height = sz; const g = c.getContext('2d')!, gr = g.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,220,170,.7)'); gr.addColorStop(1, 'rgba(255,150,90,0)');
  g.fillStyle = gr; g.fillRect(0, 0, sz, sz); return new THREE.CanvasTexture(c);
}

export class Strasse {
  readonly group = new THREE.Group();
  private linie: THREE.ShaderMaterial;
  private mats: THREE.Material[] = [];

  constructor(k: Kurve, glow: THREE.Texture, tore: { s: number; farbe: number }[]) {
    const n = k.n, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = new Uint32Array((n - 1) * 6);
    for (let i = 0; i < n; i++) {
      const nx = -k.tz[i], nz = k.tx[i], y = k.y[i] + .12;
      pos.set([k.x[i] - nx * HALB, y, k.z[i] - nz * HALB, k.x[i] + nx * HALB, y, k.z[i] + nz * HALB], i * 6);
      uv.set([0, i * k.ds / 9, 1, i * k.ds / 9], i * 4);
      if (i < n - 1) { const a = i * 2; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const band = new THREE.Mesh(g, this.m(new THREE.MeshBasicMaterial({ map: textur(), side: THREE.DoubleSide }))); band.frustumCulled = false; this.group.add(band);

    /* Leuchtlinie: Breite kommt aus der Kameraentfernung, damit sie von weit oben sichtbar bleibt */
    const lp = new Float32Array(n * 6), lq = new Float32Array(n * 6), lu = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const nx = -k.tz[i], nz = k.tx[i];
      lp.set([k.x[i], k.y[i], k.z[i], k.x[i], k.y[i], k.z[i]], i * 6); lq.set([-nx, 0, -nz, nx, 0, nz], i * 6); lu.set([i / (n - 1), i / (n - 1)], i * 2);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('quer', new THREE.BufferAttribute(lq, 3)); lg.setAttribute('u', new THREE.BufferAttribute(lu, 1)); lg.setIndex(new THREE.BufferAttribute(idx, 1));
    this.linie = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { breite: { value: 6 }, hub: { value: 2 }, kopf: { value: 0 }, kraft: { value: 1 } },
      vertexShader: 'attribute vec3 quer;attribute float u;uniform float breite;uniform float hub;varying float vu;void main(){vu=u;vec4 mv=modelViewMatrix*vec4(position,1.);float b=breite*length(mv.xyz);vec3 p=position+quer*b+vec3(0.,hub+b*.3,0.);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
      fragmentShader: 'uniform float kopf;uniform float kraft;varying float vu;void main(){float gez=step(vu,kopf);float spur=gez*exp(-(kopf-vu)*9.);float aus=1.-smoothstep(1.05,1.35,kopf);vec3 c=vec3(1.,.70,.28)*(.34+.7*gez*aus)+vec3(1.,.9,.7)*spur*1.3*aus;gl_FragColor=vec4(c*kraft,1.);}'
    });
    const l = new THREE.Mesh(lg, this.m(this.linie)); l.frustumCulled = false; l.renderOrder = 5; this.group.add(l);

    /* Leitpfosten alle 35 m */
    const step = Math.max(1, Math.round(35 / k.ds)), posts = new THREE.InstancedMesh(new THREE.BoxGeometry(.22, 1.1, .22), this.m(new THREE.MeshBasicMaterial({ color: 0xff5c8a })), Math.ceil(n / step) * 2);
    const mt = new THREE.Matrix4(); let pi = 0;
    for (let i = 0; i < n; i += step) for (const s of [-1, 1]) { mt.makeTranslation(k.x[i] - k.tz[i] * 5 * s, k.y[i] + .55, k.z[i] + k.tx[i] * 5 * s); posts.setMatrixAt(pi++, mt); }
    posts.count = pi; posts.frustumCulled = false; this.group.add(posts);

    for (const t of tore) {
      const [i] = stelle(k, t.s), p = new THREE.Vector3(k.x[i], k.y[i], k.z[i]);
      const a = new THREE.Mesh(new THREE.TorusGeometry(7, .35, 8, 40, Math.PI), this.m(new THREE.MeshBasicMaterial({ color: t.farbe })));
      a.position.copy(p); a.lookAt(p.x + k.tx[i], p.y, p.z + k.tz[i]); this.group.add(a);
      const sp = new THREE.Sprite(this.m(new THREE.SpriteMaterial({ map: glow, color: t.farbe, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .5 })) as THREE.SpriteMaterial);
      sp.position.copy(p).y += 6; sp.scale.setScalar(46); this.group.add(sp);
    }
  }
  private m<T extends THREE.Material>(x: T): T { this.mats.push(x); return x; }
  /* kopf 0…1,35: wie weit die Linie gezeichnet ist; kraft 0…1: Helligkeit; breite in m */
  leuchte(kopf: number, kraft: number, breite: number) { const u = this.linie.uniforms; u.kopf.value = kopf; u.kraft.value = kraft; u.breite.value = breite; u.hub.value = 1; this.linie.visible = kraft > .01; }
  dispose() { this.group.traverse(o => { const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); }); for (const m of this.mats) m.dispose(); }
}
