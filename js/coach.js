'use strict';
/* ---------- Coach: Hinweise während der Fahrt ---------- */
/* Freiwillig, auf der Startkarte gewählt (S.set.coach: '' aus, sonst ein Ziel aus COACH), nur mit bekannter FTP.
   Auf einer Strecke werden die Anstiege vorab erkannt. Vor dem Fuß: wie lang, wie steil, welche Leistung, wie lange.
   Am Berg: Zielleistung und Restzeit bis oben. Kurz vor der Kuppe: wie viele Sekunden noch drücken, nämlich bis
   es hinter der Kuppe richtig bergab rollt (dort ist Tempo am billigsten zu holen). Bergab: erholen.
   Frei fahren: Zielbereich des Ziels halten. Zeiten aus derselben Fahrphysik wie simStep. */
const COACH={
  locker:{n:'Locker',sub:'Grundlage, am Berg nicht überziehen',lo:.56,hi:.75,top:.8},
  zuegig:{n:'Zügig',sub:'Tempo, an Anstiegen etwas fester',lo:.72,hi:.88,top:.95},
  vollgas:{n:'Vollgas',sub:'Bestzeit, Kraft in die Anstiege',lo:.82,hi:.98,top:1.2}
};
const coachGoal=()=>COACH[S.set.coach]||null;
/* FTP gilt als bekannt nach einem FTP-Test, eigenem Eintrag oder einem Wert aus dem Konto (nicht mehr der Startwert) */
const ftpKnown=()=>!!(S.set.ftpOk||S.set.ftp!==200||S.rides.some(r=>r.ftpTest));
const w5=w=>Math.round(w/5)*5;

/* Gleichgewichtstempo bei Leistung P und Steigung g (wie simStep, ohne Beschleunigung) */
function speedAt(P,g){
  const m=S.set.weight+S.set.bike,th=Math.atan(g/100),A=m*PHYS.g*(PHYS.crr*Math.cos(th)+Math.sin(th)),B=.5*PHYS.rho*PHYS.cda;
  const f=v=>v*(A+B*v*v);if(f(25)<=P)return 25;
  let lo=.3,hi=25;for(let i=0;i<30;i++){const v=(lo+hi)/2;if(f(v)<P)lo=v;else hi=v;}
  return Math.max(lo,1);
}
function rideTime(rt,d0,d1,P){let t=0;for(let x=d0;x<d1;x+=rt.step){const s=Math.min(rt.step,d1-x);t+=s/speedAt(P,gradeAt(rt,x+s/2));}return t;}
/* Wie fest am Berg: je kürzer, desto mehr über der FTP geht, gedeckelt durch das Ziel */
function climbWatt(t,G){const cap=t<=180?1.2:t<=480?1.08:t<=1200?1:.95;return w5(S.set.ftp*Math.min(cap,G.top));}

/* Anstiege: ab 3 % im Schnitt, mindestens 200 m und 12 Hm. Kurze Dellen (bis 12 m runter, 400 m ohne neuen Gipfel)
   gehören dazu. over = Punkt hinter der Kuppe, ab dem es mit mehr als 2,5 % bergab geht (höchstens 300 m weiter). */
function findClimbs(rt){
  const e=rt.ele,st=rt.step,n=e.length,out=[];
  const g=i=>{const a=Math.max(0,i-2),b=Math.min(n-1,i+2);return(e[b]-e[a])/((b-a)*st)*100;};
  let i=0;
  while(i<n-1){
    if(g(i)<2){i++;continue;}
    let s=i,top=i,j=i;
    while(j<n-1){j++;if(e[j]>e[top])top=j;if(e[top]-e[j]>12||(j-top)*st>400)break;}
    while(top-s>4&&g(s)<3)s++;  /* weich auslaufenden Fuß nicht mitzählen */
    const gain=e[top]-e[s],len=(top-s)*st;
    if(gain>=12&&len>=200&&gain/len*100>=3){
      let ov=top*st;while(ov<rt.dist&&ov-top*st<300&&gradeAt(rt,ov)>-2.5)ov+=st;
      out.push({s:s*st,top:top*st,over:Math.min(ov,rt.dist),gain,len,g:gain/len*100});
    }
    i=Math.max(top,i)+1;
  }
  return out;
}
/* Leistung und Dauer je Anstieg zum Ziel passend */
function planClimbs(rt,G){
  return findClimbs(rt).map(c=>{let w=w5(S.set.ftp*(G.lo+G.hi)/2);for(let k=0;k<2;k++)w=climbWatt(rideTime(rt,c.s,c.top,w),G);return{...c,w,t:rideTime(rt,c.s,c.top,w)};});
}
const fmtMin=t=>t<90?`${n0(t)} s`:`${n0(t/60)} min`;

