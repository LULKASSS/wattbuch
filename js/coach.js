'use strict';
/* ---------- Coach: Hinweise während der Fahrt ---------- */
/* Freiwillig, auf der Startkarte gewählt (S.set.coach: '' aus, sonst ein Ziel aus COACH), nur mit bekannter FTP.
   Auf einer Strecke werden die Anstiege vorab erkannt. Vor dem Fuß: wie lang, wie steil, welche Leistung, wie lange.
   Am Berg: Zielleistung und Restzeit bis oben. Kurz vor der Kuppe: wie viele Sekunden noch drücken, nämlich bis
   es hinter der Kuppe richtig bergab rollt (dort ist Tempo am billigsten zu holen). Bergab: erholen.
   Immer zuerst 5 min aufwärmen. Dazwischen eine feste Zielleistung, die mit der Steigung voraus mitgeht, mit kurzen
   Ansagen bei Wechseln („Mehr Watt“, „Rollen lassen“), Erinnerung, wenn du lange drunter liegst, und Lob, wenn es passt.
   Zeiten aus derselben Fahrphysik wie simStep. */
const COACH={
  locker:{n:'Locker',sub:'Grundlage, am Berg nicht überziehen',base:.65,top:.8},
  zuegig:{n:'Zügig',sub:'Tempo, an Anstiegen etwas fester',base:.8,top:.95},
  vollgas:{n:'Vollgas',sub:'Bestzeit, Kraft in die Anstiege',base:.9,top:1.2}
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
/* Kraftreserve über der FTP (W′, Modell von Skiba 2015): über der FTP verbraucht jede Sekunde (P − FTP) Joule,
   darunter füllt sie sich wieder auf, umso schneller, je lockerer (τ = 546·e^(−0,01·(FTP − P)) + 316 s).
   Größe aus deinem besten 5-min-Wert: (P5 − FTP)·300, ohne den 18 kJ; begrenzt auf 8–30 kJ. */
function wPrime(){const b=bestsOf(aggRides())[300];return clamp(b?(b.w-S.set.ftp)*300:18000,8000,30000);}
function wbalStep(C,p){
  const cp=S.set.ftp;
  if(p>cp)C.wbal=Math.max(0,C.wbal-(p-cp));
  else{const tau=546*Math.exp(-.01*(cp-p))+316;C.wbal+=(C.W-C.wbal)*(1-Math.exp(-1/tau));}
}
/* Wie fest am Berg (bis hinter die Kuppe): Studien zu welligen Zeitfahren zeigen, dass +5–10 % am Berg und weniger
   bergab schneller sind als gleichmäßige Leistung (Swain 1997, Atkinson u. a. 2007). Kurze Anstiege vertragen mehr
   (bis +25 %), lange weniger (+8 %), gedeckelt durch das Ziel. Über der FTP nur so viel, wie die Reserve W′ bis über
   die Kuppe hergibt, ein Viertel bleibt übrig; in den letzten 40 s darf fast alles raus. */
function climbWatt(rt,d,c,G,C){
  const ftp=S.set.ftp,base=ftp*G.base*C.boost;
  let w=base*1.1,t=rideTime(rt,d,c.over,w);
  for(let k=0;k<3;k++){
    const up=t<=120?.25:t<=300?.18:t<=900?.12:.08,last=t<=40;
    w=Math.min(base*(1+up),ftp*G.top*C.boost*(last?1.1:1));
    if(w>ftp)w=Math.max(ftp,Math.min(w,ftp+(last?.9:.75)*C.wbal/Math.max(t,15)));
    t=rideTime(rt,d,c.over,w);
  }
  return w5(Math.max(w,base));
}

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
  const C={boost:1,W:wPrime()};C.wbal=C.W;
  return findClimbs(rt).map(c=>{const w=climbWatt(rt,c.s,c,G,C);return{...c,w,t:rideTime(rt,c.s,c.top,w)};});
}
const fmtMin=t=>t<90?`${n0(t)} s`:`${n0(t/60)} min`;

