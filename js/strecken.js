'use strict';
/* ---------- Strecken ---------- */
const RSTEP=25;
const PREP=new Map();
function prepRoute(r,rev){
  const k=r.id+(rev?'~r':'');if(PREP.has(k))return PREP.get(k);
  const ele=rev?r.ele.slice().reverse():r.ele,line=rev?r.line.slice().reverse():r.line;
  /* Linie: kumulierte Länge für die Position auf der Karte */
  const cum=[0];for(let i=1;i<line.length;i++)cum.push(cum[i-1]+hav(line[i-1],line[i]));
  const a=line[0],b=line[line.length-1];
  const p={id:r.id,name:r.name+(rev?' (umgekehrt)':''),dist:(ele.length-1)*(r.step||RSTEP),step:r.step||RSTEP,ele,line,cum,gain:r.gain,loop:hav(a,b)<300};
  PREP.set(k,p);return p;
}
function hav(a,b){const R=6371000,p1=a[0]*Math.PI/180,p2=b[0]*Math.PI/180,dp=p2-p1,dl=(b[1]-a[1])*Math.PI/180;const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));}
function activeRoute(){const r=S.routes.find(x=>x.id===S.set.routeId);return r?prepRoute(r,S.set.rev):null;}
function eleAt(rt,d){const x=clamp(d,0,rt.dist)/rt.step,i=Math.min(rt.ele.length-2,Math.floor(x)),f=x-i;return rt.ele[i]+(rt.ele[i+1]-rt.ele[i])*f;}
function gradeAt(rt,d){const a=clamp(d-25,0,rt.dist),b=clamp(d+25,0,rt.dist);return b>a?clamp((eleAt(rt,b)-eleAt(rt,a))/(b-a)*100,-25,25):0;}
function routeGradeNow(){const rt=activeRoute();return rt&&!S.sim.done?gradeAt(rt,S.sim.d):0;}
function trainerGrade(){return Math.round(routeGradeNow()*S.set.diff*10)/10;}
function posAt(rt,d){
  const L=rt.cum[rt.cum.length-1],t=clamp(d/rt.dist,0,1)*L;let i=1;
  while(i<rt.cum.length-1&&rt.cum[i]<t)i++;
  const s0=rt.cum[i-1],s1=rt.cum[i],f=s1>s0?(t-s0)/(s1-s0):0;
  return[rt.line[i-1][0]+(rt.line[i][0]-rt.line[i-1][0])*f,rt.line[i-1][1]+(rt.line[i][1]-rt.line[i-1][1])*f];
}
/* Fahrphysik: Leistung gegen Rollwiderstand, Luft und Hangabtrieb */
const PHYS={g:9.81,rho:1.225,cda:.32,crr:.005};
function simStep(dt){
  const P=isLive()?(curPow()||0):0,m=S.set.weight+S.set.bike,rt=activeRoute(),sim=S.sim;
  const g=rt&&!sim.done?gradeAt(rt,sim.d):0,th=Math.atan(g/100);
  const v=sim.v,drive=P/Math.max(v,1);
  const res=m*PHYS.g*(PHYS.crr*Math.cos(th)+Math.sin(th))+.5*PHYS.rho*PHYS.cda*v*v;
  sim.v=clamp(v+(drive-res)/(m+1.5)*dt,0,25);
  if(!isLive())sim.v=0;
  if(S.rec.state!=='rec')return;
  const dd=sim.v*dt;sim.total+=dd;
  if(!rt)return;
  if(sim.done)return;
  sim.d+=dd;
  if(sim.d>=rt.dist){
    if(rt.loop){sim.d-=rt.dist;sim.lap++;toast(`Runde ${sim.lap-1} geschafft`);}
    else{sim.d=rt.dist;sim.done=true;toast('Ziel erreicht');applyControl(true);}
  }
  const alt=eleAt(rt,sim.d);
  if(sim.lastAlt!=null&&alt>sim.lastAlt)sim.gain+=alt-sim.lastAlt;
  sim.lastAlt=alt;
}
function resetSim(){Object.assign(S.sim,{d:0,total:0,gain:0,lastAlt:null,lap:1,done:false});const rt=activeRoute();if(rt)S.sim.lastAlt=eleAt(rt,0);}
/* Aus Punkten (Abstand, Höhe, Linie) eine Strecke machen; gleiche Glättung wie bei den Strava-Strecken */
function buildRoute(name,pts){
  const xs=[0];for(let i=1;i<pts.length;i++)xs.push(xs[i-1]+hav(pts[i-1],pts[i]));
  const L=xs[xs.length-1];if(L<1000)throw new Error('zu kurz');
  const n=Math.floor(L/RSTEP)+1;let ele=[];let j=0;
  for(let k=0;k<n;k++){const x=k*RSTEP;while(j<xs.length-2&&xs[j+1]<x)j++;const f=xs[j+1]>xs[j]?(x-xs[j])/(xs[j+1]-xs[j]):0;ele.push(pts[j][2]+(pts[j+1][2]-pts[j][2])*clamp(f,0,1));}
  const sm=a=>a.map((_,i)=>{let s=0,c=0;for(let q=Math.max(0,i-3);q<=Math.min(a.length-1,i+3);q++){s+=a[q];c++;}return s/c;});
  ele=sm(sm(ele));
  let gain=0;for(let i=1;i<ele.length;i++)if(ele[i]>ele[i-1])gain+=ele[i]-ele[i-1];
  const every=Math.max(1,Math.ceil(pts.length/600)),line=pts.filter((_,i)=>i%every===0||i===pts.length-1).map(p=>[+p[0].toFixed(5),+p[1].toFixed(5)]);
  return{id:'g'+Math.round(L)+'-'+Math.abs(Math.round(pts[0][0]*1e4+pts[0][1]*1e4)),name,dist:(n-1)*RSTEP,step:RSTEP,gain:Math.round(gain),ele:ele.map(e=>Math.round(e*10)/10),line};
}
function parseGPX(text,fname){
  const x=new DOMParser().parseFromString(text,'application/xml');
  if(x.querySelector('parsererror'))throw new Error('keine GPX-Datei');
  let nodes=[...x.getElementsByTagName('trkpt')];if(!nodes.length)nodes=[...x.getElementsByTagName('rtept')];
  const pts=[];
  for(const n of nodes){const e=n.getElementsByTagName('ele')[0];if(!e)throw new Error('GPX ohne Höhenangaben');pts.push([+n.getAttribute('lat'),+n.getAttribute('lon'),+e.textContent]);}
  if(pts.length<10)throw new Error('zu wenige Punkte');
  const nm=(x.getElementsByTagName('name')[0]||{}).textContent||fname.replace(/\.gpx$/i,'');
  return buildRoute(nm.trim().slice(0,60)||'Strecke',pts);
}
async function addRoutes(list){
  let n=0;for(const r of list){if(!r||!r.id||!Array.isArray(r.ele)||!Array.isArray(r.line)||r.ele.length<10)continue;const i=S.routes.findIndex(x=>x.id===r.id);if(i>=0)S.routes[i]=r;else S.routes.push(r);PREP.delete(r.id);PREP.delete(r.id+'~r');n++;}
  await DB.set('routes',S.routes);renderRoutes();return n;
}
function routeSpark(ele){
  const N=40,pts=[];let mn=1e9,mx=-1e9;
  for(let k=0;k<N;k++){const v=ele[Math.round(k*(ele.length-1)/(N-1))];pts.push(v);if(v<mn)mn=v;if(v>mx)mx=v;}
  const r=Math.max(30,mx-mn),d=pts.map((v,i)=>`${(i/(N-1)*64).toFixed(1)},${(22-(v-mn)/r*19).toFixed(1)}`).join(' ');
  return`<svg viewBox="0 0 64 24" aria-hidden="true"><polygon points="0,24 ${d} 64,24" fill="var(--accent-soft)"/><polyline points="${d}" fill="none" stroke="var(--accent)" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
}
function renderRoutes(){
  const busy=S.rec.state!=='idle',sel=S.set.routeId;
  const rows=[`<button type="button" class="rrow${!sel?' on':''}" data-route=""${busy?' disabled':''}><span class="rd"></span><span class="rn"><b>Frei fahren</b><span>Flache Straße</span></span><span></span></button>`];
  for(const r of S.routes)rows.push(`<button type="button" class="rrow${sel===r.id?' on':''}" data-route="${esc(r.id)}"${busy?' disabled':''}><span class="rd"></span><span class="rn"><b>${esc(r.name)}</b><span>${n1(r.dist/1000)} km · ${n0(r.gain)} Hm</span></span>${routeSpark(r.ele)}</button>`);
  $('#rtList').innerHTML=rows.join('')+(S.routes.length?'':'<p class="rt-empty">Noch keine Strecke. Über „Laden“ eine Streckendatei oder GPX einlesen.</p>');
  $('#rtOpts').hidden=!sel;
  $('#rev').checked=!!S.set.rev;$('#chkRev').classList.toggle('on',!!S.set.rev);$('#rev').disabled=busy;
  $$('#diffSeg button').forEach(b=>b.classList.toggle('on',+b.dataset.df===S.set.diff));
  requestAnimationFrame(()=>placeSegThumb($('#diffSeg')));
  $('#routeLive').hidden=!activeRoute();
}
function selectRoute(id){
  if(S.rec.state!=='idle')return;
  S.set.routeId=id||null;saveSet();resetSim();renderRoutes();applyControl(true);
  setTimeout(()=>{const c=$('#cvMap');if(c)c._bounds=null;},0);
}
