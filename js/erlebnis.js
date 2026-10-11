'use strict';
/* ---------- Fahrt-Erlebnis ---------- */
/* Countdown vor dem Start, Momente während der Fahrt (Bestwert, Meilensteine, Gipfel),
   Zusammenfassung nach dem Speichern. Alles rein darstellend, die Aufnahme selbst bleibt in aufnahme.js. */

const ICON={
  trophy:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
  flag:'<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  peak:'<path d="M3 20l6-10 4 6 2-3 6 7H3z"/>',
  road:'<path d="M8 3l-3 18M16 3l3 18M12 5v2M12 11v2M12 17v2"/>',
  bolt:'<path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z"/>'
};
const ico=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

/* Countdown 3-2-1, Klick überspringt */
function beginRide(){
  if(HANDY||S.rec.state!=='idle')return;
  if(!isLive()){toast('Erst die Rolle verbinden');return;}
  const el=document.createElement('div');el.className='countdown';el.setAttribute('role','status');
  document.body.appendChild(el);
  let n=3,t=null;
  const go=()=>{clearTimeout(t);el.remove();startRec();momReset();window.scrollTo({top:0});S.fullAuto=true;openFull();};
  const step=()=>{if(!n){el.innerHTML='<b class="go">Los</b>';t=setTimeout(go,450);return;}el.innerHTML=`<b>${n}</b>`;n--;t=setTimeout(step,850);};
  el.addEventListener('click',go);step();
}

/* Momente: kurzes Banner oben in der Live-Karte, eins nach dem anderen */
const momQ=[];let momT=null;
function moment(icon,title,sub,kind){
  momQ.push({icon,title,sub,kind});if(momQ.length>4)momQ.shift();
  if(!momT)nextMoment();
  S.mom&&S.mom.log.push({title,sub,kind});
}
function nextMoment(){
  const m=momQ.shift(),el=$('#moment');
  if(!m){el.classList.remove('show');momT=null;return;}
  el.className='moment'+(m.kind?' '+m.kind:'');
  el.innerHTML=`<span class="mi">${ico(m.icon)}</span><span class="mt"><b>${esc(m.title)}</b>${m.sub?`<span>${esc(m.sub)}</span>`:''}</span>`;
  void el.offsetWidth;el.classList.add('show');
  momT=setTimeout(()=>{el.classList.remove('show');momT=setTimeout(nextMoment,400);},4200);
}

const PB_DURS=[[60,'1 min'],[300,'5 min'],[1200,'20 min']];
const SNACK=[[250,'etwa eine Brezel'],[500,'etwa ein Stück Pizza'],[750,'etwa ein Teller Pasta'],[1000,'etwa ein Döner'],[1500,'etwa eine ganze Pizza']];
function momReset(){
  const real=S.rides.filter(r=>!r.sample);
  S.mom={best:real.length?bestsOf(real):null,pb:{},km:0,kj:0,hm:0,peak:false,log:[]};
  paceReset();
}
/* Läuft jede Sekunde während der Aufnahme (aus tick) */
function checkMoments(){
  const M=S.mom,R=S.rec;if(!M)return;
  paceCheck();rampTick();
  const p=R.p,n=p.length;
  if(M.best)for(const[d,l]of PB_DURS){
    if(n<d||M.pb[d])continue;
    let s=0;for(let i=n-d;i<n;i++)s+=p[i];const w=s/d,b=M.best[d];
    if(!b||w>b.w){M.pb[d]=Math.round(w);moment('trophy',`Neuer Bestwert ${l}`,b?`${n0(w)} W · bisher ${n0(b.w)} W`:`${n0(w)} W`,'gold');}
  }
  const km=Math.floor(S.sim.total/10000)*10;
  if(km>M.km){M.km=km;moment('road',`${km} km geschafft`,`Ø ${n0(sum(p)/n)} W bisher`);}
  const kj=sum(p)/1000,snack=SNACK.filter(([k])=>k<=kj).pop();
  if(snack&&snack[0]>M.kj){M.kj=snack[0];moment('bolt',`${snack[0]} kJ Arbeit`,`Verbrannt hast du ${snack[1]}`);}
  const rt=activeRoute();
  if(rt){
    const hm=Math.floor(S.sim.gain/100)*100;
    if(hm>M.hm){M.hm=hm;moment('peak',`${hm} Höhenmeter`,rt.name);}
    if(!M.peak){const top=rt.ele.indexOf(Math.max(...rt.ele))*rt.step;if(top>500&&S.sim.d>=top&&S.sim.d<top+200){M.peak=true;moment('flag','Höchster Punkt erreicht',`${n0(eleAt(rt,top))} m · ab hier wird es leichter`,'gold');}}
  }
}

