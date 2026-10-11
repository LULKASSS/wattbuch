'use strict';
/* ---------- Handy: Übersicht ---------- */
/* Am Handy wird nicht aufgenommen. Die Übersicht zeigt Training je Zeitraum, die eigenen Werte (FTP, Gewicht, Zonen)
   zum Pflegen, den FTP-Verlauf, die letzten Fahrten und das Konto, über das sich Handy und Mac abgleichen. */
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

/* ---------- Kennzahlen für das Dashboard ---------- */
const dayKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const rideKm=r=>r.dist&&r.dist.length?r.dist[r.dist.length-1]/1000:0;
/* TSS mit der FTP zur Zeit der Fahrt, damit alte Fahrten nicht mit der heutigen FTP neu bewertet werden */
function tssOf(r){const s=stats(r),f=r.ftp||s.ftp;return r.noW?s.tss:s.dur*s.np*s.np/(f*f*36);}
function daily(rides){
  const m=new Map();
  for(const r of rides){const k=dayKey(new Date(r.start)),o=m.get(k)||{tss:0,sec:0,n:0,km:0};o.tss+=tssOf(r);o.sec+=stats(r).dur;o.n++;o.km+=rideKm(r);m.set(k,o);}
  return m;
}
/* Fitness (CTL, 42 Tage), Ermüdung (ATL, 7 Tage), Form (TSB = Fitness − Ermüdung), Tag für Tag bis heute */
function pmc(dm,first){
  const out=[],d=new Date(first),end=new Date();d.setHours(12,0,0,0);end.setHours(12,0,0,0);
  let ctl=0,atl=0;
  while(d<=end){const t=(dm.get(dayKey(d))||{}).tss||0;ctl+=(t-ctl)/42;atl+=(t-atl)/7;out.push({d:new Date(d),ctl,atl,tsb:ctl-atl});d.setDate(d.getDate()+1);}
  return out;
}
function formWord(tsb){
  if(tsb>15)return['Frisch','ok'];if(tsb>5)return['Bereit','ok'];if(tsb>-10)return['Ausgeglichen',''];
  if(tsb>-30)return['Im Aufbau','acc'];return['Überlastet','warn'];
}
function wkgLevel(w){return w<2.5?'Einsteiger':w<3.2?'Hobby':w<4?'Ambitioniert':w<4.8?'Stark':'Elite';}

