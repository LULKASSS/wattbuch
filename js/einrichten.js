'use strict';
/* ---------- Einrichten beim ersten Start und App-Updates (nur App für Mac/Windows) ---------- */
/* Beim ersten Start der App, solange niemand angemeldet ist: Konto → deine Werte → Strava (optional) → fertig.
   S.set.onboarded merkt, dass es durch ist (auch beim Überspringen). Wer schon ein Konto hat, sieht es nie.
   App-Updates: die Oberfläche kommt ohnehin laufend von der Webseite; neue Versionen der App selbst lädt sie im
   Hintergrund (desktop/selfupdate.js) und spielt sie beim Beenden ein. Ältere Apps können das noch nicht,
   die bekommen in den Einstellungen einen Link zum einmaligen Neuladen. */
const OB={step:0,t:null};
const OBSTEPS=['konto','werte','strava','fertig'];
function obSteps(){return OBSTEPS.filter(s=>s!=='strava'||SV());}
function openSetup(){OB.step=0;renderSetup();const d=$('#dlgStart');if(!d.open)d.showModal();d.focus();clearInterval(OB.t);OB.t=setInterval(obTick,700);}
function closeSetup(){clearInterval(OB.t);S.set.onboarded=true;saveSet();const d=$('#dlgStart');if(d.open)d.close();}
/* Anmeldung und Strava laufen im Hintergrund weiter: Knöpfe passend halten */
function obTick(){
  const st=obSteps()[OB.step],nx=$('#obNext');if(!nx)return;
  if(st==='konto')nx.textContent=K.s?'Weiter':'Ohne Konto weiter',nx.classList.toggle('primary',!!K.s),nx.classList.toggle('ghost',!K.s);
  if(st==='strava'){const c=S.strava&&S.strava.connected;nx.textContent=c?'Weiter':'Überspringen';const b=$('#obSv');if(b&&c){b.disabled=true;b.textContent='Mit Strava verbunden';}}
}
function renderSetup(){
  const steps=obSteps(),st=steps[OB.step],box=$('#obBox');
  const dots=steps.map((_,i)=>`<i class="${i===OB.step?'on':i<OB.step?'done':''}"></i>`).join('');
  let h='',next='Weiter';
  if(st==='konto')h=`<h2>Willkommen bei Wattbuch</h2><p class="ftp-note">Mit Konto sind deine Fahrten gesichert und auch am Handy da. Neu hier? E-Mail und Passwort eingeben, „Konto anlegen“, dann den Link in der Mail öffnen und hier anmelden.</p><div class="konto">${kontoHTML()}</div>`;
  if(st==='werte')h=`<h2>Deine Werte</h2><p class="ftp-note">Damit Watt pro Kilo, Zonen, Tempo am Berg und der Coach stimmen.</p>
    <div class="vals ob-vals">
      <label class="vf" for="obKg"><span class="lbl">Gewicht</span><span class="field left"><input id="obKg" inputmode="decimal" autocomplete="off" value="${String(S.set.weight).replace('.',',')}"><span class="u">kg</span></span></label>
      <label class="vf" for="obFtp"><span class="lbl">FTP</span><span class="field left"><input id="obFtp" inputmode="numeric" autocomplete="off" placeholder="?" value="${ftpKnown()?S.set.ftp:''}"><span class="u">W</span></span></label>
      <label class="vf" for="obBike"><span class="lbl">Rad</span><span class="field left"><input id="obBike" inputmode="decimal" autocomplete="off" value="${String(S.set.bike).replace('.',',')}"><span class="u">kg</span></span></label>
    </div><p class="ftp-note ob-tip">FTP nicht zur Hand? Leer lassen und später unter „Fahren“ den FTP-Test machen, er trägt sie selbst ein.</p><p class="note ob-msg" id="obMsg" hidden></p>`;
  if(st==='strava')h=`<h2>Strava <small>optional</small></h2><p class="ftp-note">Fahrten mit der Rolle gehen von selbst hoch, und deine meistgefahrenen Runden kommen als Strecken dazu.</p>
    <div class="dlg-row"><button type="button" class="btn strava" id="obSv"${S.strava&&S.strava.connected?' disabled':''}>${S.strava&&S.strava.connected?'Mit Strava verbunden':'Mit Strava verbinden'}</button></div>`;
  if(st==='fertig'){h=`<h2>Alles bereit</h2><p class="ftp-note">Rolle anschalten, unter „Fahren“ verbinden, Strecke wählen und los. Den Coach findest du direkt über dem Start.</p>`;next='Los geht’s';}
  box.innerHTML=`<div class="ob-dots" aria-hidden="true">${dots}</div><div class="ob-body">${h}</div>
    <div class="dlg-foot ob-foot">${OB.step?'<button type="button" class="btn ghost" id="obBack">Zurück</button>':''}<span class="spacer"></span><button type="button" class="btn primary" id="obNext">${next}</button></div>`;
  obTick();
  const f=$('#obBox input');if(f&&st==='werte')f.focus();
}
function obSaveWerte(){
  const num=id=>{const v=$(id).value.trim().replace(',','.');return v===''?null:+v;};
  const kg=num('#obKg'),ftp=num('#obFtp'),bike=num('#obBike'),msg=$('#obMsg');
  const bad=t=>{msg.textContent=t;msg.hidden=false;return false;};
  if(!fin(kg)||kg<30||kg>200)return bad('Gewicht zwischen 30 und 200 kg eintragen');
  if(ftp!=null&&(!fin(ftp)||ftp<50||ftp>600))return bad('FTP zwischen 50 und 600 W, oder leer lassen');
  if(fin(bike)&&bike>=3&&bike<=30){S.set.bike=Math.round(bike*10)/10;}
  setWeight(kg);if(ftp!=null)setFtp(ftp);else saveSet();
  return true;
}
$('#dlgStart').addEventListener('click',async e=>{
  const steps=obSteps(),st=steps[OB.step];
  if(e.target.closest('#obBack')){OB.step--;renderSetup();return;}
  if(e.target.closest('#obSv')){const b=e.target.closest('#obSv');b.disabled=true;b.textContent='Warte auf Strava im Browser …';
    const r=await SV().connect();if(r.ok){S.strava=r;toast('Mit Strava verbunden');stravaSync();svPull(true);}else{toast('Strava: '+r.error);b.disabled=false;b.textContent='Mit Strava verbinden';}renderStravaSet();obTick();return;}
  if(e.target.closest('#obNext')){
    if(st==='werte'&&!obSaveWerte())return;
    if(OB.step>=steps.length-1){closeSetup();renderView(S.view);return;}
    OB.step++;renderSetup();
  }
});
$('#dlgStart').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.closest('.ob-vals')){e.preventDefault();$('#obNext').click();}});
/* Esc oder Schließen: nicht wieder fragen, alles bleibt in den Einstellungen erreichbar */
$('#dlgStart').addEventListener('close',()=>{clearInterval(OB.t);if(!S.set.onboarded){S.set.onboarded=true;saveSet();}});

