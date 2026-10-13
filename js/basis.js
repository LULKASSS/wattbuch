'use strict';
/* ---------- Helfer ---------- */
const $=(s,e=document)=>e.querySelector(s);
const $$=(s,e=document)=>[...e.querySelectorAll(s)];
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const pad=n=>String(n).padStart(2,'0');
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const F0=new Intl.NumberFormat('de-DE',{maximumFractionDigits:0});
const F1=new Intl.NumberFormat('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1});
const F2=new Intl.NumberFormat('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2});
const fin=v=>v!=null&&isFinite(v);
const n0=v=>fin(v)?F0.format(Math.round(v)):'–';
const n1=v=>fin(v)?F1.format(v):'–';
const n2=v=>fin(v)?F2.format(v):'–';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmtDur(s){s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return h?`${h}:${pad(m)}:${pad(x)}`:`${m}:${pad(x)}`;}
function fmtHM(s){s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?`${h}:${pad(m)}`:`0:${pad(m)}`;}
function durLbl(d){if(d<60)return d+' s';if(d<3600)return (d/60)+' min';const h=d/3600;return (Number.isInteger(h)?h:F1.format(h))+' h';}
const WD=['So','Mo','Di','Mi','Do','Fr','Sa'];
const MO=['Jan.','Feb.','März','Apr.','Mai','Juni','Juli','Aug.','Sep.','Okt.','Nov.','Dez.'];
const fmtDate=iso=>{const d=new Date(iso);return `${WD[d.getDay()]} ${d.getDate()}. ${MO[d.getMonth()]}`;};
const fmtDateY=iso=>{const d=new Date(iso);return `${d.getDate()}. ${MO[d.getMonth()]} ${d.getFullYear()}`;};
const fmtTime=iso=>{const d=new Date(iso);return `${pad(d.getHours())}:${pad(d.getMinutes())}`;};
function isoWeek(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);const y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));return Math.ceil(((t-y0)/864e5+1)/7);}
function weekStart(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
let toastT=null;
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),3600);}
function anim(ms,fn){const t0=performance.now();return new Promise(res=>{const st=t=>{const k=Math.min(1,(t-t0)/ms);fn(1-Math.pow(1-k,3));k<1?requestAnimationFrame(st):res();};requestAnimationFrame(st);});}

/* ---------- Leistungs-Kennzahlen ---------- */
const DURS=[1,5,10,15,30,60,120,300,600,1200,1800,3600,5400,7200];
const KEY_DURS=[5,60,300,1200,3600];
const ZONES=[
  {n:'Z1',name:'Erholung',hi:.55},{n:'Z2',name:'Grundlage',hi:.75},{n:'Z3',name:'Tempo',hi:.90},
  {n:'Z4',name:'Schwelle',hi:1.05},{n:'Z5',name:'VO2max',hi:1.20},{n:'Z6',name:'Anaerob',hi:1.50},{n:'Z7',name:'Sprint',hi:Infinity}];
function zoneIdx(w,ftp){const r=w/ftp;for(let i=0;i<6;i++)if(r<=ZONES[i].hi)return i;return 6;}
function sum(a){let s=0;for(let i=0;i<a.length;i++)s+=a[i];return s;}
function rolling(a,w){const o=new Array(a.length);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=w)s-=a[i-w];o[i]=s/Math.min(i+1,w);}return o;}
function calcNP(p){
  if(!p.length)return 0;
  if(p.length<30)return sum(p)/p.length;
  let s=0,acc=0,n=0;
  for(let i=0;i<p.length;i++){s+=p[i];if(i>=30)s-=p[i-30];if(i>=29){const a=s/30;acc+=a*a*a*a;n++;}}
  return Math.pow(acc/n,.25);
}
function bestAvg(p,d){
  if(p.length<d)return null;
  let s=0;for(let i=0;i<d;i++)s+=p[i];let m=s;
  for(let i=d;i<p.length;i++){s+=p[i]-p[i-d];if(s>m)m=s;}
  return m/d;
}
const SC=new WeakMap();
/* Gültige Fahrt: Leistung je Sekunde, oder (aus Strava, draußen ohne Wattmesser) noW mit Dauer dur in Sekunden */
const okRide=x=>!!(x&&x.id&&x.start&&Array.isArray(x.p)&&(x.p.length||x.noW&&x.dur>0));
function stats(r){
  const ftp=S.set.ftp, c=SC.get(r);
  if(c&&c.ftp===ftp)return c;
  if(r.noW){
    /* Ohne Wattmessung: Zeit, Puls, Kadenz echt; Leistung, Arbeit und TSS aus Stravas geschätztem Durchschnitt */
    const dur=r.dur||0,avg=r.estW||null,f=r.ftp||ftp,IF=avg?avg/f:null;
    const hv=r.hr?r.hr.filter(v=>v>0):[],cv=r.cad?r.cad.filter(v=>v>0):[];
    const s={ftp,dur,avg,np:null,max:null,kj:avg?avg*dur/1000:0,IF,tss:IF?dur*IF*IF/36:0,est:true,
      hrAvg:hv.length?sum(hv)/hv.length:null,hrMax:hv.length?Math.max(...hv):null,cadAvg:cv.length?sum(cv)/cv.length:null,curve:[],zt:[0,0,0,0,0,0,0]};
    SC.set(r,s);return s;
  }
  const p=r.p,dur=p.length;
  let max=0;for(const v of p)if(v>max)max=v;
  const avg=dur?sum(p)/dur:0,np=calcNP(p);
  const hv=r.hr?r.hr.filter(v=>v>0):[],cv=r.cad?r.cad.filter(v=>v>0):[];
  const zt=[0,0,0,0,0,0,0];for(const v of p)zt[zoneIdx(v,ftp)]++;
  const IF=np/ftp;
  const s={ftp,dur,avg,np,max,kj:sum(p)/1000,IF,tss:dur*np*IF/(ftp*36),
    hrAvg:hv.length?sum(hv)/hv.length:null,hrMax:hv.length?Math.max(...hv):null,
    cadAvg:cv.length?sum(cv)/cv.length:null,
    curve:DURS.filter(d=>d<=dur).map(d=>[d,bestAvg(p,d)]),zt};
  SC.set(r,s);return s;
}
/* Fahrten für Summen und Bestwerte: Beispielfahrt zählt nur, solange es keine echte gibt */
function aggRides(){const real=S.rides.filter(r=>!r.sample);return real.length?real:S.rides;}
function bestsOf(rides){
  const m={};
  for(const r of rides){for(const [d,w] of stats(r).curve){if(w!=null&&(!m[d]||w>m[d].w))m[d]={w,id:r.id,start:r.start};}}
  return m;
}