/* Balken je Zeitraum: Woche = Tage, Monat = Tage, Jahr = Monate, Gesamt = Monate (über zwei Jahre: Jahre) */
const MOI=['J','F','M','A','M','J','J','A','S','O','N','D'];
function buckets(k,rides){
  const n=new Date(),b=[];
  if(k==='w'){const s=weekStart(n);for(let i=0;i<7;i++){const a=new Date(s);a.setDate(a.getDate()+i);const e=new Date(a);e.setDate(e.getDate()+1);b.push({s:a,e,l:WD[a.getDay()],cap:fmtDate(a.toISOString())});}}
  else if(k==='m'){const days=new Date(n.getFullYear(),n.getMonth()+1,0).getDate();for(let i=1;i<=days;i++){const a=new Date(n.getFullYear(),n.getMonth(),i);b.push({s:a,e:new Date(n.getFullYear(),n.getMonth(),i+1),l:i%7===1?String(i):'',cap:fmtDate(a.toISOString())});}}
  else if(k==='y'){for(let i=0;i<12;i++){const a=new Date(n.getFullYear(),i,1);b.push({s:a,e:new Date(n.getFullYear(),i+1,1),l:MOI[i],cap:a.toLocaleDateString('de-DE',{month:'long',year:'numeric'})});}}
  else{
    const first=rides.reduce((a,r)=>!a||r.start<a?r.start:a,null),f=first?new Date(first):n;
    const months=(n.getFullYear()-f.getFullYear())*12+n.getMonth()-f.getMonth()+1;
    if(months>24)for(let y=f.getFullYear();y<=n.getFullYear();y++)b.push({s:new Date(y,0,1),e:new Date(y+1,0,1),l:String(y).slice(2),cap:String(y)});
    else for(let i=Math.max(12,months)-1;i>=0;i--){const a=new Date(n.getFullYear(),n.getMonth()-i,1);b.push({s:a,e:new Date(a.getFullYear(),a.getMonth()+1,1),l:MOI[a.getMonth()],cap:a.toLocaleDateString('de-DE',{month:'long',year:'numeric'})});}
  }
  for(const x of b){x.sec=0;x.n=0;x.km=0;x.cur=n>=x.s&&n<x.e;x.fut=x.s>n;}
  for(const r of rides){const t=new Date(r.start),x=b.find(y=>t>=y.s&&t<y.e);if(x){x.sec+=stats(r).dur;x.n++;x.km+=rideKm(r);}}
  return b;
}
let HB=[];
function barChart(b){
  HB=b;const W=320,H=112,top=14,base=H-18,gap=b.length>20?2:b.length>10?4:8,bw=(W-gap*(b.length-1))/b.length;
  const mx=Math.max(1800,...b.map(x=>x.sec));
  return`<svg class="hbars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trainingszeit im Zeitraum">
    <line x1="0" x2="${W}" y1="${base+.5}" y2="${base+.5}" stroke="var(--line)"/>
    ${b.map((x,i)=>{const h=x.sec?Math.max(3,x.sec/mx*(base-top)):0,X=(i*(bw+gap)).toFixed(1);return`<g data-hb="${i}">
      <rect x="${X}" y="0" width="${bw.toFixed(1)}" height="${H}" fill="transparent"/>
      ${h?`<rect class="b${x.cur?' cur':''}" style="--i:${i}" x="${X}" y="${(base-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4,bw/2).toFixed(1)}"/>`:`<rect x="${X}" y="${base-2}" width="${bw.toFixed(1)}" height="2" rx="1" fill="${x.fut?'transparent':'var(--surface-3)'}"/>`}
      ${x.l?`<text x="${(+X+bw/2).toFixed(1)}" y="${H-4}" text-anchor="middle" class="${x.cur?'cur':''}">${x.l}</text>`:''}</g>`;}).join('')}
  </svg>`;
}
const bucketCap=x=>`<b>${x.cap}</b> · ${x.n?`${fmtHM(x.sec)} h · ${x.n} ${x.n===1?'Fahrt':'Fahrten'}${x.km?` · ${n1(x.km)} km`:''}`:'keine Fahrt'}`;

/* Kalender: die letzten 18 Wochen, Farbe nach Belastung (TSS) */
function calendar(dm){
  const W=18,cs=13.2,g=3.4,left=18,top=14,ws=weekStart(new Date());ws.setDate(ws.getDate()-7*(W-1));
  const today=dayKey(new Date()),lvl=t=>t<=0?'':t<40?'var(--z2)':t<70?'var(--z3)':t<100?'var(--z4)':'var(--z5)';
  let cells='',months='',lastM=-1;
  for(let w=0;w<W;w++)for(let d=0;d<7;d++){
    const a=new Date(ws);a.setDate(a.getDate()+w*7+d);if(a>new Date())continue;
    const k=dayKey(a),o=dm.get(k),x=left+w*(cs+g),y=top+d*(cs+g);
    if(d===0&&a.getMonth()!==lastM){lastM=a.getMonth();months+=`<text x="${x}" y="9">${MO[lastM].replace('.','')}</text>`;}
    cells+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cs}" height="${cs}" rx="3" fill="${o?lvl(o.tss)||'var(--z2)':'var(--surface-3)'}"${k===today?' class="today"':''}><title>${fmtDate(a.toISOString())}${o?` · ${fmtHM(o.sec)} h · TSS ${n0(o.tss)}`:''}</title></rect>`;
  }
  const h=top+7*(cs+g);
  return`<svg class="hcal-s" viewBox="0 0 ${left+W*(cs+g)} ${h}" role="img" aria-label="Trainingskalender der letzten 18 Wochen">${months}
    ${['Mo','','Mi','','Fr','',''].map((l,d)=>l?`<text x="0" y="${top+d*(cs+g)+10}">${l}</text>`:'').join('')}${cells}</svg>`;
}
function streak(rides){
  const ws=weekStart(new Date()),has=new Set(rides.map(r=>weekStart(new Date(r.start)).getTime()));
  let n=0;const w=new Date(ws);if(!has.has(w.getTime()))w.setDate(w.getDate()-7);
  while(has.has(w.getTime())){n++;w.setDate(w.getDate()-7);}
  return n;
}
function formChart(p){
  const d=p.slice(-90),W=320,H=96,mx=Math.max(20,...d.map(x=>Math.max(x.ctl,x.atl)))*1.1;
  const X=i=>(i/(d.length-1||1)*W).toFixed(1),Y=v=>(H-4-v/mx*(H-10)).toFixed(1);
  const line=f=>d.map((x,i)=>`${i?'L':'M'}${X(i)},${Y(x[f])}`).join(' ');
  return`<svg class="hform-s" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${line('ctl')} L${W},${H} L0,${H} Z" fill="var(--accent-soft)"/>
    <path d="${line('atl')}" fill="none" stroke="var(--fg-3)" stroke-width="1.3" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    <path class="ln" d="${line('ctl')}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>
  <div class="hf-ax"><span>vor ${d.length} Tagen</span><span class="legend-in"><span><i></i>Fitness</span><span><i class="g"></i>Ermüdung</span></span><span>heute</span></div>`;
}

