'use strict';
/* ---------- Konto: Abgleich über Supabase ---------- */
/* Fahrten und Werte (FTP, Gewicht, Rad) liegen je Konto in Supabase (Projekt „Apps“, Tabellen wattbuch_fahrten und
   wattbuch_werte, Zeilenschutz: jeder sieht nur seine eigenen Zeilen). Ohne Bibliothek, direkt über die REST-Schnittstelle.
   Ablauf: Jede lokal gespeicherte oder gelöschte Fahrt landet im Ausgang (K.out). Ein Abgleich holt erst alles, was seit
   K.pulled im Konto neu ist, und schickt dann den Ausgang. Liegt eine Fahrt noch im Ausgang, gewinnt die lokale Fassung;
   beim ersten Abgleich nach der Anmeldung gewinnt das Konto. Gelöschte Fahrten bleiben als Zeile mit geloescht=true stehen. */
const SB={url:'https://nysoyxbsdsxdvyknnkbc.supabase.co',key:'sb_publishable_ezMnvUv2bU521KyvyqrD7w_-Lh7TJnx'};
const K={s:null,out:new Map(),pulled:null,first:false,werte:false,wg:null,last:null,busy:false,err:'',mine:{}};

async function kSave(){await DB.set('konto',{s:K.s,out:[...K.out],pulled:K.pulled,first:K.first,werte:K.werte,wg:K.wg,last:K.last});}
async function kLoad(){const d=await DB.get('konto');if(!d)return;Object.assign(K,{s:d.s||null,out:new Map(d.out||[]),pulled:d.pulled||null,first:!!d.first,werte:!!d.werte,wg:d.wg||null,last:d.last||null});}

