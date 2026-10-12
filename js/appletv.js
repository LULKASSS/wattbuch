'use strict';
/* ---------- Apple TV als Fernbedienung ---------- */
/* Nur in der Mac-App (window.wattbuchDesktop.appletv, siehe desktop/appletv.js), im Browser unsichtbar.
   In der Fahrt-Ansicht steht die Fernbedienung ganz da, sobald das Apple TV an ist; ist es aus (Ruhezustand) oder nicht
   erreichbar, nur ein An/Aus-Knopf. T oder der Knopf: aus → einschalten, an → Fernbedienung ein- und ausklappen.
   Pfeile bewegen, Enter OK, Esc/⌫ Zurück, Leertaste Abspielen/Pause, +/− Lautstärke, H Home.
   Solange die Fernbedienung offen ist, gehen diese Tasten ans Apple TV.
   Automatisch pausieren (S.set.tvAuto, an): Fahrt pausiert oder 5 s kaum Leistung → Apple TV hält an,
   wieder 2 s richtig getreten → läuft weiter. Weiter geht es nur, wenn Wattbuch selbst angehalten hat. */
const TV=()=>window.wattbuchDesktop&&window.wattbuchDesktop.appletv;
S.tv={dev:null,connected:false,play:null,on:null,hide:false,ours:false,low:0,high:0,ui:'',list:[],err:'',again:false,busy:0,retry:0};
const tvAuto=()=>S.set.tvAuto!==false;
const TVKEYS={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Enter:'select',Escape:'menu',Backspace:'menu',' ':'play_pause',h:'home',H:'home','+':'volume_up','=':'volume_up','-':'volume_down'};