function renderHome(){
  const v=$('#v-home'),real=S.rides.filter(r=>!r.sample),ftp=S.set.ftp,kg=S.set.weight;
  const [k,,prevName]=PER.find(p=>p[0]===S.per)||PER[0];
  const t=totals(real,perRange(k)),pv=k==='a'?null:totals(real,perRange(k,1));
  const bests=bestsOf(real),g=ftpSuggest(real),est=g&&g.w;
  const steps=ftpSteps(real),recent=[...real].sort((a,b)=>b.start.localeCompare(a.start)).slice(0,3);
  const dm=daily(real),first=real.reduce((a,r)=>!a||r.start<a?r.start:a,null);
  const P=first?pmc(dm,first):[],now=P[P.length-1],wk=P[Math.max(0,P.length-8)];
  const B=buckets(k,real),zt=[0,0,0,0,0,0,0];
  {const {s,e}=perRange(k);for(const r of real){const d=new Date(r.start);if(d>=s&&d<e)stats(r).zt.forEach((x,i)=>zt[i]+=x);}}
  const ztot=sum(zt),dPct=pv&&pv.sec?Math.round((t.sec-pv.sec)/pv.sec*100):null,wkg=ftp/kg,strk=streak(real);
  const kpi=(val,u,lbl)=>`<div><b>${val}${u?`<small>${u}</small>`:''}</b><span class="lbl">${lbl}</span></div>`;
  const cut=Date.now()-30*864e5;
  const fw=now?formWord(now.tsb):null;
  /* Zonen-Leiste: Breiten wie im Live-Balken, darunter die Grenzen in Watt */
  const zwT=ZW.reduce((a,b)=>a+b,0);let acc=0;
  const zMarks=ZONES.slice(0,6).map((z,i)=>{acc+=ZW[i];return`<span style="left:${(acc/zwT*100).toFixed(2)}%">${Math.round(z.hi*ftp)}</span>`;}).join('');
  v.innerHTML=`
  <div class="page-h"><div><h1>Übersicht</h1>${real.length?`<p class="sub-h">${real.length} ${real.length===1?'Fahrt':'Fahrten'} · zuletzt ${fmtDate(recent[0].start)}</p>`:''}</div></div>
  <div class="home">
    ${real.length?'':K.s?`<div class="card empty"><b>${K.busy||!K.last?'Fahrten werden geholt …':'Im Konto liegen noch keine Fahrten'}</b>${K.busy||!K.last?'Einen Moment.':'Am Mac in den Einstellungen mit demselben Konto anmelden, dann kommen sie von selbst hierher.'}</div>`
      :`<div class="card empty"><b>Noch keine Fahrten auf dem Handy</b>Mit deinem Konto anmelden, dann kommen die Fahrten vom Mac von selbst.<div class="konto empty-k">${kontoHTML()}</div></div>`}
    ${now?`<div class="card hform">
      <div class="card-h"><h3>Form</h3><span class="tag ${fw[1]}">${fw[0]}</span></div>
      <div class="hk3">
        <div><span class="lbl">Fitness</span><b>${n0(now.ctl)}</b>${wk&&Math.round(now.ctl-wk.ctl)?`<em class="${now.ctl>=wk.ctl?'up':'dn'}">${now.ctl>=wk.ctl?'▲':'▼'} ${n0(Math.abs(now.ctl-wk.ctl))}</em>`:''}</div>
        <div><span class="lbl">Ermüdung</span><b>${n0(now.atl)}</b></div>
        <div><span class="lbl">Form</span><b class="${now.tsb>=0?'pos':'neg'}">${now.tsb>=.5?'+':''}${n0(now.tsb)}</b></div>
      </div>
      ${formChart(P)}
    </div>`:''}
    <div class="card hp">
      <div class="card-h"><h3>Training</h3><div class="seg sm" id="perSeg"><span class="thumb"></span>${PER.map(([key,l])=>`<button type="button" data-per="${key}"${key===k?' class="on"':''}>${l}</button>`).join('')}</div></div>
      <div class="hp-top">
        <div><span class="lbl">${perLabel(k,real)}</span><div class="hp-big"><b>${fmtHM(t.sec)}</b><small>h</small></div></div>
        <div class="hp-r"><span class="hp-n">${t.n} ${t.n===1?'Fahrt':'Fahrten'}</span>${dPct!=null&&t.sec?`<span class="hp-d ${dPct>=0?'up':'dn'}" title="gegenüber ${prevName}">${dPct>=0?'▲':'▼'} ${Math.abs(dPct)} %</span>`:''}</div>
      </div>
      ${barChart(B)}
      <p class="hp-cap" id="hbCap">${bucketCap(B.find(x=>x.cur)||B[B.length-1])}</p>
      <div class="hp-g">
        ${kpi(n1(t.km),'km','Distanz')}${kpi(n0(t.gain),'m','Höhe')}${kpi(n0(t.kj),'kJ','Arbeit')}
        ${kpi(t.sec?n0(t.kj*1000/t.sec):'–',t.sec?'W':'','Ø Leistung')}${kpi(n0(t.tss),'','TSS')}${kpi(t.sec&&t.km?n1(t.km/(t.sec/3600)):'–',t.sec&&t.km?'km/h':'','Ø Tempo')}
      </div>
      ${ztot?`<div class="hzd"><div class="hzd-bar">${zt.map((x,i)=>x?`<i style="flex:${x};--zc:var(--z${i+1})" title="${ZONES[i].n} ${ZONES[i].name}"></i>`:'').join('')}</div>
        <div class="hzd-l">${zt.map((x,i)=>x/ztot>=.05?`<span style="--zc:var(--z${i+1})"><i></i>${ZONES[i].name} <b>${n0(x/ztot*100)} %</b></span>`:'').join('')}</div></div>`:''}
    </div>
    ${real.length?`<div class="card hrec">
      <div class="card-h"><h3>Rekorde</h3><button type="button" class="lnk" data-go="best">Leistungskurve</button></div>
      <div class="hrec-g">${[[5,'5 s'],[60,'1 min'],[300,'5 min'],[1200,'20 min']].map(([d,l])=>{const b=bests[d];return b?`<button type="button" class="hrec-t" data-ride="${b.id}"><span class="lbl">${l}</span><b>${n0(b.w)}<small>W</small></b><span class="wk">${n2(b.w/kg)} W/kg</span>${Date.parse(b.start)>=cut?'<i class="new">neu</i>':''}</button>`:`<div class="hrec-t off"><span class="lbl">${l}</span><b>–</b></div>`;}).join('')}</div>
    </div>
    <div class="card hcal">
      <div class="card-h"><h3>Kalender</h3>${strk?`<span class="tag acc">${strk} ${strk===1?'Woche':'Wochen'} am Stück</span>`:''}</div>
      ${calendar(dm)}
    </div>`:''}
    <div class="card hv">
      <div class="hv-top">
        <div><span class="lbl">FTP</span><div class="hv-big"><b>${ftp}</b><small>W</small></div></div>
        <div><span class="lbl">Watt pro kg</span><div class="hv-big"><b id="hWkg">${n2(wkg)}</b></div></div>
        <span class="tag acc hv-lv">${wkgLevel(wkg)}</span>
      </div>
      <div class="hzb"><div class="hzb-bar">${ZONES.map((z,i)=>`<span style="flex:${ZW[i]};--zc:var(--z${i+1})"><em>${z.n}</em></span>`).join('')}</div><div class="hzb-w">${zMarks}</div></div>
      <div class="hv-f">
        <div><span class="lbl">FTP</span><div class="field"><button type="button" class="pm" data-hv="ftp" data-d="-5" aria-label="5 Watt weniger">−</button><input id="hFtp" inputmode="numeric" autocomplete="off" value="${ftp}" aria-label="FTP in Watt"><span class="u">W</span><button type="button" class="pm" data-hv="ftp" data-d="5" aria-label="5 Watt mehr">+</button></div></div>
        <div><span class="lbl">Gewicht</span><div class="field"><button type="button" class="pm" data-hv="kg" data-d="-0.5" aria-label="Ein halbes Kilo weniger">−</button><input id="hKg" inputmode="decimal" autocomplete="off" value="${String(kg).replace('.',',')}" aria-label="Gewicht in Kilogramm"><span class="u">kg</span><button type="button" class="pm" data-hv="kg" data-d="0.5" aria-label="Ein halbes Kilo mehr">+</button></div></div>
      </div>
      ${est&&est!==ftp?`<button type="button" class="qb hv-est" data-hest="${est}">${g.lbl}<b>${est} W übernehmen</b></button>`:''}
    </div>
    ${steps.length>1?`<div class="card hf">
      <div class="card-h"><h3>FTP-Verlauf</h3><span class="lbl">${steps[0].w} → ${ftp} W</span></div>
      ${ftpChart(steps)}
    </div>`:''}
    ${recent.length?`<div class="card hr-c">
      <div class="card-h"><h3>Letzte Fahrten</h3><button type="button" class="lnk" data-go="rides">Alle</button></div>
      <div class="list">${recent.map(rideRow).join('')}</div>
    </div>`:''}
    ${K.s||real.length?`<div class="card hd">
      <div class="card-h"><h3>Konto</h3></div>
      <div class="konto">${kontoHTML()}</div>
    </div>`:''}
    ${standalone()?'':`<p class="note soft hd-tip">Tipp: Teilen → „Zum Home-Bildschirm“, dann startet Wattbuch wie eine App.</p>`}
  </div>`;
  requestAnimationFrame(()=>placeSegThumb($('#perSeg')));
}
/* Balken antippen zeigt Zeit, Fahrten und km darunter */
document.addEventListener('click',e=>{
  const g=e.target.closest('[data-hb]');if(!g||!HB[+g.dataset.hb])return;
  $$('.hbars g.sel').forEach(x=>x.classList.remove('sel'));g.classList.add('sel');
  const c=$('#hbCap');if(c)c.innerHTML=bucketCap(HB[+g.dataset.hb]);
});

/* Werte direkt in der Übersicht ändern */
function hvSet(which,val){
  if(!fin(val))return false;
  if(which==='ftp')setFtp(val);else setWeight(val);
  renderHome();return true;
}
document.addEventListener('click',e=>{
  const p=e.target.closest('[data-per]');if(p){S.per=p.dataset.per;renderHome();return;}
  const pm=e.target.closest('[data-hv]');if(pm){hvSet(pm.dataset.hv,(pm.dataset.hv==='ftp'?S.set.ftp:S.set.weight)+(+pm.dataset.d));return;}
  const he=e.target.closest('[data-hest]');if(he){hvSet('ftp',+he.dataset.hest);toast(`FTP auf ${S.set.ftp} W gesetzt`);return;}
});
document.addEventListener('change',e=>{
  if(e.target.id==='hFtp')hvSet('ftp',parseInt(e.target.value,10))||renderHome();
  if(e.target.id==='hKg')hvSet('kg',parseFloat(e.target.value.replace(',','.')))||renderHome();
});
document.addEventListener('focusin',e=>{if(e.target.id==='hFtp'||e.target.id==='hKg')e.target.select();});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.target.id==='hFtp'||e.target.id==='hKg'))e.target.blur();});
