'use strict';
/* ---------- FTP-Test (Rampentest) ---------- */
/* Die Rolle hält per Zielleistung eine Stufe und erhöht jede Minute um 20 W, bis es nicht mehr geht.
   Start bei 50 % der bisherigen FTP (mind. 100 W). Ende, wenn die Leistung 8 s lang unter 80 % der Stufe
   bleibt oder die Kadenz unter 50 fällt – oder wenn du selbst beendest.
   FTP = 75 % der besten Minute (übliche Formel für Rampentests). */
const RAMP={step:20,secs:60};

function ftpTestStart(){
  if(S.rec.state!=='idle'){toast('Erst die laufende Fahrt beenden');return;}
  if(!isLive()){toast('Erst die Rolle verbinden oder „Ohne Rolle testen“ einschalten');return;}
  const base=Math.max(100,Math.round(S.set.ftp*.5/10)*10);
  S.ramp={base,step:RAMP.step,stage:-1,low:0,done:false,ftp:null,best:null};
  /* flach fahren, damit nur die Stufe zählt */
  if(S.set.routeId){S.set.routeId=null;saveSet();resetSim();renderRoutes();}
  S.erg.on=true;S.erg.target=base;ergChanged();
  beginRide();
}
const rampTarget=T=>T.base+Math.max(0,T.stage)*T.step;
function rampResult(p){const b=bestAvg(p,60);return b?{best:Math.round(b),ftp:Math.round(b*.75)}:null;}

/* Jede Sekunde aus checkMoments */
function rampTick(){
  const T=S.ramp;if(!T||T.done||S.rec.state!=='rec')return;
  const el=recElapsed()/1000,stage=Math.floor(el/RAMP.secs);
  if(stage!==T.stage){
    T.stage=stage;S.erg.on=true;S.erg.target=rampTarget(T);ergChanged();
    if(stage>0)moment('bolt',`Stufe ${stage+1}: ${rampTarget(T)} W`,stage>=6?'Durchhalten, jede Minute zählt':'Locker bleiben, es wird langsam härter');
  }
  const pw=curPow(),cad=curCad(),weak=el>90&&((pw!=null&&pw<rampTarget(T)*.8)||(cad!=null&&cad<50));
  T.low=weak?T.low+1:0;
  if(T.low>=8)rampFinish();
}
function rampFinish(){
  const T=S.ramp;if(!T||T.done)return;
  T.done=true;T.peak=rampTarget(T);
  const r=rampResult(S.rec.p);if(r){T.ftp=r.ftp;T.best=r.best;}
  /* zum Ausfahren auf ruhige Leistung */
  S.erg.target=Math.round(S.set.ftp*.5/5)*5;ergChanged();
  moment('trophy',T.ftp?`FTP-Test geschafft: ${T.ftp} W`:'FTP-Test beendet',T.ftp?`Beste Minute ${T.best} W · jetzt locker ausfahren`:'Zu kurz für ein Ergebnis','gold');
}

/* Für die Zusammenfassung: Ergebnis an die Fahrt hängen (auch wenn du vor dem Einbruch selbst beendet hast) */
function rampSummary(r){
  const T=S.ramp;if(!T)return null;
  S.ramp=null;
  const res=T.ftp?{ftp:T.ftp,best:T.best}:rampResult(r.p);
  if(!res||r.p.length<120)return null;
  r.ftpTest={...res,peak:T.peak||rampTarget(T),before:S.set.ftp};r.name='FTP-Test';DB.put(r);autoBackup();
  return r.ftpTest;
}

/* Anzeige in der Fahrt-Ansicht */
function renderRamp(){
  const T=S.ramp,el=$('#fRamp');
  if(!T||S.rec.state==='idle'){el.hidden=true;return;}
  el.hidden=false;
  if(T.done){setT('fRampT',T.ftp?`FTP ≈ ${T.ftp} W · ausfahren`:'Test beendet');$('#fRampBar').style.width='100%';return;}
  const el2=recElapsed()/1000,left=RAMP.secs-el2%RAMP.secs;
  setT('fRampT',`FTP-Test · Stufe ${Math.max(1,T.stage+1)} · ${rampTarget(T)} W · ${fmtDur(left)}`);
  $('#fRampBar').style.width=((el2%RAMP.secs)/RAMP.secs*100).toFixed(1)+'%';
}

function renderFtpCard(){setT('ftpNow',`FTP ${S.set.ftp} W`);}
$('#btnFtpTest').onclick=ftpTestStart;
