'use strict';
/* ---------- Navigation ---------- */
const ORDER={home:0,live:0,rides:1,detail:2,best:3};
const navOf=v=>v==='detail'?'rides':v;
function placeThumb(){
  const nav=$('#nav'),b=$(`#nav button[data-v="${navOf(S.view)}"]`),th=$('.thumb',nav);
  $$('#nav button').forEach(x=>x.classList.toggle('on',x===b));
  if(b){th.style.width=b.offsetWidth+'px';th.style.transform=`translateX(${b.offsetLeft}px)`;}
}
function go(v,instant){
  const cur=$('.view.active'),next=$('#v-'+v);
  S.view=v;document.body.dataset.view=v;placeThumb();renderView(v);if(typeof sceneKick==='function')sceneKick();
  if(!cur||cur===next||instant){$$('.view').forEach(x=>x.classList.toggle('active',x===next));requestAnimationFrame(()=>onEnter(v));return;}
  const dir=ORDER[v]>=ORDER[cur.id.slice(2)]?1:-1;
  cur.style.setProperty('--dx',(-20*dir)+'px');cur.classList.add('leaving');
  setTimeout(()=>{
    cur.classList.remove('active','leaving');
    next.style.setProperty('--dx',(20*dir)+'px');next.classList.add('active','entering');
    window.scrollTo(0,0);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{next.classList.remove('entering');onEnter(v);}));
  },170);
}
function renderView(v){
  if(v==='live'){renderControls();renderErg();renderZoneBar();renderRoutes();if(typeof renderFtpCard==='function')renderFtpCard();}
  if(v==='home')renderHome();
  if(v==='rides')renderRides();
  if(v==='detail')renderDetail();
  if(v==='best')renderBest();
}
function onEnter(v){
  const sec=$('#v-'+v);
  sec.classList.remove('grow');void sec.offsetWidth;
  requestAnimationFrame(()=>sec.classList.add('grow'));
  $$('[data-count]',sec).forEach(el=>{const to=+el.dataset.count,dec=+(el.dataset.dec||0);anim(900,k=>{el.textContent=dec?F2.format(to*k):F0.format(Math.round(to*k));});});
  $$('canvas',sec).forEach(c=>{if(c._draw){anim(1500,k=>{c._prog=k;c._draw(null);});}});
}

