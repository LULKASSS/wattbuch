'use strict';
/* ---------- Szene: Straße zum Durchfahren ---------- */
/* Pseudo-3D wie bei klassischen Rennspielen: Die Straße vor dir folgt Kurven und Höhen der gewählten
   Strecke (Höhen leicht überzeichnet). Je länger du fährst, desto mehr verändert sich die Welt:
   Tageszeit nach Fahrtdauer (Abendrot → Nacht → Morgengrauen → Tag → Sonnenuntergang),
   Landschaft nach Strecke (Wald, Felder, ab 900 m Alpen). Dazu Geist bzw. Schrittmacher als Radfahrer.
   Die Szene ist die Fahrt-Ansicht (#full) und im Leerlauf der Hintergrund von „Fahren“ (#cvBack). */

/* tz0/tz1: Landschaft am Rand ist unter tz0 m weg und ab tz0+tz1 m voll sichtbar */
const SCN={seg:5,n:200,ex:3,half:3.2,tz0:15,tz1:35};
/* Leuchtfarben je Zone, von ruhigem Grau-Lila bis Magenta/Rot */
const GLOW=['#646a7c','#6E62B5','#7F5FE8','#9A6BFF','#C266F0','#F062B8','#FF5C7A'];
const hex2=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const lerp3=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const rgb=(c,a)=>a==null?`rgb(${c[0]|0},${c[1]|0},${c[2]|0})`:`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
const mixc=(a,b,t)=>rgb(lerp3(a,b,t));
const hash=k=>{const x=Math.sin(k*127.1+311.7)*43758.5453;return x-Math.floor(x);};

/* Tageszeiten: Stützpunkte in Minuten Fahrtzeit, alle 100 min beginnt es von vorn */
const DAY=[
  {at:0, n:'Abendrot',top:'#120c24',hor:'#6b2f6e',g:['#1a1526','#1d1829'],r:['#262236','#2a2539'],m:['#3d2850','#2e2040','#221a33'],tree:'#1c2230',stars:.15,body:'#ff9a6b',alt:.05,zm:.45},
  {at:18,n:'Nacht',top:'#04050d',hor:'#161a33',g:['#0b0c14','#0d0e17'],r:['#17171f','#1a1a23'],m:['#141830','#10142a','#0c0f20'],tree:'#0b1017',stars:1,body:'#e8e6ff',alt:.55,zm:.35},
  {at:40,n:'Morgengrauen',top:'#1d2550',hor:'#f29a8c',g:['#2a2433','#2e2738'],r:['#34303f','#383344'],m:['#7a5a7e','#5b4566','#3f3352'],tree:'#2a2f3c',stars:.2,body:'#ffd4a3',alt:.08,zm:.25},
  {at:55,n:'Tag',top:'#3d7bd9',hor:'#bfe0ff',g:['#3d6b45','#42724a'],r:['#4a4a55','#50505b'],m:['#8fb0d6','#6f93bf','#577aa6'],tree:'#24452f',stars:0,body:'#fff6dc',alt:.7,zm:.15},
  {at:80,n:'Sonnenuntergang',top:'#2a2266',hor:'#ff8a4c',g:['#2b2a35','#302e3a'],r:['#383444','#3d3949'],m:['#7b4a6a','#5a3858','#402a47'],tree:'#1f2531',stars:.05,body:'#ffb36b',alt:.06,zm:.3},
  {at:100,n:'Abendrot'}
].map((k,i,a)=>{const s=k.top?k:a[0];return{at:k.at,n:k.n,top:hex2(s.top),hor:hex2(s.hor),g:s.g.map(hex2),r:s.r.map(hex2),m:s.m.map(hex2),tree:hex2(s.tree),stars:s.stars,body:hex2(s.body),alt:s.alt,zm:s.zm};});
const smooth=t=>t*t*(3-2*t);
function dayAt(min){
  const m=((min%100)+100)%100;let i=0;while(i<DAY.length-2&&DAY[i+1].at<=m)i++;
  const a=DAY[i],b=DAY[i+1],t=smooth(clamp((m-a.at)/(b.at-a.at),0,1)),L=(x,y)=>x+(y-x)*t;
  return{n:t<.5?a.n:b.n,top:lerp3(a.top,b.top,t),hor:lerp3(a.hor,b.hor,t),g:[0,1].map(k=>lerp3(a.g[k],b.g[k],t)),r:[0,1].map(k=>lerp3(a.r[k],b.r[k],t)),
    m:[0,1,2].map(k=>lerp3(a.m[k],b.m[k],t)),tree:lerp3(a.tree,b.tree,t),stars:L(a.stars,b.stars),body:lerp3(a.body,b.body,t),alt:L(a.alt,b.alt),zm:L(a.zm,b.zm)};
}
/* Fahrtzeit in Minuten für die Tageszeit; im Leerlauf bleibt es beim Abendrot */
const rideMin=()=>S.rec.state==='idle'?0:recElapsed()/60000;

/* Fahrtrichtung entlang der Strecke (geglättet), einmal je Strecke berechnet */
const HEADS=new WeakMap();
function headings(rt){
  let h=HEADS.get(rt);if(h)return h;
  const n=rt.ele.length,raw=new Float32Array(n);let prev=0;
  for(let k=0;k<n;k++){
    const d=k*rt.step,a=posAt(rt,Math.max(0,d-rt.step)),b=posAt(rt,Math.min(rt.dist,d+rt.step));
    const dy=(b[0]-a[0])*111320,dx=(b[1]-a[1])*111320*Math.cos(a[0]*Math.PI/180);
    let ang=(dx||dy)?Math.atan2(dx,dy):prev;
    while(ang-prev>Math.PI)ang-=2*Math.PI;while(ang-prev<-Math.PI)ang+=2*Math.PI;
    raw[k]=prev=ang;
  }
  h=new Float32Array(n);
  for(let k=0;k<n;k++){let s=0,c=0;for(let q=Math.max(0,k-6);q<=Math.min(n-1,k+6);q++){s+=raw[q];c++;}h[k]=s/c;}
  HEADS.set(rt,h);return h;
}
/* Höhe und Richtung an Position d; ohne Strecke eine sanft geschwungene, fast flache Landstraße */
/* Zusätzliche Kurven nur fürs Auge (Steigung und Distanz bleiben exakt): lange Bögen und dazwischen engere Kehren */
const bend=d=>.5*Math.sin(d/360)+.28*Math.sin(d/150+1.3)+.12*Math.sin(d/63+.4);
function trackAt(rt,d){
  if(!rt)return{e:1.2*Math.sin(d/180)+.6*Math.sin(d/57),h:.4*Math.sin(d/520)+bend(d)};
  d=rt.loop?((d%rt.dist)+rt.dist)%rt.dist:clamp(d,0,rt.dist);
  const H=headings(rt),x=d/rt.step,i=Math.min(H.length-2,Math.floor(x)),f=x-i;
  return{e:eleAt(rt,d),h:H[i]+(H[i+1]-H[i])*f+bend(d)*.8};
}
const wrapA=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;};

/* Landschaft an Position s: ab 900 m Alpen, sonst wechseln Wald und Felder in Abschnitten von 3,5 km */
function biomeAt(rt,s,e){
  if(rt&&e>900)return'alpen';
  return hash(Math.floor(s/3500)*7.3+1)<.5?'wald':'felder';
}

/* Berge: drei Schichten, verschieben sich beim Abbiegen (Parallaxe) */
const MTN=[0,1,2].map(l=>{const a=[];for(let i=0;i<256;i++){let v=0;for(let o=1;o<=4;o++)v+=Math.sin(i/256*Math.PI*2*(o*2+l)+hash(l*9+o)*6)/o;a.push(v);}return a;});
const STARS=Array.from({length:140},(_,i)=>({x:hash(i*3.1),y:Math.pow(hash(i*5.7),1.6),r:.5+hash(i*1.3)*1.2,p:hash(i*9.1)*6}));
const SCV={alp:0,vp:null,gap:null,lastT:0,riding:false,pw:0,zc:null,g:0}; /* geglättete Werte zwischen den Bildern */

/* Mitfahrer: Geist der besten früheren Fahrt auf dieser Strecke, sonst ein Schrittmacher, der genau die Zielleistung
   fährt und nur da ist, solange eine Zielleistung an ist. Mit Coach oder beim FTP-Test fährt niemand mit. */
function paceReset(){
  if(S.ramp||(typeof coachGoal==='function'&&coachGoal()&&ftpKnown())){S.pace=null;return;}
  const rt=activeRoute(),ftp=S.set.ftp;
  const prev=rt?S.rides.filter(r=>!r.sample&&r.route===rt.name&&r.dist&&r.dist.length>30):[];
  const best=prev.sort((a,b)=>b.dist[b.dist.length-1]/b.dist.length-a.dist[a.dist.length-1]/a.dist.length)[0];
  S.pace=best?{kind:'geist',name:'Dein Geist',dist:best.dist,total:0,v:0,ahead:null}
             :{kind:'pacer',name:'Schrittmacher',total:0,v:0,ahead:null,off:true};
}
function paceStep(dt){
  const P=S.pace;if(!P)return;
  if(P.kind==='geist'){const t=recElapsed()/1000,i=Math.min(P.dist.length-1,Math.floor(t)),f=Math.min(1,t-i);const a=P.dist[i],b=P.dist[i+1]??a;P.v=Math.max(0,b-a);P.total=a+(b-a)*f;return;}
  /* Ohne Zielleistung wartet der Schrittmacher unsichtbar neben dir und setzt beim Einschalten dort an */
  if(!S.erg.on){P.off=true;P.total=S.sim.total;P.v=S.sim.v;P.ahead=null;return;}
  P.off=false;P.name=`Schrittmacher ${Math.round(S.erg.target)} W`;
  const rt=activeRoute(),m=S.set.weight+S.set.bike;
  const pd=rt?(rt.loop?P.total%rt.dist:Math.min(P.total,rt.dist)):0,g=rt?gradeAt(rt,pd):0,th=Math.atan(g/100);
  const res=m*PHYS.g*(PHYS.crr*Math.cos(th)+Math.sin(th))+.5*PHYS.rho*PHYS.cda*P.v*P.v;
  const w=S.erg.target;
  P.v=clamp(P.v+(w/Math.max(P.v,1)-res)/(m+1.5)*dt,0,25);P.total+=P.v*dt;
}
/* Jede Sekunde aus checkMoments: Überholen und Tageszeit melden */
let lastDay=null;
function paceCheck(){
  const d=dayAt(rideMin()).n;
  if(lastDay&&d!==lastDay&&recElapsed()>60000)moment('peak',{Nacht:'Die Nacht bricht herein',Morgengrauen:'Der Morgen graut',Tag:'Guten Morgen, Sonne',Sonnenuntergang:'Die Sonne geht unter',Abendrot:'Abendrot'}[d]||d,`${fmtDur(recElapsed()/1000)} unterwegs`);
  lastDay=d;
  const P=S.pace;if(!P||P.off||recElapsed()<20000)return;
  const ahead=S.sim.total>P.total+5;
  if(P.ahead!=null&&ahead!==P.ahead)moment('flag',ahead?`${P.name} überholt`:`${P.name} zieht vorbei`,ahead?'Weiter so, nicht nachlassen':`Abstand ${n0(P.total-S.sim.total)} m`,ahead?'gold':'');
  P.ahead=ahead;
}

/* Zeichnen. opt.back: Hintergrund im Leerlauf (langsam rollend, niedrige Auflösung) */
function drawScene(c,opt={}){
  /* Auflösung: Hintergrund halb (liegt unter Glas), Fahrt-Ansicht 1:1 – weiche Szene, flüssige 60 Bilder/s */
  const dpr=opt.back?.5:1,W=c.clientWidth,H=c.clientHeight;if(!W||!H)return;
  if(c.width!==Math.round(W*dpr)||c.height!==Math.round(H*dpr)){c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);}
  const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  const now=performance.now(),dt=clamp((now-(SCV.lastT||now))/1000,0,.2);SCV.lastT=now;
  const riding=S.rec.state!=='idle',rt=activeRoute();
  /* Die Simulation rechnet 4-mal pro Sekunde. Gezeichnet wird mit der eigenen Geschwindigkeit weitergerollt
     und sanft an die echte Position herangeführt – so bewegt sich die Straße in jedem Bild ein Stück. */
  if(riding){
    const target=rt?S.sim.d:S.sim.total;
    if(SCV.vp==null||!SCV.riding)SCV.vp=target;
    SCV.vp+=S.sim.v*dt;const err=target-SCV.vp;
    if(Math.abs(err)>40)SCV.vp=target;else SCV.vp+=err*Math.min(1,dt*1.5);
  }else{
    if(SCV.vp==null||SCV.riding)SCV.vp=0;
    SCV.vp+=dt*4; /* im Leerlauf rollt die Straße gemächlich weiter */
    if(rt&&!rt.loop&&SCV.vp>rt.dist)SCV.vp=0;
  }
  SCV.riding=riding;
  const pos=SCV.vp;
  /* Leistung, Zonenfarbe und Steigung kommen in Sprüngen (Rolle, Takt). Fürs Bild weich nachziehen,
     sonst flackern Himmel und Horizont bei jeder Watt-Schwankung */
  const pwRaw=riding||isLive()?curPow():null,ftp=S.set.ftp,ease=k=>Math.min(1,dt*k);
  SCV.pw+=((pwRaw||0)-SCV.pw)*ease(1.2);const pw=pwRaw==null&&SCV.pw<1?null:SCV.pw;
  const zcT=hex2(GLOW[pw&&pw>0?zoneIdx(pw,ftp):0]);SCV.zc=SCV.zc?lerp3(SCV.zc,zcT,ease(.9)):zcT;const zc=SCV.zc;
  const D=dayAt(rideMin()),t0=trackAt(rt,pos);
  SCV.g+=((rt&&riding?gradeAt(rt,rt.loop?pos%rt.dist:Math.min(pos,rt.dist))/100:0)-SCV.g)*ease(2);const g0=SCV.g;
  /* Bergauf sinkt der Horizont (die Straße türmt sich auf), bergab hebt er sich (sie fällt vor dir weg) */
  const hy=H*(opt.back?.5:.42)+clamp(g0*H*1.1,-H*.1,H*.1),F=Math.max(W,H*1.5)*.62,camY=1.45; /* etwas tiefer: Boden und Striche ziehen schneller vorbei */
  const horA=lerp3(D.hor,zc,D.zm*(pw?1:.4)),fogC=horA;
  /* Alpen-Anteil weich überblenden */
  const alpT=biomeAt(rt,pos+600,rt?trackAt(rt,pos+600).e:0)==='alpen'?1:0;SCV.alp+=(alpT-SCV.alp)*Math.min(1,dt*.8);
  /* Himmel */
  let gr=ctx.createLinearGradient(0,0,0,hy);gr.addColorStop(0,rgb(D.top));gr.addColorStop(1,rgb(horA));ctx.fillStyle=gr;ctx.fillRect(0,0,W,hy+2);
  if(D.stars>.02){for(const s of STARS){const a=D.stars*(.6+.4*Math.sin(now/1600+s.p));ctx.fillStyle=`rgba(255,255,255,${a*(1-s.y)})`;ctx.fillRect(s.x*W,s.y*hy*.95,s.r,s.r);}}
  /* Sonne bzw. Mond */
  const bx=W*.5+Math.sin(t0.h)*-W*.25,by=hy-D.alt*hy*.9,br=Math.min(W,H)*.045;
  gr=ctx.createRadialGradient(bx,by,0,bx,by,br*5);gr.addColorStop(0,rgb(D.body,.5));gr.addColorStop(1,rgb(D.body,0));ctx.fillStyle=gr;ctx.fillRect(bx-br*5,by-br*5,br*10,br*10);
  ctx.fillStyle=rgb(D.body);ctx.beginPath();ctx.arc(bx,by,br,0,7);ctx.fill();
  /* Leuchten am Horizont, atmet mit der Leistung */
  const glow=clamp((pw||0)/ftp,.25,1.6);
  gr=ctx.createRadialGradient(W/2,hy,0,W/2,hy,W*.55*glow);gr.addColorStop(0,rgb(zc,.5*D.zm*2));gr.addColorStop(1,rgb(zc,0));ctx.fillStyle=gr;ctx.fillRect(0,0,W,hy+2);
  /* Berge, in den Alpen höher und mit Schneegipfeln */
  MTN.forEach((m,l)=>{
    const hgt=H*.11*(1-l*.22)*(1+SCV.alp*(1.5-l*.3)),off=t0.h*256/Math.PI*(.35+l*.25),col=lerp3(D.m[l],fogC,.25-l*.08);
    const top=hy-hgt*1.2;
    if(SCV.alp>.05){gr=ctx.createLinearGradient(0,top,0,hy);gr.addColorStop(0,mixc(col,[245,245,255],SCV.alp*.85));gr.addColorStop(.35,rgb(col));gr.addColorStop(1,rgb(col));ctx.fillStyle=gr;}else ctx.fillStyle=rgb(col);
    ctx.beginPath();ctx.moveTo(0,hy+1);
    for(let x=0;x<=W+8;x+=8){const f=(x/W*128+off)%256,i=((Math.floor(f)%256)+256)%256,j=(i+1)%256,k=f-Math.floor(f),v=m[i]+(m[j]-m[i])*k;ctx.lineTo(x,hy-hgt*(.55+.32*v*(1+SCV.alp*.6)));}
    ctx.lineTo(W,hy+1);ctx.closePath();ctx.fill();
  });
  /* Straße: Punkte vor dir berechnen (seitlicher Versatz aus den Richtungsänderungen) */
  /* Erster Punkt genau unter dir, danach feste Punkte alle 5 m – so reicht die Straße immer bis an den Bildrand */
  const s0=Math.floor(pos/SCN.seg)*SCN.seg,P=[{s:pos,x:0,z:0,y:0,e:t0.e}];let x=0,z=0,ps=pos;const y0=t0.e;
  for(let k=1;k<=SCN.n;k++){
    const s=s0+k*SCN.seg,tr=trackAt(rt,s),ds=s-ps,th=wrapA(tr.h-t0.h);ps=s;
    x+=Math.sin(th)*ds;z+=Math.cos(th)*ds;
    P.push({s,x,z,y:(tr.e-y0)*SCN.ex-z*g0*SCN.ex*.2,e:tr.e});
  }
  /* Nahebene 1 m vor dir: Die Straße beginnt an einem exakt dorthin gerechneten Punkt, der stufenlos mitgleitet.
     (Vorher hing sie an einem geklemmten Hilfspunkt – bei jedem 5-m-Schritt knickte der Rand unten kurz, je schneller, desto öfter.) */
  {const ZN=1;let k=1;while(k<P.length-1&&P[k].z<=ZN)k++;const A=P[k-1],B=P[k],t=clamp((ZN-A.z)/((B.z-A.z)||1),0,1);
   P.splice(0,k,{s:A.s+(B.s-A.s)*t,x:A.x+(B.x-A.x)*t,z:ZN,y:A.y+(B.y-A.y)*t,e:A.e+(B.e-A.e)*t});}
  const NP=P.length-1;
  const camX=1.4;
  const pr=p=>{const zz=Math.max(p.z,.5),k=F/zz;return{sx:W/2+(p.x-camX)*k,sy:hy-(p.y-camY)*k,w:SCN.half*k,k};};
  const far=SCN.n*SCN.seg;
  /* Sichtbarkeit von vorn nach hinten: was hinter einer Kuppe liegt, wird ausgelassen */
  const Q=[],vis=[],crest=[];let clipY=H*4;
  for(let k=0;k<=NP;k++){const p=pr(P[k]);Q.push(p);crest.push(clipY);const ok=p.sy<clipY+.5;vis.push(ok);if(ok)clipY=Math.min(clipY,p.sy);}
  /* Boden: ein ruhiger Verlauf vom Dunst zur Wiese vorn */
  const gTop=Math.min(hy,clipY);
  gr=ctx.createLinearGradient(0,gTop,0,H);gr.addColorStop(0,rgb(fogC));gr.addColorStop(.18,mixc(D.g[1],fogC,.45));gr.addColorStop(1,rgb(D.g[0]));
  const groundG=gr;
  ctx.fillStyle=groundG;ctx.fillRect(0,hy-1,W,H-hy+1);
  /* Straße als durchgehende Fläche je sichtbarem Abschnitt, Ränder als feine Lichtkante */
  const roadG=ctx.createLinearGradient(0,hy,0,H);roadG.addColorStop(0,rgb(fogC));roadG.addColorStop(.2,mixc(D.r[0],fogC,.5));roadG.addColorStop(1,rgb(D.r[1]));
  const edgeG=ctx.createLinearGradient(0,hy,0,H);edgeG.addColorStop(0,rgb(fogC,0));edgeG.addColorStop(.25,rgb(lerp3([127,95,232],fogC,.4),.7));edgeG.addColorStop(1,'rgba(150,120,245,.9)');
  const strip=(i0,i1,wf,fill)=>{ctx.beginPath();for(let k=i0;k<=i1;k++)ctx.lineTo(Q[k].sx-Q[k].w*wf,Q[k].sy);for(let k=i1;k>=i0;k--)ctx.lineTo(Q[k].sx+Q[k].w*wf,Q[k].sy);ctx.closePath();ctx.fillStyle=fill;ctx.fill();};
  /* Hang: Bergauf hebt sich ein Hügelrücken (±25 m um die Straße) aus der Landschaft, daneben bleiben Berge sichtbar */
  for(let k=0;k<=NP;k++){
    if(!vis[k])continue;let e=k;while(e<NP&&vis[e+1])e++;
    if(e>k)strip(k,e,8,groundG);
    k=e;
  }
  for(let k=0;k<=NP;k++){
    if(!vis[k])continue;let e=k;while(e<NP&&vis[e+1])e++;
    if(e>k){strip(k,e,1.08,edgeG);strip(k,e,1,roadG);}
    k=e;
  }
  /* Mittelstreifen: 10 m Strich, 10 m Lücke, fest an der Straße – zeigt das Tempo */
  const at3=(A,B,t)=>pr({x:A.x+(B.x-A.x)*t,y:A.y+(B.y-A.y)*t,z:A.z+(B.z-A.z)*t});
  for(let k=0;k<NP;k++){
    if(!vis[k]||!vis[k+1])continue;
    const A=P[k],B=P[k+1],len=B.s-A.s;if(len<=0)continue;
    /* Strich auf [12n, 12n+4) Metern (4 m Strich, 8 m Lücke), angeschnittene Stücke an den Segmentgrenzen mitnehmen */
    for(let d0=Math.floor(A.s/12)*12;d0<B.s;d0+=12){
      const u0=Math.max(A.s,d0),u1=Math.min(B.s,d0+4);if(u1<=u0)continue;
      /* Kommt bis wenige Meter heran und blendet erst dann aus (ganz unten wäre er in zwei, drei Bildern durch) */
      const a=at3(A,B,(u0-A.s)/len),b=at3(A,B,(u1-A.s)/len),fz=Math.min(1,A.z/far),near=clamp((A.z-3)/12,0,1);
      if(near<=0)continue;
      ctx.fillStyle=`rgba(240,236,255,${.55*(1-fz)*near})`;ctx.beginPath();ctx.moveTo(a.sx-a.k*.06,a.sy);ctx.lineTo(a.sx+a.k*.06,a.sy);ctx.lineTo(b.sx+b.k*.06,b.sy);ctx.lineTo(b.sx-b.k*.06,b.sy);ctx.closePath();ctx.fill();
    }
  }
  /* Landschaft am Rand, von hinten nach vorn; tauchen aus dem Dunst auf statt plötzlich da zu sein.
     Jedes Stück wird an der Kuppe davor abgeschnitten (nicht ein-/ausgeblendet) – so gleitet ein Baum
     weich hinter einem Hügel hervor, statt zu blinken. Unter 50 m blenden sie aus, unter 15 m sind sie weg: näher
     rasen sie in wenigen Bildern quer übers Bild, das misst der Flacker-Test (ausprobiert 12.10.2026: 10–13 m flackert). */
  for(let k=NP;k>=1;k--){
    if(P[k].z<=SCN.tz0||crest[k]<=0)continue;
    ctx.save();ctx.beginPath();ctx.rect(0,0,W,Math.min(H,crest[k]+1));ctx.clip();
    const b=P[k],s=b.s,fz=Math.pow(Math.min(1,b.z/far),.7),fade=Math.min(1,(1-fz)*1.6)*clamp((b.z-SCN.tz0)/SCN.tz1,0,1),bio=biomeAt(rt,s,b.e),side=hash(s)>.5?1:-1,at=(dx,dy=0)=>pr({x:b.x+dx,y:b.y+dy,z:b.z});
    ctx.globalAlpha=fade;
    if(bio==='wald'){
      if(s%35===0){fir(ctx,at(side*(SCN.half+3+hash(s+1)*10)),7+hash(s+2)*6,D,fz,fogC,hash(s+13));if(hash(s+3)>.6)fir(ctx,at(-side*(SCN.half+4+hash(s+4)*12)),8+hash(s+5)*5,D,fz,fogC,hash(s+14));}
    }else if(bio==='felder'){
      if(s%100===0)leaf(ctx,at(side*(SCN.half+7+hash(s+6)*16)),6+hash(s+7)*4,D,fz,fogC,hash(s+15));
    }else{
      if(s%50===0&&hash(s+8)>.45)fir(ctx,at(side*(SCN.half+3+hash(s+9)*12)),5+hash(s+10)*4,D,fz,fogC,hash(s+16));
      if(s%70===0)rock(ctx,at(-side*(SCN.half+2+hash(s+11)*7)),1+hash(s+12)*2.5,D,fz,fogC);
    }
    /* Leitpfosten alle 50 m links und rechts, in jeder Landschaft – zeigen das Tempo.
       Erst ab 20 m und mit halbem Kontrast: dünne helle Pfosten blinken sonst beim Vorbeiziehen */
    if(s%50===0&&b.z>20){const ga=ctx.globalAlpha;ctx.globalAlpha=ga*.45*clamp((b.z-20)/20,0,1);post(ctx,at(SCN.half+1),fz,fogC);post(ctx,at(-SCN.half-1),fz,fogC);ctx.globalAlpha=ga;}
    /* Warnschild vor steilen Abschnitten (Schnitt der nächsten 300 m) */
    if(rt&&s%250===0&&!opt.back){const g=(trackAt(rt,s+300).e-b.e)/3;if(Math.abs(g)>=6)gradeSign(ctx,at(SCN.half+1.8),Math.round(g),fz);}
    if(s%1000===0&&s>0&&!opt.back)sign(ctx,at(-SCN.half-1.6),s,rt,fz);
    ctx.restore();
  }
  ctx.globalAlpha=1;
  /* Geist / Schrittmacher als Radfahrer */
  const Pc=S.pace;
  if(Pc&&!Pc.off&&riding){
    const tg=Pc.total-S.sim.total;if(SCV.gap==null||Math.abs(tg-SCV.gap)>40)SCV.gap=tg;else SCV.gap+=(Pc.v-S.sim.v)*dt+(tg-SCV.gap)*Math.min(1,dt*1.5);
    const gap=SCV.gap;
    if(gap>1.5&&gap<far-10){const tgt=pos+gap;let ii=0;while(ii<NP-1&&P[ii+1].s<tgt)ii++;const a=P[ii],b=P[ii+1],f=clamp((tgt-a.s)/((b.s-a.s)||1),0,1);
      const q=pr({x:a.x+(b.x-a.x)*f-.6,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f});
      cyclist(ctx,q,Pc.kind==='geist',now/1000*(Pc.v>.3?1.45:0),Math.min(1,gap/far*1.5));}
  }
  /* Unten weich in die Anzeige auslaufen lassen */
  if(!opt.back){gr=ctx.createLinearGradient(0,H*.5,0,H);gr.addColorStop(0,'rgba(8,6,16,0)');gr.addColorStop(.45,'rgba(8,6,16,.45)');gr.addColorStop(.75,'rgba(8,6,16,.8)');gr.addColorStop(1,'rgba(8,6,16,.94)');ctx.fillStyle=gr;ctx.fillRect(0,H*.5,W,H*.5);}
  /* Vignette */
  gr=ctx.createRadialGradient(W/2,H*.55,Math.min(W,H)*.3,W/2,H*.55,Math.max(W,H)*.75);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,`rgba(0,0,0,${opt.back?.55:.4})`);ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);
}
/* Nadelbaum: vier Etagen mit hängenden Zweigen bis zum Boden (kein freier Stamm, der sonst über dem Boden schwebt;
   gerade Unterkanten, Zacken flackern beim Vorbeiziehen),
   ohne Lichtkante, deren schmale Streifen beim Vorbeiziehen flimmern; v (0–1) macht jeden Baum anders */
function fir(ctx,q,h,D,fz,fogC,v=.5){
  const hh=h*q.k;if(hh<1.5)return;
  const X=q.sx,Y=q.sy,wf=.82+v*.36,lean=(v-.5)*.04*hh;
  const dark=mixc(D.tree,fogC,fz);
  if(hh<5){ctx.fillStyle=dark;ctx.beginPath();ctx.moveTo(X+lean,Y-hh);ctx.lineTo(X+hh*.27*wf,Y);ctx.lineTo(X-hh*.27*wf,Y);ctx.closePath();ctx.fill();return;}
  /* Etagen von unten nach oben: Unterkante, Spitze, halbe Breite (Anteile der Höhe), alle in einem Pfad */
  const T=[[0,.5,.31],[.24,.7,.25],[.46,.88,.18],[.66,1,.1]];
  ctx.fillStyle=dark;ctx.beginPath();
  for(const[b,t,w0]of T){
    const w=w0*hh*wf,yb=Y-hh*b,yt=Y-hh*t,xt=X+lean*t;
    ctx.moveTo(xt,yt);
    ctx.quadraticCurveTo(X+w*.45,yb-hh*.12,X+w,yb+hh*.015);
    ctx.lineTo(X-w,yb+hh*.015);
    ctx.quadraticCurveTo(X-w*.45,yb-hh*.12,xt,yt);
  }
  ctx.fill();
}
/* Laubbaum: Stamm mit Astgabel und eine Krone aus mehreren runden Büscheln, oben heller */
function leaf(ctx,q,h,D,fz,fogC,v=.5){
  const hh=h*q.k;if(hh<1.5)return;
  const X=q.sx,Y=q.sy,col=lerp3(D.tree,[60,90,60],.25),wf=.85+v*.3;
  const bark=mixc(lerp3(col,[40,30,30],.5),fogC,fz);
  ctx.strokeStyle=bark;ctx.lineCap='round';ctx.lineWidth=Math.max(1,hh*.06);
  ctx.beginPath();ctx.moveTo(X,Y);ctx.lineTo(X,Y-hh*.45);ctx.lineTo(X-hh*.1*wf,Y-hh*.62);ctx.moveTo(X,Y-hh*.45);ctx.lineTo(X+hh*.12*wf,Y-hh*.66);ctx.stroke();
  const dark=mixc(col,fogC,fz),lite=mixc(lerp3(col,[170,200,150],.1),fogC,fz);
  const B=[[-.2,.62,.2],[.2,.6,.2],[0,.72,.26],[-.12,.86,.18],[.14,.84,.17]];
  ctx.fillStyle=dark;ctx.beginPath();for(const[dx,dy,r]of B){const x=X+dx*hh*wf,y=Y-dy*hh,rr=r*hh*wf;ctx.moveTo(x+rr,y);ctx.arc(x,y,rr,0,7);}ctx.fill();
  ctx.fillStyle=lite;ctx.beginPath();for(const[dx,dy,r]of B.slice(2)){const x=X+(dx+.05)*hh*wf,y=Y-(dy+.05)*hh,rr=r*.55*hh*wf;ctx.moveTo(x+rr,y);ctx.arc(x,y,rr,0,7);}ctx.fill();
}
/* Zaunpfahl mit Reflektor */
/* Leitpfosten: weiß, schwarzes Band oben, Reflektor */
function post(ctx,q,fz,fogC){
  const h=1.05*q.k,w=Math.max(1,h*.1);if(h<2)return;
  ctx.fillStyle=mixc([232,228,240],fogC,fz);ctx.fillRect(q.sx-w/2,q.sy-h,w,h);
  ctx.fillStyle=mixc([25,22,32],fogC,fz);ctx.fillRect(q.sx-w/2,q.sy-h,w,h*.24);
  ctx.fillStyle=`rgba(255,170,90,${1-fz})`;ctx.fillRect(q.sx-w*.3,q.sy-h*.2,w*.6,h*.09);
}
/* Verkehrsschild Steigung/Gefälle: rot umrandetes Dreieck mit Prozentzahl */
function gradeSign(ctx,q,pct,fz){
  const h=2.4*q.k,a=1.1*q.k;if(a<9)return;
  ctx.save();ctx.globalAlpha*=1-fz;
  ctx.fillStyle='#c9c4d6';ctx.fillRect(q.sx-a*.03,q.sy-h,a*.06,h);
  const cx=q.sx,top=q.sy-h-a*.95,bot=q.sy-h;
  ctx.beginPath();ctx.moveTo(cx,top);ctx.lineTo(cx+a*.55,bot);ctx.lineTo(cx-a*.55,bot);ctx.closePath();ctx.fillStyle='#E5484D';ctx.fill();
  ctx.beginPath();ctx.moveTo(cx,top+a*.2);ctx.lineTo(cx+a*.38,bot-a*.09);ctx.lineTo(cx-a*.38,bot-a*.09);ctx.closePath();ctx.fillStyle='#fff';ctx.fill();
  /* kleiner Keil: steigt nach rechts (bergauf) oder fällt (bergab) */
  ctx.fillStyle='#111';ctx.beginPath();const up=pct>0,y0=bot-a*.15,x0=cx-a*.24,x1=cx+a*.24;
  ctx.moveTo(x0,y0);ctx.lineTo(x1,y0);ctx.lineTo(up?x1:x0,y0-a*.2);ctx.closePath();ctx.fill();
  ctx.font=`700 ${Math.max(6,a*.2)}px Geist,system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='alphabetic';
  ctx.fillText(`${Math.abs(pct)}%`,cx,bot-a*.4);
  ctx.restore();
}
/* Fels */
function rock(ctx,q,h,D,fz,fogC){
  const hh=h*q.k;if(hh<1.5)return;
  ctx.fillStyle=mixc(lerp3(D.m[2],[120,120,130],.4),fogC,fz);
  ctx.beginPath();ctx.moveTo(q.sx-hh*.9,q.sy);ctx.lineTo(q.sx-hh*.4,q.sy-hh*.8);ctx.lineTo(q.sx+hh*.2,q.sy-hh);ctx.lineTo(q.sx+hh*.8,q.sy-hh*.3);ctx.lineTo(q.sx+hh,q.sy);ctx.closePath();ctx.fill();
}
function sign(ctx,q,s,rt,fz){
  const h=2.2*q.k,w=1.6*q.k;if(w<6)return;
  ctx.globalAlpha=1-fz;ctx.fillStyle='#d9d3ff';ctx.fillRect(q.sx-w*.04,q.sy-h,w*.08,h);
  ctx.fillStyle='#7F5FE8';ctx.fillRect(q.sx-w/2,q.sy-h-w*.55,w,w*.55);
  ctx.fillStyle='#fff';ctx.font=`600 ${Math.max(6,w*.28)}px Geist,system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  const km=rt&&!rt.loop?Math.max(0,Math.round((rt.dist-s)/1000)):Math.round(s/1000);
  ctx.fillText(rt&&!rt.loop?`${km} km`:`km ${km}`,q.sx,q.sy-h-w*.27);ctx.globalAlpha=1;
}
/* Radfahrer von hinten: Hinterrad, tretende Beine, vorgebeugter Rücken im Trikot, Helm.
   t = Zeit in Kurbelumdrehungen, fog = Ausblenden in der Ferne */
function cyclist(ctx,q,ghost,t,fog){
  const m=q.k;if(m*1.7<6)return;
  const X=v=>q.sx+v*m,Y=v=>q.sy-v*m,ph=t*Math.PI*2,sway=Math.sin(ph)*.025;
  const jersey=ghost?'#C4B5FD':'#F5C451',dark=ghost?'rgba(70,55,140,.9)':'#1b1b24',skin=ghost?'#E6DEFF':'#d9a982';
  ctx.save();ctx.globalAlpha=(ghost?.78:1)*(1-fog*.6);
  ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(X(0),Y(0),.38*m,.07*m,0,0,7);ctx.fill();
  if(ghost){ctx.shadowColor='#A78BFA';ctx.shadowBlur=Math.min(40,m*.5);}
  ctx.lineCap='round';ctx.lineJoin='round';
  /* Hinterrad (von hinten nur der schmale Reifen) */
  ctx.strokeStyle=dark;ctx.lineWidth=Math.max(1,.045*m);ctx.beginPath();ctx.moveTo(X(0),Y(.02));ctx.lineTo(X(0),Y(.68));ctx.stroke();
  /* Beine: Hüfte → Knie → Fuß, Füße gehen gegenläufig auf und ab */
  const hipY=.98,leg=(sd,p)=>{const fy=.3+.17*Math.sin(p),hx=sd*.1+sway,fx=sd*.13,kx=sd*.17+sway*.5,ky=(hipY+fy)/2+.12;
    ctx.strokeStyle=dark;ctx.lineWidth=.12*m;ctx.beginPath();ctx.moveTo(X(hx),Y(hipY));ctx.lineTo(X(kx),Y(ky));ctx.stroke();
    ctx.strokeStyle=skin;ctx.lineWidth=.09*m;ctx.beginPath();ctx.moveTo(X(kx),Y(ky));ctx.lineTo(X(fx),Y(fy+.04));ctx.stroke();
    ctx.fillStyle=dark;ctx.beginPath();ctx.ellipse(X(fx),Y(fy),.05*m,.035*m,0,0,7);ctx.fill();};
  leg(-1,ph);leg(1,ph+Math.PI);
  /* Rücken im Trikot, leicht vorgebeugt */
  ctx.fillStyle=jersey;ctx.beginPath();ctx.moveTo(X(-.15+sway),Y(hipY-.03));ctx.lineTo(X(.15+sway),Y(hipY-.03));ctx.lineTo(X(.21+sway*.6),Y(1.32));ctx.quadraticCurveTo(X(sway*.6),Y(1.4),X(-.21+sway*.6),Y(1.32));ctx.closePath();ctx.fill();
  ctx.fillStyle=ghost?'rgba(127,95,232,.8)':'#1b1b24';ctx.fillRect(X(-.15+sway),Y(hipY+.06),.3*m,.06*m);
  /* Arme zum Lenker */
  ctx.strokeStyle=jersey;ctx.lineWidth=.08*m;
  for(const sd of[-1,1]){ctx.beginPath();ctx.moveTo(X(sd*.19+sway*.6),Y(1.28));ctx.lineTo(X(sd*.25),Y(1.08));ctx.stroke();}
  /* Helm */
  ctx.fillStyle=ghost?'#F1EEFF':'#f4f4f8';ctx.beginPath();ctx.ellipse(X(sway*.6),Y(1.47),.11*m,.085*m,0,0,7);ctx.fill();
  ctx.fillStyle=ghost?'#7F5FE8':'#E5484D';ctx.fillRect(X(-.02+sway*.6),Y(1.55),.04*m,.16*m);
  ctx.restore();
}

/* Höhenprofil in der Fahrt-Ansicht: ganze Strecke, gefahrener Teil hell, du und der Geist als Punkte.
   Ohne Strecke: Leistung der letzten 2 Minuten in Zonenfarben. */
function drawFullProf(c){
  const dpr=Math.min(2,devicePixelRatio||1),W=c.clientWidth,H=c.clientHeight;if(!W||!H)return;
  if(c.width!==Math.round(W*dpr)||c.height!==Math.round(H*dpr)){c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);}
  const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const rt=activeRoute();
  if(!rt){
    const d=(S.rec.state!=='idle'?S.rec.p:S.hist).slice(-120),bw=W/120;
    d.forEach((v,i)=>{const hh=clamp(v/(S.set.ftp*1.6),0,1)*H;ctx.fillStyle=GLOW[zoneIdx(v||1,S.set.ftp)];ctx.globalAlpha=.85;ctx.fillRect(W-(d.length-i)*bw,H-hh,Math.max(1,bw-1),hh);});
    ctx.globalAlpha=1;return;
  }
  let mn=1e9,mx=-1e9;for(const e of rt.ele){if(e<mn)mn=e;if(e>mx)mx=e;}const span=Math.max(40,mx-mn);
  const X=d=>d/rt.dist*W,Y=e=>H-4-(e-mn)/span*(H-12);
  const path=()=>{ctx.beginPath();ctx.moveTo(0,H);for(let i=0;i<rt.ele.length;i+=Math.max(1,Math.floor(rt.ele.length/400)))ctx.lineTo(X(i*rt.step),Y(rt.ele[i]));ctx.lineTo(W,Y(rt.ele[rt.ele.length-1]));ctx.lineTo(W,H);ctx.closePath();};
  path();ctx.fillStyle='rgba(230,222,255,.14)';ctx.fill();
  ctx.save();ctx.beginPath();ctx.rect(0,0,X(S.sim.d),H);ctx.clip();path();const gr=ctx.createLinearGradient(0,0,0,H);gr.addColorStop(0,'rgba(167,139,250,.9)');gr.addColorStop(1,'rgba(127,95,232,.25)');ctx.fillStyle=gr;ctx.fill();ctx.restore();
  const dot=(d,col,r)=>{ctx.beginPath();ctx.arc(X(d),Y(eleAt(rt,d)),r,0,7);ctx.fillStyle=col;ctx.fill();};
  if(S.pace&&!S.pace.off&&S.rec.state!=='idle'){const gd=rt.loop?S.pace.total%rt.dist:Math.min(S.pace.total,rt.dist);dot(gd,S.pace.kind==='geist'?'#E6DEFF':'#F5C451',4);}
  dot(S.sim.d,'#fff',5.5);
}

/* Steigung als Farbe und Wort: bergab blau, flach grün, dann gelb, orange, rot */
function gradeStyle(g){
  if(g<=-2)return{c:'#7DB8FF',w:'bergab'};
  if(g<2)return{c:'#6EE7B7',w:'flach'};
  if(g<4)return{c:'#D9F99D',w:'leicht'};
  if(g<6)return{c:'#FDE68A',w:'mittel'};
  if(g<9)return{c:'#FDBA74',w:'steil'};
  return{c:'#FCA5A5',w:'sehr steil'};
}

/* Fahrt-Ansicht. Öffnet sich beim Start von selbst; os=true schaltet zusätzlich echtes Vollbild ein (Taste F). */
let fsReq=false,stillT=null;
function openFull(os){
  const f=$('#full');
  if(f.hidden){
    f.hidden=false;document.body.classList.add('fullon');f.appendChild($('#moment'));
    if(!S.pace&&S.rec.state!=='idle')paceReset();
    renderControls();renderFull();sceneKick();
  }
  if(os&&!document.fullscreenElement){try{const p=document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen({navigationUI:'hide'});if(p)p.then(()=>{fsReq=true;}).catch(()=>{});}catch(_){}}
}
function closeFull(){
  const f=$('#full');if(f.hidden)return;S.fullAuto=false;
  f.hidden=true;document.body.classList.remove('fullon');$('.card.live').appendChild($('#moment'));renderControls();sceneKick();
  if(fsReq&&document.fullscreenElement){fsReq=false;document.exitFullscreen().catch(()=>{});}
}
function toggleOsFull(){if(document.fullscreenElement){fsReq=false;document.exitFullscreen().catch(()=>{});}else openFull(true);}
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)fsReq=false;});
function renderFull(){
  const rt=activeRoute(),pw=curPow(),ftp=S.set.ftp,R=S.rec;
  setT('fPow',pw==null?'–':String(Math.round(pw)));
  setT('fWkg',pw==null?'':`${n2(pw/S.set.weight)} W/kg`);
  const zi=pw!=null&&pw>0?zoneIdx(pw,ftp):-1;
  setT('fZone',zi<0?(isLive()?'Pausiert':'Keine Daten'):`${ZONES[zi].n} · ${ZONES[zi].name}`);
  $('#full').style.setProperty('--fz',zi<0?'#646a7c':GLOW[zi]);
  const hr=curHR(),cad=curCad();
  setT('fSpd',isLive()?n1(S.sim.v*3.6):'–');setT('fCad',cad==null?'–':String(Math.round(cad)));setT('fHr',hr==null?'–':String(hr));
  const g=rt?routeGradeNow():0,gs=gradeStyle(g);
  setT('fGrade',(g>0.05?'+':'')+n1(g));setT('fGradeW',gs.w);
  if(gs.c!==SCV.gcol){SCV.gcol=gs.c;$('#fGradeBox').style.setProperty('--gc',gs.c);$('#fGradeW').style.setProperty('--gc',gs.c);}
  setT('fTime',fmtDur((R.state==='idle'?0:recElapsed())/1000));
  setT('fRoute',rt?rt.name:'Frei fahren');
  /* Distanz groß; auf einer Strecke mit Fortschritt „von … km“ */
  const km=(R.state==='idle'?0:(rt?S.sim.d:S.sim.total))/1000;
  setT('fKm',n1(km));setT('fGain',n0(S.sim.gain));
  /* Durchschnitt über die bisher aufgenommene Fahrt (eine Probe pro Sekunde) */
  const ps=R.state==='idle'?0:R.p.length;
  setT('fPowAvg',ps?n0(sum(R.p)/ps):'–');setT('fSpdAvg',ps>=5?n1(S.sim.total/ps*3.6):'–');
  $('#fKmProg').hidden=!rt;$('#fMapBox').hidden=!rt;
  if(rt){setT('fKmOf',`von ${n1(rt.dist/1000)} km · noch ${n1(Math.max(0,rt.dist/1000-km))}`);$('#fKmBar').style.width=clamp(km*1000/rt.dist*100,0,100).toFixed(2)+'%';}
  const bio={wald:'Wald',felder:'Felder',alpen:'Alpen'}[biomeAt(rt,SCV.vp||0,rt?trackAt(rt,SCV.vp||0).e:0)];
  setT('fProg',`${dayAt(rideMin()).n} · ${bio}${rt&&rt.loop&&S.sim.lap>1?` · Runde ${S.sim.lap}`:''}`);
  const P=S.pace,gEl=$('#fGhost');
  if(P&&!P.off&&R.state!=='idle'){const gap=P.total-S.sim.total;gEl.hidden=false;gEl.className='f-ghost'+(gap>0?'':' behind');setT('fGhostT',`${P.name} · ${gap>0?n0(gap)+' m vor dir':n0(-gap)+' m hinter dir'}`);}
  else gEl.hidden=true;
  renderRamp();renderCoach();
  /* Zielleistung direkt in der Fahrt-Ansicht */
  $('#fErg').classList.toggle('on',S.erg.on);setT('fErgW',S.erg.on?`${Math.round(S.erg.target)} W`:'Aus');
}
$('#fErg').addEventListener('click',e=>{
  const b=e.target.closest('[data-ferg]');if(!b)return;
  const v=b.dataset.ferg;
  if(v==='an'){S.erg.on=!S.erg.on;}else{S.erg.on=true;S.erg.target=clamp(S.erg.target+(+v),0,1000);}
  ergChanged();renderFull();
});

/* Ein Zeichen-Takt für Fahrt-Ansicht und Hintergrund. Gezeichnet wird nur, solange etwas zu sehen ist.
   Höchstens 60 Bilder/s (Hintergrund 30), bei „Bewegung reduzieren“ nur 2 (per Timer statt Bildwiederholung). */
const lowMotion=matchMedia('(prefers-reduced-motion: reduce)');let sceneOn=false,lastFrame=0;
const sceneWanted=()=>!$('#full').hidden||(S.view==='live'&&!document.hidden);
function sceneKick(){if(!sceneOn&&sceneWanted()){sceneOn=true;sceneLoop();}}
function sceneLoop(){
  if(!sceneWanted()){sceneOn=false;return;}
  if(lowMotion.matches)setTimeout(sceneLoop,500);else requestAnimationFrame(sceneLoop);
  const full=!$('#full').hidden,t=performance.now();if(t-lastFrame<12)return;lastFrame=t;
  if(full){drawScene($('#cvFull'));drawFullProf($('#cvFullProf'));renderFull();const rt=activeRoute(),mc=$('#cvFullMap');if(rt&&mc.offsetParent)drawMap(mc,rt,S.rec.state==='idle'?0:clamp(rt.loop?(SCV.vp%rt.dist):SCV.vp,0,rt.dist));}
  else drawScene($('#cvBack'),{back:true});
}
document.addEventListener('visibilitychange',sceneKick);

/* Maus in der Fahrt-Ansicht nach kurzer Zeit ausblenden */
document.addEventListener('mousemove',()=>{const f=$('#full');if(f.hidden)return;f.classList.remove('still');clearTimeout(stillT);stillT=setTimeout(()=>f.classList.add('still'),2500);});

/* Tastatur: F Vollbild, Leertaste Start/Pause/Weiter, Pfeile Zielleistung, Esc/Ü Übersicht */
document.addEventListener('keydown',e=>{
  const tg=e.target;if(HANDY||e.metaKey||e.ctrlKey||e.altKey||(tg&&(tg.tagName==='INPUT'||tg.tagName==='TEXTAREA'))||document.querySelector('dialog[open]'))return;
  const st=S.rec.state;
  if(e.key==='f'||e.key==='F'){e.preventDefault();toggleOsFull();}
  else if(e.key===' '){e.preventDefault();if(st==='idle')beginRide();else if(st==='rec')pauseRec();else if(st==='pause')resumeRec();}
  else if(e.key==='Escape'&&!$('#full').hidden&&!document.fullscreenElement)closeFull();
  else if((e.key==='ArrowUp'||e.key==='ArrowDown')&&S.erg.on){e.preventDefault();S.erg.target=clamp(S.erg.target+(e.key==='ArrowUp'?5:-5),0,1000);ergChanged();renderFull();toast(`Zielleistung ${S.erg.target} W`);}
});
