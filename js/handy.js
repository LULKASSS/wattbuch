'use strict';
/* ---------- Handy: Übersicht ---------- */
/* Am Handy wird nicht aufgenommen. Die Übersicht zeigt Training je Zeitraum, die eigenen Werte (FTP, Gewicht, Zonen)
   zum Pflegen, den FTP-Verlauf, die letzten Fahrten und den Abgleich mit dem Mac über iCloud Drive:
   Laden = Sicherung der Mac-App (iCloud Drive/Wattbuch), Senden = Datei nach iCloud Drive/Wattbuch/Import,
   die Mac-App übernimmt sie beim nächsten Start (Namen, Löschungen, FTP, Gewicht). */
const PER=[['w','Woche','Vorwoche'],['m','Monat','Vormonat'],['y','Jahr','Vorjahr'],['a','Gesamt','']];
function perRange(k,back=0){
  const n=new Date();
  if(k==='w'){const s=weekStart(n);s.setDate(s.getDate()-7*back);const e=new Date(s);e.setDate(e.getDate()+7);return{s,e};}
  if(k==='m')return{s:new Date(n.getFullYear(),n.getMonth()-back,1),e:new Date(n.getFullYear(),n.getMonth()-back+1,1)};
  if(k==='y')return{s:new Date(n.getFullYear()-back,0,1),e:new Date(n.getFullYear()-back+1,0,1)};
  return{s:new Date(0),e:new Date(8.64e15)};
}
function totals(rides,{s,e}){
  const t={n:0,sec:0,km:0,kj:0,gain:0,tss:0};
  for(const r of rides){const d=new Date(r.start);if(d<s||d>=e)continue;const x=stats(r);t.n++;t.sec+=x.dur;t.kj+=x.kj;t.tss+=x.tss;t.gain+=r.gain||0;if(r.dist&&r.dist.length)t.km+=r.dist[r.dist.length-1]/1000;}
  return t;
}
function perLabel(k,rides){
  const n=new Date();
  if(k==='w')return`KW ${isoWeek(n)}`;
  if(k==='m')return n.toLocaleDateString('de-DE',{month:'long',year:'numeric'});
  if(k==='y')return String(n.getFullYear());
  const first=rides.reduce((a,r)=>!a||r.start<a?r.start:a,null);
  return first?`seit ${fmtDateY(first)}`:'alle Fahrten';
}

/* FTP über die Zeit: Wert zur Zeit jeder Fahrt, Ergebnis eines FTP-Tests, zuletzt der eingestellte Wert */
function ftpSteps(rides){
  const pts=[];
  for(const r of [...rides].sort((a,b)=>a.start.localeCompare(b.start))){
    const f=r.ftpTest?r.ftpTest.ftp:r.ftp;
    if(fin(f)&&(!pts.length||pts[pts.length-1].w!==f))pts.push({t:Date.parse(r.start),w:f,test:r.ftpTest?r.id:null});
  }
  if(!pts.length||pts[pts.length-1].w!==S.set.ftp)pts.push({t:Date.now(),w:S.set.ftp,now:true});
  return pts;
}
function ftpChart(pts){
  const t0=pts[0].t,t1=Math.max(Date.now(),pts[pts.length-1].t),ws=pts.map(p=>p.w);
  const lo=Math.min(...ws),hi=Math.max(...ws),pd=Math.max(8,(hi-lo)*.3),y0=lo-pd,y1=hi+pd;
  const X=t=>((t-t0)/(t1-t0||1)*300).toFixed(1),Y=w=>(74-(w-y0)/(y1-y0)*66).toFixed(1);
  let d=`M0,${Y(pts[0].w)}`;for(let i=1;i<pts.length;i++)d+=` H${X(pts[i].t)} V${Y(pts[i].w)}`;d+=' H300';
  return`<svg viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true"><path d="${d} V80 H0 Z" fill="var(--accent-soft)"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>
  <div class="hf-ax"><span>${fmtDateY(new Date(t0).toISOString())}</span><span>heute</span></div>`;
}

