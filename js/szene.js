'use strict';
/* ---------- Szene: Straße zum Durchfahren ---------- */
/* Pseudo-3D wie bei klassischen Rennspielen: Die Straße vor dir folgt Kurven und Höhen der gewählten
   Strecke (Höhen leicht überzeichnet). Je länger du fährst, desto mehr verändert sich die Welt:
   Tageszeit nach Fahrtdauer (Abendrot → Nacht → Morgengrauen → Tag → Sonnenuntergang),
   Landschaft nach Strecke (Wald, Felder, ab 900 m Alpen). Dazu Geist bzw. Schrittmacher als Radfahrer.
   Die Szene ist die Fahrt-Ansicht (#full) und im Leerlauf der Hintergrund von „Fahren“ (#cvBack). */

const SCN={seg:5,n:260,ex:2.4,half:3.2};
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
function trackAt(rt,d){
  if(!rt)return{e:1.2*Math.sin(d/180)+.6*Math.sin(d/57),h:.55*Math.sin(d/520)+.3*Math.sin(d/190+1)};
  d=rt.loop?((d%rt.dist)+rt.dist)%rt.dist:clamp(d,0,rt.dist);
  const H=headings(rt),x=d/rt.step,i=Math.min(H.length-2,Math.floor(x)),f=x-i;
  return{e:eleAt(rt,d),h:H[i]+(H[i+1]-H[i])*f};
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
const SCV={alp:0,idle:0,lastT:0}; /* geglättete Werte zwischen den Bildern */

/* Geist: beste frühere Fahrt auf dieser Strecke, sonst Schrittmacher mit 75 % FTP */
function paceReset(){
  const rt=activeRoute(),ftp=S.set.ftp;
  const prev=rt?S.rides.filter(r=>!r.sample&&r.route===rt.name&&r.dist&&r.dist.length>30):[];
  const best=prev.sort((a,b)=>b.dist[b.dist.length-1]/b.dist.length-a.dist[a.dist.length-1]/a.dist.length)[0];
  S.pace=best?{kind:'geist',name:'Dein Geist',dist:best.dist,total:0,v:0,ahead:null}
             :{kind:'pacer',name:`Schrittmacher ${Math.round(ftp*.75/5)*5} W`,watt:Math.round(ftp*.75/5)*5,total:0,v:0,ahead:null};
}
function paceStep(dt){
  const P=S.pace;if(!P)return;
  if(P.kind==='geist'){const t=recElapsed()/1000,i=Math.min(P.dist.length-1,Math.floor(t)),f=Math.min(1,t-i);const a=P.dist[i],b=P.dist[i+1]??a;P.v=Math.max(0,b-a);P.total=a+(b-a)*f;return;}
  const rt=activeRoute(),m=S.set.weight+S.set.bike;
  const pd=rt?(rt.loop?P.total%rt.dist:Math.min(P.total,rt.dist)):0,g=rt?gradeAt(rt,pd):0,th=Math.atan(g/100);
  const res=m*PHYS.g*(PHYS.crr*Math.cos(th)+Math.sin(th))+.5*PHYS.rho*PHYS.cda*P.v*P.v;
  P.v=clamp(P.v+(P.watt/Math.max(P.v,1)-res)/(m+1.5)*dt,0,25);P.total+=P.v*dt;
}
/* Jede Sekunde aus checkMoments: Überholen und Tageszeit melden */
let lastDay=null;
function paceCheck(){
  const d=dayAt(rideMin()).n;
  if(lastDay&&d!==lastDay&&recElapsed()>60000)moment('peak',{Nacht:'Die Nacht bricht herein',Morgengrauen:'Der Morgen graut',Tag:'Guten Morgen, Sonne',Sonnenuntergang:'Die Sonne geht unter',Abendrot:'Abendrot'}[d]||d,`${fmtDur(recElapsed()/1000)} unterwegs`);
  lastDay=d;
  const P=S.pace;if(!P||recElapsed()<20000)return;
  const ahead=S.sim.total>P.total+5;
  if(P.ahead!=null&&ahead!==P.ahead)moment('flag',ahead?`${P.name} überholt`:`${P.name} zieht vorbei`,ahead?'Weiter so, nicht nachlassen':`Abstand ${n0(P.total-S.sim.total)} m`,ahead?'gold':'');
  P.ahead=ahead;
}

/* Zeichnen. opt.back: Hintergrund im Leerlauf (langsam rollend, niedrige Auflösung) */
function drawScene(c,opt={}){
  const dpr=opt.back?1:Math.min(2,devicePixelRatio||1),W=c.clientWidth,H=c.clientHeight;if(!W||!H)return;
  if(c.width!==Math.round(W*dpr)||c.height!==Math.round(H*dpr)){c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);}
  const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  const now=performance.now(),dt=clamp((now-(SCV.lastT||now))/1000,0,.2);SCV.lastT=now;
  const riding=S.rec.state!=='idle',rt=activeRoute();
  if(!riding)SCV.idle+=dt*6; /* im Leerlauf rollt die Straße gemächlich weiter */
  const pos=riding?(rt?S.sim.d:S.sim.total):(rt?(rt.loop?SCV.idle%rt.dist:Math.min(SCV.idle,rt.dist)):SCV.idle);
  const pw=riding||isLive()?curPow():null,ftp=S.set.ftp;
  const zi=pw!=null&&pw>0?zoneIdx(pw,ftp):0,zc=hex2(GLOW[zi]);
  const D=dayAt(rideMin()),t0=trackAt(rt,pos),g0=rt&&riding?routeGradeNow()/100:0;
  const hy=H*(opt.back?.5:.42),F=Math.max(W,H*1.5)*.62,camY=1.7;
  const horA=lerp3(D.hor,zc,D.zm*(pw?1:.4)),fogC=horA;
  /* Alpen-Anteil weich überblenden */
  const alpT=biomeAt(rt,pos+600,rt?trackAt(rt,pos+600).e:0)==='alpen'?1:0;SCV.alp+=(alpT-SCV.alp)*Math.min(1,dt*.8);
  /* Himmel */
  let gr=ctx.createLinearGradient(0,0,0,hy);gr.addColorStop(0,rgb(D.top));gr.addColorStop(1,rgb(horA));ctx.fillStyle=gr;ctx.fillRect(0,0,W,hy+2);
  if(D.stars>.02){for(const s of STARS){const a=D.stars*(.55+.45*Math.sin(now/700+s.p));ctx.fillStyle=`rgba(255,255,255,${a*(1-s.y)})`;ctx.fillRect(s.x*W,s.y*hy*.95,s.r,s.r);}}
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
    const top=hy-hgt*1.2-g0*H*.6;
    if(SCV.alp>.05){gr=ctx.createLinearGradient(0,top,0,hy);gr.addColorStop(0,mixc(col,[245,245,255],SCV.alp*.85));gr.addColorStop(.35,rgb(col));gr.addColorStop(1,rgb(col));ctx.fillStyle=gr;}else ctx.fillStyle=rgb(col);
    ctx.beginPath();ctx.moveTo(0,hy+1);
    for(let x=0;x<=W+8;x+=8){const f=(x/W*128+off)%256,i=((Math.floor(f)%256)+256)%256,j=(i+1)%256,k=f-Math.floor(f),v=m[i]+(m[j]-m[i])*k;ctx.lineTo(x,hy-hgt*(.55+.32*v*(1+SCV.alp*.6))-g0*H*.6);}
    ctx.lineTo(W,hy+1);ctx.closePath();ctx.fill();
  });
  /* Straße: Punkte vor dir berechnen (seitlicher Versatz aus den Richtungsänderungen) */
  const s0=Math.floor(pos/SCN.seg)*SCN.seg,P=[];let x=0,z=s0-pos;const y0=t0.e;
  for(let k=0;k<=SCN.n;k++){
    const s=s0+k*SCN.seg,tr=trackAt(rt,s);if(k){const th=wrapA(tr.h-t0.h);x+=Math.sin(th)*SCN.seg;z+=Math.cos(th)*SCN.seg;}
    P.push({s,x,z,y:(tr.e-y0)*SCN.ex-z*g0*SCN.ex*.3,e:tr.e});
  }
  const camX=P[Math.min(2,P.length-1)].x*.6+1.4;
  const pr=p=>{const zz=Math.max(p.z,.5),k=F/zz;return{sx:W/2+(p.x-camX)*k,sy:hy-(p.y-camY)*k,w:SCN.half*k,k};};
  const far=SCN.n*SCN.seg;
  ctx.fillStyle=rgb(D.g[0]);ctx.fillRect(0,hy,W,H-hy);
  const rum=[lerp3([127,95,232],D.r[0],.15),lerp3([70,58,120],D.r[0],.3)];
  for(let k=SCN.n;k>=1;k--){
    const a=P[k-1],b=P[k];if(a.z<=.6)continue;
    const p1=pr(a),p2=pr(b),fz=Math.pow(Math.min(1,b.z/far),.7),par=Math.floor(b.s/(SCN.seg*2))%2;
    if(p2.sy>=p1.sy&&p1.sy<hy-2)continue;
    ctx.fillStyle=mixc(D.g[par],fogC,fz);ctx.fillRect(0,Math.min(p1.sy,p2.sy)-.5,W,Math.abs(p1.sy-p2.sy)+1);
    const quad=(w1,w2,col)=>{ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(p1.sx-w1,p1.sy+.5);ctx.lineTo(p1.sx+w1,p1.sy+.5);ctx.lineTo(p2.sx+w2,p2.sy);ctx.lineTo(p2.sx-w2,p2.sy);ctx.closePath();ctx.fill();};
    quad(p1.w*1.14,p2.w*1.14,mixc(rum[par],fogC,fz));
    quad(p1.w,p2.w,mixc(D.r[par],fogC,fz));
    if(a.z>4&&Math.floor(b.s/SCN.seg)%4<2)quad(p1.k*.06,p2.k*.06,`rgba(240,236,255,${.75*(1-fz)})`);
    /* Landschaft am Rand */
    const bio=biomeAt(rt,b.s,b.e),s=b.s,side=hash(s)>.5?1:-1,at=(dx,dy=0)=>pr({x:b.x+dx,y:b.y+dy,z:b.z});
    if(bio==='wald'){
      if(s%25===0){fir(ctx,at(side*(SCN.half+2.5+hash(s+1)*9)),7+hash(s+2)*7,D,fz,fogC);if(hash(s+3)>.55)fir(ctx,at(-side*(SCN.half+3+hash(s+4)*10)),8+hash(s+5)*6,D,fz,fogC);}
    }else if(bio==='felder'){
      if(s%15===0)post(ctx,at(SCN.half+.9),fz,fogC);
      if(s%80===0)leaf(ctx,at(side*(SCN.half+6+hash(s+6)*16)),6+hash(s+7)*4,D,fz,fogC);
    }else{
      if(s%40===0&&hash(s+8)>.45)fir(ctx,at(side*(SCN.half+3+hash(s+9)*12)),5+hash(s+10)*4,D,fz,fogC);
      if(s%55===0)rock(ctx,at(-side*(SCN.half+2+hash(s+11)*7)),1+hash(s+12)*2.5,D,fz,fogC);
    }
    if(s%1000===0&&s>0&&!opt.back)sign(ctx,at(SCN.half+1.2),s,rt,fz);
  }
  /* Geist / Schrittmacher als Radfahrer */
  const Pc=S.pace;
  if(Pc&&riding){
    const gap=Pc.total-S.sim.total;
    if(gap>1.5&&gap<far){const kk=gap/SCN.seg,i=Math.min(SCN.n-1,Math.floor(kk)),f=kk-i,a=P[i],b=P[i+1];
      const q=pr({x:a.x+(b.x-a.x)*f-.6,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f});
      cyclist(ctx,q,Pc.kind==='geist',now/1000*(Pc.v>.3?1.45:0),Math.min(1,gap/far*1.5));}
  }
  /* Vignette */
  gr=ctx.createRadialGradient(W/2,H*.55,Math.min(W,H)*.3,W/2,H*.55,Math.max(W,H)*.75);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,`rgba(0,0,0,${opt.back?.65:.5})`);ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);
}
/* Nadelbaum */
function fir(ctx,q,h,D,fz,fogC){
  const hh=h*q.k,w=hh*.32;if(hh<1.5)return;
  ctx.fillStyle=mixc(D.tree,fogC,fz);
  ctx.beginPath();ctx.moveTo(q.sx,q.sy-hh);ctx.lineTo(q.sx+w,q.sy-hh*.18);ctx.lineTo(q.sx-w,q.sy-hh*.18);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(q.sx,q.sy-hh*.62);ctx.lineTo(q.sx+w*1.25,q.sy);ctx.lineTo(q.sx-w*1.25,q.sy);ctx.closePath();ctx.fill();
}
/* Laubbaum: Stamm und runde Krone */
function leaf(ctx,q,h,D,fz,fogC){
  const hh=h*q.k;if(hh<1.5)return;
  const col=lerp3(D.tree,[60,90,60],.25);
  ctx.fillStyle=mixc(lerp3(col,[40,30,30],.5),fogC,fz);ctx.fillRect(q.sx-hh*.04,q.sy-hh*.5,hh*.08,hh*.5);
  ctx.fillStyle=mixc(col,fogC,fz);ctx.beginPath();ctx.ellipse(q.sx,q.sy-hh*.68,hh*.34,hh*.32,0,0,7);ctx.fill();
  ctx.beginPath();ctx.ellipse(q.sx+hh*.18,q.sy-hh*.55,hh*.22,hh*.2,0,0,7);ctx.fill();
}
/* Zaunpfahl mit Reflektor */
function post(ctx,q,fz,fogC){
  const h=1.1*q.k;if(h<2)return;
  ctx.fillStyle=mixc([220,215,235],fogC,fz);ctx.fillRect(q.sx-h*.04,q.sy-h,h*.08,h);
  ctx.fillStyle=`rgba(255,120,90,${1-fz})`;ctx.fillRect(q.sx-h*.04,q.sy-h*.85,h*.08,h*.12);
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
  if(S.pace&&S.rec.state!=='idle'){const gd=rt.loop?S.pace.total%rt.dist:Math.min(S.pace.total,rt.dist);dot(gd,S.pace.kind==='geist'?'#E6DEFF':'#F5C451',4);}
  dot(S.sim.d,'#fff',5.5);
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
  setT('fGrade',rt?((routeGradeNow()>0.05?'+':'')+n1(routeGradeNow())):'0,0');
  setT('fTime',fmtDur((R.state==='idle'?0:recElapsed())/1000));
  setT('fRoute',rt?rt.name:'Frei fahren');
  setT('fProg',(rt?`${n1(S.sim.d/1000)} von ${n1(rt.dist/1000)} km · ${n0(S.sim.gain)} Hm`:`${n1(S.sim.total/1000)} km`)+` · ${dayAt(rideMin()).n}`);
  const P=S.pace,gEl=$('#fGhost');
  if(P&&R.state!=='idle'){const gap=P.total-S.sim.total;gEl.hidden=false;gEl.className='f-ghost'+(gap>0?'':' behind');setT('fGhostT',`${P.name} · ${gap>0?n0(gap)+' m vor dir':n0(-gap)+' m hinter dir'}`);}
  else gEl.hidden=true;
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
  const full=!$('#full').hidden,t=performance.now();if(t-lastFrame<(full?15:31))return;lastFrame=t;
  if(full){drawScene($('#cvFull'));drawFullProf($('#cvFullProf'));renderFull();}
  else drawScene($('#cvBack'),{back:true});
}
document.addEventListener('visibilitychange',sceneKick);