/* Zusammenfassung nach dem Speichern */
function showSummary(r){
  closeFull();S.pace=null;
  const ft=rampSummary(r);
  const s=stats(r),M=S.mom||{pb:{},log:[]},dlg=$('#dlgSum');
  const prev=S.rides.filter(x=>!x.sample&&x.id!==r.id);
  const before=prev.length?bestsOf(prev):{};
  /* Bestwerte über alle Kennzeiten am Ende neu vergleichen, nicht nur die live gemeldeten */
  const pbs=prev.length?KEY_DURS.filter(d=>d<=s.dur).map(d=>{const w=bestAvg(r.p,d),b=before[d];return(!b||w>b.w)?{d,w,b:b&&b.w}:null;}).filter(Boolean):[];
  const km=r.dist&&r.dist.length?r.dist[r.dist.length-1]/1000:0;
  const zMax=s.zt.indexOf(Math.max(...s.zt));
  const head=ft?'FTP-Test geschafft':pbs.length?(pbs.length>1?`${pbs.length} neue Bestwerte`:'Neuer Bestwert'):s.IF>=.85?'Stark gefahren':s.IF>=.7?'Gute Einheit':'Locker gerollt';
  const hl=[];
  if(ft)hl.push(['trophy',`Deine FTP: ${ft.ftp} W`,`75 % deiner besten Minute (${ft.best} W) · höchste Stufe ${ft.peak} W · ${ft.ftp!==ft.before?`übernommen, bisher ${ft.before} W`:'wie bisher'}`,'gold']);
  for(const x of pbs)hl.push(['trophy',`Bestwert ${durLbl(x.d)}: ${n0(x.w)} W`,x.b?`+${n0(x.w-x.b)} W gegenüber vorher`:'Erster Wert','gold']);
  hl.push(['bolt',`Meiste Zeit in ${ZONES[zMax].n} ${ZONES[zMax].name}`,`${fmtDur(s.zt[zMax])} · ${n0(s.zt[zMax]/s.dur*100)} %`]);
  const snack=SNACK.filter(([k])=>k<=s.kj).pop();if(snack)hl.push(['bolt',`${n0(s.kj)} kJ Arbeit`,`Verbrannt hast du ${snack[1]}`]);
  if(r.route)hl.push(['peak',r.route,`${n0(r.gain||0)} Höhenmeter${km?` auf ${n1(km)} km`:''}`]);
  const last=prev.filter(x=>Date.parse(x.start)<Date.parse(r.start)).sort((a,b)=>Date.parse(b.start)-Date.parse(a.start))[0];
  if(last){const d=s.avg-stats(last).avg;if(Math.abs(d)>=3)hl.push(['road',`Ø ${n0(Math.abs(d))} W ${d>0?'mehr':'weniger'} als letztes Mal`,`${fmtDate(last.start)}: Ø ${n0(stats(last).avg)} W`]);}
  const tiles=[['Zeit',fmtDur(s.dur),'',0],['Ø Leistung',Math.round(s.avg),'W',1],['Arbeit',Math.round(s.kj),'kJ',1]];
  if(km)tiles.push(['Distanz',km,'km',2]);if(r.gain)tiles.push(['Höhenmeter',r.gain,'m',1]);
  dlg.innerHTML=`<div class="sum">
    <div class="sum-h"><span class="lbl">${fmtDate(r.start)} · ${esc(r.name)}</span><h2>${head}</h2></div>
    <div class="sum-t">${tiles.map(([l,v,u,k])=>`<div><span class="lbl">${l}</span><b ${k?`data-to="${v}" data-dec="${k===2?1:0}"`:''}>${k?0:v}</b>${u?`<small>${u}</small>`:''}</div>`).join('')}</div>
    <div class="sum-z">${s.zt.map((t,i)=>t?`<i style="flex:${t};--zc:var(--z${i+1})" title="${ZONES[i].n}"></i>`:'').join('')}</div>
    <ul class="sum-l">${hl.map(([ic,t,sub,k],i)=>`<li class="${k||''}" style="--i:${i}"><span class="mi">${ico(ic)}</span><span><b>${esc(t)}</b><span>${esc(sub)}</span></span></li>`).join('')}</ul>
    <div class="sum-f">${ft&&ft.ftp!==ft.before&&S.set.ftp===ft.ftp?`<button type="button" class="btn ghost" id="sumFtp">Zurück auf ${ft.before} W</button>`:''}${stravaBtn(r,'sumStrava')}<span class="spacer"></span><button type="button" class="btn primary" id="sumOk">Details ansehen</button></div>
  </div>`;
  dlg.showModal();
  $$('[data-to]',dlg).forEach(el=>{const to=+el.dataset.to,dec=+el.dataset.dec;anim(1100,k=>{el.textContent=dec?F1.format(to*k):F0.format(Math.round(to*k));});});
  if(pbs.length)confetti(dlg);
  $('#sumOk').onclick=()=>dlg.close();
  if(ft&&$('#sumFtp'))$('#sumFtp').onclick=e=>{setFtp(ft.before);renderFtpCard();toast(`FTP bleibt bei ${ft.before} W`);e.target.remove();};
  $('#sumStrava').dataset.ride=r.id;
  stravaSync();
}

/* Kleines Konfetti in Akzentfarben, nur bei neuen Bestwerten, respektiert „weniger Bewegung“ */
function confetti(host){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const c=document.createElement('canvas');c.className='confetti';host.appendChild(c);
  const dpr=devicePixelRatio||1,W=c.width=host.clientWidth*dpr,H=c.height=host.clientHeight*dpr,ctx=c.getContext('2d');
  const cols=[css('--z3'),css('--z5'),css('--z6'),css('--accent'),'#F5C451'];
  const ps=Array.from({length:90},()=>({x:W/2+(Math.random()-.5)*W*.3,y:H*.28,vx:(Math.random()-.5)*14*dpr,vy:(-Math.random()*13-4)*dpr,r:Math.random()*6,s:(3+Math.random()*4)*dpr,c:cols[Math.floor(Math.random()*cols.length)]}));
  const t0=performance.now();
  (function fr(t){
    const k=(t-t0)/1800;ctx.clearRect(0,0,W,H);
    for(const p of ps){p.vy+=.45*dpr;p.vx*=.985;p.x+=p.vx;p.y+=p.vy;p.r+=.12;ctx.save();ctx.globalAlpha=Math.max(0,1-k);ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.fillStyle=p.c;ctx.fillRect(-p.s/2,-p.s/4,p.s,p.s/2);ctx.restore();}
    k<1?requestAnimationFrame(fr):c.remove();
  })(t0);
}
