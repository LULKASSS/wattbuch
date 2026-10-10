'use strict';
/* ---------- Live-Daten ---------- */
function feed(r,src){
  const now=performance.now(),L=S.live;
  if(fin(r.pow)){L.raw.push({t:now,v:Math.max(0,r.pow)});}
  if(fin(r.cad)&&(src==='cd'||S.cd.state!=='on')){L.cad=r.cad;L.tC=now;if(r.cad>0)L.cadSeen=true;}
  if(fin(r.spd)){L.spd=r.spd;L.tS=now;}
  if(fin(r.hr)&&r.hr>0&&(src==='hr'||S.hrm.state!=='on')){L.hr=r.hr;L.tH=now;}
  while(L.raw.length&&now-L.raw[0].t>5000)L.raw.shift();
}
function avgSince(ms){const now=performance.now();let s=0,n=0;for(const x of S.live.raw)if(now-x.t<=ms){s+=x.v;n++;}return n?s/n:null;}
function curPow(){const v=avgSince(3000);if(v!=null)return v;return isLive()?0:null;}
function samplePow(){let v=avgSince(1100);if(v==null)v=avgSince(3000);return v==null?0:Math.round(v);}
const fresh=(t,ms)=>performance.now()-t<=ms;
function curHR(){return S.live.hr&&fresh(S.live.tH,5000)?S.live.hr:null;}
function curCad(){return S.live.cadSeen&&fresh(S.live.tC,3000)?S.live.cad:null;}

/* ---------- Bluetooth ---------- */
const hasBT=!!(navigator.bluetooth&&navigator.bluetooth.requestDevice);
function onIBD(e){
  const dv=e.target.value;
  try{
    const f=dv.getUint16(0,true);let o=2;const r={};
    if(!(f&1)){r.spd=dv.getUint16(o,true)/100;o+=2;}
    if(f&2)o+=2;
    if(f&4){r.cad=Math.round(dv.getUint16(o,true)/2);o+=2;}
    if(f&8)o+=2;
    if(f&16)o+=3;
    if(f&32)o+=2;
    if(f&64){r.pow=dv.getInt16(o,true);o+=2;}
    if(f&128)o+=2;
    if(f&256)o+=5;
    if(f&512){r.hr=dv.getUint8(o);o+=1;}
    feed(r,'tr');
  }catch(_){}
}
let lastCrank=null;
function onCPM(e){
  const dv=e.target.value;
  try{
    const f=dv.getUint16(0,true);const r={pow:dv.getInt16(2,true)};let o=4;
    if(f&1)o+=1; if(f&4)o+=2; if(f&16)o+=6;
    if(f&32){
      const rev=dv.getUint16(o,true),t=dv.getUint16(o+2,true),now=performance.now();
      if(lastCrank&&rev!==lastCrank.rev){const dr=(rev-lastCrank.rev+65536)%65536,dt=((t-lastCrank.t+65536)%65536)/1024;if(dt>0&&dr<10)r.cad=Math.round(dr/dt*60);}
      else if(lastCrank&&now-lastCrank.at>2500)r.cad=0;
      if(!lastCrank||rev!==lastCrank.rev)lastCrank={rev,t,at:now};
    }
    feed(r,'tr');
  }catch(_){}
}
function onHRM(e){
  const dv=e.target.value;
  try{const f=dv.getUint8(0);feed({hr:f&1?dv.getUint16(1,true):dv.getUint8(1)},'hr');}catch(_){}
}
let lastCsc=null;
function onCSC(e){
  const dv=e.target.value;
  try{
    const f=dv.getUint8(0);let o=1;if(f&1)o+=6;
    if(f&2){
      const rev=dv.getUint16(o,true),t=dv.getUint16(o+2,true),now=performance.now();let cad=null;
      if(lastCsc&&rev!==lastCsc.rev){const dr=(rev-lastCsc.rev+65536)%65536,dt=((t-lastCsc.t+65536)%65536)/1024;if(dt>0&&dr<10)cad=Math.round(dr/dt*60);}
      else if(lastCsc&&now-lastCsc.at>2500)cad=0;
      if(!lastCsc||rev!==lastCsc.rev)lastCsc={rev,t,at:now};
      if(cad!=null)feed({cad},'cd');
    }
  }catch(_){}
}
function onCP(e){
  const dv=e.target.value;
  try{if(dv.getUint8(0)===0x80){const op=dv.getUint8(1),res=dv.getUint8(2);if(res!==1&&op===0x00){S.tr.ctrl=false;S.tr.denied=true;ergMsg('Die Rolle gibt die Steuerung nicht frei. Läuft noch eine andere App?');}}}catch(_){}
}

