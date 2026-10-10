'use strict';
/* ---------- Szene: Straße zum Durchfahren ---------- */
/* Pseudo-3D wie bei klassischen Rennspielen: Die Straße vor dir folgt Kurven und Höhen der gewählten
   Strecke (Höhen leicht überzeichnet, damit 5 % auch nach 5 % aussehen). Dazu Berge im Hintergrund,
   Bäume am Rand, Kilometerschilder und ein Geist bzw. Schrittmacher zum Hinterherfahren.
   Gezeichnet wird nur, wenn die Szene sichtbar ist (Vollbild oder Fahrt-Modus). */

const SCN={seg:5,n:260,ex:2.4,half:3.2};
/* Leuchtfarben je Zone, von ruhigem Grau-Lila bis Magenta/Rot – unabhängig vom hellen/dunklen Thema */
const GLOW=['#646a7c','#6E62B5','#7F5FE8','#9A6BFF','#C266F0','#F062B8','#FF5C7A'];
const hex2=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const mixc=(a,b,t)=>`rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;
const hash=k=>{const x=Math.sin(k*127.1+311.7)*43758.5453;return x-Math.floor(x);};

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

/* Berge: drei Schichten, verschieben sich beim Abbiegen (Parallaxe) */
const MTN=[0,1,2].map(l=>{const a=[];for(let i=0;i<256;i++){let v=0;for(let o=1;o<=4;o++)v+=Math.sin(i/256*Math.PI*2*(o*2+l)+hash(l*9+o)*6)/o;a.push(v);}return a;});

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
  if(P.kind==='geist'){const t=recElapsed()/1000,i=Math.min(P.dist.length-1,Math.floor(t)),f=Math.min(1,t-i);P.total=P.dist[i]+((P.dist[i+1]??P.dist[i])-P.dist[i])*f;return;}
  const rt=activeRoute(),m=S.set.weight+S.set.bike;
  const pd=rt?(rt.loop?P.total%rt.dist:Math.min(P.total,rt.dist)):0,g=rt?gradeAt(rt,pd):0,th=Math.atan(g/100);
  const res=m*PHYS.g*(PHYS.crr*Math.cos(th)+Math.sin(th))+.5*PHYS.rho*PHYS.cda*P.v*P.v;
  P.v=clamp(P.v+(P.watt/Math.max(P.v,1)-res)/(m+1.5)*dt,0,25);P.total+=P.v*dt;
}
/* Jede Sekunde aus checkMoments: Überholen melden */
function paceCheck(){
  const P=S.pace;if(!P||recElapsed()<20000)return;
  const ahead=S.sim.total>P.total+5;
  if(P.ahead!=null&&ahead!==P.ahead)moment('flag',ahead?`${P.name} überholt`:`${P.name} zieht vorbei`,ahead?'Weiter so, nicht nachlassen':`Abstand ${n0(P.total-S.sim.total)} m`,ahead?'gold':'');
  P.ahead=ahead;
}

/* Zeichnen */
function drawScene(c,mini){
  const dpr=Math.min(2,devicePixelRatio||1),W=c.clientWidth,H=c.clientHeight;if(!W||!H)return;
  if(c.width!==Math.round(W*dpr)||c.height!==Math.round(H*dpr)){c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);}
  const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  const rt=activeRoute(),pos=rt?S.sim.d:S.sim.total,pw=curPow(),ftp=S.set.ftp;
  const zi=pw!=null&&pw>0?zoneIdx(pw,ftp):0,zc=hex2(GLOW[zi]);
  const t0=trackAt(rt,pos),g0=rt?routeGradeNow()/100:0;
  const hy=H*(mini?.47:.5),F=Math.max(W,H*1.5)*.62,camY=1.7;
  const sky=[11,10,20],haze=hex2('#2a2140'),hor=mixc(haze,zc,.45),horA=[...hex2('#2a2140')].map((v,i)=>v+(zc[i]-v)*.45);
  /* Himmel mit Leuchten am Horizont, das mit der Leistung atmet */
  let gr=ctx.createLinearGradient(0,0,0,hy);gr.addColorStop(0,`rgb(${sky})`);gr.addColorStop(1,hor);ctx.fillStyle=gr;ctx.fillRect(0,0,W,hy+2);
  const glow=clamp((pw||0)/ftp,.25,1.6);
  gr=ctx.createRadialGradient(W/2,hy,0,W/2,hy,W*.55*glow);gr.addColorStop(0,`rgba(${zc},.55)`);gr.addColorStop(1,`rgba(${zc},0)`);ctx.fillStyle=gr;ctx.fillRect(0,0,W,hy+2);
  /* Berge */
  MTN.forEach((m,l)=>{
    const hgt=H*(mini?.09:.11)*(1-l*.22),off=t0.h*256/Math.PI*(.35+l*.25),col=mixc(horA,[16+l*6,14+l*5,28+l*8],.35+l*.25);
    ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(0,hy+1);
    for(let x=0;x<=W+8;x+=8){const f=(x/W*128+off)%256,i=((Math.floor(f)%256)+256)%256,j=(i+1)%256,k=f-Math.floor(f),v=m[i]+(m[j]-m[i])*k;ctx.lineTo(x,hy-hgt*(.55+.32*v)-g0*H*.6);}
    ctx.lineTo(W,hy+1);ctx.closePath();ctx.fill();
  });
  /* Straße: Punkte vor dir berechnen (seitlicher Versatz aus den Richtungsänderungen) */
  const s0=Math.floor(pos/SCN.seg)*SCN.seg,P=[];let x=0,z=s0-pos,y0=t0.e;
  for(let k=0;k<=SCN.n;k++){
    const s=s0+k*SCN.seg,tr=trackAt(rt,s);if(k){const th=wrapA(tr.h-t0.h);x+=Math.sin(th)*SCN.seg;z+=Math.cos(th)*SCN.seg;}
    const y=(tr.e-y0)*SCN.ex-z*g0*SCN.ex*.3;
    P.push({s,x,z,y,e:tr.e});
  }
  const camX=P[Math.min(2,P.length-1)].x*.6+1.4;
  const pr=p=>{const zz=Math.max(p.z,.5),k=F/zz;return{sx:W/2+(p.x-camX)*k,sy:hy-(p.y-camY)*k,w:SCN.half*k,k};};
  const far=SCN.n*SCN.seg,ground=[[20,18,32],[23,20,37]],road=[[34,32,46],[38,35,52]],fogC=horA;
  ctx.fillStyle=`rgb(${ground[0]})`;ctx.fillRect(0,hy,W,H-hy);
  const sprites=[];
  for(let k=SCN.n;k>=1;k--){
    const a=P[k-1],b=P[k];if(a.z<=.6)continue;
    const p1=pr(a),p2=pr(b),fz=Math.pow(Math.min(1,b.z/far),.7),par=Math.floor(b.s/(SCN.seg*2))%2;
    if(p2.sy>=p1.sy&&p1.sy<hy-2)continue;
    ctx.fillStyle=mixc(ground[par],fogC,fz);ctx.fillRect(0,Math.min(p1.sy,p2.sy)-.5,W,Math.abs(p1.sy-p2.sy)+1);
    const quad=(w1,w2,col)=>{ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(p1.sx-w1,p1.sy+.5);ctx.lineTo(p1.sx+w1,p1.sy+.5);ctx.lineTo(p2.sx+w2,p2.sy);ctx.lineTo(p2.sx-w2,p2.sy);ctx.closePath();ctx.fill();};
    quad(p1.w*1.14,p2.w*1.14,mixc(par?[127,95,232]:[70,58,120],fogC,fz));
    quad(p1.w,p2.w,mixc(road[par],fogC,fz));
    if(a.z>4&&Math.floor(b.s/SCN.seg)%4<2)quad(p1.k*.06,p2.k*.06,`rgba(240,236,255,${.75*(1-fz)})`);
    /* Bäume alle 30 m, Kilometerschild jeden km */
    if(b.s%30===0){const side=hash(b.s)>.5?1:-1,tx=b.x+side*(SCN.half+2.5+hash(b.s+1)*9),ty=b.y,hh=7+hash(b.s+2)*7;sprites.push({k,draw:()=>tree(ctx,pr({x:tx,y:ty,z:b.z}),hh,fz,fogC)});}
    if(b.s%1000===0&&b.s>0){const sx=b.x+SCN.half+1.2;sprites.push({k,draw:()=>sign(ctx,pr({x:sx,y:b.y,z:b.z}),b.s,rt,fz)});}
    while(sprites.length&&sprites[sprites.length-1].k===k)sprites.pop().draw();
  }
  /* Geist / Schrittmacher */
  const Pc=S.pace;
  if(Pc&&S.rec.state!=='idle'){
    const gap=Pc.total-S.sim.total;
    if(gap>2&&gap<far){const kk=gap/SCN.seg,i=Math.min(SCN.n-1,Math.floor(kk)),f=kk-i,a=P[i],b=P[i+1];const q=pr({x:a.x+(b.x-a.x)*f-1.2,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f});rider(ctx,q,Pc.kind==='geist');}
  }
  /* Vignette */
  gr=ctx.createRadialGradient(W/2,H*.55,Math.min(W,H)*.3,W/2,H*.55,Math.max(W,H)*.75);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,.55)');ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);
}
function tree(ctx,q,h,fz,fogC){
  const hh=h*q.k,w=hh*.32;if(hh<1.5)return;
  ctx.fillStyle=mixc([28,40,44],fogC,fz);
  ctx.beginPath();ctx.moveTo(q.sx,q.sy-hh);ctx.lineTo(q.sx+w,q.sy-hh*.18);ctx.lineTo(q.sx-w,q.sy-hh*.18);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(q.sx,q.sy-hh*.62);ctx.lineTo(q.sx+w*1.25,q.sy);ctx.lineTo(q.sx-w*1.25,q.sy);ctx.closePath();ctx.fill();
}
function sign(ctx,q,s,rt,fz){
  const h=2.2*q.k,w=1.6*q.k;if(w<6)return;
  ctx.globalAlpha=1-fz;ctx.fillStyle='#d9d3ff';ctx.fillRect(q.sx-w*.04,q.sy-h,w*.08,h);
  ctx.fillStyle='#7F5FE8';ctx.fillRect(q.sx-w/2,q.sy-h-w*.55,w,w*.55);
  ctx.fillStyle='#fff';ctx.font=`600 ${Math.max(6,w*.28)}px Geist,system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  const km=rt&&!rt.loop?Math.max(0,Math.round((rt.dist-s)/1000)):Math.round(s/1000);
  ctx.fillText(rt&&!rt.loop?`${km} km`:`km ${km}`,q.sx,q.sy-h-w*.27);ctx.globalAlpha=1;
}
function rider(ctx,q,ghost){
  const h=1.8*q.k;if(h<3)return;
  ctx.save();ctx.globalAlpha=ghost?.75:.9;ctx.shadowColor=ghost?'#C4B5FD':'#F5C451';ctx.shadowBlur=Math.min(30,h*.6);
  ctx.strokeStyle=ctx.fillStyle=ghost?'#E6DEFF':'#F5C451';ctx.lineWidth=Math.max(1,h*.07);ctx.lineCap='round';
  const r=h*.2;ctx.beginPath();ctx.arc(q.sx-h*.28,q.sy-r,r,0,7);ctx.moveTo(q.sx+h*.28+r,q.sy-r);ctx.arc(q.sx+h*.28,q.sy-r,r,0,7);ctx.stroke();
  ctx.beginPath();ctx.moveTo(q.sx-h*.28,q.sy-r);ctx.lineTo(q.sx,q.sy-h*.55);ctx.lineTo(q.sx+h*.28,q.sy-r);ctx.moveTo(q.sx,q.sy-h*.55);ctx.lineTo(q.sx+h*.1,q.sy-h*.8);ctx.stroke();
  ctx.beginPath();ctx.arc(q.sx+h*.12,q.sy-h*.92,h*.09,0,7);ctx.fill();ctx.restore();
}