const standalone=()=>!!(navigator.standalone||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches));
function renderHome(){
  const v=$('#v-home'),real=S.rides.filter(r=>!r.sample),ftp=S.set.ftp,kg=S.set.weight;
  const [k,,prevName]=PER.find(p=>p[0]===S.per)||PER[0];
  const t=totals(real,perRange(k)),pv=k==='a'?null:totals(real,perRange(k,1));
  const b20=bestsOf(real)[1200],est=b20?Math.round(b20.w*.95):null;
  const steps=ftpSteps(real),tests=real.filter(r=>r.ftpTest).sort((a,b)=>b.start.localeCompare(a.start));
  const recent=[...real].sort((a,b)=>b.start.localeCompare(a.start)).slice(0,3);
  const last=recent[0];
  const bk=S.bk?`Stand: Sicherung vom ${fmtDate(S.bk.saved)}, ${fmtTime(S.bk.saved)} Uhr.`:'Noch keine Sicherung vom Mac geladen.';
  const card=(lbl,val,u)=>`<div><span class="lbl">${lbl}</span><div class="v">${val}${u?`<small>${u}</small>`:''}</div></div>`;
  v.innerHTML=`
  <div class="page-h"><div><h1>Übersicht</h1><p class="sub-h">${real.length?`${real.length} ${real.length===1?'Fahrt':'Fahrten'} · zuletzt ${fmtDate(last.start)}`:'Gefahren wird am Mac, hier siehst und pflegst du alles'}</p></div></div>
  <div class="home">
    ${real.length?'':`<div class="card empty"><b>Noch keine Fahrten auf dem Handy</b>Die Mac-App sichert jede Fahrt in iCloud Drive → Wattbuch. Lade die Datei <code>wattbuch-sicherung.json</code> einmal hier.<div class="empty-a"><button type="button" class="btn primary" data-load>Sicherung laden</button></div></div>`}
    <div class="card hp">
      <div class="card-h"><h3>Training</h3><div class="seg sm" id="perSeg"><span class="thumb"></span>${PER.map(([key,l])=>`<button type="button" data-per="${key}"${key===k?' class="on"':''}>${l}</button>`).join('')}</div></div>
      <span class="lbl">${perLabel(k,real)}</span>
      <div class="hp-big"><b>${fmtHM(t.sec)}</b><small>h</small><span class="hp-n">${t.n} ${t.n===1?'Fahrt':'Fahrten'}</span></div>
      <div class="hp-g">
        ${card('Distanz',n1(t.km),'km')}${card('Arbeit',n0(t.kj),'kJ')}${card('Höhenmeter',n0(t.gain),'m')}
        ${card('Ø Leistung',t.sec?n0(t.kj*1000/t.sec):'–',t.sec?'W':'')}${card('TSS',n0(t.tss),'')}${card('Ø pro Fahrt',t.n?fmtHM(t.sec/t.n):'–',t.n?'h':'')}
      </div>
      ${pv?`<p class="hp-cmp">${prevName}: ${pv.n} ${pv.n===1?'Fahrt':'Fahrten'} · ${fmtHM(pv.sec)} h · ${n0(pv.kj)} kJ</p>`:''}
    </div>
    <div class="card hv">
      <div class="card-h"><h3>Deine Werte</h3><span class="tag acc" id="hWkg">${n2(ftp/kg)} W/kg</span></div>
      <div class="hv-f">
        <div><span class="lbl">FTP</span><div class="field"><button type="button" class="pm" data-hv="ftp" data-d="-5" aria-label="5 Watt weniger">−</button><input id="hFtp" inputmode="numeric" autocomplete="off" value="${ftp}" aria-label="FTP in Watt"><span class="u">W</span><button type="button" class="pm" data-hv="ftp" data-d="5" aria-label="5 Watt mehr">+</button></div></div>
        <div><span class="lbl">Gewicht</span><div class="field"><button type="button" class="pm" data-hv="kg" data-d="-0.5" aria-label="Ein halbes Kilo weniger">−</button><input id="hKg" inputmode="decimal" autocomplete="off" value="${String(kg).replace('.',',')}" aria-label="Gewicht in Kilogramm"><span class="u">kg</span><button type="button" class="pm" data-hv="kg" data-d="0.5" aria-label="Ein halbes Kilo mehr">+</button></div></div>
      </div>
      ${est&&est!==ftp?`<button type="button" class="qb hv-est" data-hest="${est}">Aus bestem 20-min-Wert<b>${est} W übernehmen</b></button>`:''}
      ${tests[0]?`<p class="hp-cmp">Letzter FTP-Test: <button type="button" class="lnk" data-ride="${tests[0].id}">${fmtDateY(tests[0].start)}</button> · ${tests[0].ftpTest.ftp} W</p>`:''}
      <div class="hz">${ZONES.map((z,i)=>{const lo=i?Math.round(ZONES[i-1].hi*ftp)+1:0,hi=z.hi===Infinity?null:Math.round(z.hi*ftp);return`<div style="--zc:var(--z${i+1})"><i></i><span>${z.n} ${z.name}</span><span>${hi==null?`ab ${lo}`:`${lo}–${hi}`} W</span></div>`;}).join('')}</div>
    </div>
    ${recent.length?`<div class="card hr-c">
      <div class="card-h"><h3>Letzte Fahrten</h3><button type="button" class="lnk" data-go="rides">Alle</button></div>
      <div class="list">${recent.map(rideRow).join('')}</div>
    </div>`:''}
    ${steps.length>1?`<div class="card hf">
      <div class="card-h"><h3>FTP-Verlauf</h3><span class="lbl">${steps[0].w} → ${ftp} W</span></div>
      ${ftpChart(steps)}
      <div class="hf-l">${steps.slice(1).reverse().slice(0,4).map((p,i,a)=>{const prev=steps[steps.length-1-i-1],dw=p.w-prev.w;return`<div><span>${p.now?'Eingestellt':fmtDateY(new Date(p.t).toISOString())}${p.test?' <span class="tag acc">Test</span>':''}</span><b>${p.w} W</b><span class="${dw>0?'up':'dn'}">${dw>0?'+':'−'}${Math.abs(dw)} W</span></div>`;}).join('')}</div>
    </div>`:''}
    <div class="card hd">
      <div class="card-h"><h3>Abgleich mit dem Mac</h3>${S.dirty?'<span class="tag warn">Änderungen offen</span>':''}</div>
      <p class="ftp-note">${bk}</p>
      <div class="dlg-row"><button type="button" class="btn sm${real.length?'':' primary'}" data-load>Sicherung laden</button><button type="button" class="btn sm${S.dirty?' primary':''}" id="hSend"${real.length||S.dirty?'':' disabled'}>Änderungen an den Mac</button></div>
      <p class="ftp-note hd-how"><b>Laden:</b> iCloud Drive → Wattbuch → <code>wattbuch-sicherung.json</code>.<br><b>An den Mac:</b> „In Dateien sichern“ → iCloud Drive → Wattbuch → Import. Die Mac-App übernimmt Namen, Löschungen, FTP und Gewicht beim nächsten Start.</p>
    </div>
    ${standalone()?'':`<p class="note soft hd-tip">Tipp: In Safari auf Teilen → „Zum Home-Bildschirm“. Dann startet Wattbuch wie eine App, und die Daten bleiben sicher liegen.</p>`}
  </div>`;
  requestAnimationFrame(()=>placeSegThumb($('#perSeg')));
}