/* Start der Fahrt (aus momReset) */
function coachReset(){
  const G=coachGoal();
  if(!G||!ftpKnown()||S.ramp){S.coach=null;$('#fCoach').hidden=true;return;}
  const rt=activeRoute();
  S.coach={G,climbs:rt?planClimbs(rt,G):[],said:{},cueAt:-1e9,cueW:null,low:0,lowAt:-1e9,high:0,highAt:-1e9,good:0,goodAt:-1e9,boost:1,ui:null,ergOff:0,ergSet:null,ergAuto:false,W:wPrime()};
  S.coach.wbal=S.coach.W;
  /* Die Rolle hält von Anfang an, was der Coach sagt (Zielleistung an, beginnend beim Aufwärmen) */
  if(isLive()){S.coach.ergAuto=!S.erg.on;S.erg.on=true;S.erg.target=S.coach.ergSet=warmWatt(0,G);ergChanged();}
}
/* Zielleistung folgt dem Coach. Eigene Änderungen (±, Pfeiltasten, Eingabe) bleiben als Versatz auf allen Werten
   erhalten, z. B. +10 W. Zielleistung aus: der Coach zeigt nur an, du trittst selbst. */
function coachErg(ui){
  const C=S.coach;
  if(!S.erg.on){C.ergSet=null;return;}
  if(C.ergSet!=null&&S.erg.target!==C.ergSet)C.ergOff=clamp(C.ergOff+S.erg.target-C.ergSet,-150,150);
  const w=Math.max(0,ui.w+C.ergOff);
  if(w!==S.erg.target){S.erg.target=w;ergChanged();}
  C.ergSet=w;
}
/* Ende der Fahrt: hat der Coach die Zielleistung eingeschaltet, schaltet er sie auch wieder aus */
function coachEnd(){const C=S.coach;if(C&&C.ergAuto&&S.erg.on){S.erg.on=false;ergChanged();}S.coach=null;}
const coachSay=(key,...m)=>{const C=S.coach;if(C.said[key])return;C.said[key]=1;C.cueAt=S.rec.p.length;moment(...m);};
/* Ansagen aus dem Flachen mit Abstand: höchstens alle 40 s eine, damit es nicht nervt */
function coachCue(...m){const C=S.coach,n=S.rec.p.length;if(n-C.cueAt<40)return false;C.cueAt=n;moment(...m);return true;}
function lastAvg(n){const p=S.rec.p,k=Math.min(n,p.length);if(!k)return null;let s=0;for(let i=p.length-k;i<p.length;i++)s+=p[i];return s/k;}
/* Erst aufwärmen: 5 min von 50 % FTP langsam hoch auf die Grundleistung des Ziels */
const WARM=300;
const warmWatt=(el,G)=>w5(S.set.ftp*(.5+(G.base-.5)*clamp(el/WARM,0,1)));
/* Zielleistung jetzt: Grundleistung des Ziels, an jeder Steigung mehr (+5 % je Prozent, höchstens +15 %),
   bergab weniger (höchstens −25 %), wie in den Studien zu welligen Strecken.
   Blick 40–100 m voraus, damit man vor der Welle anzieht und nicht erst mittendrin. Gerechnet mit der echten Steigung
   der Strecke, nicht mit der abgeschwächten an der Rolle. */
const coachGrade=(rt,d)=>rt?(gradeAt(rt,d+40)+gradeAt(rt,d+100))/2:0;
function paceWatt(rt,d,G,boost=1){const ftp=S.set.ftp;return w5(clamp(ftp*G.base*boost*(1+clamp(.05*coachGrade(rt,d),-.25,.15)),ftp*.45,ftp*G.top*boost));}