/* Start der Fahrt (aus momReset) */
function coachReset(){
  const G=coachGoal();
  if(!G||!ftpKnown()||S.ramp){S.coach=null;$('#fCoach').hidden=true;return;}
  const rt=activeRoute();
  S.coach={G,climbs:rt?planClimbs(rt,G):[],said:{},off:0,offSaid:-1e9,ui:null};
}
const coachSay=(key,...m)=>{const C=S.coach;if(C.said[key])return;C.said[key]=1;moment(...m);};
function lastAvg(n){const p=S.rec.p,k=Math.min(n,p.length);if(!k)return null;let s=0;for(let i=p.length-k;i<p.length;i++)s+=p[i];return s/k;}

/* Jede Sekunde aus checkMoments */
function coachTick(){
  const C=S.coach;if(!C||S.rec.state!=='rec')return;
  const G=C.G,ftp=S.set.ftp,rt=activeRoute(),d=S.sim.d,lap=S.sim.lap,a10=lastAvg(10),a30=lastAvg(30);
  const lo=w5(ftp*G.lo),hi=w5(ftp*G.hi);
  let ui=null;
  if(rt&&!S.sim.done){
    const c=C.climbs.find(x=>d<x.over),k=lap+':'+(c?c.s:'');
    if(c&&d<c.s){
      const to=c.s-d,sec=rideTime(rt,d,c.s,(lo+hi)/2);
      if(sec<=45)coachSay(k+'a','peak',`Anstieg in ${n0(to)} m`,`${n1(c.len/1000)} km mit ${n1(c.g)} % · ≈ ${fmtMin(c.t)} mit ${c.w} W`);
      ui=to<=1500?{k:'Gleich bergauf',t:`Anstieg in ${to<1000?n0(to)+' m':n1(to/1000)+' km'}`,s:`${n1(c.len/1000)} km · ${n1(c.g)} % · ${c.w} W`,w:[lo,hi]}:null;
    }
    else if(c&&d<c.top){
      const tTop=rideTime(rt,d,c.top,c.w),tOver=rideTime(rt,d,c.over,c.w),done=(d-c.s)/(c.top-c.s);
      if(tOver<=60&&c.t>=40)coachSay(k+'k','flag',`Noch ${n0(tOver)} s drücken`,c.over>c.top+30?'Über die Kuppe, bis es bergab rollt, dann erholen':'Bis oben dranbleiben, dann erholen','gold');
      else if(done>=.5&&c.t>=240&&tTop>90)coachSay(k+'h','peak','Halbzeit am Berg',`Noch ${fmtMin(tTop)} bei ${c.w} W`);
      if(a30!=null&&d-c.s>150&&tTop>120&&a30>c.w*1.12)coachSay(k+'f','bolt','Etwas zu fest',`Noch ${fmtMin(tTop)} bis oben, Richtung ${c.w} W`);
      ui={k:'Am Berg',t:tOver<=60?`Noch ${n0(tOver)} s drücken`:`Noch ${fmtMin(tTop)} bis oben`,s:`${n1(Math.max(0,c.top-d)/1000)} km · halte ${c.w} W`,w:[w5(c.w*.95),w5(c.w*1.05)],bar:done};
    }
    else if(c){
      const t=rideTime(rt,d,c.over,c.w);
      ui={k:'Über die Kuppe',t:`Noch ${n0(t)} s drücken`,s:'dann rollen lassen',w:[w5(c.w*.95),w5(c.w*1.05)],bar:1};
    }
    /* Hinter der Kuppe bergab: erholen, mit Blick auf den nächsten Anstieg */
    const prev=C.climbs.filter(x=>x.over<=d).pop();
    if(prev&&d-prev.over<400&&gradeAt(rt,d)<=-2.5){
      const nx=C.climbs.find(x=>x.s>d);
      coachSay(lap+':'+prev.s+'r','road','Jetzt erholen',nx?`Bergab locker treten · nächster Anstieg in ${n1((nx.s-d)/1000)} km`:'Bergab locker treten, das Schwerste ist geschafft');
    }
    if(!ui&&gradeAt(rt,d)<=-2.5)ui={k:'Bergab',t:'Locker treten',s:'erholen für den nächsten Anstieg',w:[w5(ftp*.4),w5(ftp*.6)]};
  }
  if(!ui)ui={k:`Coach · ${G.n}`,t:`${lo}–${hi} W`,s:rt?'im Flachen gleichmäßig':'gleichmäßig fahren',w:[lo,hi],nag:1};
  /* Im Flachen länger als eine Minute neben dem Bereich: einmal sanft erinnern, höchstens alle 5 Minuten */
  const n=S.rec.p.length;
  if(ui.nag&&a30!=null&&n>90&&(a30<ui.w[0]*.85||a30>ui.w[1]*1.12)){C.off++;if(C.off>=60&&n-C.offSaid>300){C.offSaid=n;C.off=0;moment('bolt',a30<ui.w[0]?'Da geht noch was':'Etwas zu fest',`Zielbereich ${ui.w[0]}–${ui.w[1]} W, gerade ${n0(a30)} W`);}}
  else C.off=0;
  ui.now=a10;C.ui=ui;
}

