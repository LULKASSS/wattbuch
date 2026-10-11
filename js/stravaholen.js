'use strict';
/* ---------- Fahrten aus Strava holen (nur Mac-App) ---------- */
/* Die Mac-App liest alle eigenen Radfahrten von Strava (braucht activity:read_all, sonst „Neu verbinden“) und legt sie als
   Wattbuch-Fahrten an: id 'sv<Strava-ID>', src:'strava', r.strava = {state:'ok'} (wird nie wieder hochgeladen).
   Mit Wattmessung (Rolle, Zwift, MyWhoosh) kommt die Leistung Sekunde für Sekunde; draußen ohne Wattmesser ist es eine
   noW-Fahrt: Zeit (dur), km, Höhe, Puls, Kadenz echt, Leistung nur Stravas Schätzung (estW).
   Pausen (Lücken über 10 s oder „steht“) fallen raus, wie bei Stravas Bewegungszeit.
   Schon aus Wattbuch hochgeladene Fahrten werden erkannt (external_id wattbuch-…, Strava-ID, gleiche Startzeit).
   Erst alles (neueste zuerst), danach beim Start und alle 30 min nur Neues. Höchstens 90 Abfragen pro 15 min
   (Strava erlaubt 100). Über das Konto kommen die Fahrten auch aufs Handy. */
const SVR=/^(Ride|VirtualRide|GravelRide|MountainBikeRide|EBikeRide|EMountainBikeRide|Velomobile|Handcycle)$/;
const SI={run:null,total:0,done:0,until:0,err:'',calls:[]};
const svInOn=()=>!!(SV()&&S.strava.connected&&S.strava.canRead&&S.set.stravaIn!==false);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function svCall(fn){
  for(;;){
    const now=Date.now();SI.calls=SI.calls.filter(t=>now-t<15*60000);
    if(SI.calls.length<90)break;
    SI.until=SI.calls[0]+15*60000;renderSvIn();await sleep(SI.until-now+500);
  }
  SI.until=0;SI.calls.push(Date.now());
  const r=await fn();
  if(!r.ok&&r.status===429){SI.until=Date.now()+15*60000;renderSvIn();await sleep(15*60000);return svCall(fn);}
  if(!r.ok)throw new Error(r.error||'Strava antwortet nicht');
  return r;
}
function svKnown(a){
  const id=String(a.id);
  if(S.gone.has('sv'+id)||S.rides.some(r=>r.id==='sv'+id||(r.strava&&String(r.strava.id)===id)))return true;
  if(/wattbuch-/.test(a.external_id||''))return true;
  const t=Date.parse(a.start_date);
  return S.rides.some(r=>r.src!=='strava'&&!r.sample&&Math.abs(Date.parse(r.start)-t)<10*60000);
}
/* Strava-Streams (key_by_type) → Wattbuch-Fahrt mit einem Wert pro Sekunde Bewegung */
function svRide(a,st){
  const g=k=>st&&st[k]&&Array.isArray(st[k].data)?st[k].data:null;
  const T=g('time');if(!T||T.length<2)return null;
  const W=g('watts'),H=g('heartrate'),C=g('cadence'),D=g('distance'),A=g('altitude'),M=g('moving');
  const hasW=!!(W&&a.device_watts!==false&&W.some(v=>v>0));
  const p=[],hr=[],cad=[],dist=[],alt=[];
  for(let i=1;i<T.length;i++){
    const dt=T[i]-T[i-1];if(dt<=0||dt>10||(M&&!M[i]))continue;
    for(let k=1;k<=dt;k++){
      if(hasW)p.push(Math.round(W[i]||0));
      hr.push(H?Math.round(H[i]||0):0);cad.push(C?Math.round(C[i]||0):0);
      if(D)dist.push(Math.round(D[i-1]+(D[i]-D[i-1])*k/dt));
      if(A)alt.push(Math.round(A[i]));
    }
  }
  const n=hr.length;if(n<60)return null;
  const any=x=>x.some(v=>v>0);
  const r={id:'sv'+a.id,start:new Date(a.start_date).toISOString(),name:a.name||'Ausfahrt',src:'strava',sport:a.sport_type||a.type||'Ride',
    p:hasW?p:[],hr:any(hr)?hr:null,cad:any(cad)?cad:null,spd:null,dist:D?dist:null,alt:A?alt:null,
    gain:Math.round(a.total_elevation_gain||0),route:null,trainer:!!a.trainer||a.sport_type==='VirtualRide',
    strava:{state:'ok',id:String(a.id),url:'https://www.strava.com/activities/'+a.id}};
  if(!hasW)Object.assign(r,{noW:true,dur:n,estW:a.average_watts?Math.round(a.average_watts):null});
  return r;
}