async function tvRefresh(){const tv=TV();if(!tv)return;const r=await tv.status();if(r.ok){S.tv.dev=r.device;S.tv.connected=r.connected;S.tv.play=r.play;S.tv.on=r.power==null?null:!!r.power;}renderTv();renderTvSet();}
/* An? Meldet das Apple TV seinen Zustand nicht (ältere Mac-App), gilt: verbunden und etwas läuft oder ist pausiert */
function tvIsOn(){const T=S.tv;if(!T.connected)return false;if(T.on!=null)return T.on;return!!(T.play&&/^(playing|paused|loading)$/.test(T.play.state));}
const tvPad=()=>!!(TV()&&S.tv.dev&&tvIsOn()&&!S.tv.hide);
let tvConnecting=null;
function tvEnsure(){
  const tv=TV();if(!tv||!S.tv.dev||S.tv.connected||tvConnecting||Date.now()<S.tv.retry)return tvConnecting;
  tvConnecting=tv.connect().then(r=>{if(!r.ok){S.tv.retry=Date.now()+30000;S.tv.err=r.error;}else{S.tv.connected=r.connected;S.tv.err='';if(r.power!=null)S.tv.on=!!r.power;}renderTv();renderTvSet();return r;}).finally(()=>{tvConnecting=null;});
  return tvConnecting;
}
let tvErrAt=0;
async function tvKey(k,{quiet}={}){
  const tv=TV();if(!tv||!S.tv.dev)return false;
  if(S.tv.busy>4)return false;  /* Taste festgehalten und Apple TV kommt nicht nach: überzählige verwerfen */
  S.tv.busy++;
  const b=$(`#fTvPad [data-tv="${k}"]`);if(b){b.classList.add('hit');setTimeout(()=>b.classList.remove('hit'),160);}
  try{
    const r=await tv.key(k);
    if(!r.ok&&!quiet&&Date.now()-tvErrAt>4000){tvErrAt=Date.now();toast('Apple TV: '+r.error);}
    return r.ok;
  }finally{S.tv.busy--;}
}
/* T oder der Knopf: aus → einschalten (Fernbedienung erscheint, sobald es an ist), an → ein- und ausklappen */
async function tvToggle(){
  if(!TV()||!S.tv.dev)return;
  if($('#full').hidden)openFull();
  if(tvIsOn()){S.tv.hide=!S.tv.hide;renderTv();return;}
  S.tv.hide=false;S.tv.waking=true;renderTv();
  try{
    await tvEnsure();
    if(!tvIsOn()&&S.tv.connected){
      /* Ältere Mac-App kennt kein Einschalten, dann weckt Home das Apple TV */
      if(await tvKey('turn_on',{quiet:true}))S.tv.on=true;else if(await tvKey('home'))S.tv.on=true;
    }
  }finally{S.tv.waking=false;renderTv();}
}
async function tvOff(){if(await tvKey('turn_off')){S.tv.on=false;S.tv.hide=false;renderTv();}}
function renderTv(){
  const has=!!(TV()&&S.tv.dev),btn=$('#fTv'),pad=$('#fTvPad'),on=tvIsOn(),open=tvPad();
  /* Knopf oben: An/Aus-Zeichen, solange das Apple TV aus ist; ist es an und die Fernbedienung zugeklappt, das TV-Zeichen */
  btn.hidden=!has||open;btn.classList.toggle('pw',!on);btn.classList.toggle('wait',!!S.tv.waking);
  btn.innerHTML=on?TVICO.tv:TVICO.power;
  btn.setAttribute('aria-label',on?'Apple-TV-Fernbedienung zeigen (T)':'Apple TV einschalten (T)');btn.title=on?'Fernbedienung (T)':'Apple TV einschalten (T)';
  pad.hidden=!open;
  const p=S.tv.play,now=!S.tv.connected?(tvConnecting?'Verbinde …':S.tv.err||'Nicht verbunden')
    :p&&(p.title||p.app)?[p.app,p.title].filter(Boolean).join(' · '):p&&p.state==='paused'?'Pausiert':'Verbunden';
  setT('fTvNow',now);setT('fTvName',has?S.tv.dev.name:'Apple TV');
  pad.classList.toggle('live',S.tv.connected);pad.classList.toggle('playing',!!(p&&p.state==='playing'));
  const k=$('.f-keys');if(k)k.textContent=`Leertaste Start/Pause · ↑↓ Ziel${has?' · T Apple TV':''} · F Vollbild · Esc Übersicht`;
}
const TVICO={
  tv:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg>',
  power:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/></svg>'
};
$('#fTv').addEventListener('click',tvToggle);
$('#fTvPad').addEventListener('mousedown',e=>{if(e.target.closest('button'))e.preventDefault();}); /* kein Fokus, sonst löst Enter den Knopf mit aus */
$('#fTvPad').addEventListener('click',e=>{const b=e.target.closest('[data-tv]');if(b)tvKey(b.dataset.tv);else if(e.target.closest('#fTvClose')){S.tv.hide=true;renderTv();}else if(e.target.closest('#fTvOff'))tvOff();});

/* Tastatur: vor der Fahrt-Ansicht-Tastatur (szene.js), damit Pfeile und Leertaste ans Apple TV gehen */
document.addEventListener('keydown',e=>{
  const tg=e.target;if(!TV()||!S.tv.dev||HANDY||e.metaKey||e.ctrlKey||e.altKey||(tg&&(tg.tagName==='INPUT'||tg.tagName==='TEXTAREA'))||document.querySelector('dialog[open]'))return;
  if(e.key==='t'||e.key==='T'){e.preventDefault();e.stopImmediatePropagation();if($('#full').hidden&&tvIsOn()){S.tv.hide=false;openFull();renderTv();}else tvToggle();return;}
  if(!tvPad()||$('#full').hidden)return;
  const k=TVKEYS[e.key];if(!k)return;
  e.preventDefault();e.stopImmediatePropagation();
  if(e.repeat&&!/^(up|down|left|right|volume_up|volume_down)$/.test(k))return;
  tvKey(k);
},true);

