/* Fahrer und Rennrad, aus einfachen Körpern gebaut (kein fremdes Modell). Beine treten mit der echten Trittfrequenz,
   der Oberkörper wiegt leicht mit, am steilen Berg geht er aus dem Sattel. Der Geist nutzt dieselbe Figur, durchscheinend. */
import * as THREE from 'three';

export interface Farben { frame: THREE.Material; rim: THREE.Material; tire: THREE.Material; jersey: THREE.Material; short: THREE.Material; skin: THREE.Material; helmet: THREE.Material; shoe: THREE.Material; light?: THREE.Material; akzent?: THREE.Material }
export interface Figur { group: THREE.Group; update(dt: number, v: number, cad: number | null, grade: number): void }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

export function figur(M: Farben, geist = false): Figur {
  const g = new THREE.Group(), cyl = new THREE.CylinderGeometry(1, 1, 1, 12), kap = new THREE.CapsuleGeometry(1, 1, 5, 12), d = V(0, 0, 0);
  type Rohr = THREE.Mesh & { userData: { r: number; r2: number; kap: boolean } };
  /* Rohr oder Kapsel zwischen zwei Punkten legen */
  const lege = (m: Rohr, a: THREE.Vector3, b: THREE.Vector3) => {
    d.subVectors(b, a); const L = d.length(), u = m.userData;
    m.position.copy(a).addScaledVector(d, .5); m.quaternion.setFromUnitVectors(UP, d.normalize());
    /* Kapsel-Grundform: Radius 1, gerades Stück 1 → Gesamtlänge 3; so strecken, dass die Enden rund bleiben */
    if (u.kap) m.scale.set(u.r, Math.max(L, u.r * 2) / 3, u.r2); else m.scale.set(u.r, L, u.r2);
  };
  const rohr = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, r2 = r, rund = false, zu: THREE.Object3D = g) => {
    const m = new THREE.Mesh(rund ? kap : cyl, mat) as unknown as Rohr; m.userData = { r, r2, kap: rund }; lege(m, a, b); zu.add(m); return m;
  };
  const kasten = (w: number, h: number, l: number, x: number, y: number, z: number, mat: THREE.Material, rx = 0, zu: THREE.Object3D = g) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); m.position.set(x, y, z); m.rotation.x = rx; zu.add(m); return m; };

  /* Laufräder: Reifen, hohe Felge, Speichen, Nabe */
  const rad = (z: number) => {
    const w = new THREE.Group(); w.position.set(0, .34, z);
    const t = new THREE.Mesh(new THREE.TorusGeometry(.322, .022, 8, 40), M.tire); t.rotation.y = Math.PI / 2; w.add(t);
    const felge = new THREE.Mesh(new THREE.TorusGeometry(.285, .02, 6, 40), M.rim); felge.rotation.y = Math.PI / 2; felge.scale.set(1, 1, .55); w.add(felge);
    for (let i = 0; i < 9; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(.004, .56, .006), M.rim); sp.rotation.x = i * Math.PI / 9; w.add(sp); }
    const nabe = new THREE.Mesh(cyl, M.rim); nabe.scale.set(.022, .09, .022); nabe.rotation.z = Math.PI / 2; w.add(nabe);
    g.add(w); return w;
  };
  const w1 = rad(.53), w2 = rad(-.5);
  /* Rahmen */
  const BB = V(0, .29, -.07), RA = V(0, .34, -.5), FA = V(0, .34, .53), SC = V(0, .8, -.21), HT = V(0, .86, .33), HB = V(0, .7, .37), SD = V(0, .95, -.25), BAR = V(0, .93, .43);
  rohr(BB, SC, .021, M.frame, .017); rohr(SC, HT, .02, M.frame, .016); rohr(BB, HB, .028, M.frame, .02); rohr(HB, HT, .024, M.frame);
  rohr(SC, SD, .014, M.akzent || M.rim); rohr(HT, BAR, .016, M.akzent || M.rim);
  for (const x of [-.045, .045]) { rohr(V(x * .4, BB.y, BB.z), V(x, RA.y, RA.z), .012, M.frame); rohr(V(x * .4, SC.y, SC.z), V(x, RA.y, RA.z), .009, M.frame); rohr(V(x * .5, HB.y, HB.z), V(x, FA.y, FA.z), .014, M.frame, .01); }
  /* Sattel, Lenker mit Bügeln, Flasche, Kettenblatt */
  const sattel = new THREE.Mesh(kap, M.short); sattel.scale.set(.055, .085, .018); sattel.rotation.x = Math.PI / 2; sattel.rotation.z = 0; sattel.position.set(0, .968, -.26); g.add(sattel);
  rohr(V(-.2, .93, .45), V(.2, .93, .45), .013, M.rim);
  for (const x of [-.2, .2]) { rohr(V(x, .93, .45), V(x, .905, .56), .013, M.rim, .013, true); rohr(V(x, .905, .56), V(x, .8, .545), .013, M.rim, .013, true); }
  rohr(V(0, .42, .02), V(0, .6, .13), .034, M.akzent || M.rim, .034, true);
  const blatt = new THREE.Mesh(cyl, M.rim); blatt.scale.set(.09, .008, .09); blatt.rotation.z = Math.PI / 2; blatt.position.set(.05, BB.y, BB.z); g.add(blatt);
  if (M.light) { const l = new THREE.Mesh(new THREE.SphereGeometry(.03, 8, 6), M.light); l.position.set(0, .86, -.36); g.add(l); }

  /* Oberkörper als eigene Gruppe um die Hüfte, damit er wiegen und aus dem Sattel gehen kann */
  const ober = new THREE.Group(); ober.position.set(0, 1.0, -.2); g.add(ober);
  const HIP = V(0, 0, 0), NECK = V(0, .3, .44);
  rohr(HIP, NECK, .15, M.jersey, .1, true, ober);
  const becken = new THREE.Mesh(kap, M.short); becken.scale.set(.15, .06, .1); becken.rotation.x = .2; becken.position.set(0, -.01, -.02); ober.add(becken);
  rohr(V(0, .29, .43), V(0, .36, .51), .045, M.skin, .045, false, ober);
  const kopf = new THREE.Mesh(new THREE.SphereGeometry(.095, 16, 12), M.skin); kopf.position.set(0, .41, .54); ober.add(kopf);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(.118, 16, 12, 0, Math.PI * 2, 0, Math.PI * .6), M.helmet); helm.position.set(0, .425, .53); helm.scale.set(1, .92, 1.38); helm.rotation.x = .38; ober.add(helm);
  const arme = [-1, 1].map(x => ({ x, o: rohr(V(0, 0, 0), UP, .046, M.jersey, .046, true, ober), u: rohr(V(0, 0, 0), UP, .036, M.skin, .036, true, ober) }));
  /* Beine und Kurbel, jedes Bild neu gestellt */
  const beine = [-1, 1].map(x => ({ x, th: rohr(V(0, 0, 0), UP, .072, M.short, .066, true), sh: rohr(V(0, 0, 0), UP, .048, M.skin, .044, true), cr: rohr(V(0, 0, 0), UP, .012, M.rim), pd: kasten(.09, .02, .07, 0, 0, 0, M.tire), ft: kasten(.085, .06, .24, 0, 0, 0, M.shoe) }));
  const hip = V(0, 0, 0), foot = V(0, 0, 0), knee = V(0, 0, 0), ped = V(0, 0, 0), bb = V(0, 0, 0), sh = V(0, 0, 0), el = V(0, 0, 0), ha = V(0, 0, 0);
  let ph = 0, steh = 0; const inv = new THREE.Matrix4();

  function update(dt: number, v: number, cad: number | null, grade: number) {
    w1.rotation.x += v * dt / .34; w2.rotation.x += v * dt / .34;
    /* Tritt: echte Trittfrequenz, sonst aus dem Tempo geschätzt */
    const rpm = cad != null ? cad : v > .5 ? 60 + v * 3 : 0;
    ph -= dt * rpm / 60 * Math.PI * 2;
    /* ab 7 % aus dem Sattel, weich hinein und heraus */
    steh += ((grade > 7 && rpm > 20 ? 1 : 0) - steh) * Math.min(1, dt * 2.5);
    const wieg = Math.sin(ph) * (.012 + steh * .05) * Math.min(1, rpm / 50);
    ober.position.set(wieg * .6, 1.0 + steh * .025, -.2 + steh * .13); ober.rotation.z = wieg; ober.rotation.x = steh * .1; ober.updateMatrix(); inv.copy(ober.matrix).invert();
    for (const A of arme) {
      sh.set(A.x * .17, .27, .4); ha.set(A.x * .2, .9, .54).applyMatrix4(inv);
      el.copy(sh).lerp(ha, .5); el.x += A.x * .04; el.y -= .05 - steh * .03; el.z -= .04;
      lege(A.o as any, sh, el); lege(A.u as any, el, ha);
    }
    for (const L of beine) {
      const a = ph + (L.x > 0 ? 0 : Math.PI);
      ped.set(L.x * .12, BB.y + .17 * Math.sin(a), BB.z + .17 * Math.cos(a)); bb.set(L.x * .07, BB.y, BB.z); lege(L.cr as any, bb, ped); L.pd.position.copy(ped);
      foot.set(L.x * .12, ped.y + .045, ped.z + .03); L.ft.position.copy(foot); L.ft.rotation.x = .25 + Math.sin(a) * .2;
      hip.set(L.x * .095 + ober.position.x, ober.position.y - .01, ober.position.z);
      const dy = foot.y - hip.y, dz = foot.z - .06 - hip.z, D = Math.min(Math.hypot(dy, dz), .875), A = .44, B = .44, k = (A * A - B * B + D * D) / (2 * D), h = Math.sqrt(Math.max(A * A - k * k, 0)), ny = dy / D, nz = dz / D;
      knee.set(L.x * .11, hip.y + ny * k + h * nz, hip.z + nz * k - h * ny);
      lege(L.th as any, hip, knee); foot.z -= .06; lege(L.sh as any, knee, foot);
    }
  }
  update(0, 0, 0, 0);
  if (geist) g.traverse(o => { o.renderOrder = 3; });
  return { group: g, update };
}

