'use strict';
/* ---------- Ereignisse ---------- */
document.addEventListener('click',e=>{
  const n=e.target.closest('#nav button');if(n){go(n.dataset.v);return;}
  const gEl=e.target.closest('[data-go]');if(gEl){go(gEl.dataset.go);return;}
  const rdl=e.target.closest('[data-rdel]');if(rdl){delRoute(rdl);return;}
  const rr=e.target.closest('[data-route]');if(rr){if(!rr.disabled)selectRoute(rr.dataset.route);return;}
  const df=e.target.closest('[data-df]');if(df){S.set.diff=+df.dataset.df;saveSet();renderRoutes();applyControl(true);return;}
  const rEl=e.target.closest('[data-ride]');if(rEl){S.detail=rEl.dataset.ride;go('detail');return;}
  const fb=e.target.closest('[data-full]');if(fb){$('#full').hidden?openFull():closeFull();return;}
  const a=e.target.closest('[data-a]');
  if(a){({start:beginRide,pause:pauseRec,resume:resumeRec,end:askEnd,back:backFromEnd,save:saveRec,
    discard:()=>{if(a.classList.contains('armed'))discardRec();else{a.classList.add('armed');a.textContent='Ja, verwerfen';setTimeout(()=>{if(a.isConnected){a.classList.remove('armed');a.textContent='Verwerfen';}},3500);}}})[a.dataset.a]();return;}
  const sm=e.target.closest('[data-sm]');
  if(sm){S.smooth=+sm.dataset.sm;$$('#smSeg button').forEach(b=>b.classList.toggle('on',b===sm));placeSegThumb($('#smSeg'));const c=$('#cvRide');c._prog=1;c._draw(null);return;}
  const qb=e.target.closest('#ergQuick [data-w]');
  if(qb){S.erg.target=+qb.dataset.w;if(!S.erg.on)S.erg.on=true;ergChanged();return;}
  const pm=e.target.closest('#ergCard .pm');
  if(pm){S.erg.target=clamp(S.erg.target+(+pm.dataset.d),0,1000);ergChanged();return;}
});
$('#btnTr').onclick=connectTrainer;
$('#btnHr').onclick=connectHR;
$('#btnCd').onclick=connectCd;
$('#rev').addEventListener('change',e=>{if(S.rec.state!=='idle'){e.target.checked=!!S.set.rev;return;}S.set.rev=e.target.checked;saveSet();resetSim();renderRoutes();applyControl(true);});
$('#fClose').onclick=closeFull;
$('#rtLoad').onclick=()=>$('#anyFile').click();
$('#rtRoll').onclick=()=>{if(S.rec.state!=='idle'){toast('Strecke erst nach der Fahrt wechseln');return;}rollRoute();};
$('#demo').addEventListener('change',e=>setDemo(e.target.checked));
$('#ergOn').addEventListener('change',e=>{S.erg.on=e.target.checked;ergChanged();});
const ergIn=$('#ergW');
ergIn.addEventListener('focus',()=>ergIn.select());
ergIn.addEventListener('input',()=>{const v=parseInt(ergIn.value,10);if(fin(v)&&v>=0&&v<=1000){S.erg.target=v;clearTimeout(ergT);ergT=setTimeout(applyErg,500);}});
ergIn.addEventListener('blur',()=>{S.erg.target=clamp(parseInt(ergIn.value,10)||S.erg.target,0,1000);ergIn.value=S.erg.target;});
ergIn.addEventListener('keydown',e=>{if(e.key==='Enter')ergIn.blur();if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();S.erg.target=clamp(S.erg.target+(e.key==='ArrowUp'?1:-1),0,1000);ergIn.value=S.erg.target;ergChanged();}});
bindHover($('#cvLive'),x=>{S.liveHover=x;});
$('#btnSet').onclick=openSet;
$('#setFtp').addEventListener('focus',e=>e.target.select());
$('#setKg').addEventListener('focus',e=>e.target.select());
$('#setBike').addEventListener('focus',e=>e.target.select());
$('#setBike').addEventListener('change',e=>{const v=parseFloat(e.target.value.replace(',','.'));if(fin(v)){S.set.bike=clamp(Math.round(v*10)/10,3,30);saveSet();}e.target.value=String(S.set.bike).replace('.',',');});
$('#setFtp').addEventListener('change',e=>{const v=parseInt(e.target.value,10);if(fin(v))setFtp(v);else e.target.value=S.set.ftp;rerender();});
$('#setKg').addEventListener('change',e=>{const v=parseFloat(e.target.value.replace(',','.'));if(fin(v)){S.set.weight=clamp(Math.round(v*10)/10,30,200);saveSet();}e.target.value=String(S.set.weight).replace('.',',');rerender();});
$('#dlgSet').addEventListener('close',rerender);
$('#bkExp').onclick=()=>download(backupJSON(),`wattbuch-sicherung-${new Date().toISOString().slice(0,10)}.json`,'application/json');
$('#bkImp').onclick=()=>$('#anyFile').click();
/* Eine Datei für alles: Sicherung, Streckendatei oder GPX */
/* Eine Datei für alles: Sicherung, Streckendatei oder GPX. files: [{name,text}] */
async function importFiles(files){
  let rides=0,routes=0,err='';
  for(const f of files){
    try{
      const text=f.text;
      if(/\.gpx$/i.test(f.name)||/^\s*<\?xml|<gpx/i.test(text.slice(0,300))){routes+=await addRoutes([parseGPX(text,f.name)]);continue;}
      const d=JSON.parse(text);
      const n=await importData(d);rides+=n.rides;routes+=n.routes;
      if(!(d&&(Array.isArray(d.routes)||Array.isArray(d.rides))))throw new Error('unbekanntes Format');
    }catch(x){err=`${f.name}: ${x&&x.message?x.message:'nicht lesbar'}`;}
  }
  const parts=[];if(routes)parts.push(`${routes} ${routes===1?'Strecke':'Strecken'}`);if(rides)parts.push(`${rides} ${rides===1?'Fahrt':'Fahrten'}`);
  if(parts.length)autoBackup();
  return{msg:parts.length?parts.join(' und ')+' geladen':(err||'Nichts gefunden'),ok:parts.length>0};
}
$('#anyFile').addEventListener('change',async e=>{
  const files=await Promise.all([...e.target.files].map(async f=>({name:f.name,text:await f.text()})));e.target.value='';
  toast((await importFiles(files)).msg);
  if($('#dlgSet').open)$('#dlgSet').close();else rerender();
});
armDelete($('#delAll'),'Wirklich alle löschen?',async()=>{for(const r of S.rides)await DB.del(r.id);S.rides=[];await DB.set('seeded',true);toast('Alle Fahrten gelöscht');autoBackup();$('#dlgSet').close();});
let rzT=null;
window.addEventListener('resize',()=>{clearTimeout(rzT);rzT=setTimeout(()=>{placeThumb();placeSegThumb($('#smSeg'));placeSegThumb($('#diffSeg'));$$('.view.active canvas').forEach(c=>c._draw&&c._draw(null));},120);});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>$$('.view.active canvas').forEach(c=>c._draw&&c._draw(null)));