/* Automatisch pausieren und weiterlaufen lassen, einmal pro Sekunde */
function tvAutoTick(){
  if(!TV()||!S.tv.dev)return;
  if(!S.tv.connected&&!$('#full').hidden)tvEnsure();  /* in der Fahrt-Ansicht wissen, ob das Apple TV an ist */
  if(!tvAuto())return;
  const st=S.rec.state,T=S.tv;
  if(st==='idle'){T.ours=false;T.low=T.high=0;return;}
  if(!T.connected){tvEnsure();return;}
  const pw=curPow();
  if(st==='rec'&&(pw==null||pw<15))T.low++;else T.low=0;
  if(st==='rec'&&pw!=null&&pw>=40)T.high++;else T.high=0;
  const stopped=st!=='rec'||T.low>=5;
  if(stopped&&!T.ours&&T.play&&T.play.state==='playing'){T.ours=true;tvKey('pause',{quiet:true}).then(ok=>{if(ok)toast('Apple TV pausiert');else T.ours=false;});}
  else if(!stopped&&T.ours&&T.high>=2){T.ours=false;tvKey('play',{quiet:true});}
}
setInterval(tvAutoTick,1000);

/* Meldungen der Mac-App: Verbindung und was gerade läuft */
if(TV())TV().onEvent(m=>{
  if(m.ev==='state'){S.tv.connected=!!m.connected;if(!m.connected){S.tv.play=null;S.tv.on=null;}else S.tv.err='';}
  else if(m.ev==='power'){const was=tvIsOn();S.tv.on=!!m.on;if(m.on&&!was)S.tv.hide=false;}
  else if(m.ev==='play'){
    /* Läuft wieder, obwohl Wattbuch angehalten hat: von Hand fortgesetzt, dann nicht mehr eingreifen */
    if(m.state==='playing'&&S.tv.ours)S.tv.ours=false;
    S.tv.play=m;
  }
  else if(m.ev==='setup'){S.tv.ui='setup';renderTvSet();}
  renderTv();if(m.ev==='state')renderTvSet();
});

