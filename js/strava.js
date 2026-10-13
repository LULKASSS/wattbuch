'use strict';
/* ---------- Strava ---------- */
/* Direkt hochladen geht nur in der Mac-App (Zugangsdaten bleiben dort, siehe desktop/strava.js).
   Im Browser bleibt „Für Strava exportieren“ (TCX speichern und strava.com/upload öffnen).
   Fahrt merkt sich den Stand in r.strava = {state:'wartet'|'laeuft'|'verarbeitung'|'fehler'|'ok'|'aus', id, url, error, auto, tries}.
   Automatisch: jede Fahrt mit echter Rolle (r.trainer) geht nach kurzer Wartezeit von selbst hoch,
   in der Zusammenfassung lässt sich das noch abbrechen. Klappt es nicht (offline, App zu), wird es später nachgeholt. */
const SV=()=>window.wattbuchDesktop&&window.wattbuchDesktop.strava;
S.strava={configured:false,connected:false,athlete:null};
let svWait=15000;                 // so lange lässt sich der automatische Upload nach der Fahrt abbrechen
const svAuto=()=>S.set.stravaAuto!==false,svOn=()=>!!(SV()&&S.strava.connected&&svAuto()),svBusy=new Set();
let svT=null;

async function stravaRefresh(){const sv=SV();if(!sv)return;const r=await sv.status();if(r.ok)S.strava=r;renderStravaSet();stravaSync();stravaVirtual();if(typeof svPull==='function')svPull();}
/* Früher hochgeladene Wattbuch-Fahrten sind auf Strava ein normaler Ride: einmal zum Virtual Ride machen (braucht eine
   App, die das kann). Gemerkt in r.strava.vr; was Strava ablehnt, bleibt wie es ist und wird nicht wieder versucht. */
let svVirtRun=false;
async function stravaVirtual(){
  const sv=SV();if(svVirtRun||!sv||!sv.sport||!S.strava.connected)return;
  svVirtRun=true;let n=0;
  try{
    for(const r of S.rides.filter(x=>x.src!=='strava'&&x.strava&&x.strava.state==='ok'&&x.strava.id&&x.strava.vr==null)){
      const res=await sv.sport(r.strava.id);
      if(!res.ok&&res.status===401)break;
      r.strava.vr=!!(res.ok&&res.virtual);if(r.strava.vr)n++;await DB.put(r);
    }
  }finally{svVirtRun=false;}
  if(n)toast(`${n} ${n===1?'Fahrt':'Fahrten'} auf Strava zum Virtual Ride gemacht`);
}

function stravaDesc(r){
  const s=stats(r);
  return[`Mit Wattbuch auf der Rolle${r.route?` · Strecke ${r.route}`:''}`,
    `Normalized Power ${n0(s.np)} W`,
    r.ftpTest?`FTP-Test: ${r.ftpTest.ftp} W (beste Minute ${r.ftpTest.best} W)`:''].filter(Boolean).join('\n');
}

/* Neue Fahrt mit Rolle vormerken (vor dem Speichern aufgerufen) */
function stravaQueue(r){if(r.trainer&&svOn())r.strava={state:'wartet',due:Date.now()+svWait,auto:true};}
/* Was ist wann fällig? Vorgemerkte Fahrten, fehlgeschlagene automatische Versuche (bis 4-mal, immer länger warten),
   von Strava noch nicht fertig verarbeitete, abgebrochene Uploads (App zu) und frische Fahrten mit Rolle,
   die noch nie dran waren (z. B. ohne Strava-Verbindung gefahren). Doppelte erkennt Strava an der external_id. */
function svDue(r){
  const st=r.strava;
  if(svBusy.has(r.id))return null;
  if(!st)return r.trainer&&Date.now()-Date.parse(r.start)<3*864e5?0:null;
  if(st.state==='wartet')return st.due||0;
  if(st.state==='laeuft')return 0;
  if((st.state==='verarbeitung'||st.state==='fehler'&&st.auto)&&(st.tries||0)<4)return st.retry||0;
  return null;
}
let svRun=null;
function stravaSync(){
  if(svRun)return svRun;
  svRun=(async()=>{
    clearTimeout(svT);svT=null;
    for(const r of S.rides.slice()){const d=svDue(r);if(svOn()&&d!=null&&d<=Date.now())await stravaUpload(r,true);}
    const next=Math.min(...S.rides.map(svDue).filter(d=>d!=null));
    if(svOn()&&next<Infinity)svT=setTimeout(stravaSync,Math.max(500,next-Date.now()));
  })().finally(()=>{svRun=null;});
  return svRun;
}
addEventListener('online',()=>stravaSync());