/* ---------- Start ---------- */
(async()=>{
  $('#noBt').hidden=hasBT;document.documentElement.lang='de';
  renderZoneBar();
  $('#zonePill span').id='zpTxt';
  await DB.open();
  /* Browser soll die Daten nicht von selbst wegräumen, wenn der Speicher knapp wird */
  try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist();}catch(_){}
  /* Mac-App: Speicher leer (neu installiert oder verloren), aber Sicherung da → zurückholen */
  const fresh=!(await DB.get('seeded'))&&!(await DB.all()).length;
  if(fresh&&window.wattbuchDesktop){try{const b=await window.wattbuchDesktop.latestBackup();if(b&&Array.isArray(b.rides)&&b.rides.length){const n=await importData(b);await DB.set('seeded',true);toast(`${n.rides} Fahrten aus der Sicherung wiederhergestellt`);}}catch(_){}}
  const set=await DB.get('settings');if(set)S.set={...S.set,...set};
  S.erg.target=Math.round(S.set.ftp*.65/5)*5;
  S.rides=await DB.all();
  S.routes=(await DB.get('routes'))||[];
  /* Beim allerersten Start drei Vorschlagsstrecken anlegen */
  if(!(await DB.get('routesSeeded'))){await addRoutes(GEN_START.map(([t,sd])=>genRoute(t,sd)));await DB.set('routesSeeded',true);}
  if(S.set.routeId&&!S.routes.some(r=>r.id===S.set.routeId))S.set.routeId=null;
  renderRoutes();resetSim();
  const draft=await DB.get('draft');
  if(draft&&draft.p&&draft.p.length>=10){const r=makeRide(draft);r.name='Wiederhergestellte Fahrt';await DB.put(r);S.rides.push(r);toast('Unterbrochene Aufnahme wurde gespeichert');}
  if(draft)await DB.rm('draft');
  if(!S.rides.length&&!(await DB.get('seeded'))){const r=makeSample();await DB.put(r);S.rides.push(r);await DB.set('seeded',true);}
  go('live',true);
  if(typeof stravaRefresh==='function')stravaRefresh();
  /* Mac-App: neue Version der Oberfläche liegt bereit → neu laden, sobald keine Aufnahme läuft */
  if(window.wattbuchDesktop&&window.wattbuchDesktop.onUpdate)window.wattbuchDesktop.onUpdate(()=>{
    /* nicht während einer Fahrt, eines Dialogs, einer Gerätesuche oder eines Verbindungsaufbaus */
    const busy=()=>S.rec.state!=='idle'||document.querySelector('dialog[open]')||document.getElementById('btPick')||[S.tr,S.hrm,S.cd].some(d=>d.state==='wait');
    const go=()=>{if(!busy())location.reload();else setTimeout(go,10000);};go();
  });
  /* Mac-App: Dateien aus iCloud Drive/Wattbuch/Import/ übernehmen (z. B. Strecken aus Strava) */
  if(window.wattbuchDesktop&&window.wattbuchDesktop.pendingImports){try{const files=await window.wattbuchDesktop.pendingImports();if(files.length){const res=await importFiles(files);toast(res.msg);if(res.ok)await window.wattbuchDesktop.importsDone(files.map(f=>f.name));renderRoutes();}}catch(_){}}
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(placeThumb);
  setInterval(tick,250);tick();
})();
