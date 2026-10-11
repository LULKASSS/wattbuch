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
    if(!SI.err)favRoutes();
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
  if(!st.canRead&&st.central)return'';   // gemeinsame Strava-App: nur Hochladen, siehe desktop/strava.js
  if(!st.canRead)return`<p class="ftp-note">Damit Wattbuch deine Strava-Fahrten übernehmen darf, einmal neu verbinden und „Aktivitäten ansehen“ erlauben.</p>
    <div class="dlg-row"><button type="button" class="btn sm primary" id="svConnect">Neu verbinden</button></div>`;
  const on=S.set.stravaIn!==false;
  return`<label class="chk sm${on?' on':''}" id="svInL"><input type="checkbox" id="svInChk"${on?' checked':''}><span class="box"></span>Alle Fahrten aus Strava übernehmen</label>
    ${on?`<p class="ftp-note sv-in" id="svInSt">${svInText()}</p><p class="ftp-note">Deine meistgefahrenen Runden kommen als Strecken dazu.</p>`:''}`;
}
$('#svBox').addEventListener('change',e=>{if(e.target.id==='svInChk'){S.set.stravaIn=e.target.checked;saveSet();renderStravaSet();if(e.target.checked)stravaImport();}});

/* ---------- Meistgefahrene Runden als Strecken ---------- */
/* Aus allen eigenen Draußen-Fahrten (Stravas summary_polyline) gleiche Runden erkennen: Start und Ziel höchstens 1 km
   auseinander, Länge ±8 %, und die Linien decken sich (Stichproben der einen liegen höchstens 300 m neben der anderen,
   in beide Richtungen). Die drei häufigsten Runden (mind. 3-mal gefahren) kommen als Strecke dazu, Linie und Höhe aus der
   jüngsten Fahrt (id 'sf<Strava-ID>', r.fav = {n}). Läuft nach dem Übernehmen, höchstens einmal pro Woche.
   Gelöschte Lieblingsrunden kommen nicht wieder (favGone). */
const FAV={max:3,min:3};
let favRun=false;
/* Google-Polyline entpacken, dabei alle 100 m einen Punkt einfügen, damit lange gerade Stücke vergleichbar bleiben */
function polyDec(s){
  const pts=[];let i=0,la=0,lo=0;
  while(i<s.length){const v=[0,0];for(const k of[0,1]){let b,sh=0,r=0;do{b=s.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5;}while(b>=32&&i<s.length);v[k]=r&1?~(r>>1):r>>1;}
    la+=v[0];lo+=v[1];const p=[la/1e5,lo/1e5],q=pts[pts.length-1];
    if(q){const n=Math.floor(dm(q,p)/100);for(let j=1;j<=n;j++)pts.push([q[0]+(p[0]-q[0])*j/(n+1),q[1]+(p[1]-q[1])*j/(n+1)]);}
    pts.push(p);}
  return pts;
}
const dm=(a,b)=>Math.hypot((a[0]-b[0])*111320,(a[1]-b[1])*111320*Math.cos(a[0]*Math.PI/180));
function covers(a,b){
  const st=Math.max(1,Math.floor(a.length/25));
  for(let i=0;i<a.length;i+=st){let ok=false;for(const q of b)if(dm(a[i],q)<300){ok=true;break;}if(!ok)return false;}
  return true;
}
const sameLoop=(a,b)=>Math.abs(a.km-b.km)<=.08*Math.max(a.km,b.km)&&dm(a.s,b.s)<1000&&dm(a.e,b.e)<1000&&covers(a.pts,b.pts)&&covers(b.pts,a.pts);
function favClusters(list){
  const cl=[];
  for(const a of list.slice().sort((a,b)=>b.start_date.localeCompare(a.start_date))){
    if(!SVR.test(a.sport_type||a.type||'')||a.trainer||a.sport_type==='VirtualRide'||!(a.distance>=10000)||!a.map||!a.map.summary_polyline)continue;
    const pts=polyDec(a.map.summary_polyline);if(pts.length<2)continue;
    const x={a,pts,km:a.distance/1000,s:pts[0],e:pts[pts.length-1]},c=cl.find(c=>sameLoop(c[0],x));
    if(c)c.push(x);else cl.push([x]);
  }
  return cl.filter(c=>c.length>=FAV.min).sort((a,b)=>b.length-a.length);
}
/* Name: der Name, den du der Runde am häufigsten gegeben hast (Stravas „Radfahrt am Morgen“ zählt nicht) */
const SVDEF=/^(morning|lunch|afternoon|evening|night|morgen|vormittag|mittag|nachmittag|abend|nacht)\w*[- ]?(ride|radfahrt|ausfahrt|fahrt)?$|(ride|radfahrt|ausfahrt|fahrt) (am|in the) /i;
function favName(c){
  const m=new Map();for(const x of c){const n=(x.a.name||'').trim();if(n&&!SVDEF.test(n))m.set(n,(m.get(n)||0)+1);}
  const b=[...m].sort((a,b)=>b[1]-a[1])[0];
  return b&&b[1]>=2?b[0].slice(0,60):`Deine Runde · ${n0(c[0].km)} km`;
}
async function favRoutes(force){
  if(favRun||!svInOn())return;
  const st=(await DB.get('favR'))||{};
  if(!force&&st.at&&Date.now()-st.at<7*864e5)return;
  favRun=true;let added=0;
  try{
    const list=[];
    for(let page=1;page<50;page++){const r=await svCall(()=>SV().activities({page}));list.push(...(r.list||[]));if(!r.list||r.list.length<100)break;}
    const gone=new Set((await DB.get('favGone'))||[]),has=(c,ids)=>c.some(y=>ids.has('sf'+y.a.id));
    const top=favClusters(list).filter(c=>!has(c,gone)).slice(0,FAV.max);
    for(const c of top){
      const old=S.routes.find(r=>r.fav&&has(c,new Set([r.id])));
      if(old){old.fav.n=c.length;continue;}
      const x=c[0],sm=(await svCall(()=>SV().streams(x.a.id,'route'))).streams||{};
      const L=sm.latlng&&sm.latlng.data,A=sm.altitude&&sm.altitude.data;
      if(!L||!A||L.length!==A.length)continue;   // ältere Mac-App liefert noch keine Linie
      try{const rt=buildRoute(favName(c),L.map((p,i)=>[p[0],p[1],A[i]]));rt.id='sf'+x.a.id;rt.fav={n:c.length};await addRoutes([rt]);added++;}catch(_){}
    }
    await DB.set('routes',S.routes);renderRoutes();
    await DB.set('favR',{at:Date.now()});
  }catch(_){}
  finally{favRun=false;}
  if(added){autoBackup();toast(added===1?'Deine meistgefahrene Runde ist jetzt als Strecke da':`${added} deiner meistgefahrenen Runden sind jetzt als Strecken da`);}
}