/* Anmeldung */
function authMsg(d){
  const m=String(d.error_code||d.msg||d.error_description||d.message||'');
  if(/invalid_credentials|invalid login/i.test(m))return'E-Mail oder Passwort stimmt nicht';
  if(/email_not_confirmed|not confirmed/i.test(m))return'Bitte erst den Link in der Bestätigungs-Mail öffnen';
  if(/user_already_exists|already registered/i.test(m))return'Das Konto gibt es schon, einfach anmelden';
  if(/weak_password|at least/i.test(m))return'Passwort zu kurz (mindestens 6 Zeichen)';
  if(/email_address_invalid|invalid.*email/i.test(m))return'E-Mail-Adresse stimmt nicht';
  return m||'Anmeldung hat nicht geklappt';
}
async function sbAuth(path,body){
  const r=await fetch(SB.url+'/auth/v1/'+path,{method:'POST',headers:{apikey:SB.key,'content-type':'application/json'},body:JSON.stringify(body||{})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(authMsg(d)),{status:r.status});
  return d;
}
function kSession(d){K.s={access:d.access_token,refresh:d.refresh_token,exp:Date.now()+(d.expires_in||3600)*1000,id:d.user&&d.user.id,email:d.user&&d.user.email};}
/* Der Bestätigungslink in der Mail führt zurück zur Webseite (auch aus der Mac-App heraus), nicht auf die Startseite von Supabase */
const K_BACK='https://lulkasss.github.io/wattbuch/';
async function kLogin(email,pw,neu){
  if(neu){const d=await sbAuth('signup?redirect_to='+encodeURIComponent(K_BACK),{email,password:pw});if(!d.access_token)return'mail';kSession(d);}
  else kSession(await sbAuth('token?grant_type=password',{email,password:pw}));
  await kFirst();return'ok';
}
/* Erster Abgleich: alles Lokale vormerken, das Konto gewinnt bei Fahrten, die es schon kennt */
async function kFirst(){
  Object.assign(K,{first:true,pulled:null,werte:true,wg:null,err:'',mine:{},out:new Map([...S.rides.filter(r=>!r.sample).map(r=>r.id),...S.gone].map(id=>[id,Date.now()]))});
  await kSave();sync();
}
/* Zurück aus der Bestätigungs-Mail: Supabase hängt die Anmeldung als #access_token=… an, dann gleich angemeldet.
   Abgelaufener oder schon benutzter Link (#error=…): Konto ist meist trotzdem bestätigt, also einfach anmelden. */
async function kFromLink(){
  const h=new URLSearchParams(location.hash.slice(1)),at=h.get('access_token'),err=h.get('error_description')||h.get('error');
  if(!at&&!err)return;
  history.replaceState(null,'',location.pathname+location.search);
  if(err){toast('Der Link aus der Mail ist abgelaufen oder schon benutzt. Melde dich einfach mit E-Mail und Passwort an.');return;}
  if(K.s)return;
  try{
    const r=await fetch(SB.url+'/auth/v1/user',{headers:{apikey:SB.key,authorization:'Bearer '+at}}),u=await r.json();if(!r.ok)throw 0;
    kSession({access_token:at,refresh_token:h.get('refresh_token'),expires_in:+h.get('expires_in')||3600,user:u});
    await kFirst();renderKonto(true);toast('E-Mail bestätigt, du bist angemeldet');
  }catch(_){toast('E-Mail bestätigt. Melde dich jetzt mit E-Mail und Passwort an.');}
}
async function kLogout(){
  const t=K.s&&K.s.access;
  Object.assign(K,{s:null,out:new Map(),pulled:null,first:false,werte:false,wg:null,last:null,err:''});await kSave();renderKonto(true);
  if(t)fetch(SB.url+'/auth/v1/logout',{method:'POST',headers:{apikey:SB.key,authorization:'Bearer '+t}}).catch(()=>{});
}
async function kToken(){
  if(Date.now()>K.s.exp-60000){
    try{kSession(await sbAuth('token?grant_type=refresh_token',{refresh_token:K.s.refresh}));await kSave();}
    catch(e){if(e.status>=400&&e.status<500){await kLogout();toast('Bitte neu im Konto anmelden');}throw e;}
  }
  return K.s.access;
}
async function sb(path,{method='GET',body,prefer}={},again=true){
  const r=await fetch(SB.url+'/rest/v1/'+path,{method,headers:{apikey:SB.key,authorization:'Bearer '+await kToken(),'content-type':'application/json',...(prefer?{prefer}:{})},body:body&&JSON.stringify(body)});
  if(r.status===401&&again&&K.s){K.s.exp=0;return sb(path,{method,body,prefer},false);}
  const tx=await r.text();
  if(!r.ok)throw Object.assign(new Error('Konto antwortet nicht ('+r.status+')'),{status:r.status});
  return tx?JSON.parse(tx):null;
}

/* Vormerken (DB.put/DB.del rufen das für jede Fahrt auf, Abgleich selbst schreibt still) */
let kT=null;
function syncSoon(ms=1500){if(!K.s)return;clearTimeout(kT);kT=setTimeout(sync,ms);}
function syncMark(id){if(!K.s||id==='sample')return;K.out.set(id,Date.now()+Math.random());kSave();syncSoon();renderKonto();}
function werteMark(){if(!K.s)return;K.werte=true;kSave();syncSoon();}

/* Eine Zeile aus dem Konto übernehmen. Gibt 1 zurück, wenn sich lokal etwas geändert hat. */
async function kApply(x){
  if(K.mine[x.id]===x.geaendert){delete K.mine[x.id];return 0;}   // eigenes Echo
  if(K.out.has(x.id)){if(K.first)K.out.delete(x.id);else return 0;}
  const loc=S.rides.find(r=>r.id===x.id);
  if(x.geloescht){
    if(loc){S.rides=S.rides.filter(r=>r!==loc);await DB.del(x.id,true);}
    if(!S.gone.has(x.id)){S.gone.add(x.id);await DB.set('gone',[...S.gone]);}
    return loc?1:0;
  }
  const r=x.data;if(!okRide(r))return 0;
  if(S.gone.delete(x.id))await DB.set('gone',[...S.gone]);
  const i=S.rides.indexOf(loc);if(i>=0)S.rides[i]=r;else S.rides.push(r);
  await DB.put(r,true);return 1;
}

let kRun=null;
function sync(){
  if(!K.s)return Promise.resolve();
  if(kRun){kRun.then(()=>syncSoon(200));return kRun;}
  clearTimeout(kT);
  kRun=(async()=>{
    K.busy=true;renderKonto();let n=0;
    try{
      /* 1. Holen, was im Konto neu ist */
      for(;;){
        const rows=await sb('wattbuch_fahrten?select=id,data,geloescht,geaendert&order=geaendert.asc&limit=10'+(K.pulled?'&geaendert=gt.'+encodeURIComponent(K.pulled):''));
        for(const x of rows){n+=await kApply(x);K.pulled=x.geaendert;}
        await kSave();
        if(rows.length<10)break;
      }
      const w=(await sb('wattbuch_werte?select=werte,geaendert'))[0];
      if(w&&w.geaendert!==K.wg&&(K.first||!K.werte)){
        const v=w.werte||{};
        if(fin(v.ftp)){S.set.ftp=v.ftp;S.set.ftpOk=true;}if(fin(v.weight))S.set.weight=v.weight;if(fin(v.bike))S.set.bike=v.bike;
        await saveSet();K.werte=false;K.wg=w.geaendert;n++;if(typeof renderErg==='function')renderErg();renderCoachOpts();
      }
      /* 2. Ausgang schicken: bis fünf Fahrten oder gut 1,5 MB pro Anfrage (lange Touren sind groß) */
      const ids=[...K.out.keys()];
      for(let k=0;k<ids.length;){
        const part=[],rows=[];let size=0;
        while(k<ids.length&&part.length<5&&(!part.length||size<1.5e6)){
          const id=ids[k++],r=S.rides.find(x=>x.id===id);
          const row=r?{id,start:r.start,data:r,geloescht:false}:{id,start:null,data:null,geloescht:true};
          size+=r?JSON.stringify(r).length:50;part.push([id,K.out.get(id)]);rows.push(row);
        }
        const res=await sb('wattbuch_fahrten?on_conflict=user_id,id&select=id,geaendert',{method:'POST',body:rows,prefer:'resolution=merge-duplicates,return=representation'});
        for(const x of res||[])K.mine[x.id]=x.geaendert;
        for(const [id,st] of part)if(K.out.get(id)===st)K.out.delete(id);   // in der Zwischenzeit neu vorgemerkt? Dann bleibt es drin
        await kSave();
      }
      if(K.werte){
        const res=await sb('wattbuch_werte?on_conflict=user_id&select=geaendert',{method:'POST',body:[{werte:{ftp:S.set.ftp,weight:S.set.weight,bike:S.set.bike}}],prefer:'resolution=merge-duplicates,return=representation'});
        K.werte=false;K.wg=res&&res[0]?res[0].geaendert:null;
      }
      Object.assign(K,{first:false,last:new Date().toISOString(),err:''});await kSave();
    }catch(e){K.err=navigator.onLine===false?'offline':(e&&e.message)||'Fehler';}
    finally{K.busy=false;kRun=null;}
    if(n||S.view==='home')kRefresh();
    renderKonto();
    if(K.s&&(K.out.size||K.werte))syncSoon(K.err?60000:500);
  })();
  return kRun;
}
/* Nach neuen Daten aus dem Konto neu zeichnen, aber nicht mitten in einer Eingabe */
function kRefresh(){
  const a=document.activeElement;
  if(S.view==='live'||$('#dlgSet').open||(a&&a.tagName==='INPUT'&&a.closest('main')))return;
  rerender();
}
setInterval(()=>syncSoon(0),5*60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncSoon(300);});
addEventListener('online',()=>syncSoon(300));