/* Jede Sekunde aus checkMoments */
function coachTick(){
  const C=S.coach;if(!C||S.rec.state!=='rec')return;
  const G=C.G,ftp=S.set.ftp,rt=S.sim.done?null:activeRoute(),d=S.sim.d,lap=S.sim.lap,a30=lastAvg(30),n=S.rec.p.length;
  const el=recElapsed()/1000,warm=el<WARM&&!C.skip,ww=warmWatt(el,G);
  wbalStep(C,S.rec.p[n-1]||0);
  const res=C.wbal/C.W;
  if(n>=3&&!C.skip)coachSay('w0','bolt','Erst mal aufwärmen',`5 min locker einrollen, ab ${ww} W langsam steigern`);
  let ui=null;
  const c=rt?C.climbs.find(x=>d<x.over):null,k=lap+':'+(c?c.s:'');
  if(c&&d>=c.s){
    const cw=climbWatt(rt,d,c,G,C),w=warm?Math.min(cw,w5(ww*1.25)):cw;
    const tTop=rideTime(rt,d,c.top,w),tOver=rideTime(rt,d,c.over,w),done=(d-c.s)/(c.top-c.s);
    if(d<c.top){
      if(tOver<=60&&c.t>=40)coachSay(k+'k','flag',`Noch ${n0(tOver)} s drücken`,c.over>c.top+30?'Über die Kuppe, bis es bergab rollt, dann erholen':'Bis oben dranbleiben, dann erholen','gold');
      else if(done>=.5&&c.t>=240&&tTop>90)coachSay(k+'h','peak','Halbzeit am Berg',`Noch ${fmtMin(tTop)} bei ${w} W, dranbleiben`);
      else if(c.t>=40)coachSay(k+'s','bolt',`Jetzt ${w} W drücken`,`${n1(c.len/1000)} km mit ${n1(c.g)} % · ≈ ${fmtMin(c.t)} bis oben`);
      if(a30!=null&&d-c.s>150&&tTop>120&&a30>w*1.12)coachSay(k+'f','bolt','Etwas zu fest',`Noch ${fmtMin(tTop)} bis oben, Richtung ${w} W`);
      ui={k:'Am Berg',w,t:tOver<=60?`Noch ${n0(tOver)} s bis über die Kuppe`:`Noch ${fmtMin(tTop)} bis oben`,
        s:tOver<=60?(w>ftp&&res>.3?'Die Reserve reicht: jetzt alles raus, danach rollst du dich aus':'Jetzt zahlt sich Druck doppelt aus, danach rollst du dich aus')
          :w>ftp?`${n1(gradeAt(rt,d))} % · über der FTP, die Reserve reicht bis über die Kuppe`
          :res<.5&&w5(ftp*G.base*C.boost*1.08)>w?`${n1(gradeAt(rt,d))} % · Reserve knapp, deshalb nicht mehr`
          :`${n1(gradeAt(rt,d))} % · noch ${n1(Math.max(0,c.top-d)/1000)} km: am Berg bringt jedes Watt Tempo, gleichmäßig bleiben`,bar:done,climb:1};
    }
    else ui={k:'Über die Kuppe',w,t:`Noch ${n0(rideTime(rt,d,c.over,w))} s drücken`,s:'Oben noch Tempo mitnehmen, bis es bergab rollt, dann erholen',bar:1,climb:1};
  }
  if(rt){
    /* Hinter der Kuppe bergab: erholen, mit Blick auf den nächsten Anstieg */
    const prev=C.climbs.filter(x=>x.over<=d).pop();
    if(prev&&d-prev.over<400&&gradeAt(rt,d)<=-2.5){
      const nx=C.climbs.find(x=>x.s>d);
      coachSay(lap+':'+prev.s+'r','road','Jetzt erholen',nx?`Bergab locker treten · nächster Anstieg in ${n1((nx.s-d)/1000)} km`:'Bergab locker treten, das Schwerste ist geschafft');
    }
    if(c&&d<c.s&&rideTime(rt,d,c.s,ftp*G.base)<=45)coachSay(k+'a','peak',`Anstieg in ${n0(c.s-d)} m`,`${n1(c.len/1000)} km mit ${n1(c.g)} % · ≈ ${fmtMin(c.t)} mit ${c.w} W`);
  }
  if(!ui){
    const g=coachGrade(rt,d),pw0=paceWatt(rt,d,G,C.boost),low=res<.4&&pw0>w5(ftp*.75);
    /* Reserve fast leer (nach einem harten Stück): im Flachen kurz unter 75 % FTP, damit sie sich auffüllt */
    const pw=low?w5(ftp*.75):pw0,w=warm?Math.min(pw,ww):pw;
    const nxt=c&&d<c.s&&c.s-d<=1500?`Anstieg in ${c.s-d<1000?n0(c.s-d)+' m':n1((c.s-d)/1000)+' km'} (${n1(c.g)} %): noch Kraft sammeln`:null;
    if(warm)ui={k:'Aufwärmen',w,t:`Noch ${fmtDur(WARM-el)} einrollen`,s:nxt||`Langsam steigern, damit Beine und Kreislauf mitkommen · dann ${w5(ftp*G.base)} W`,bar:el/WARM,warm:1};
    else ui={k:(g>=1.5?'Leicht bergauf':g<=-2.5?'Bergab':g<=-1?'Leicht bergab':'Flach')+(C.boost>1?` · +${n0((C.boost-1)*100)} %`:''),w,
      t:g>=1.5?'Etwas mehr drücken':g<=-2.5?'Rollen lassen':g<=-1?'Etwas rausnehmen':'Gleichmäßig treten',
      s:low?`Reserve ${n0(res*100)} %: kurz erholen, dann wieder Tempo`
        :g>=1.5?`${n1(g)} % voraus: am Hang bringt jedes Watt mehr Tempo als im Flachen`
        :g<=-2.5?`${n1(g)} % bergab: Watt bringen hier kaum Tempo, erholen`
        :g<=-1?'Leicht bergab: das rollt fast von selbst'
        :nxt||(rt?'Flach: gleichmäßiger Druck ist hier am schnellsten':`Frei fahren: gleichmäßig ${G.n.toLowerCase()} treten`)};
  }
  if(!warm&&!C.skip)coachSay('w1','bolt','Aufgewärmt',`Jetzt geht es los: ${ui.w} W`,'gold');
  /* Wechsel der Zielleistung ansagen (nicht am Berg, da gibt es eigene Ansagen) */
  if(!warm&&!ui.climb){
    if(C.cueW==null)C.cueW=ui.w;
    else if(ui.w>=C.cueW*1.1){if(coachCue('bolt',`Mehr Watt: ${ui.w} W`,coachGrade(rt,d)>=1?`Es geht ${n1(coachGrade(rt,d))} % hoch, jetzt anziehen`:'Tempo wieder aufnehmen'))C.cueW=ui.w;}
    else if(ui.w<=C.cueW*.88){if(coachCue('road',`Rollen lassen: ${ui.w} W`,'Kraft sparen für das nächste Stück'))C.cueW=ui.w;}
  }
  else C.cueW=null;
  /* Dauerhaft drunter, drüber oder genau richtig: sanft erinnern bzw. loben (nicht, wenn die Rolle die Leistung hält) */
  if(a30!=null&&n>60&&!S.erg.on){
    /* Zu fest bremst der Coach nur beim Aufwärmen (am Berg gibt es eigene Ansagen). Wer sonst dauerhaft drüber fährt,
       ist gut drauf: dann geht das Ziel um 3 % hoch, bis +12 % */
    C.low=a30<ui.w*.88?C.low+1:0;C.high=!ui.climb&&coachGrade(rt,d)>-1&&a30>ui.w*(warm?1.15:1.06)?C.high+1:0;C.good=Math.abs(a30-ui.w)<=ui.w*.07?C.good+1:0;
    if(C.low>=20&&n-C.lowAt>=120&&coachCue('bolt','Da geht noch was',`Ziel ${ui.w} W, gerade ${n0(a30)} W`)){C.lowAt=n;C.low=0;}
    if(warm&&C.high>=30&&n-C.highAt>=180&&coachCue('bolt','Langsam angehen',`Erst aufwärmen, ${ui.w} W reichen gerade`)){C.highAt=n;C.high=0;}
    if(!warm&&C.high>=240&&C.boost<1.12){C.boost=Math.round((C.boost+.03)*100)/100;C.high=0;C.cueW=null;C.cueAt=-1e9;coachCue('trophy','Du bist gut drauf',`Ziel hoch auf ${paceWatt(rt,d,G,C.boost)} W, weiter so`,'gold');}
    if(C.good>=180&&n-C.goodAt>=600&&coachCue('trophy','Stark, genau richtig',`Seit 3 min auf ${ui.w} W`,'gold')){C.goodAt=n;C.good=0;}
  }
  C.ui=ui;coachErg(ui);
}

