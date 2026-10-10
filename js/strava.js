'use strict';
/* ---------- Strava ---------- */
/* Direkt hochladen geht nur in der Mac-App (Zugangsdaten bleiben dort, siehe desktop/strava.js).
   Im Browser bleibt „Für Strava exportieren“ (TCX speichern und strava.com/upload öffnen).
   Fahrt merkt sich den Stand in r.strava = {state:'ok'|'laeuft'|'verarbeitung'|'fehler', id, url, error}. */
const SV=()=>window.wattbuchDesktop&&window.wattbuchDesktop.strava;
S.strava={configured:false,connected:false,athlete:null};

async function stravaRefresh(){const sv=SV();if(!sv)return;const r=await sv.status();if(r.ok)S.strava=r;renderStravaSet();}

function stravaDesc(r){
  const s=stats(r);
  return[`Mit Wattbuch auf der Rolle${r.route?` · Strecke ${r.route}`:''}`,
    `Ø ${n0(s.avg)} W · NP ${n0(s.np)} W · ${n0(s.kj)} kJ · TSS ${n0(s.tss)}`,
    r.ftpTest?`FTP-Test: ${r.ftpTest.ftp} W (beste Minute ${r.ftpTest.best} W)`:''].filter(Boolean).join('\n');
}

async function stravaUpload(r){
  const sv=SV();
  if(!sv||!S.strava.connected){toast('Erst in den Einstellungen mit Strava verbinden');return null;}
  if(r.strava&&r.strava.state==='laeuft')return null;
  r.strava={state:'laeuft'};stravaChanged(r);
  const res=await sv.upload({tcx:tcx(r),name:r.name,description:stravaDesc(r),externalId:'wattbuch-'+r.id});
  if(!res.ok){r.strava={state:'fehler',error:res.error};toast('Strava: '+res.error);}
  else if(res.processing){r.strava={state:'verarbeitung',uploadId:res.uploadId};toast('Strava verarbeitet die Fahrt noch, sie erscheint gleich');}
  else{r.strava={state:'ok',id:res.activityId,url:res.url,at:new Date().toISOString()};toast(res.duplicate?'War schon auf Strava':'Auf Strava hochgeladen');}
  await DB.put(r);autoBackup();stravaChanged(r);
  return r.strava;
}
/* Knopf passend zum Stand der Fahrt */
function stravaBtn(r,id){
  const st=r.strava&&r.strava.state;
  if(st==='ok')return`<a class="btn strava" id="${id}" href="${esc(r.strava.url)}" target="_blank" rel="noopener">Auf Strava ansehen</a>`;
  if(SV()&&S.strava.connected)return`<button type="button" class="btn strava" id="${id}" data-strava="${esc(r.id)}"${st==='laeuft'?' disabled':''}>${st==='laeuft'?'Wird hochgeladen …':st==='fehler'?'Erneut zu Strava hochladen':'Zu Strava hochladen'}</button>`;
  return`<button type="button" class="btn" id="${id}" data-strava-export="${esc(r.id)}">Für Strava exportieren</button>`;
}
function stravaChanged(r){
  const b=$('#sumStrava');if(b&&$('#dlgSum').open&&b.dataset.ride===r.id){b.outerHTML=stravaBtn(r,'sumStrava');const nb=$('#sumStrava');if(nb)nb.dataset.ride=r.id;}
  if(S.view==='detail'&&S.detail===r.id)renderDetail();
}
document.addEventListener('click',e=>{
  const up=e.target.closest('[data-strava]');
  if(up){const r=S.rides.find(x=>x.id===up.dataset.strava);if(r)stravaUpload(r);return;}
  const ex=e.target.closest('[data-strava-export]');
  if(ex){const r=S.rides.find(x=>x.id===ex.dataset.stravaExport);if(r){download(tcx(r),`wattbuch-${r.start.slice(0,10)}.tcx`,'application/vnd.garmin.tcx+xml');window.open('https://www.strava.com/upload/select','_blank','noopener');}}
});