const SM = (c: number, e = 0, r = .6, metal = .1) => new THREE.MeshStandardMaterial({ color: c, emissive: e, roughness: r, metalness: metal });
export function ich(glow: THREE.Texture): Figur {
  const f = figur({ frame: SM(0x2a2233, 0x0d0a12, .3, .5), rim: SM(0x9a8f9c, 0x1a161d, .35, .6), tire: SM(0x0c0a10, 0, .9), jersey: SM(0xf6f0e6, 0x4a4038, .7), short: SM(0x1c1524, 0x08060b, .8), skin: SM(0xd9a184, 0x3a261c, .8), helmet: SM(0xf3b56b, 0x5a3a14, .35), shoe: SM(0xf6f0e6, 0x3a332c, .5), akzent: SM(0xf3b56b, 0x5a3a14, .4), light: new THREE.MeshBasicMaterial({ color: 0xff4a4a }) });
  const lamp = new THREE.PointLight(0xffc890, 260, 70, 2); lamp.position.set(0, 2.4, 2); f.group.add(lamp);
  const schatten = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .5, depthWrite: false })); schatten.rotation.x = -Math.PI / 2; schatten.position.y = .03; schatten.scale.set(.42, 1.15, 1); f.group.add(schatten);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xf3b56b, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .28 })); sp.position.set(0, .8, 0); sp.scale.setScalar(4.4); f.group.add(sp);
  return f;
}
export function geist(): Figur {
  const GM = new THREE.MeshBasicMaterial({ color: 0xff9ec0, transparent: true, opacity: .34, blending: THREE.AdditiveBlending, depthWrite: false });
  return figur({ frame: GM, rim: GM, tire: GM, jersey: GM, short: GM, skin: GM, helmet: GM, shoe: GM }, true);
}