/* Anzeige in der Fahrt-Ansicht (aus renderFull): Zielleistung groß, darunter was zu tun ist */
function renderCoach(){
  const C=S.coach,el=$('#fCoach');
  if(!C||!C.ui||S.rec.state==='idle'){el.hidden=true;return;}
  const u=C.ui,off=S.erg.on?C.ergOff:0,w=Math.max(0,u.w+off);el.hidden=false;
  const res=C.wbal/C.W;  /* Reserve über der FTP nur zeigen, wenn sie angebrochen ist */
  setT('fCoachK',u.k+(off?` · ${off>0?'+':'−'}${Math.abs(off)} W von dir`:'')+(res<.9?` · Reserve ${n0(res*100)} %`:''));setT('fCoachW',String(w));setT('fCoachT',u.t);setT('fCoachS',u.s);
  const now=lastAvg(3),st=now==null||S.rec.p.length<3?'':now<w*.93?'lo':now>w*1.07?'hi':'ok';
  if(el.dataset.st!==st)el.dataset.st=st;
  setT('fCoachI',S.erg.on?'Rolle hält die Leistung':st==='lo'?`▲ ${n0(w-now)} W mehr`:st==='hi'?`▼ ${n0(now-w)} W weniger`:st==='ok'?'✓ passt':'');
  $('#fCoachSkip').hidden=!u.warm;
  const rt=activeRoute(),cv=$('#cvCoach');cv.hidden=!rt||S.sim.done;
  if(!cv.hidden&&Math.abs(S.sim.d-(C.viewD??-99))>2){C.viewD=S.sim.d;drawCoachView(cv,rt,S.sim.d,C);}
  const b=$('#fCoachBar');b.parentNode.hidden=u.bar==null;if(u.bar!=null)b.style.width=(clamp(u.bar,0,1)*100).toFixed(1)+'%';
}