/* ---------- Fahren ---------- */
const lastTxt={};
function setT(id,t){if(lastTxt[id]!==t){lastTxt[id]=t;const el=document.getElementById(id);if(el)el.textContent=t;}}
const ZW=[55,20,15,15,15,30,30];
function renderZoneBar(){
  const tr=$('#zTrack'),lb=$('#zLbl');
  if(!tr.querySelector('span')){
    ZONES.forEach((z,i)=>{const s=document.createElement('span');s.style.flex=ZW[i];s.style.setProperty('--zc',`var(--z${i+1})`);tr.appendChild(s);});
    lb.innerHTML=ZONES.map((z,i)=>`<span style="flex:${ZW[i]}">${z.n}</span>`).join('');
  }
}
function zonePos(w,ftp){
  /* Position im Balken: Zonen sind ungleich breit, deshalb stückweise linear */
  const edges=[0,.55,.75,.90,1.05,1.20,1.50,1.80],tot=ZW.reduce((a,b)=>a+b,0);
  const r=clamp(w/ftp,0,1.8);let acc=0;
  for(let i=0;i<7;i++){if(r<=edges[i+1]){return(acc+ZW[i]*(r-edges[i])/(edges[i+1]-edges[i]))/tot;}acc+=ZW[i];}
  return 1;
}
function renderLive(){
  const pw=curPow(),ftp=S.set.ftp,R=S.rec;
  /* Diagramme nur zeichnen, wenn die Übersicht zu sehen ist (nicht hinter der Fahrt-Ansicht) */
  const shown=$('#full').hidden;
  setT('lvPow',pw==null?'–':String(Math.round(pw)));
  setT('lvWkg',pw==null?'– W/kg':`${n2(pw/S.set.weight)} W/kg`);
  const zp=$('#zonePill'),mk=$('#zMark');
  const lc=$('.card.live');lc.classList.toggle('idle',pw==null);
  if(pw!=null&&pw>0){const zi=zoneIdx(pw,ftp);setT('zpTxt',`${ZONES[zi].n} ${ZONES[zi].name}`);zp.style.setProperty('--zc',`var(--z${zi+1})`);lc.style.setProperty('--amb',`var(--z${zi+1})`);mk.style.left=(zonePos(pw,ftp)*100)+'%';mk.style.opacity=1;}
  else{setT('zpTxt',isLive()?'Pausiert':'Keine Daten');zp.style.removeProperty('--zc');lc.style.removeProperty('--amb');mk.style.opacity=0;}
  const p=R.p,el=R.state==='idle'?0:recElapsed();
  setT('lvTime',fmtDur(el/1000));
  setT('lvAvg',p.length?n0(sum(p)/p.length):'–');
  setT('lvNP',p.length>=30?n0(calcNP(p)):'–');
  setT('lvKJ',n0(sum(p)/1000));
  const hr=curHR(),cad=curCad();
  setT('lvHR',hr==null?'–':String(hr));
  setT('lvCad',cad==null?'–':String(Math.round(cad)));
  setT('lvDist',n1(R.state==='idle'?0:S.sim.total/1000));
  setT('lvSpd',isLive()?n1(S.sim.v*3.6):'–');
  setT('lvGain',n0(R.state==='idle'?0:S.sim.gain));
  const rt=activeRoute();
  if(rt){
    const g=routeGradeNow();
    setT('rlName',rt.name+(rt.loop&&S.sim.lap>1?` · Runde ${S.sim.lap}`:''));
    setT('rlGrade',(g>0.05?'+':'')+n1(g)+' %');
    setT('rlSent',S.erg.on?'Zielleistung aktiv':S.set.diff!==1?`an Rolle ${n1(trainerGrade())} %`:'');
    setT('rlDone',n1(S.sim.d/1000)+' km');setT('rlLeft','noch '+n1((rt.dist-S.sim.d)/1000)+' km');
    $('#rlFill').style.width=(S.sim.d/rt.dist*100).toFixed(2)+'%';
    if(shown){drawProfile($('#cvProf'),rt,S.sim.d);drawMap($('#cvMap'),rt,S.sim.d);}
  }
  const c=$('#cvLive'),data=R.state!=='idle'?p.slice(-300):S.hist.slice(-300);
  if(shown)drawSeries(c,data,{span:300,live:true,ftp,hover:S.liveHover});
}
function renderControls(){
  const el=$('#ctrls'),st=S.rec.state,live=isLive();
  document.body.classList.toggle('riding',st!=='idle');
  let h='';
  if(st==='idle')h=`<button type="button" class="btn primary big" data-a="start"${live?'':' aria-disabled="true"'}>Aufnahme starten</button>${live?'':'<span class="note soft" style="margin:0">Erst die Rolle verbinden</span>'}`;
  if(st==='rec')h=`<button type="button" class="btn big" data-a="pause">Pause</button><button type="button" class="btn dark big" data-a="end">Beenden</button>`;
  if(st==='pause')h=`<button type="button" class="btn primary big" data-a="resume">Weiter</button><button type="button" class="btn dark big" data-a="end">Beenden</button>`;
  if(st==='confirm')h=`<span class="q">Fahrt beenden?</span><button type="button" class="btn primary big" data-a="save">Speichern</button><button type="button" class="btn big" data-a="back">Weiterfahren</button><span class="spacer"></span><button type="button" class="btn ghost warn" data-a="discard">Verwerfen</button>`;
  /* Nach dem Verwerfen zurück aus der Fahrt-Ansicht */
  if(st==='idle'&&S.fullAuto&&!$('#full').hidden){S.fullAuto=false;closeFull();return;}
  const full=`<button type="button" class="btn ghost full-b" data-full title="${st==='idle'?'Vorschau der Fahrt-Ansicht':'Zur Fahrt-Ansicht'}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>${st==='idle'?'Vorschau':'Fahrt-Ansicht'}</button>`;
  el.innerHTML=h+(st==='confirm'?'':full);
  const fc=$('#fCtrl');if(fc)fc.innerHTML=$('#full').hidden?'':h;
  if(typeof sceneKick==='function')sceneKick();
}
function renderRecPill(){
  const st=S.rec.state,p=$('#recpill');
  p.hidden=st==='idle';
  if(st!=='idle'){p.classList.toggle('paused',st!=='rec');setT('recpillT',fmtDur(recElapsed()/1000));}
}
function renderErg(){
  $('#ergCard').classList.toggle('off',!S.erg.on);
  $('#ergOn').checked=S.erg.on;
  if(document.activeElement!==$('#ergW'))$('#ergW').value=Math.round(S.erg.target);
  const ftp=S.set.ftp;
  $('#ergQuick').innerHTML=[['Grundlage',.65],['Sweet Spot',.9],['Schwelle',1],['VO2max',1.15]]
    .map(([l,f])=>`<button type="button" class="qb" data-w="${Math.round(ftp*f/5)*5}">${l}<b>${Math.round(ftp*f/5)*5} W</b></button>`).join('');
}