/* Höhenprofil im Vollbild: ganze Strecke, gefahrener Teil hell, du und der Geist als Punkte.
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

/* Vollbild */
let fsReq=false,stillT=null;
function openFull(){
  const f=$('#full');if(!f.hidden)return;
  f.hidden=false;document.body.classList.add('fullon');f.appendChild($('#moment'));
  if(!S.pace)paceReset();
  renderControls();renderFull();sceneKick();
  try{const p=document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen({navigationUI:'hide'});if(p)p.then(()=>{fsReq=true;}).catch(()=>{});}catch(_){}
}
function closeFull(){
  const f=$('#full');if(f.hidden)return;
  f.hidden=true;document.body.classList.remove('fullon');$('.card.live').appendChild($('#moment'));renderControls();
  if(fsReq&&document.fullscreenElement){fsReq=false;document.exitFullscreen().catch(()=>{});}
}
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&fsReq){fsReq=false;closeFull();}});
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
  setT('fProg',rt?`${n1(S.sim.d/1000)} von ${n1(rt.dist/1000)} km · ${n0(S.sim.gain)} Hm`:`${n1(S.sim.total/1000)} km`);
  const P=S.pace,gEl=$('#fGhost');
  if(P&&R.state!=='idle'){const gap=P.total-S.sim.total;gEl.hidden=false;gEl.className='f-ghost'+(gap>0?'':' behind');setT('fGhostT',`${P.name} · ${gap>0?n0(gap)+' m vor dir':n0(-gap)+' m hinter dir'}`);}
  else gEl.hidden=true;
}