/* requestDevice abgelehnt: Abbrechen durch dich bleibt still, alles andere bekommt einen Hinweis */
function btFail(e){
  const m=(e&&e.message)||'';
  if(/cancel/i.test(m))return;
  if(/adapter|not available|unavailable|permission|denied|not allowed|globally disabled/i.test(m)){toast('Bluetooth nicht verfügbar. Ist es an? Mac: Systemeinstellungen → Datenschutz → Bluetooth → Wattbuch erlauben');return;}
  if(e&&e.name==='NotFoundError')return;
  toast('Verbinden ging nicht: '+m);
}
async function connectTrainer(){
  if(S.tr.state!=='off'){disconnectTrainer();return;}
  if(!hasBT){toast('Dieser Browser kann kein Bluetooth');return;}
  let dev;
  try{
    dev=await navigator.bluetooth.requestDevice({filters:[{services:[0x1826]},{services:[0x1818]}],optionalServices:[0x1826,0x1818]});
  }catch(e){btFail(e);return;}
  if(S.demo)setDemo(false);
  S.tr.dev=dev;S.tr.manual=false;S.tr.tries=0;
  dev.addEventListener('gattserverdisconnected',onTrDisc);
  await setupTrainer();
}
async function setupTrainer(){
  const dev=S.tr.dev;if(!dev)return;
  setTr('wait',dev.name||'Rollentrainer','Verbinde …');
  try{
    const srv=await dev.gatt.connect();let via='';
    try{
      const f=await srv.getPrimaryService(0x1826);
      const ibd=await f.getCharacteristic(0x2ad2);
      ibd.addEventListener('characteristicvaluechanged',onIBD);
      await ibd.startNotifications();via='FTMS';
      try{const cp=await f.getCharacteristic(0x2ad9);cp.addEventListener('characteristicvaluechanged',onCP);await cp.startNotifications();S.tr.cp=cp;S.tr.ctrl=false;S.tr.denied=false;}catch(_){S.tr.cp=null;}
    }catch(_){}
    if(!via){
      const s=await srv.getPrimaryService(0x1818);const m=await s.getCharacteristic(0x2a63);
      m.addEventListener('characteristicvaluechanged',onCPM);await m.startNotifications();via='Leistungsmesser';S.tr.cp=null;
    }
    S.tr.via=via;S.tr.tries=0;
    setTr('on',dev.name||'Rollentrainer');
    if(S.erg.on)applyErg();
  }catch(e){
    if(S.rec.state!=='idle'&&S.tr.tries<5){retryTrainer();return;}
    setTr('off','');toast('Rolle nicht erreichbar. Ist sie wach und Zwift geschlossen?');
  }
}
function retryTrainer(){S.tr.tries++;setTr('wait',S.tr.name,`Verbindung weg, neuer Versuch ${S.tr.tries}/5`);setTimeout(setupTrainer,2000);}
function onTrDisc(){
  if(S.tr.manual){setTr('off','');return;}
  S.tr.ctrl=false;
  if(S.tr.tries<5)retryTrainer();else{setTr('off','');toast('Verbindung zur Rolle verloren');}
}
function disconnectTrainer(){
  S.tr.manual=true;
  try{S.tr.dev&&S.tr.dev.gatt.connected&&S.tr.dev.gatt.disconnect();}catch(_){}
  S.tr.cp=null;S.tr.ctrl=false;setTr('off','');
}
function setTr(state,name,sub){
  S.tr.state=state;S.tr.name=name||S.tr.name;
  $('#trDot').className='dot'+(state==='on'?' on':state==='wait'?' wait':'');
  $('#trSub').textContent=state==='on'?`${S.tr.name} · ${S.tr.via}`:state==='wait'?(sub||'Verbinde …'):'Nicht verbunden';
  $('#btnTr').textContent=state==='off'?'Verbinden':'Trennen';
  if(state==='off')S.live.raw=[];
  renderControls();
}

async function connectHR(){
  if(S.hrm.state!=='off'){S.hrm.manual=true;try{S.hrm.dev.gatt.disconnect();}catch(_){}setHr('off');return;}
  if(!hasBT){toast('Dieser Browser kann kein Bluetooth');return;}
  let dev;
  try{dev=await navigator.bluetooth.requestDevice({filters:[{services:['heart_rate']}]});}
  catch(e){btFail(e);return;}
  S.hrm.dev=dev;S.hrm.manual=false;
  dev.addEventListener('gattserverdisconnected',()=>{if(S.hrm.manual){setHr('off');return;}setHr('wait');setTimeout(setupHR,2000);});
  await setupHR();
}
async function setupHR(){
  const dev=S.hrm.dev;if(!dev)return;
  setHr('wait');
  try{
    const srv=await dev.gatt.connect();const s=await srv.getPrimaryService('heart_rate');const c=await s.getCharacteristic('heart_rate_measurement');
    c.addEventListener('characteristicvaluechanged',onHRM);await c.startNotifications();
    S.hrm.name=dev.name||'Pulsgurt';setHr('on');
  }catch(e){setHr('off');toast('Pulsgurt nicht erreichbar');}
}
function setHr(state){
  S.hrm.state=state;
  $('#hrDot').className='dot'+(state==='on'?' on':state==='wait'?' wait':'');
  $('#hrSub').textContent=state==='on'?S.hrm.name:state==='wait'?'Verbinde …':'Nicht verbunden';
  $('#btnHr').textContent=state==='off'?'Verbinden':'Trennen';
}