/* ---------- Fahrten ---------- */
function spark(p){
  if(!p.length)return'';
  const N=48,pts=[];let mx=1;
  for(let b=0;b<N;b++){const a=Math.floor(b*p.length/N),e=Math.max(a+1,Math.floor((b+1)*p.length/N));let s=0;for(let i=a;i<e;i++)s+=p[i];const v=s/(e-a);pts.push(v);if(v>mx)mx=v;}
  const d=pts.map((v,i)=>`${(i/(N-1)*120).toFixed(1)},${(31-v/mx*28).toFixed(1)}`).join(' ');
  return`<svg viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true"><polyline points="${d}" fill="none" stroke="var(--accent)" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function rideRow(r){const s=stats(r);return`
    <button type="button" class="row" data-ride="${r.id}">
      <span class="d"><b>${fmtDate(r.start).split(' ').slice(1).join(' ')}</b><span>${WD[new Date(r.start).getDay()]} · ${fmtTime(r.start)}</span></span>
      <span class="nm">${esc(r.name)}${r.sample?'<span class="tag">Beispiel</span>':''}${r.strava&&r.strava.state==='ok'?'<span class="tag strava">Strava</span>':''}${r.ftpTest?'<span class="tag acc">FTP '+r.ftpTest.ftp+' W</span>':''}</span>
      <span class="m"><span class="lbl">Dauer</span><b>${fmtDur(s.dur)}</b></span>
      <span class="m"><span class="lbl">Ø Watt</span><b>${n0(s.avg)}</b></span>
      <span class="m np"><span class="lbl">NP</span><b>${n0(s.np)}</b></span>
      <span class="m kj"><span class="lbl">kJ</span><b>${n0(s.kj)}</b></span>
      ${spark(r.p)}
    </button>`;}
function renderRides(){
  const v=$('#v-rides'),agg=aggRides(),now=new Date(),w0=weekStart(now);
  const weeks=[];for(let k=7;k>=0;k--){const s=new Date(w0);s.setDate(s.getDate()-7*k);const e=new Date(s);e.setDate(e.getDate()+7);weeks.push({s,e,sec:0,kj:0,n:0});}
  for(const r of agg){const t=new Date(r.start);const wk=weeks.find(x=>t>=x.s&&t<x.e);if(wk){const s=stats(r);wk.sec+=s.dur;wk.kj+=s.kj;wk.n++;}}
  const cw=weeks[7],mxs=Math.max(1800,...weeks.map(x=>x.sec));
  const list=[...S.rides].sort((a,b)=>b.start.localeCompare(a.start));
  v.innerHTML=`
  <div class="page-h"><h1>Fahrten</h1></div>
  <div class="card week">
    <div>
      <span class="lbl">Diese Woche · KW ${isoWeek(now)}</span>
      <div class="week-nums big3" style="margin-top:12px">
        <div><span class="lbl">Fahrten</span><div class="v">${cw.n}</div></div>
        <div><span class="lbl">Zeit</span><div class="v">${fmtHM(cw.sec)}<small>h</small></div></div>
        <div><span class="lbl">Arbeit</span><div class="v">${n0(cw.kj)}<small>kJ</small></div></div>
      </div>
    </div>
    <div class="wbars" aria-label="Trainingszeit der letzten acht Wochen">
      ${weeks.map((x,i)=>`<div class="wb${i===7?' cur':''}"><span class="val">${x.sec?fmtHM(x.sec):''}</span><span class="bar" style="--h:${Math.max(x.sec?4:2,x.sec/mxs*92)}px"></span><span class="kw">KW${isoWeek(x.s)}</span></div>`).join('')}
    </div>
  </div>
  <div class="list">
    ${list.length?list.map(rideRow).join(''):HANDY?`<div class="card empty"><b>Noch keine Fahrten auf dem Handy</b>Gefahren wird am Mac. Lade dessen Sicherung aus iCloud Drive → Wattbuch.<div class="empty-a"><button type="button" class="btn primary" data-load>Sicherung laden</button></div></div>`:`<div class="card empty"><b>Noch keine Fahrt</b>Unter „Fahren“ die Rolle verbinden und die Aufnahme starten.</div>`}
  </div>`;
}

/* ---------- Detail ---------- */
function renderDetail(){
  const v=$('#v-detail'),r=S.rides.find(x=>x.id===S.detail);
  if(!r){v.innerHTML='';setTimeout(()=>go('rides'),0);return;}
  const s=stats(r),kg=S.set.weight,ftp=S.set.ftp,all=bestsOf(aggRides());
  const keys=KEY_DURS.filter(d=>d<=s.dur);
  const maxZ=Math.max(1,...s.zt);
  const kv=[['Dauer',fmtDur(s.dur),''],['Ø Leistung',n0(s.avg),'W'],['Max',n0(s.max),'W'],['Arbeit',n0(s.kj),'kJ'],
    ['TSS',n0(s.tss),''],['IF',n2(s.IF),''],['Ø Puls',n0(s.hrAvg),s.hrAvg?'bpm':''],['Max Puls',n0(s.hrMax),s.hrMax?'bpm':'']];
  const km=r.dist&&r.dist.length?r.dist[r.dist.length-1]/1000:null;
  if(km){kv.push(['Distanz',n1(km),'km'],['Ø Tempo',n1(km/(s.dur/3600)),'km/h'],['Höhenmeter',n0(r.gain||0),'m'],['Ø Trittfrequenz',n0(s.cadAvg),s.cadAvg?'rpm':'']);}
  v.innerHTML=`
  <div class="crumb"><button type="button" class="lnk" data-go="rides">Fahrten</button><span>/</span><span>${fmtDate(r.start)} · ${fmtTime(r.start)}</span>${r.sample?'<span class="tag">Beispiel</span>':''}${r.route?`<span class="tag acc">${esc(r.route)}</span>`:''}${r.strava&&r.strava.state==='ok'?'<span class="tag strava">Strava</span>':''}</div>
  <input class="title-in" id="rideName" value="${esc(r.name)}" aria-label="Name der Fahrt" autocomplete="off">
  <div class="card hero">
    <div>
      <span class="lbl">Normalized Power</span>
      <div class="hero-num"><b data-count="${Math.round(s.np)}">${n0(s.np)}</b><span class="unit">W</span></div>
      <span class="sub">${n2(s.np/kg)} W/kg</span>
    </div>
    <div class="kv">${kv.map(([l,val,u])=>`<div class="st"><span class="lbl">${l}</span><div class="v">${val}${u?`<small>${u}</small>`:''}</div></div>`).join('')}</div>
  </div>
  <div class="stack">
    <div class="card">
      <div class="card-h"><h3>Leistung</h3>
        <div class="seg sm" id="smSeg"><span class="thumb"></span>${[[1,'Roh'],[5,'5 s'],[30,'30 s']].map(([k,l])=>`<button type="button" data-sm="${k}"${S.smooth===k?' class="on"':''}>${l}</button>`).join('')}</div>
      </div>
      <canvas class="cv tall" id="cvRide" aria-label="Leistung über die Fahrt"></canvas>
    </div>
    <div class="two">
      <div class="card">
        <div class="card-h"><h3>Bestwerte</h3><span class="legend-in"><span><i></i>Diese Fahrt</span><span><i class="g"></i>Alle Fahrten</span></span></div>
        <canvas class="cv" id="cvCurveR" aria-label="Leistungskurve"></canvas>
        <div class="btab">${keys.map(d=>{const b=s.curve.find(x=>x[0]===d)[1],rec=all[d]&&all[d].id===r.id&&!r.sample;return`<div class="r"><span class="lbl">${durLbl(d)}</span><span>${rec?'<span class="tag acc" style="margin:0">Bestwert</span>':''}</span><span class="w">${n0(b)} W</span><span class="k">${n2(b/kg)} W/kg</span></div>`;}).join('')}</div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Zonen</h3><span class="lbl">FTP ${ftp} W</span></div>
        ${ZONES.map((z,i)=>{const lo=i?Math.round(ZONES[i-1].hi*ftp)+1:0,hi=z.hi===Infinity?null:Math.round(z.hi*ftp);const t=s.zt[i];return`
        <div class="zb" style="--zc:var(--z${i+1})">
          <span class="zn"><i></i><span>${z.n} ${z.name}<span class="zw">${hi==null?`ab ${lo}`:`${lo}–${hi}`} W</span></span></span>
          <span class="tr"><span style="--w:${(t/maxZ*100).toFixed(1)}%"></span></span>
          <span class="t">${fmtDur(t)}</span><span class="p">${n0(t/s.dur*100)} %</span>
        </div>`;}).join('')}
      </div>
    </div>
    <div class="acts">
      ${stravaBtn(r,'btnStrava')}
      <button type="button" class="btn" id="btnTcx">Als TCX speichern</button>
      <span class="spacer"></span>
      <button type="button" class="btn ghost warn" id="btnDel">Fahrt löschen</button>
    </div>
  </div>`;
  /* Diagramme */
  const cr=$('#cvRide'),cc=$('#cvCurveR');
  cr._prog=1;cr._draw=hv=>drawSeries(cr,S.smooth>1?rolling(r.p,S.smooth):r.p,{ftp,hover:hv,prog:cr._prog});
  const allPts=DURS.filter(d=>all[d]).map(d=>[d,all[d].w]).filter(p=>p[0]<=Math.max(s.dur,60));
  cc._prog=1;cc._draw=hv=>drawCurve(cc,[{pts:s.curve,color:'--accent',label:'Fahrt'},{pts:allPts,color:'--fg-3',dash:[4,4],width:1.4,label:'Alle'}],{hover:hv,prog:cc._prog});
  bindHover(cr,cr._draw);bindHover(cc,cc._draw);
  cr._draw(null);cc._draw(null);
  requestAnimationFrame(()=>placeSegThumb($('#smSeg')));
  $('#rideName').addEventListener('change',async e=>{r.name=e.target.value.trim()||'Rollentraining';r.edited=Date.now();e.target.value=r.name;await DB.put(r);changed();});
  $('#rideName').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur();});
  $('#btnTcx').onclick=()=>download(tcx(r),`wattbuch-${r.start.slice(0,10)}-${fmtTime(r.start).replace(':','')}.tcx`,'application/vnd.garmin.tcx+xml');
  armDelete($('#btnDel'),'Wirklich löschen?',async()=>{await forget(r);toast('Fahrt gelöscht');go('rides');});
}
function placeSegThumb(seg){if(!seg)return;const b=$('button.on',seg),th=$('.thumb',seg);if(b&&th){th.style.width=b.offsetWidth+'px';th.style.transform=`translateX(${b.offsetLeft-3}px)`;th.style.left='3px';}}
function armDelete(btn,armed,fn){
  const orig=btn.textContent;let t=null;
  btn.onclick=()=>{if(btn.classList.contains('armed')){clearTimeout(t);fn();return;}btn.classList.add('armed');btn.textContent=armed;t=setTimeout(()=>{btn.classList.remove('armed');btn.textContent=orig;},3500);};
}

/* ---------- Bestwerte ---------- */
function renderBest(){
  const v=$('#v-best'),agg=aggRides();
  if(!agg.length){v.innerHTML=`<div class="page-h"><h1>Bestwerte</h1></div><div class="card empty"><b>Noch keine Fahrt</b>Nach der ersten Aufnahme stehen hier deine besten Werte.</div>`;return;}
  const all=bestsOf(agg),cut=Date.now()-30*864e5,recent=bestsOf(agg.filter(r=>Date.parse(r.start)>=cut));
  const kg=S.set.weight,ftp=S.set.ftp,est=all[1200]?Math.round(all[1200].w*.95):null;
  const allPts=DURS.filter(d=>all[d]).map(d=>[d,all[d].w]),recPts=DURS.filter(d=>recent[d]).map(d=>[d,recent[d].w]);
  const sample=agg.some(r=>r.sample);
  v.innerHTML=`
  <div class="page-h"><h1>Bestwerte</h1>${sample?'<span class="tag">Aus der Beispielfahrt</span>':''}</div>
  <div class="stack" style="margin-top:0">
    <div class="card ftpc">
      <div><span class="lbl">FTP geschätzt · 95 % vom besten 20-min-Wert</span><div class="v">${est?`<span data-count="${est}">${est}</span><small>W</small>`:'–'}</div></div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span class="note soft" style="margin:0">Eingestellt: ${ftp} W</span>${est&&est!==ftp?`<button type="button" class="btn sm" id="useEst">${est} W übernehmen</button>`:''}</div>
    </div>
    <div class="card">
      <div class="card-h"><h3>Leistungskurve</h3><span class="legend-in"><span><i></i>Alle Fahrten</span><span><i class="g"></i>Letzte 30 Tage</span></span></div>
      <canvas class="cv tall" id="cvCurveA" aria-label="Leistungskurve aller Fahrten"></canvas>
      <div class="btab">${DURS.filter(d=>all[d]&&d>=5).map(d=>`<div class="r"><span class="lbl">${durLbl(d)}</span><button type="button" class="lnk" data-ride="${all[d].id}">${fmtDateY(all[d].start)}</button><span class="w">${n0(all[d].w)} W</span><span class="k">${n2(all[d].w/kg)} W/kg</span></div>`).join('')}</div>
    </div>
  </div>`;
  const c=$('#cvCurveA');c._prog=1;
  c._draw=hv=>drawCurve(c,[{pts:allPts,color:'--accent',label:'Alle'},{pts:recPts,color:'--fg-3',dash:[4,4],width:1.4,label:'30 Tage'}],{hover:hv,prog:c._prog});
  bindHover(c,c._draw);c._draw(null);
  const u=$('#useEst');if(u)u.onclick=()=>{setFtp(est);renderBest();toast(`FTP auf ${est} W gesetzt`);};
}