/* Anzeige: überall, wo ein .konto-Platz ist (Einstellungen, Übersicht am Handy) */
function kontoHTML(){
  if(!K.s)return`<div class="k-form">
    <p class="ftp-note">Mit Konto gleichen sich Mac und Handy von selbst ab.</p>
    <div class="k-ins"><input class="k-in" type="email" name="email" autocomplete="username" placeholder="E-Mail" aria-label="E-Mail">
    <input class="k-in" type="password" name="pw" autocomplete="current-password" placeholder="Passwort" aria-label="Passwort"></div>
    <div class="dlg-row"><button type="button" class="btn sm primary" data-k="in">Anmelden</button><button type="button" class="btn sm ghost" data-k="neu">Konto anlegen</button></div>
    <p class="note k-msg" hidden></p>
  </div>`;
  const st=K.busy?'Gleicht ab …':K.err?`Abgleich klappt gerade nicht (${esc(K.err)}), wird wiederholt`:K.last?`Abgeglichen ${fmtDate(K.last)}, ${fmtTime(K.last)} Uhr`:'Noch nicht abgeglichen';
  const em=K.s.email||'';
  return`<div class="k-me"><span class="k-av" aria-hidden="true">${esc((em[0]||'?').toUpperCase())}</span>
    <div class="k-t"><span class="k-ok">Angemeldet als <b>${esc(em)}</b></span>
    <span class="k-st${K.err?' warn':''}"><i></i>${st}${K.out.size&&!K.busy?` · ${K.out.size} ${K.out.size===1?'Änderung wartet':'Änderungen warten'}`:''}</span></div>
    <button type="button" class="btn sm ghost" data-k="aus">Abmelden</button></div>`;
}
function renderKonto(force){$$('.konto').forEach(el=>{if(force||!el.contains(document.activeElement)||!K.s===!el.querySelector('.k-form'))el.innerHTML=kontoHTML();});}
async function kSubmit(box,neu){
  const em=$('[name=email]',box).value.trim(),pw=$('[name=pw]',box).value,msg=$('.k-msg',box);
  const say=t=>{msg.textContent=t;msg.hidden=!t;};
  if(!em||!pw){say('E-Mail und Passwort eingeben');return;}
  $$('button',box).forEach(b=>b.disabled=true);say('');
  try{
    const r=await kLogin(em,pw,neu);
    if(r==='mail'){say('Fast geschafft: Bitte den Link in der Mail von Supabase öffnen, dann hier anmelden.');msg.classList.add('soft');}
    else{if(S.view==='home')renderHome();renderKonto(true);toast('Angemeldet, Fahrten werden abgeglichen');}
  }catch(e){say(e.message||'Anmeldung hat nicht geklappt');}
  finally{$$('button',box).forEach(b=>b.disabled=false);}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-k]');if(!b)return;
  const box=b.closest('.konto');
  if(b.dataset.k==='in'||b.dataset.k==='neu')kSubmit(box,b.dataset.k==='neu');
  if(b.dataset.k==='aus'){kLogout();toast('Abgemeldet, die Fahrten bleiben auf diesem Gerät');if(S.view==='home')renderHome();}
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.classList&&e.target.classList.contains('k-in')){e.preventDefault();kSubmit(e.target.closest('.konto'),false);}});