async function connectCd(){
  if(S.cd.state!=='off'){S.cd.manual=true;try{S.cd.dev.gatt.disconnect();}catch(_){}setCd('off');return;}
  if(!hasBT){toast('Dieser Browser kann kein Bluetooth');return;}
  let dev;
  try{dev=await navigator.bluetooth.requestDevice({filters:[{services:[0x1816]}]});}
  catch(e){btFail(e);return;}
  S.cd.dev=dev;S.cd.manual=false;lastCsc=null;
  dev.addEventListener('gattserverdisconnected',()=>{if(S.cd.manual){setCd('off');return;}setCd('wait');setTimeout(setupCd,2000);});
  await setupCd();
}
async function setupCd(){
  const dev=S.cd.dev;if(!dev)return;
  setCd('wait');
  try{
    const srv=await dev.gatt.connect();const s=await srv.getPrimaryService(0x1816);const c=await s.getCharacteristic(0x2a5b);
    c.addEventListener('characteristicvaluechanged',onCSC);await c.startNotifications();
    S.cd.name=dev.name||'Trittfrequenzsensor';setCd('on');
  }catch(e){setCd('off');toast('Trittfrequenzsensor nicht erreichbar');}
}
function setCd(state){
  S.cd.state=state;
  $('#cdDot').className='dot'+(state==='on'?' on':state==='wait'?' wait':'');
  $('#cdSub').textContent=state==='on'?S.cd.name:state==='wait'?'Verbinde …':'Nicht verbunden';
  $('#btnCd').textContent=state==='off'?'Verbinden':'Trennen';
}

/* Steuerung (FTMS Control Point) */
let cpQ=Promise.resolve();
function cpWrite(bytes){
  const cp=S.tr.cp;if(!cp)return Promise.reject(new Error('keine Steuerung'));
  const d=new Uint8Array(bytes);
  const job=cpQ.catch(()=>{}).then(()=>cp.writeValueWithResponse?cp.writeValueWithResponse(d):cp.writeValue(d)).then(()=>new Promise(r=>setTimeout(r,120)));
  cpQ=job;return job;
}
/* Zielleistung (ERG) oder Steigung der Strecke an die Rolle */
async function applyControl(force){
  if(S.demo||S.tr.state!=='on')return;
  if(!S.tr.cp){if(S.erg.on||activeRoute())ergMsg('Die Rolle nimmt keine Steuerbefehle an.');return;}
  if(S.sim.busy)return;
  /* Verweigert: nicht im Takt erneut fragen, erst wieder bei einer Änderung durch den Nutzer */
  if(S.tr.denied&&!force)return;
  const now=performance.now();
  try{
    S.sim.busy=true;
    if(!S.tr.ctrl){S.tr.denied=false;await cpWrite([0x00]);if(S.tr.denied)return;S.tr.ctrl=true;await cpWrite([0x07]).catch(()=>{});force=true;}
    if(S.erg.on){
      if(force||S.sim.sent!=='erg'+S.erg.target){const t=clamp(Math.round(S.erg.target),0,2000);await cpWrite([0x05,t&255,(t>>8)&255]);S.sim.sent='erg'+S.erg.target;S.sim.tSent=now;}
    }else{
      const g=trainerGrade();
      if(force||typeof S.sim.sent!=='number'||Math.abs(g-S.sim.sent)>=.2||(now-S.sim.tSent>8000&&g!==S.sim.sent)){
        const gi=Math.round(g*100)&0xffff; /* 0,01 %, int16 */
        await cpWrite([0x11,0,0,gi&255,(gi>>8)&255,40,51]); /* Wind 0, Crr 0,004, Cw 0,51 */
        S.sim.sent=g;S.sim.tSent=now;
      }
    }
    ergMsg('');
  }catch(e){ergMsg('Steuerbefehl ging nicht durch.');}
  finally{S.sim.busy=false;}
}
const applyErg=()=>applyControl(true);
let ergT=null;
function ergChanged(){clearTimeout(ergT);ergT=setTimeout(applyErg,350);renderErg();}
function ergMsg(m){const el=$('#ergMsg');el.textContent=m;el.hidden=!m;}

/* ---------- Demo ---------- */
let demoT=null,demoClock=0,demoHr=72;
function setDemo(on){
  S.demo=on;$('#demo').checked=on;$('#chkDemo').classList.toggle('on',on);
  clearInterval(demoT);demoT=null;S.live.raw=[];
  if(on){if(S.tr.state!=='off')disconnectTrainer();demoClock=0;S.live.cadSeen=false;demoT=setInterval(demoStep,250);}
  renderControls();
}
function demoStep(){
  demoClock+=.25;const t=demoClock;
  let base;
  if(S.erg.on)base=S.erg.target;
  else if(activeRoute())base=S.set.ftp*.72+clamp(routeGradeNow(),-6,10)*14;
  else{const c=t%420;base=c<300?S.set.ftp*.72+10*Math.sin(t/23):S.set.ftp*1.02+8*Math.sin(t/9);}
  const pow=Math.max(0,base+(Math.random()-.5)*24);
  demoHr+=((60+pow*.42)-demoHr)*.008;
  feed({pow,hr:Math.round(demoHr),cad:Math.round(84+(Math.random()-.5)*6)},'demo');
}