async function stravaImport(){
  if(SI.run)return SI.run;
  if(!svInOn())return;
  SI.run=(async()=>{
    SI.err='';let added=0;
    try{
      const st=(await DB.get('svIn'))||{};
      /* Beim ersten Mal die ganze Liste, danach nur seit der neuesten bekannten Fahrt (ein Tag Puffer für Nachzügler) */
      const after=st.full&&st.last?st.last-86400:0,list=[];
      for(let page=1;page<50;page++){const r=await svCall(()=>SV().activities({after,page}));list.push(...(r.list||[]));if(!r.list||r.list.length<100)break;}
      const todo=list.filter(a=>SVR.test(a.sport_type||a.type||'')&&(a.moving_time||0)>=300&&!svKnown(a)).sort((a,b)=>b.start_date.localeCompare(a.start_date));
      SI.total=todo.length;SI.done=0;renderSvIn();
      for(const a of todo){
        if(!svInOn())break;
        const r=await svCall(()=>SV().streams(a.id));
        const ride=svRide(a,r.streams);
        if(ride&&!svKnown(a)){S.rides.push(ride);await DB.put(ride);added++;}
        SI.done++;renderSvIn();
        if(added&&added%10===0&&typeof kRefresh==='function')kRefresh();
      }
      if(SI.done===SI.total){
        const newest=list.reduce((m,a)=>Math.max(m,Math.floor(Date.parse(a.start_date)/1000)),st.last||0);
        await DB.set('svIn',{full:true,last:newest,at:Date.now()});
      }
    }catch(e){SI.err=(e&&e.message)||'Fehler';}
    finally{SI.run=null;SI.total=0;SI.until=0;}
    if(added){toast(`${added} ${added===1?'Fahrt':'Fahrten'} aus Strava übernommen`);autoBackup();if(typeof kRefresh==='function')kRefresh();}
    renderSvIn();
  })();
  return SI.run;
}
setInterval(()=>stravaImport(),30*60000);

/* Stand in den Einstellungen */
function svInText(){
  const n=S.rides.filter(r=>r.src==='strava').length;
  if(SI.run){
    if(SI.until)return`Strava-Pause, geht um ${fmtTime(new Date(SI.until).toISOString())} Uhr weiter · ${SI.done} von ${SI.total}`;
    return SI.total?`Hole Fahrten aus Strava … ${SI.done} von ${SI.total}`:'Suche neue Fahrten auf Strava …';
  }
  if(SI.err)return`Übernehmen hat nicht geklappt (${esc(SI.err)}), nächster Versuch in 30 min`;
  return`${n} ${n===1?'Fahrt':'Fahrten'} aus Strava in Wattbuch`;
}
function renderSvIn(){const el=$('#svInSt');if(el)el.textContent=svInText();}
function svInHTML(){
  const st=S.strava;
  if(!st.canRead)return`<p class="ftp-note">Damit Wattbuch deine Strava-Fahrten übernehmen darf, einmal neu verbinden und „Aktivitäten ansehen“ erlauben.</p>
    <div class="dlg-row"><button type="button" class="btn sm primary" id="svConnect">Neu verbinden</button></div>`;
  const on=S.set.stravaIn!==false;
  return`<label class="chk sm${on?' on':''}" id="svInL"><input type="checkbox" id="svInChk"${on?' checked':''}><span class="box"></span>Alle Fahrten aus Strava übernehmen</label>
    ${on?`<p class="ftp-note sv-in" id="svInSt">${svInText()}</p>`:''}`;
}
$('#svBox').addEventListener('change',e=>{if(e.target.id==='svInChk'){S.set.stravaIn=e.target.checked;saveSet();renderStravaSet();if(e.target.checked)stravaImport();}});
