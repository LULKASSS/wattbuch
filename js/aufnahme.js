'use strict';
/* ---------- Aufnahme ---------- */
const recElapsed=(now=performance.now())=>S.rec.acc+(S.rec.state==='rec'?now-S.rec.run:0);
function pushSample(){
  const R=S.rec;
  if(S.tr.state==='on')R.trainer=true;
  R.p.push(samplePow());
  const h=curHR();R.hr.push(h==null?0:h);
  const c=curCad();R.cad.push(c==null?0:c);
  R.spd.push(Math.round(S.sim.v*36)/10);
  R.dist.push(Math.round(S.sim.total*10)/10);
  const rt=activeRoute();R.alt.push(rt?Math.round(eleAt(rt,S.sim.d)*10)/10:null);
}
function startRec(){
  if(!isLive()){toast('Erst die Rolle verbinden');return;}
  Object.assign(S.rec,{state:'rec',startISO:new Date().toISOString(),trainer:false,acc:0,run:performance.now(),p:[],hr:[],cad:[],spd:[],dist:[],alt:[],lastDraft:0});
  resetSim();wake(true);renderControls();renderRoutes();
  if(innerWidth<900)$('.card.live').scrollIntoView({behavior:'smooth',block:'start'});
}
function pauseRec(){if(S.rec.state!=='rec')return;S.rec.acc+=performance.now()-S.rec.run;S.rec.state='pause';saveDraft();renderControls();}
function resumeRec(){S.rec.run=performance.now();S.rec.state='rec';renderControls();}
function askEnd(){if(S.rec.state==='rec')pauseRec();S.rec.state='confirm';renderControls();}
function backFromEnd(){S.rec.state='pause';renderControls();}
function makeRide(d){
  const any=a=>a&&a.some(v=>v>0);
  return{id:'r'+Date.parse(d.startISO)+Math.random().toString(36).slice(2,6),start:d.startISO,name:rideName(d.startISO,d.route),
    p:d.p.slice(),hr:any(d.hr)?d.hr.slice():null,cad:any(d.cad)?d.cad.slice():null,spd:any(d.spd)?d.spd.slice():null,
    dist:any(d.dist)?d.dist.slice():null,alt:d.alt&&d.alt.some(v=>v!=null)?d.alt.slice():null,route:d.route||null,gain:d.gain||0,
    trainer:!!d.trainer,ftp:S.set.ftp,weight:S.set.weight};
}
async function saveRec(){
  const R=S.rec;
  if(R.p.length<10){toast('Unter 10 Sekunden, nicht gespeichert');resetRec();return;}
  const rt=activeRoute();R.route=rt?rt.name:null;R.gain=Math.round(S.sim.gain);
  const r=makeRide(R);stravaQueue(r);
  await DB.put(r);S.rides.push(r);await DB.rm('draft');
  resetRec();toast('Fahrt gespeichert');autoBackup();
  S.detail=r.id;go('detail');showSummary(r);
}
async function discardRec(){await DB.rm('draft');resetRec();toast('Fahrt verworfen');}
function resetRec(){Object.assign(S.rec,{state:'idle',startISO:null,trainer:false,acc:0,run:0,p:[],hr:[],cad:[],spd:[],dist:[],alt:[],lastDraft:0});resetSim();wake(false);renderControls();renderRecPill();renderRoutes();}
function saveDraft(){const R=S.rec,rt=activeRoute();R.lastDraft=R.p.length;DB.set('draft',{startISO:R.startISO,p:R.p,hr:R.hr,cad:R.cad,spd:R.spd,dist:R.dist,alt:R.alt,route:rt?rt.name:null,gain:Math.round(S.sim.gain),trainer:R.trainer});}
async function wake(on){
  try{
    if(on&&'wakeLock' in navigator&&!S.wake){S.wake=await navigator.wakeLock.request('screen');S.wake.addEventListener('release',()=>{S.wake=null;});}
    if(!on&&S.wake){await S.wake.release();S.wake=null;}
  }catch(_){}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.rec.state!=='idle')wake(true);});
window.addEventListener('beforeunload',e=>{if(S.rec.state!=='idle'){saveDraft();e.preventDefault();e.returnValue='';}});

/* ---------- Takt ---------- */
let lastHist=0,lastSim=performance.now();
function tick(){
  const now=performance.now();
  let dt=Math.min((now-lastSim)/1000,120);lastSim=now;
  while(dt>1e-6){const h=Math.min(.25,dt);simStep(h);dt-=h;}
  if(S.tr.state==='on'){applyControl(false);checkTrCad();}
  if(now-lastHist>=1000){lastHist=now;if(isLive()){S.hist.push(Math.round(curPow()));if(S.hist.length>600)S.hist.shift();}else S.hist=[];}
  if(S.rec.state==='rec'){
    const target=Math.floor(recElapsed(now)/1000);
    let added=false;while(S.rec.p.length<target){pushSample();added=true;}
    if(added)checkMoments();
    if(S.rec.p.length-S.rec.lastDraft>=15)saveDraft();
  }
  if(S.view==='live')renderLive();
  renderRecPill();
}