/* ---------- App-Version ---------- */
async function appInfo(){
  const d=window.wattbuchDesktop;if(!d)return;
  S.app=d.info?await d.info().catch(()=>null):null;
  if(d.onAppUpdate)d.onAppUpdate(m=>{if(S.app)S.app.update=m.version;renderAppBox();toast(`Wattbuch ${m.version} ist geladen und kommt beim nächsten Start`);});
  renderAppBox();
  if(S.app&&S.app.update)toast(`Wattbuch ${S.app.update} ist geladen und kommt beim nächsten Start`);
}
function renderAppBox(){
  const el=$('#appBox');if(!el)return;
  const d=window.wattbuchDesktop,A=S.app;
  if(!d){el.hidden=true;return;}
  el.hidden=false;
  /* Ältere App ohne Selbst-Update: einmal von Hand */
  if(!A)el.innerHTML=`<h3>App</h3><div class="sv-line"><span class="ftp-note">Es gibt eine neue Version der App. Einmal laden und installieren, danach aktualisiert sie sich selbst.</span><a class="btn sm primary" href="${MAC_APP}">Neue Version laden</a></div>`;
  else if(A.update)el.innerHTML=`<h3>App</h3><div class="sv-line"><span class="ftp-note">Wattbuch ${esc(A.update)} ist geladen und kommt beim nächsten Start.</span><button type="button" class="btn sm primary" id="appInstall"${S.rec.state!=='idle'?' disabled':''}>Jetzt neu starten</button></div>`;
  else el.innerHTML=`<h3>App</h3><p class="ftp-note">Version ${esc(A.version)} · aktualisiert sich von selbst.</p>`;
}
$('#appBox').addEventListener('click',async e=>{
  if(!e.target.closest('#appInstall')||S.rec.state!=='idle')return;
  e.target.disabled=true;e.target.textContent='Startet neu …';
  if(!await window.wattbuchDesktop.installUpdate()){toast('Update hat nicht geklappt, kommt beim nächsten Start');renderAppBox();}
});
/* Erster Start: einrichten, solange niemand angemeldet ist */
function maybeSetup(){
  if(!S.app||!S.app.onboard||S.set.onboarded||HANDY)return;
  if(K.s){S.set.onboarded=true;saveSet();return;}
  openSetup();
}