/* Anzeige in der Fahrt-Ansicht (aus renderFull) */
function renderCoach(){
  const C=S.coach,el=$('#fCoach');
  if(!C||!C.ui||S.rec.state==='idle'){el.hidden=true;return;}
  const u=C.ui;el.hidden=false;
  setT('fCoachK',u.k);setT('fCoachT',u.t);setT('fCoachS',u.s);
  const st=u.now==null?'':u.now<u.w[0]*.93?'lo':u.now>u.w[1]*1.07?'hi':'ok';
  if(el.dataset.st!==st){el.dataset.st=st;setT('fCoachI',{lo:'mehr',hi:'weniger',ok:'passt'}[st]||'');}
  const b=$('#fCoachBar');b.parentNode.hidden=u.bar==null;if(u.bar!=null)b.style.width=(clamp(u.bar,0,1)*100).toFixed(1)+'%';
}

/* Startkarte: Ziel wählen, Vorschau der Anstiege */
function renderCoachOpts(){
  const box=$('#coachOpts');if(!box)return;
  const ok=ftpKnown(),G=ok?coachGoal():null,busy=S.rec.state!=='idle';
  $$('#coachSeg button').forEach(b=>{b.classList.toggle('on',(b.dataset.coach||'')===(ok?S.set.coach||'':''));b.disabled=busy||!ok&&!!b.dataset.coach;});
  requestAnimationFrame(()=>placeSegThumb($('#coachSeg')));
  let note;
  if(!ok)note='Braucht deine FTP: einen FTP-Test machen oder sie in den Einstellungen eintragen.';
  else if(!G)note='Hinweise während der Fahrt: wann ein Anstieg kommt, wie fest, wie lange noch bis über die Kuppe.';
  else{
    const rt=activeRoute(),cl=rt?planClimbs(rt,G):[];
    const big=cl.slice().sort((a,b)=>b.gain-a.gain)[0];
    note=!rt?`${G.sub} · Zielbereich ${w5(S.set.ftp*G.lo)}–${w5(S.set.ftp*G.hi)} W`
      :cl.length?`${G.sub} · ${cl.length} ${cl.length>1?'Anstiege':'Anstieg'}, der größte ${n1(big.len/1000)} km mit ${n1(big.g)} % bei ${big.w} W`
      :`${G.sub} · keine nennenswerten Anstiege, Zielbereich ${w5(S.set.ftp*G.lo)}–${w5(S.set.ftp*G.hi)} W`;
  }
  setT('coachNote',note);
}
$('#coachSeg').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||b.disabled||S.rec.state!=='idle')return;
  S.set.coach=b.dataset.coach||'';saveSet();renderCoachOpts();
});