/* Maus in der Fahrt-Ansicht nach kurzer Zeit ausblenden */
document.addEventListener('mousemove',()=>{const f=$('#full');if(f.hidden)return;f.classList.remove('still');clearTimeout(stillT);stillT=setTimeout(()=>f.classList.add('still'),2500);});

/* Tastatur: F Vollbild, Leertaste Start/Pause/Weiter, Pfeile Zielleistung, Esc/Ü Übersicht */
document.addEventListener('keydown',e=>{
  const tg=e.target;if(e.metaKey||e.ctrlKey||e.altKey||(tg&&(tg.tagName==='INPUT'||tg.tagName==='TEXTAREA'))||document.querySelector('dialog[open]'))return;
  const st=S.rec.state;
  if(e.key==='f'||e.key==='F'){e.preventDefault();toggleOsFull();}
  else if(e.key===' '){e.preventDefault();if(st==='idle')beginRide();else if(st==='rec')pauseRec();else if(st==='pause')resumeRec();}
  else if(e.key==='Escape'&&!$('#full').hidden&&!document.fullscreenElement)closeFull();
  else if((e.key==='ArrowUp'||e.key==='ArrowDown')&&S.erg.on){e.preventDefault();S.erg.target=clamp(S.erg.target+(e.key==='ArrowUp'?5:-5),0,1000);ergChanged();renderFull();toast(`Zielleistung ${S.erg.target} W`);}
});