async function stravaUpload(r,auto=false){
  const sv=SV();
  if(!sv||!S.strava.connected){if(!auto)toast('Erst in den Einstellungen mit Strava verbinden');return null;}
  if(svBusy.has(r.id))return null;
  svBusy.add(r.id);
  const tries=auto?(r.strava&&r.strava.tries||0)+1:1;
  r.strava={state:'laeuft',auto,tries};stravaChanged(r);
  let res;
  try{res=await sv.upload({tcx:tcx(r),name:r.name,description:stravaDesc(r),externalId:'wattbuch-'+r.id});}
  catch(e){res={ok:false,error:e.message};}
  finally{svBusy.delete(r.id);}
  r=S.rides.find(x=>x.id===r.id);if(!r)return null;   // inzwischen gelöscht (oder vom Konto-Abgleich ersetzt)
  if(!res.ok){
    r.strava={state:'fehler',error:res.error,auto,tries,retry:Date.now()+2**tries*60000};
    if(!auto||tries===1)toast('Strava: '+res.error+(auto?' – wird später nochmal versucht':''));
  }
  else if(res.processing){r.strava={state:'verarbeitung',uploadId:res.uploadId,auto:true,tries,retry:Date.now()+60000};toast('Strava verarbeitet die Fahrt noch, sie erscheint gleich');}
  else{r.strava={state:'ok',id:res.activityId,url:res.url,at:new Date().toISOString(),vr:!!res.virtual};toast(res.duplicate?'War schon auf Strava':'Auf Strava hochgeladen');}
  await DB.put(r);autoBackup();stravaChanged(r);
  return r.strava;
}
/* Knopf passend zum Stand der Fahrt */
function stravaBtn(r,id){
  const st=r.strava&&r.strava.state;
  if(st==='ok')return`<a class="btn strava" id="${id}" href="${esc(r.strava.url)}" target="_blank" rel="noopener">Auf Strava ansehen</a>`;
  if(HANDY)return'';   // hochgeladen wird vom Mac
  if(st==='wartet'&&svOn())return`<span class="sv-wait" id="${id}"><span>Geht gleich zu Strava</span><button type="button" class="btn sm ghost" data-strava-cancel="${esc(r.id)}">Nicht hochladen</button></span>`;
  if(SV()&&S.strava.connected)return`<button type="button" class="btn strava" id="${id}" data-strava="${esc(r.id)}"${st==='laeuft'?' disabled':''}>${st==='laeuft'?'Wird hochgeladen …':st==='fehler'?'Erneut zu Strava hochladen':'Zu Strava hochladen'}</button>`;
  return`<button type="button" class="btn" id="${id}" data-strava-export="${esc(r.id)}">Für Strava exportieren</button>`;
}
function stravaChanged(r){
  const b=$('#sumStrava');if(b&&$('#dlgSum').open&&b.dataset.ride===r.id){b.outerHTML=stravaBtn(r,'sumStrava');const nb=$('#sumStrava');if(nb)nb.dataset.ride=r.id;}
  if(S.view==='detail'&&S.detail===r.id)renderDetail();
}
document.addEventListener('click',async e=>{
  const up=e.target.closest('[data-strava]');
  if(up){const r=S.rides.find(x=>x.id===up.dataset.strava);if(r)stravaUpload(r);return;}
  const no=e.target.closest('[data-strava-cancel]');
  if(no){const r=S.rides.find(x=>x.id===no.dataset.stravaCancel);if(r&&r.strava&&r.strava.state==='wartet'){r.strava={state:'aus'};stravaChanged(r);await DB.put(r);autoBackup();toast('Wird nicht zu Strava hochgeladen');}return;}
  const ex=e.target.closest('[data-strava-export]');
  if(ex){const r=S.rides.find(x=>x.id===ex.dataset.stravaExport);if(r){download(tcx(r),`wattbuch-${r.start.slice(0,10)}.tcx`,'application/vnd.garmin.tcx+xml');window.open('https://www.strava.com/upload/select','_blank','noopener');}}
});

/* Einstellungen */
function renderStravaSet(){
  const el=$('#svBox');if(!el)return;const sv=SV(),st=S.strava;
  let h='<h3>Strava</h3>';
  if(!sv)h+=`<div class="sv-line"><span class="ftp-note">Von selbst hochladen geht in der App für Mac und Windows. Hier im Browser nach der Fahrt „Für Strava exportieren“.</span><a class="btn sm strava" id="svMacApp" href="${location.pathname}">App laden</a></div>`;
  else if(st.connected)h+=`<div class="sv-line"><p class="sv-ok"><i></i>Verbunden${st.athlete&&st.athlete.name?` als ${esc(st.athlete.name)}`:''}</p><button type="button" class="btn sm ghost" id="svOff">Trennen</button></div>
    <label class="chk sm${svAuto()?' on':''}" id="svAutoL"><input type="checkbox" id="svAuto"${svAuto()?' checked':''}><span class="box"></span>Fahrten mit der Rolle automatisch hochladen</label>
    ${typeof svInHTML==='function'?svInHTML():''}`;
  else h+=`<div class="sv-line"><span class="ftp-note">Einmal verbinden, dann geht jede Fahrt mit der Rolle von selbst hoch.</span><button type="button" class="btn sm strava" id="svConnect">Mit Strava verbinden</button></div>`;
  el.innerHTML=h;
}
async function stravaConnect(){
  const sv=SV(),b=$('#svConnect');if(b){b.disabled=true;b.textContent='Warte auf Strava im Browser …';}
  const r=await sv.connect();
  if(r.ok){S.strava=r;toast('Mit Strava verbunden');stravaSync();if(typeof svPull==='function')svPull(true);}else toast('Strava: '+r.error);
  renderStravaSet();
}
$('#svBox').addEventListener('click',async e=>{
  const sv=SV();if(!sv)return;
  if(e.target.closest('#svConnect'))stravaConnect();
  else if(e.target.closest('#svOff')){const r=await sv.disconnect();if(r.ok)S.strava=r;renderStravaSet();toast('Von Strava getrennt');}
});
$('#svBox').addEventListener('change',e=>{if(e.target.id==='svAuto'){S.set.stravaAuto=e.target.checked;saveSet();$('#svAutoL').classList.toggle('on',svAuto());stravaSync();}});

/* Name einer neuen Fahrt: Strecke, sonst nach Tageszeit wie bei Strava */
function rideName(iso,route){
  if(route)return route;
  const h=new Date(iso).getHours();
  return`Rollentraining am ${h<5?'späten Abend':h<11?'Morgen':h<14?'Mittag':h<18?'Nachmittag':h<22?'Abend':'späten Abend'}`;
}