/* ---------- Speicher (IndexedDB, Rückfall auf Arbeitsspeicher) ---------- */
const DB=(()=>{
  let db=null;const mem=new Map(),kv=new Map();
  function open(){return new Promise(res=>{try{const q=indexedDB.open('wattbuch',1);q.onupgradeneeded=()=>{q.result.createObjectStore('rides',{keyPath:'id'});q.result.createObjectStore('kv');};q.onsuccess=()=>{db=q.result;res();};q.onerror=()=>res();q.onblocked=()=>res();}catch(e){res();}});}
  function run(store,mode,fn){return new Promise((res,rej)=>{try{const t=db.transaction(store,mode);const q=fn(t.objectStore(store));t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error);}catch(e){rej(e);}});}
  return{
    open,
    async all(){if(!db)return[...mem.values()];try{return await run('rides','readonly',s=>s.getAll())||[];}catch(e){return[...mem.values()];}},
    /* still=true: kommt aus dem Konto-Abgleich, nicht wieder ins Konto schicken */
    async put(r,still){mem.set(r.id,r);if(db)try{await run('rides','readwrite',s=>s.put(r));}catch(e){toast('Speichern im Browser fehlgeschlagen');}if(!still&&typeof syncMark==='function')syncMark(r.id);},
    async del(id,still){mem.delete(id);if(db)try{await run('rides','readwrite',s=>s.delete(id));}catch(e){}if(!still&&typeof syncMark==='function')syncMark(id);},
    async get(k){if(!db)return kv.get(k);try{return await run('kv','readonly',s=>s.get(k));}catch(e){return kv.get(k);}},
    async set(k,v){kv.set(k,v);if(db)try{await run('kv','readwrite',s=>s.put(v,k));}catch(e){}},
    async rm(k){kv.delete(k);if(db)try{await run('kv','readwrite',s=>s.delete(k));}catch(e){}},
    get ok(){return!!db;}
  };
})();

/* ---------- Handy ---------- */
/* Auf dem Handy wird nicht gefahren: nur Fahrten ansehen, Werte pflegen, Daten mit dem Mac abgleichen.
   ?handy erzwingt die Handy-Fassung (zum Testen am Mac), ?fahren schaltet sie ab. Die Mac-App ist nie Handy. */
/* Mac-App zum Herunterladen: jüngstes GitHub-Release, gebaut mit npm run app:release */
const MAC_APP='https://github.com/LULKASSS/wattbuch/releases/latest/download/Wattbuch-mac-arm64.zip';
/* Windows-App: Installer, gebaut von GitHub (.github/workflows/windows.yml) und ans jüngste Release gehängt */
const WIN_APP='https://github.com/LULKASSS/wattbuch/releases/latest/download/Wattbuch-Setup-win-x64.exe';
const HANDY=(()=>{
  const q=location.search;
  if(window.wattbuchDesktop||/[?&]fahren\b/.test(q))return false;
  if(/[?&]handy\b/.test(q))return true;
  try{return matchMedia('(pointer:coarse)').matches&&Math.min(screen.width,screen.height)<600;}catch(_){return false;}
})();
/* Am Computer im Browser: nur die Download-Seite, gefahren wird in der App. ?app (Tests) und ?fake (Entwickeln) zeigen die App. */
const LANDING=!window.wattbuchDesktop&&!HANDY&&!/[?&](app|fake|fahren)\b/.test(location.search);

/* ---------- Zustand ---------- */
const S={
  view:HANDY?'home':'live',per:'w',gone:new Set(),detail:null,set:{ftp:200,weight:75,bike:8,diff:.5,routeId:null,rev:false},rides:[],routes:[],
  sim:{v:0,d:0,total:0,gain:0,lastAlt:null,lap:1,done:false,sent:null,tSent:0,busy:false,last:0},
  cd:{state:'off',name:'',dev:null,manual:false},
  tr:{state:'off',name:'',dev:null,cp:null,ctrl:false,denied:false,via:'',manual:false,tries:0},
  hrm:{state:'off',name:'',dev:null,manual:false},
  live:{raw:[],cad:null,tC:0,cadSeen:false,spd:null,tS:0,hr:null,tH:0},
  hist:[],
  rec:{state:'idle',startISO:null,acc:0,run:0,p:[],hr:[],cad:[],spd:[],dist:[],alt:[],lastDraft:0},
  erg:{on:false,target:150},
  smooth:5,wake:null,liveHover:null
};
const isLive=()=>S.tr.state==='on';
