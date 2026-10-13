'use strict';
/* ---------- Export, Sicherung ---------- */
function download(text,name,type){
  const b=new Blob([text],{type}),a=document.createElement('a');
  a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);
}
function tcx(r){
  const s=stats(r),t0=Date.parse(r.start);let dist=0,pts='';
  const hasD=!!(r.dist||r.spd);
  for(let i=0;i<r.p.length;i++){
    if(r.dist)dist=r.dist[i]||dist;else if(r.spd)dist+=(r.spd[i]||0)/3.6;
    const alt=r.alt&&r.alt[i]!=null?`<AltitudeMeters>${r.alt[i]}</AltitudeMeters>`:'';
    const hr=r.hr&&r.hr[i]>0?`<HeartRateBpm><Value>${r.hr[i]}</Value></HeartRateBpm>`:'';
    const cad=r.cad?`<Cadence>${Math.min(254,r.cad[i]||0)}</Cadence>`:'';
    pts+=`<Trackpoint><Time>${new Date(t0+i*1000).toISOString()}</Time>${alt}${hasD?`<DistanceMeters>${dist.toFixed(1)}</DistanceMeters>`:''}${hr}${cad}<Extensions><ns3:TPX><ns3:Watts>${r.p[i]}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>\n`;
  }
  return`<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${new Date(t0).toISOString()}</Id>
<Lap StartTime="${new Date(t0).toISOString()}"><TotalTimeSeconds>${s.dur}</TotalTimeSeconds><DistanceMeters>${dist.toFixed(1)}</DistanceMeters><Calories>${Math.round(s.kj)}</Calories>${s.hrAvg?`<AverageHeartRateBpm><Value>${Math.round(s.hrAvg)}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${s.hrMax}</Value></MaximumHeartRateBpm>`:''}<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>
<Track>
${pts}</Track></Lap><Notes>${esc(r.name)}</Notes></Activity></Activities></TrainingCenterDatabase>`;
}

/* Sicherung: Einstellungen, echte Fahrten und Strecken. Aus Strava übernommene Fahrten nicht (groß, liegen in Strava und im Konto,
   die Mac-App holt sie nach einer Neuinstallation von selbst wieder). In der Mac-App (window.wattbuchDesktop)
   wird sie nach jeder Änderung automatisch nach iCloud Drive geschrieben. Sonst hält das Konto alles zusammen. */
function backupJSON(){return JSON.stringify({app:'wattbuch',version:1,saved:new Date().toISOString(),from:HANDY?'handy':'mac',settings:S.set,rides:S.rides.filter(r=>!r.sample&&r.src!=='strava'),routes:S.routes,gone:[...S.gone]});}
let bkT=null;
function autoBackup(){const d=window.wattbuchDesktop;if(!d)return;clearTimeout(bkT);bkT=setTimeout(()=>d.backup(backupJSON()).catch(()=>toast('Automatische Sicherung fehlgeschlagen')),400);}
/* Etwas an den Daten wurde von Hand geändert (Name, Löschen, FTP, Gewicht) */
function changed(){autoBackup();}
/* Gelöschte Fahrten merken, damit sie beim nächsten Abgleich nicht aus der anderen Sicherung zurückkommen */
async function forget(r){await DB.del(r.id);S.rides=S.rides.filter(x=>x!==r);if(!r.sample){S.gone.add(r.id);await DB.set('gone',[...S.gone]);}changed();}
async function importData(d){
  let rides=0,routes=0;
  if(d&&Array.isArray(d.routes))routes+=await addRoutes(d.routes);
  if(d&&Array.isArray(d.gone)&&d.gone.length){
    for(const id of d.gone){if(typeof id!=='string')continue;S.gone.add(id);if(S.rides.some(r=>r.id===id)){S.rides=S.rides.filter(r=>r.id!==id);await DB.del(id);}}
    await DB.set('gone',[...S.gone]);
  }
  if(d&&Array.isArray(d.rides)){
    for(const x of d.rides){
      if(!okRide(x)||S.gone.has(x.id))continue;
      /* Gleiche Fahrt: die zuletzt von Hand bearbeitete gewinnt, ein erfolgter Strava-Upload geht nie verloren */
      const i=S.rides.findIndex(y=>y.id===x.id),o=i>=0?S.rides[i]:null,ok=r=>r&&r.strava&&r.strava.state==='ok';
      let y=x;
      if(o&&(o.edited||0)>(x.edited||0))y={...o,strava:ok(x)?x.strava:o.strava};
      else if(ok(o)&&!ok(x))y={...x,strava:o.strava};
      if(i>=0)S.rides[i]=y;else S.rides.push(y);await DB.put(y);rides++;
    }
    if(d.settings&&fin(d.settings.ftp)){S.set.ftp=d.settings.ftp;if(fin(d.settings.weight))S.set.weight=d.settings.weight;saveSet();werteMark();renderErg();}
  }
  return{rides,routes};
}

/* ---------- Einstellungen ---------- */
async function saveSet(){await DB.set('settings',S.set);}
function setFtp(v){S.set.ftp=clamp(Math.round(v),50,600);S.set.ftpOk=true;saveSet();changed();werteMark();$('#setFtp').value=S.set.ftp;renderErg();renderCoachOpts();}
function setWeight(v){S.set.weight=clamp(Math.round(v*10)/10,30,200);saveSet();changed();werteMark();}
function openSet(){
  if(typeof stravaRefresh==='function'){renderStravaSet();stravaRefresh();}
  if(typeof tvRefresh==='function'){renderTvSet();tvRefresh();}
  if(typeof renderAppBox==='function')renderAppBox();
  $('#autoPause').checked=autoPauseOn();$('#autoPauseL').classList.toggle('on',autoPauseOn());
  $('#setFtp').value=S.set.ftp;$('#setKg').value=String(S.set.weight).replace('.',',');$('#setBike').value=String(S.set.bike).replace('.',',');
  const g=ftpSuggest(),e=$('#ftpEst');
  e.hidden=!!g&&g.w===S.set.ftp;
  if(g){e.innerHTML=`${g.lbl}<b>${g.w} W</b>`;e.disabled=false;e.onclick=()=>{setFtp(g.w);e.hidden=true;toast(`FTP auf ${g.w} W gesetzt`);};}
  else{e.innerHTML='Für einen FTP-Vorschlag: FTP-Test machen oder 20 min am Stück fahren';e.disabled=true;e.onclick=null;}
  $('#dlgSet').showModal();$('#dlgSet').focus();
}
function rerender(){renderView(S.view);if(S.view!=='live')$$(`#v-${S.view} canvas`).forEach(c=>c._draw&&c._draw(null));}

/* ---------- Beispielfahrt ---------- */
function makeSample(){
  let seed=11;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  const ftp=S.set.ftp,p=[],hr=[];let h=66;
  const plan=[[540,.45,.7],[60,.7,.7],[480,.9,.92],[240,.58,.58],[480,.92,.94],[240,.58,.58],[480,.94,.96],[180,.6,.6],[15,1.75,1.6],[285,.6,.45]];
  for(const[d,a,b]of plan)for(let i=0;i<d;i++){
    const f=a+(b-a)*i/d,v=Math.max(0,Math.round(ftp*f*(1+(rnd()-.5)*.14)));p.push(v);
    h+=((58+v*.44)-h)*.018;hr.push(Math.round(h+(rnd()-.5)*2));
  }
  const d=new Date();d.setDate(d.getDate()-1);d.setHours(18,30,0,0);
  return{id:'sample',start:d.toISOString(),name:'Beispielfahrt',sample:true,p,hr,cad:null,spd:null,ftp,weight:S.set.weight};
}