/* Ein Zeichen-Takt für Vollbild und Mini-Szene in der Live-Karte */
/* Zeichnen nur, solange etwas zu sehen ist: Vollbild offen oder Fahrt in der Live-Ansicht.
   Höchstens 60 Bilder/s, bei „Bewegung reduzieren“ nur 2 (per Timer statt Bildwiederholung). */
const lowMotion=matchMedia('(prefers-reduced-motion: reduce)');let sceneOn=false,lastFrame=0;
const sceneWanted=()=>!$('#full').hidden||(document.body.classList.contains('riding')&&S.view==='live');
function sceneKick(){if(!sceneOn&&sceneWanted()){sceneOn=true;sceneLoop();}}
function sceneLoop(){
  if(!sceneWanted()){sceneOn=false;return;}
  if(lowMotion.matches)setTimeout(sceneLoop,500);else requestAnimationFrame(sceneLoop);
  const t=performance.now();if(t-lastFrame<15)return;lastFrame=t;
  if(!$('#full').hidden){drawScene($('#cvFull'),false);drawFullProf($('#cvFullProf'));renderFull();}
  else{const c=$('#cvScene');if(c&&c.offsetParent)drawScene(c,true);}
}

/* Maus im Vollbild nach kurzer Zeit ausblenden */
document.addEventListener('mousemove',()=>{const f=$('#full');if(f.hidden)return;f.classList.remove('still');clearTimeout(stillT);stillT=setTimeout(()=>f.classList.add('still'),2500);});

/* Tastatur: F Vollbild, Leertaste Start/Pause/Weiter, Pfeile Zielleistung, Esc schließt */
document.addEventListener('keydown',e=>{
  const tg=e.target;if(e.metaKey||e.ctrlKey||e.altKey||(tg&&(tg.tagName==='INPUT'||tg.tagName==='TEXTAREA'))||document.querySelector('dialog[open]'))return;
  const st=S.rec.state;
  if(e.key==='f'||e.key==='F'){e.preventDefault();$('#full').hidden?openFull():closeFull();}
  else if(e.key===' '){e.preventDefault();if(st==='idle')beginRide();else if(st==='rec')pauseRec();else if(st==='pause')resumeRec();}
  else if(e.key==='Escape'&&!$('#full').hidden)closeFull();
  else if((e.key==='ArrowUp'||e.key==='ArrowDown')&&S.erg.on){e.preventDefault();S.erg.target=clamp(S.erg.target+(e.key==='ArrowUp'?5:-5),0,1000);ergChanged();toast(`Zielleistung ${S.erg.target} W`);}
});