/* ---------- Eine Strava-Fahrt als Strecke speichern ---------- */
/* Draußen gefahrene Strava-Fahrt → Strecke mit Linie und Höhe (id 'sr<Strava-ID>'), danach unter „Fahren“ wählbar */
const canRouteFrom=r=>!!(r&&r.src==='strava'&&r.strava&&r.strava.id&&!r.trainer&&SV()&&S.strava.connected&&S.strava.canRead);
function routeFromBtn(r){
  if(!canRouteFrom(r))return'';
  const has=S.routes.some(x=>x.id==='sr'+r.strava.id);
  return`<button type="button" class="btn" id="btnRouteFrom" data-route-from="${esc(r.id)}"${has?' disabled':''}>${has?'Als Strecke gespeichert':'Als Strecke speichern'}</button>`;
}
async function routeFrom(r,btn){
  btn.disabled=true;btn.textContent='Hole die Strecke …';
  try{
    const sm=(await svCall(()=>SV().streams(r.strava.id,'route'))).streams||{};
    const L=sm.latlng&&sm.latlng.data,A=sm.altitude&&sm.altitude.data;
    if(!L||!A||L.length!==A.length)throw new Error('Strava liefert keine Linie mit Höhe');
    const rt=buildRoute(r.name.slice(0,60)||'Strecke',L.map((p,i)=>[p[0],p[1],A[i]]));rt.id='sr'+r.strava.id;
    await addRoutes([rt]);autoBackup();
    toast(`${rt.name} ist jetzt eine Strecke · ${n1(rt.dist/1000)} km · ${n0(rt.gain)} Hm`);
    btn.textContent='Als Strecke gespeichert';
  }catch(e){btn.disabled=false;btn.textContent='Als Strecke speichern';toast('Strecke: '+((e&&e.message)||'hat nicht geklappt'));}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-route-from]');if(!b||b.disabled)return;
  const r=S.rides.find(x=>x.id===b.dataset.routeFrom);if(r)routeFrom(r,b);
});