/* Einstellungen */
function renderStravaSet(){
  const el=$('#svBox');if(!el)return;const sv=SV(),st=S.strava;
  let h='<h3>Strava</h3>';
  if(!sv)h+='<p class="ftp-note">Direkt hochladen geht in der Mac-App. Hier im Browser: nach der Fahrt „Für Strava exportieren“, die Datei landet in Downloads und Strava öffnet die Upload-Seite.</p>';
  else if(st.connected)h+=`<p class="sv-ok"><i></i>Verbunden${st.athlete&&st.athlete.name?` als ${esc(st.athlete.name)}`:''}</p>
    <label class="chk sm${S.set.stravaAuto?' on':''}" id="svAutoL"><input type="checkbox" id="svAuto"${S.set.stravaAuto?' checked':''}><span class="box"></span>Nach jeder Fahrt automatisch hochladen</label>
    <div class="dlg-row"><button type="button" class="btn sm ghost" id="svOff">Trennen</button></div>`;
  else if(st.configured&&!el.dataset.edit)h+=`<p class="ftp-note">Deine Strava-App ist eingetragen. Jetzt einmal verbinden – Strava fragt im Browser nach der Erlaubnis, Fahrten hochzuladen.</p>
    <div class="dlg-row"><button type="button" class="btn sm primary" id="svConnect">Mit Strava verbinden</button><button type="button" class="lnk" id="svEdit">Zugangsdaten ändern</button></div>`;
  else h+=`<ol class="sv-steps">
      <li><a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> öffnen und eine App anlegen</li>
      <li>Name „Wattbuch“, Website <code>http://localhost</code>, Callback-Domain <code>localhost</code></li>
      <li>Client-ID und Client-Secret hier eintragen – sie bleiben nur auf diesem Mac</li>
    </ol>
    <div class="frow"><label for="svId">Client-ID</label><div class="field left"><input id="svId" inputmode="numeric" autocomplete="off" spellcheck="false"></div></div>
    <div class="frow"><label for="svSecret">Secret</label><div class="field left"><input id="svSecret" type="password" autocomplete="off" spellcheck="false"></div></div>
    <div class="dlg-row"><button type="button" class="btn sm primary" id="svSave">Speichern und verbinden</button></div>`;
  el.innerHTML=h;
}
async function stravaConnect(){
  const sv=SV(),b=$('#svConnect')||$('#svSave');if(b){b.disabled=true;b.textContent='Warte auf Strava im Browser …';}
  const r=await sv.connect();
  if(r.ok){S.strava=r;toast('Mit Strava verbunden');}else toast('Strava: '+r.error);
  delete $('#svBox').dataset.edit;renderStravaSet();
}
$('#svBox').addEventListener('click',async e=>{
  const sv=SV();if(!sv)return;
  if(e.target.closest('#svSave')){
    const r=await sv.setup($('#svId').value,$('#svSecret').value);
    if(!r.ok){toast(r.error);return;}
    S.strava=r;stravaConnect();
  }else if(e.target.closest('#svConnect'))stravaConnect();
  else if(e.target.closest('#svEdit')){$('#svBox').dataset.edit='1';renderStravaSet();}
  else if(e.target.closest('#svOff')){const r=await sv.disconnect();if(r.ok)S.strava=r;S.set.stravaAuto=false;saveSet();renderStravaSet();toast('Von Strava getrennt');}
});
$('#svBox').addEventListener('change',e=>{if(e.target.id==='svAuto'){S.set.stravaAuto=e.target.checked;saveSet();$('#svAutoL').classList.toggle('on',S.set.stravaAuto);}});

/* Name einer neuen Fahrt: Strecke, sonst nach Tageszeit wie bei Strava */
function rideName(iso,route){
  if(route)return route;
  const h=new Date(iso).getHours();
  return`Rollentraining am ${h<5?'späten Abend':h<11?'Morgen':h<14?'Mittag':h<18?'Nachmittag':h<22?'Abend':'späten Abend'}`;
}
