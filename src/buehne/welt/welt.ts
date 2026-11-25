/* Die Welt der Bühne: Himmel in der Dämmerung, Gelände, Straße, Fahrer, Rivale, Kamera.
   Lobby: Kamera kreist über der ganzen Runde, die Leuchtlinie zeichnet sie nach.
   Countdown: Sturzflug hinter den Fahrer. Fahrt: Kamera nah hinter ihm auf der rechten Spur. */
import * as THREE from 'three';
import type { Bahn } from '../../kern/strecke';
import { anstiege } from '../../kern/strecke';
import { kurve, naehe, stelle, type Kurve } from '../../kern/kurve';
import { Gelaende } from './gelaende';
import { Strasse, leuchtpunkt } from './strasse';
import { Baeume } from './baeume';
import { Guete } from './guete';
import { ich, geist, type Figur } from './fahrer';
import { lerp, rng, smooth } from './rauschen';

export type Akt = 'lobby' | 'count' | 'ride' | 'done';
export interface Bild { akt: Akt; s: number; v: number; cad: number | null; grade: number; gs: number | null; gv: number; pause: boolean; maus: [number, number] }

const SPUR = 2.1, clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const ease = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export class Welt {
  readonly renderer: THREE.WebGLRenderer;
  readonly guete = new Guete();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, .5, 9000);
  private himmel: THREE.Mesh; private sonne: THREE.Sprite; private sterne: THREE.Points;
  private sonneDir = new THREE.Vector3(-.55, .11, -.83).normalize();
  private glow = leuchtpunkt();
  private land = new THREE.Group();   // alles, was zur Strecke gehört (in der Lobby überhöht)
  private k: Kurve | null = null;
  private gel: Gelaende | null = null; private str: Strasse | null = null; private baum: Baeume | null = null;
  private me: Figur; private rivale: Figur;
  private wind: THREE.LineSegments; private wp: Float32Array; private ws: number[][] = [];
  private staub: THREE.Points; private mp: Float32Array;
  private camP = new THREE.Vector3(); private camL = new THREE.Vector3(); private tP = new THREE.Vector3(); private tL = new THREE.Vector3(); private oP = new THREE.Vector3(); private oL = new THREE.Vector3();
  private orbit = 2.2; private t0 = 0; private sturz = 0; private shift = .17; private fov = 38; private roll = 0; private sy = 1; private uhr = 0; private aktVor: Akt = 'lobby';
  private w = 1; private h = 1;
  tot = false;

  constructor(canvas: HTMLCanvasElement) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.tot = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.tot = false; });
    const sc = this.scene;
    sc.fog = new THREE.Fog(new THREE.Color('#A8566F'), 700, 3600);
    sc.add(this.camera);
    this.himmel = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: { h: { value: new THREE.Color('#F2A25C') }, m: { value: new THREE.Color('#8A2F62') }, z: { value: new THREE.Color('#0B0820') }, sun: { value: this.sonneDir } },
      vertexShader: 'varying vec3 d;void main(){d=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec3 d;uniform vec3 h;uniform vec3 m;uniform vec3 z;uniform vec3 sun;void main(){float y=clamp(d.y,-.2,1.);vec3 c=mix(h,m,smoothstep(0.,.22,y));c=mix(c,z,smoothstep(.12,.7,y));float s=max(dot(normalize(d),sun),0.);c+=vec3(1.,.62,.3)*pow(s,6.)*.55+vec3(1.,.85,.6)*pow(s,90.)*.9;c=mix(c,h*.55,smoothstep(0.,-.2,d.y));gl_FragColor=vec4(c,1.);}'
    }));
    this.himmel.renderOrder = -10; this.himmel.frustumCulled = false; sc.add(this.himmel);
    this.sonne = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffe2b0, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, depthTest: false }));
    this.sonne.renderOrder = -9; sc.add(this.sonne);
    { const g = new THREE.BufferGeometry(), a: number[] = [], rr = rng(9);
      for (let i = 0; i < 700; i++) { const u = rr() * 6.28, v = .12 + rr() * .88, q = Math.sqrt(1 - v * v); a.push(Math.cos(u) * q, v, Math.sin(u) * q); }
      g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      this.sterne = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff2dd, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: .8, depthWrite: false, depthTest: false }));
      this.sterne.renderOrder = -8; this.sterne.frustumCulled = false; sc.add(this.sterne); }
    sc.add(new THREE.HemisphereLight(0x8a5fb0, 0x140a1e, .95));
    const dl = new THREE.DirectionalLight(0xffa868, 2.4); dl.position.copy(this.sonneDir).multiplyScalar(100); sc.add(dl);
    sc.add(this.land);
    this.me = ich(this.glow); this.rivale = geist(); sc.add(this.me.group, this.rivale.group);

    /* Fahrtwind-Linien und Staub an der Kamera */
    const WIND = 64, wg = new THREE.BufferGeometry(); this.wp = new Float32Array(WIND * 6);
    { const rr = rng(4); for (let i = 0; i < WIND; i++) { let x = (rr() - .5) * 34; x += Math.sign(x) * 6; this.ws.push([x, (rr() - .25) * 14, -rr() * 70]); } }
    wg.setAttribute('position', new THREE.BufferAttribute(this.wp, 3));
    this.wind = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xffe6c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.wind.frustumCulled = false; this.camera.add(this.wind);
    const MOTE = 80, mg = new THREE.BufferGeometry(); this.mp = new Float32Array(MOTE * 3);
    { const rr = rng(12); for (let i = 0; i < MOTE; i++) { this.mp[i * 3] = (rr() - .5) * 46; this.mp[i * 3 + 1] = (rr() - .3) * 14; this.mp[i * 3 + 2] = -rr() * 70; } }
    mg.setAttribute('position', new THREE.BufferAttribute(this.mp, 3));
    this.staub = new THREE.Points(mg, new THREE.PointsMaterial({ map: this.glow, color: 0xffd9a8, size: .42, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.staub.frustumCulled = false; this.camera.add(this.staub);
    this.groesse();
  }

  groesse() {
    const c = this.renderer.domElement; this.w = c.clientWidth || innerWidth; this.h = c.clientHeight || innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.guete.jetzt.pixel));
    this.renderer.setSize(this.w, this.h, false); this.camera.aspect = this.w / this.h; this.camera.updateProjectionMatrix();
  }

  /* Neue Runde: Welt aus ihrer Strecke bauen */
  strecke(rt: Bahn, seed: number) {
    if (this.gel) { this.land.remove(this.gel.group); this.gel.dispose(); }
    if (this.str) { this.land.remove(this.str.group); this.str.dispose(); }
    if (this.baum) { this.land.remove(this.baum.group); this.baum.dispose(); }
    const k = this.k = kurve(rt), nh = naehe(k);
    this.gel = new Gelaende(k, nh, seed);
    const haupt = anstiege(rt).sort((a, b) => b.gain - a.gain)[0];
    const tore = [{ s: rt.dist - 10, farbe: 0xf6f0e6 }];
    if (haupt) tore.push({ s: haupt.s, farbe: 0xffb347 }, { s: haupt.top, farbe: 0xff5c8a });
    this.str = new Strasse(k, this.glow, tore);
    this.baum = new Baeume(this.gel, nh, seed);
    this.land.add(this.gel.group, this.str.group, this.baum.group);
    this.orbit += 1.2; this.t0 = this.uhr;
    this.orbitPose(this.camP, this.camL, [0, 0]);
  }
  /* Beim allerersten Bild von weiter oben hereinschweben */
  einflug() { this.camP.y += this.weite() * .4; this.camP.multiplyScalar(1.25); }

  private weite() { return Math.max(1500, (this.k ? this.k.radius : 1000) * 2.1); }
  private ueberhoehung() { return clamp(this.weite() / 3200, 1, 3); }
  private orbitPose(p: THREE.Vector3, l: THREE.Vector3, maus: [number, number]) {
    const k = this.k!, D = this.weite(), a = this.orbit + maus[0] * .25, yM = (k.min[1] + k.max[1]) / 2 * this.sy;
    p.set(k.mitte[0] + Math.cos(a) * D, yM + D * .27 + maus[1] * D * .04, k.mitte[1] + Math.sin(a) * D);
    l.set(k.mitte[0], yM, k.mitte[1]);
  }
  private at(s: number, out: THREE.Vector3) { const k = this.k!, [i, f] = stelle(k, s); return out.set(lerp(k.x[i], k.x[i + 1], f), lerp(k.y[i], k.y[i + 1], f) * this.sy, lerp(k.z[i], k.z[i + 1], f)); }
  private tan(s: number, out: THREE.Vector3) { const k = this.k!, [i, f] = stelle(k, s); return out.set(lerp(k.tx[i], k.tx[i + 1], f), (k.y[i + 1] - k.y[i]) / k.ds * this.sy, lerp(k.tz[i], k.tz[i + 1], f)).normalize(); }
  private kr(s: number) { const k = this.k!, [i, f] = stelle(k, s); return lerp(k.c[i], k.c[i + 1], f); }
  private t3 = new THREE.Vector3(); private t4 = new THREE.Vector3();
  private chasePose(p: THREE.Vector3, l: THREE.Vector3, s: number) {
    const t = this.tan(s, this.t3); this.at(s, p).addScaledVector(t, -7.1); p.x += -t.z * SPUR * .3; p.z += t.x * SPUR * .3; p.y += 3.0;
    /* Die Kamera gleicht die Steigung nur zur Hälfte aus: bergauf steigt die Straße im Bild sichtbar an, bergab fällt sie ab */
    const y0 = p.y - 3.0 + t.y * 7.1, s2 = Math.min(s + 22, this.k!.len), t2 = this.tan(s2, this.t4); this.at(s2, l); l.x += -t2.z * SPUR * .45; l.z += t2.x * SPUR * .45; l.y -= 1.2 + (l.y - y0) * .55;
    if (s2 - s < 22) l.addScaledVector(t2, 22 - (s2 - s));
  }
  private stelleFigur(f: Figur, s: number, seite: number, dt: number, v: number, cad: number | null, grade: number) {
    const o = f.group, p = this.at(s, o.position), t = this.tan(s, this.t3);
    o.position.x += -t.z * seite; o.position.z += t.x * seite; o.position.y += .12;
    o.lookAt(p.x + t.x, p.y + t.y, p.z + t.z); o.rotateZ(clamp(this.kr(s) * v * 1.6, -.45, .45));
    o.updateMatrixWorld(true); f.update(dt, v, cad, grade);
  }

  bild(dt: number, b: Bild) {
    if (!this.k || !this.gel || !this.str || !this.baum || this.tot) return;
    const k = this.k; this.uhr += dt; this.orbit += dt * .06;
    if (this.guete.bild(dt)) this.groesse();
    const G = this.guete.jetzt, D = this.weite();
    if (b.akt === 'count' && this.aktVor !== 'count') { this.sturz = 0; this.oP.copy(this.camP); this.oL.copy(this.camL); }
    if (b.akt === 'lobby' && this.aktVor !== 'lobby') this.t0 = this.uhr;
    this.aktVor = b.akt;

    let tShift = .17, tFov = 38, tRoll = 0, fogN = D * .55, fogF = D * 3.4, windO = 0, syZ = this.ueberhoehung(), nearZ = D * .01, farZ = D * 8, sicht = D * 4, Kq = 1.15, kraft = .85;
    if (b.akt === 'lobby') {
      this.sy = lerp(this.sy, syZ, 1 - Math.exp(-dt * 3));
      this.orbitPose(this.tP, this.tL, b.maus); this.camP.lerp(this.tP, 1 - Math.exp(-dt * 2.5)); this.camL.lerp(this.tL, 1 - Math.exp(-dt * 2.5));
    } else if (b.akt === 'count') {
      this.sturz = Math.min(1, this.sturz + dt / 3); const e = ease(this.sturz);
      this.sy = lerp(syZ, 1, smooth(0, .7, this.sturz));
      this.chasePose(this.tP, this.tL, 0); this.camP.lerpVectors(this.oP, this.tP, e); this.camP.y += Math.sin(e * Math.PI) * D * .04; this.camL.lerpVectors(this.oL, this.tL, e);
      tShift = .17 * (1 - e); tFov = lerp(38, 64, e); fogN = lerp(D * .55, 60, e); fogF = lerp(D * 3.4, G.sicht * .85, e); this.shift = tShift; this.fov = tFov;
      nearZ = lerp(D * .01, .5, e); farZ = lerp(D * 8, 9000, e); sicht = lerp(D * 4, G.sicht, e); Kq = lerp(1.15, G.K, e); kraft = .85 * (1 - e);
    } else {
      this.sy = 1; const ss = Math.min(b.s, k.len);
      this.chasePose(this.tP, this.tL, ss); this.camP.lerp(this.tP, 1 - Math.exp(-dt * 7)); this.camL.lerp(this.tL, 1 - Math.exp(-dt * 9));
      tShift = 0; tFov = 60 + clamp(b.v - 6, 0, 12) * 1.5; tRoll = clamp(-this.kr(ss + 6) * 22, -.22, .22); fogN = 60; fogF = G.sicht * .85;
      windO = b.pause || b.akt === 'done' ? 0 : clamp((b.v - 6) / 12, 0, .3); nearZ = .5; farZ = 9000; sicht = G.sicht; Kq = G.K; kraft = 0;
    }
    this.land.scale.y = this.sy;
    this.shift = lerp(this.shift, tShift, 1 - Math.exp(-dt * 3)); this.fov = lerp(this.fov, tFov, 1 - Math.exp(-dt * 3)); this.roll = lerp(this.roll, tRoll, 1 - Math.exp(-dt * 2.5));
    const fog = this.scene.fog as THREE.Fog; fog.near = lerp(fog.near, fogN, 1 - Math.exp(-dt * 2.5)); fog.far = lerp(fog.far, fogF, 1 - Math.exp(-dt * 2.5));
    const cam = this.camera; cam.fov = this.fov; cam.near = nearZ; cam.far = farZ;
    if (this.shift > .002) cam.setViewOffset(this.w, this.h, -this.shift * this.w, 0, this.w, this.h); else cam.clearViewOffset();
    cam.updateProjectionMatrix(); cam.position.copy(this.camP); cam.lookAt(this.camL); cam.rotateZ(this.roll);
    this.himmel.position.copy(this.camP); this.himmel.scale.setScalar(farZ * .9);
    this.sterne.position.copy(this.camP); this.sterne.scale.setScalar(farZ * .85);
    this.sonne.position.copy(this.camP).addScaledVector(this.sonneDir, farZ * .8); this.sonne.scale.setScalar(farZ * .23);

    /* Leuchtlinie zeichnet die Runde nach (nur Lobby), Breite wächst mit der Entfernung */
    const kopf = ((this.uhr - this.t0) * .16) % 1.35;
    this.str.leuchte(kopf, kraft, .0026);
    this.gel.update(this.camP, this.sy, Kq, sicht, dt);

    const draussen = b.akt !== 'lobby';
    this.me.group.visible = draussen; this.rivale.group.visible = draussen && b.gs != null && b.akt !== 'count';
    if (draussen) {
      const lauf = b.akt === 'ride' && !b.pause ? dt : 0, s = b.akt === 'count' ? 0 : Math.min(b.s, k.len);
      this.stelleFigur(this.me, s, SPUR, lauf, b.akt === 'done' ? 0 : b.v, b.cad, b.grade);
      if (this.rivale.group.visible) this.stelleFigur(this.rivale, Math.min(b.gs!, k.len), SPUR - 1.25, lauf, b.gv, null, 0);
      this.baum.update(this.me.group.position.x, this.me.group.position.z, b.akt === 'count' ? G.baeume * .6 : G.baeume);
    } else this.baum.leeren();

    const sm = this.staub.material as THREE.PointsMaterial; sm.opacity = lerp(sm.opacity, b.akt === 'ride' ? .6 : 0, 1 - Math.exp(-dt * 2));
    if (sm.opacity > .01) { const mv = (b.pause ? 0 : b.v) * dt * 1.15 + dt * .5, mp = this.mp; for (let i = 0; i < mp.length / 3; i++) { mp[i * 3 + 2] += mv; mp[i * 3 + 1] += Math.sin(this.uhr * .7 + i) * dt * .25; if (mp[i * 3 + 2] > 1) mp[i * 3 + 2] -= 70; } this.staub.geometry.attributes.position.needsUpdate = true; }
    const wm = this.wind.material as THREE.LineBasicMaterial; wm.opacity = lerp(wm.opacity, windO, 1 - Math.exp(-dt * 3));
    if (wm.opacity > .01) { const L = .3 + b.v * .13; for (let i = 0; i < this.ws.length; i++) { const q = this.ws[i]; q[2] += (b.pause ? 0 : b.v) * dt * 2.6; if (q[2] > 2) q[2] -= 70; this.wp.set([q[0], q[1], q[2], q[0], q[1], q[2] - L], i * 6); } this.wind.geometry.attributes.position.needsUpdate = true; }

    this.renderer.render(this.scene, cam);
  }
  /* Zahlen für Tests und die Leistungsprüfung */
  get stand() { const i = this.renderer.info; return { stufe: this.guete.stufe, bildzeit: this.guete.bildzeit, kacheln: this.gel ? this.gel.kacheln : 0, geometrien: i.memory.geometries, dreiecke: i.render.triangles, aufrufe: i.render.calls }; }
}