/* Einstellungen: suchen, koppeln (Code vom Fernseher), automatisch pausieren, trennen */
function renderTvSet(){
  const wrap=$('#tvWrap'),el=$('#tvBox'),T=S.tv;if(!TV()){wrap.hidden=true;return;}
  wrap.hidden=false;
  let h='<h3>Apple TV</h3>';
  const err=T.err&&T.ui!=='pin'&&!T.dev?`<p class="ftp-note warn">${esc(T.err)}</p>`:'';
  if(T.dev)h+=`<p class="sv-ok tv${T.connected?' on':''}"><i></i>${T.connected?'Verbunden mit':'Gekoppelt mit'} ${esc(T.dev.name)}</p>
    <label class="chk sm${tvAuto()?' on':''}" id="tvAutoL"><input type="checkbox" id="tvAuto"${tvAuto()?' checked':''}><span class="box"></span>Pausieren, wenn du aufhörst zu treten</label>
    <p class="ftp-note">In der Fahrt-Ansicht mit T oder dem TV-Knopf steuern: Pfeile, Enter OK, Esc Zurück, Leertaste Abspielen/Pause, +/− Lautstärke.</p>
    <div class="dlg-row"><button type="button" class="btn sm ghost" id="tvOff">Trennen</button></div>`;
  else if(T.ui==='setup')h+=`<p class="sv-wait"><i></i>Wird eingerichtet, einmalig etwa eine halbe Minute …</p>`;
  else if(T.ui==='scan')h+=`<p class="sv-wait"><i></i>Suche im WLAN …</p>`;
  else if(T.ui==='list')h+=T.list.length?`<p class="ftp-note">Welches Apple TV?</p><div class="tv-list">${T.list.map(d=>`<button type="button" class="btn sm ghost" data-tvdev="${esc(d.id)}">${esc(d.name)}<small>${esc(d.model||'')}</small></button>`).join('')}</div>
    <div class="dlg-row"><button type="button" class="btn sm ghost" id="tvCancel">Abbrechen</button></div>`
    :`<p class="ftp-note">Kein Apple TV gefunden. Ist es eingeschaltet und im selben WLAN wie der Mac? Und darf Wattbuch ins lokale Netzwerk (Systemeinstellungen → Datenschutz &amp; Sicherheit → Lokales Netzwerk)?</p><div class="dlg-row"><button type="button" class="btn sm" id="tvScan">Erneut suchen</button><button type="button" class="btn sm ghost" id="tvCancel">Abbrechen</button></div>`;
  else if(T.ui==='pin')h+=`<p class="ftp-note">${T.again?'Fast geschafft, auf dem Fernseher steht ein zweiter Code.':'Auf dem Fernseher erscheint ein Code.'} Gib ihn hier ein:</p>
    ${T.err?`<p class="ftp-note warn">${esc(T.err)}</p>`:''}
    <div class="tv-pinrow"><input id="tvPin" class="tv-pin" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="Code vom Fernseher" placeholder="····"><button type="button" class="btn sm primary" id="tvPinOk">Koppeln</button><button type="button" class="btn sm ghost" id="tvCancel">Abbrechen</button></div>`;
  else if(T.ui==='wait')h+=`<p class="sv-wait"><i></i>Koppeln …</p>`;
  else h+=`<p class="ftp-note">Steuere dein Apple TV während der Fahrt mit der Tastatur, ohne die Fahrt-Ansicht zu verlassen. Hörst du auf zu treten, hält die Serie an.</p>${err}
    <div class="dlg-row"><button type="button" class="btn sm" id="tvScan">Apple TV suchen</button></div>`;
  el.innerHTML=h;
  if(T.ui==='pin'){const i=$('#tvPin');if(i)i.focus();}
}
async function tvScan(){
  const tv=TV();S.tv.err='';
  S.tv.ui='scan';renderTvSet();
  const p=await tv.prepare();
  if(!p.ok){S.tv.ui='';S.tv.err=p.error;renderTvSet();return;}
  S.tv.ui='scan';renderTvSet();
  const r=await tv.scan();
  if(!r.ok){S.tv.ui='';S.tv.err=r.error;renderTvSet();return;}
  S.tv.list=r.devices;S.tv.ui='list';renderTvSet();
}
async function tvPair(d){
  S.tv.ui='wait';S.tv.err='';renderTvSet();
  const r=await TV().pair({id:d.id,name:d.name});
  tvPaired(r);
}
async function tvPin(){
  const i=$('#tvPin'),code=i?i.value.replace(/\D/g,''):'';if(code.length<4){if(i)i.focus();return;}
  S.tv.ui='wait';renderTvSet();
  tvPaired(await TV().pin(code));
}
function tvPaired(r){
  if(!r.ok){S.tv.err=r.error;S.tv.ui=/^Code stimmt nicht/.test(r.error)?'pin':'';if(S.tv.ui!=='pin'){S.tv.again=false;}renderTvSet();return;}
  if(r.pin){S.tv.ui='pin';S.tv.again=!!r.again;S.tv.err='';renderTvSet();return;}
  S.tv.ui='';S.tv.again=false;S.tv.dev=r.device;S.tv.connected=r.connected;toast(`Mit ${r.device?r.device.name:'Apple TV'} gekoppelt`);renderTvSet();renderTv();
}
$('#tvBox').addEventListener('click',async e=>{
  const tv=TV();if(!tv)return;
  const d=e.target.closest('[data-tvdev]');
  if(d){const dev=S.tv.list.find(x=>x.id===d.dataset.tvdev);if(dev)tvPair(dev);}
  else if(e.target.closest('#tvScan'))tvScan();
  else if(e.target.closest('#tvPinOk'))tvPin();
  else if(e.target.closest('#tvCancel')){await tv.cancel();S.tv.ui='';S.tv.err='';S.tv.again=false;renderTvSet();}
  else if(e.target.closest('#tvOff')){const r=await tv.forget();S.tv.dev=null;S.tv.connected=false;S.tv.play=null;S.tv.on=null;S.tv.hide=false;if(r.ok)S.tv.dev=r.device;renderTvSet();renderTv();toast('Apple TV getrennt');}
});
$('#tvBox').addEventListener('change',e=>{if(e.target.id==='tvAuto'){S.set.tvAuto=e.target.checked;saveSet();$('#tvAutoL').classList.toggle('on',tvAuto());}});
/* Enter im Code-Feld koppelt (und schließt nicht den Einstellungs-Dialog) */
$('#tvBox').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='tvPin'){e.preventDefault();tvPin();}});