/* Ausblick in der Coach-Karte: Höhenprofil der nächsten 1000 m in Steigungsfarben, du links, Kuppe und
   „ab hier rollen lassen“ markiert. Damit sieht man, warum gleich mehr oder weniger Watt dran sind. */
function drawCoachView(c,rt,d,C){
  const dpr=Math.min(2,devicePixelRatio||1),W=c.clientWidth,H=c.clientHeight;if(!W||!H)return;
  if(c.width!==Math.round(W*dpr)||c.height!==Math.round(H*dpr)){c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);}
  const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const L=1000,end=Math.min(rt.dist,d+L),N=40,es=[];
  for(let i=0;i<=N;i++)es.push(eleAt(rt,d+(end-d)*i/N));
  let mn=Math.min(...es),mx=Math.max(...es);const span=Math.max(15,mx-mn);mn-=(span-(mx-mn))/2;
  const X=x=>(x-d)/L*W,Y=e=>H-3-(e-mn)/span*(H-8);
  for(let i=0;i<N;i++){
    const x0=d+(end-d)*i/N,x1=d+(end-d)*(i+1)/N;
    ctx.beginPath();ctx.moveTo(X(x0),H);ctx.lineTo(X(x0),Y(es[i]));ctx.lineTo(X(x1),Y(es[i+1]));ctx.lineTo(X(x1),H);ctx.closePath();
    ctx.fillStyle=gradeStyle(gradeAt(rt,(x0+x1)/2)).c;ctx.globalAlpha=.55;ctx.fill();
  }
  ctx.globalAlpha=1;
  let lastX=-1e9;  /* Beschriftungen, die zu dicht kämen, nur als Strich */
  const mark=(x,txt)=>{if(x<d||x>end)return;const px=X(x);if(px-lastX<52)txt='';else lastX=px;ctx.strokeStyle='rgba(241,238,255,.8)';ctx.setLineDash([2,2]);ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,H);ctx.stroke();ctx.setLineDash([]);
    ctx.font='600 10px '+(css('--mono')||'monospace');ctx.fillStyle='#F1EEFF';ctx.textAlign=px>W-40?'right':'left';ctx.fillText(txt,px+(px>W-40?-4:4),10);};
  for(const cl of C.climbs){if(cl.s>d+5)mark(cl.s,'Anstieg');mark(cl.top,'Kuppe');if(cl.over>cl.top+30)mark(cl.over,'rollen');}
  ctx.beginPath();ctx.arc(3,Y(es[0]),3.5,0,7);ctx.fillStyle='#fff';ctx.fill();
}
/* Aufwärmen überspringen (schon warm gefahren): sofort die volle Leistung des Ziels */
$('#fCoachSkip').addEventListener('click',()=>{const C=S.coach;if(!C||C.skip)return;C.skip=true;coachTick();renderCoach();moment('bolt','Aufwärmen übersprungen',`Los geht es mit ${C.ui?C.ui.w:''} W`);});

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
    const fl=`im Flachen ${w5(S.set.ftp*G.base)} W, an Steigungen mehr`;
    note=!rt?`${G.sub} · 5 min aufwärmen, dann ${w5(S.set.ftp*G.base)} W`
      :cl.length?`${G.sub} · ${cl.length} ${cl.length>1?'Anstiege':'Anstieg'}, der größte ${n1(big.len/1000)} km mit ${n1(big.g)} % bei ${big.w} W`
      :`${G.sub} · keine langen Anstiege, ${fl}`;
  }
  setT('coachNote',note);
}
$('#coachSeg').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||b.disabled||S.rec.state!=='idle')return;
  S.set.coach=b.dataset.coach||'';saveSet();renderCoachOpts();
});