/* Werte direkt in der Übersicht ändern */
function hvSet(which,val){
  if(!fin(val))return false;
  if(which==='ftp')setFtp(val);else setWeight(val);
  renderHome();return true;
}
document.addEventListener('click',e=>{
  if(e.target.closest('[data-load]')){$('#anyFile').click();return;}
  const p=e.target.closest('[data-per]');if(p){S.per=p.dataset.per;renderHome();return;}
  const pm=e.target.closest('[data-hv]');if(pm){hvSet(pm.dataset.hv,(pm.dataset.hv==='ftp'?S.set.ftp:S.set.weight)+(+pm.dataset.d));return;}
  const he=e.target.closest('[data-hest]');if(he){hvSet('ftp',+he.dataset.hest);toast(`FTP auf ${S.set.ftp} W gesetzt`);return;}
  if(e.target.closest('#hSend'))sendBackup();
});
document.addEventListener('change',e=>{
  if(e.target.id==='hFtp')hvSet('ftp',parseInt(e.target.value,10))||renderHome();
  if(e.target.id==='hKg')hvSet('kg',parseFloat(e.target.value.replace(',','.')))||renderHome();
});
document.addEventListener('focusin',e=>{if(e.target.id==='hFtp'||e.target.id==='hKg')e.target.select();});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.target.id==='hFtp'||e.target.id==='hKg'))e.target.blur();});

/* Änderungen an den Mac: über das Teilen-Menü in iCloud Drive/Wattbuch/Import sichern, sonst herunterladen */
async function sendBackup(){
  const name=`wattbuch-handy-${new Date().toISOString().slice(0,10)}.json`,text=backupJSON();
  let f=null;try{f=new File([text],name,{type:'application/json'});}catch(_){}
  if(f&&navigator.canShare&&navigator.canShare({files:[f]})){
    try{await navigator.share({files:[f]});}
    catch(x){if(x&&x.name==='AbortError')return;download(text,name,'application/json');}
  }else download(text,name,'application/json');
  S.dirty=false;await DB.set('dirty',false);
  toast('Im Ordner Wattbuch → Import sichern, der Mac übernimmt es');
  if(S.view==='home')renderHome();
}
