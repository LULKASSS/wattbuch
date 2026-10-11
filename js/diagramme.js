'use strict';
/* ---------- Diagramme ---------- */
function prep(c){
  const dpr=window.devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;
  if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}
  const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);return{ctx,w,h};
}
function niceMax(v){const st=[50,100,150,200,250,300,400,500,600,800,1000,1200,1500,2000];for(const s of st)if(v<=s)return s;return Math.ceil(v/500)*500;}
const yStep=m=>m<=150?50:m<=400?100:m<=800?200:500;
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function tip(ctx,x,y,lines,w,h){
  ctx.font=`500 12px ${css('--sans')}`;
  const tw=Math.max(...lines.map(l=>ctx.measureText(l).width))+20,th=lines.length*17+12;
  let bx=x+12;if(bx+tw>w-4)bx=x-12-tw;let by=Math.max(4,Math.min(y-th/2,h-th-26));
  ctx.save();ctx.shadowColor='rgba(0,0,0,.18)';ctx.shadowBlur=14;ctx.fillStyle=css('--surface');roundRect(ctx,bx,by,tw,th,8);ctx.fill();ctx.restore();
  ctx.strokeStyle=css('--line');ctx.lineWidth=1;roundRect(ctx,bx+.5,by+.5,tw-1,th-1,8);ctx.stroke();
  ctx.fillStyle=css('--fg');ctx.textAlign='left';ctx.textBaseline='top';
  lines.forEach((l,i)=>ctx.fillText(l,bx+10,by+7+i*17));
}
/* Zeitreihe Leistung; live=true heißt: festes Fenster (span Sekunden), Daten rechtsbündig */
function drawSeries(c,data,o={}){
  const{ctx,w,h}=prep(c);
  const L=40,R=10,T=10,B=24,iw=w-L-R,ih=h-T-B;
  const n=data.length,span=Math.max(o.span||n,2),off=o.live?span-n:0,prog=o.prog==null?1:o.prog;
  let mx=0;for(const v of data)if(v>mx)mx=v;if(o.ftp)mx=Math.max(mx,o.ftp*1.15);
  const ym=niceMax(mx*1.05),ys=yStep(ym);
  const X=i=>L+((i+off)/(span-1))*iw,Y=v=>T+ih-(v/ym)*ih;
  ctx.font=`500 10.5px ${css('--mono')}`;ctx.lineWidth=1;
  ctx.strokeStyle=css('--line');ctx.fillStyle=css('--fg-3');ctx.textAlign='right';ctx.textBaseline='middle';
  for(let y=0;y<=ym;y+=ys){const py=Math.round(Y(y))+.5;ctx.beginPath();ctx.moveTo(L,py);ctx.lineTo(w-R,py);ctx.stroke();ctx.fillText(y,L-8,py);}
  ctx.textAlign='center';ctx.textBaseline='top';
  if(o.live){[[0,'−5 min'],[span/2,'−2,5 min'],[span-1,'jetzt']].forEach(([t,l],k)=>{ctx.textAlign=k===0?'left':k===2?'right':'center';ctx.fillText(l,L+(t/(span-1))*iw,h-B+8);});}
  else{const xs=[60,120,300,600,900,1200,1800,3600].find(s=>span/s<=7)||3600;for(let t=0;t<span;t+=xs){const px=X(t);if(px>w-R-14)break;ctx.fillText(String(Math.round(t/60)),px,h-B+8);}ctx.textAlign='right';ctx.fillText('min',w-R,h-B+8);}
  if(o.ftp){const py=Math.round(Y(o.ftp))+.5;ctx.save();ctx.setLineDash([4,4]);ctx.strokeStyle=css('--accent-line');ctx.beginPath();ctx.moveTo(L,py);ctx.lineTo(w-R,py);ctx.stroke();ctx.restore();ctx.fillStyle=css('--accent-ink');ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText('FTP '+o.ftp,L+6,py-3);}
  if(n<2)return{L,iw,span,off,n};
  /* auf Pixelbreite verdichten */
  const buckets=Math.max(2,Math.min(n,Math.floor(iw*1.2))),pts=[];
  for(let b=0;b<buckets;b++){const a=Math.floor(b*n/buckets),e=Math.max(a+1,Math.floor((b+1)*n/buckets));let s=0;for(let i=a;i<e;i++)s+=data[i];pts.push([X((a+e-1)/2),Y(s/(e-a))]);}
  const cut=L+iw*prog,vis=pts.filter(p=>p[0]<=cut);
  if(vis.length>1){
    const g=ctx.createLinearGradient(0,T,0,T+ih);g.addColorStop(0,css('--accent-soft'));g.addColorStop(1,'rgba(127,95,232,0)');
    ctx.beginPath();ctx.moveTo(vis[0][0],T+ih);vis.forEach(p=>ctx.lineTo(p[0],p[1]));ctx.lineTo(vis[vis.length-1][0],T+ih);ctx.closePath();ctx.fillStyle=g;ctx.fill();
    ctx.beginPath();vis.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.strokeStyle=css('--accent');ctx.lineWidth=1.6;ctx.lineJoin='round';ctx.stroke();
    if(o.live){const lp=vis[vis.length-1];ctx.beginPath();ctx.arc(lp[0],lp[1],3.5,0,7);ctx.fillStyle=css('--accent');ctx.fill();}
  }
  if(o.hover!=null&&prog>=1){
    const i=clamp(Math.round((o.hover-L)/iw*(span-1))-off,0,n-1);const px=X(i),py=Y(data[i]);
    ctx.strokeStyle=css('--line-2');ctx.beginPath();ctx.moveTo(Math.round(px)+.5,T);ctx.lineTo(Math.round(px)+.5,T+ih);ctx.stroke();
    ctx.beginPath();ctx.arc(px,py,4,0,7);ctx.fillStyle=css('--surface');ctx.fill();ctx.lineWidth=2;ctx.strokeStyle=css('--accent');ctx.stroke();
    const tl=o.live?`vor ${fmtDur(n-1-i)}`:fmtDur(i);
    tip(ctx,px,py,[`${Math.round(data[i])} ${o.unit||'W'}`,tl],w,h);
  }
  return{L,iw,span,off,n};
}
/* Leistungskurve, x logarithmisch */
function drawCurve(c,lines,o={}){
  const{ctx,w,h}=prep(c);
  const L=40,R=14,T=12,B=24,iw=w-L-R,ih=h-T-B,prog=o.prog==null?1:o.prog;
  let dmax=1,wmax=0;for(const l of lines)for(const[d,v]of l.pts){if(d>dmax)dmax=d;if(v>wmax)wmax=v;}
  if(dmax<2){return;}
  const ym=niceMax(wmax*1.08),ys=yStep(ym),lg=Math.log(dmax);
  const X=d=>L+(Math.log(d)/lg)*iw,Y=v=>T+ih-(v/ym)*ih;
  ctx.font=`500 10.5px ${css('--mono')}`;ctx.lineWidth=1;ctx.strokeStyle=css('--line');ctx.fillStyle=css('--fg-3');
  ctx.textAlign='right';ctx.textBaseline='middle';
  for(let y=0;y<=ym;y+=ys){const py=Math.round(Y(y))+.5;ctx.beginPath();ctx.moveTo(L,py);ctx.lineTo(w-R,py);ctx.stroke();ctx.fillText(y,L-8,py);}
  ctx.textBaseline='top';
  /* Beschriftung nur, wo Platz ist (schmale Bildschirme): Abstand zur vorigen mindestens 52 px */
  let lastX=-1e9;[1,5,15,60,300,1200,3600,7200].filter(d=>d<=dmax).forEach((d,k,arr)=>{const px=X(d),last=k===arr.length-1;if(px-lastX<52&&!last)return;if(last&&px-lastX<52&&k>0)return;lastX=px;ctx.textAlign=k===0?'left':(last&&px>w-R-30)?'right':'center';ctx.fillText(durLbl(d),px,h-B+8);});
  const cut=L+iw*prog;
  for(const l of lines){
    const pts=l.pts.map(([d,v])=>[X(d),Y(v)]).filter(p=>p[0]<=cut+.5);if(pts.length<1)continue;
    ctx.save();if(l.dash)ctx.setLineDash(l.dash);
    ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.strokeStyle=css(l.color);ctx.lineWidth=l.width||2;ctx.lineJoin='round';ctx.stroke();ctx.restore();
    if(!l.dash)pts.forEach(p=>{ctx.beginPath();ctx.arc(p[0],p[1],2.6,0,7);ctx.fillStyle=css(l.color);ctx.fill();});
  }
  if(o.hover!=null&&prog>=1&&lines[0].pts.length){
    const base=lines[0].pts;let bi=0,bd=1e9;base.forEach(([d],i)=>{const dx=Math.abs(X(d)-o.hover);if(dx<bd){bd=dx;bi=i;}});
    const d=base[bi][0],px=X(d);
    ctx.strokeStyle=css('--line-2');ctx.beginPath();ctx.moveTo(Math.round(px)+.5,T);ctx.lineTo(Math.round(px)+.5,T+ih);ctx.stroke();
    const rows=[durLbl(d)];lines.forEach(l=>{const q=l.pts.find(p=>p[0]===d);if(q)rows.push(`${l.label}: ${Math.round(q[1])} W`);});
    tip(ctx,px,Y(base[bi][1]),rows,w,h);
  }
}
function bindHover(c,redraw){
  const mv=e=>{const r=c.getBoundingClientRect();redraw(e.clientX-r.left);};
  c.onpointermove=mv;c.onpointerdown=mv;c.onpointerleave=()=>redraw(null);
}

/* Höhenprofil mit gefahrenem Teil und Punkt */
/* pv: Vorschau vor der Fahrt, ganzes Profil in Flieder mit Verlauf */
function drawProfile(c,rt,d,pv){
  const{ctx,w,h}=prep(c);if(w<10)return;
  const L=36,R=6,T=8,B=20,iw=w-L-R,ih=h-T-B;
  let mn=1e9,mx=-1e9;for(const e of rt.ele){if(e<mn)mn=e;if(e>mx)mx=e;}
  const span=Math.max(40,mx-mn),lo=mn-span*.08,hi=lo+span*1.2;
  const X=x=>L+x/rt.dist*iw,Y=e=>T+ih-(e-lo)/(hi-lo)*ih;
  const N=Math.max(2,Math.min(rt.ele.length,Math.floor(iw))),pts=[];
  for(let k=0;k<N;k++){const x=k/(N-1)*rt.dist;pts.push([X(x),Y(eleAt(rt,x)),x]);}
  ctx.font=`500 10px ${css('--mono')}`;ctx.fillStyle=css('--fg-3');ctx.textAlign='right';ctx.textBaseline='middle';
  ctx.strokeStyle=css('--line');ctx.lineWidth=1;
  [mn,mx].forEach(e=>{const y=Math.round(Y(e))+.5;ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.fillText(Math.round(e)+' m',L-6,y);});
  ctx.textBaseline='top';ctx.textAlign='left';ctx.fillText('0',L,h-B+6);ctx.textAlign='right';ctx.fillText(n1(rt.dist/1000)+' km',w-R,h-B+6);
  const area=(arr,col)=>{if(arr.length<2)return;ctx.beginPath();ctx.moveTo(arr[0][0],T+ih);arr.forEach(p=>ctx.lineTo(p[0],p[1]));ctx.lineTo(arr[arr.length-1][0],T+ih);ctx.closePath();ctx.fillStyle=col;ctx.fill();};
  const line=(arr,col,wd)=>{if(arr.length<2)return;ctx.beginPath();arr.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.strokeStyle=col;ctx.lineWidth=wd;ctx.lineJoin='round';ctx.stroke();};
  const done=pts.filter(p=>p[2]<=d);const px=X(d),py=Y(eleAt(rt,d));done.push([px,py,d]);
  if(pv){const g=ctx.createLinearGradient(0,T,0,T+ih);g.addColorStop(0,css('--accent-line'));g.addColorStop(1,'rgba(167,139,250,0)');area(pts,g);line(pts,css('--accent'),2);}
  else{area(pts,css('--surface-2'));line(pts,css('--line-2'),1.4);
  area(done,css('--accent-soft'));line(done,css('--accent'),2);}
  ctx.beginPath();ctx.arc(px,py,5.5,0,7);ctx.fillStyle=css('--surface');ctx.fill();
  ctx.beginPath();ctx.arc(px,py,4,0,7);ctx.fillStyle=css('--accent');ctx.fill();
}
/* Streckenverlauf ohne Kartenkacheln */
function drawMap(c,rt,d,pv){
  const{ctx,w,h}=prep(c);if(w<10)return;
  let a=90,b=-90,l=180,r=-180;for(const p of rt.line){if(p[0]<a)a=p[0];if(p[0]>b)b=p[0];if(p[1]<l)l=p[1];if(p[1]>r)r=p[1];}
  const kx=Math.cos((a+b)/2*Math.PI/180),W=(r-l)*kx||1e-6,H=(b-a)||1e-6,pad=12;
  const sc=Math.min((w-2*pad)/W,(h-2*pad)/H),ox=(w-W*sc)/2,oy=(h-H*sc)/2;
  const P=p=>[ox+(p[1]-l)*kx*sc,oy+(b-p[0])*sc];
  const pos=posAt(rt,d),t=clamp(d/rt.dist,0,1)*rt.cum[rt.cum.length-1];
  ctx.lineJoin='round';ctx.lineCap='round';
  ctx.beginPath();rt.line.forEach((p,i)=>{const q=P(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.strokeStyle=css(pv?'--accent':'--line-2');ctx.lineWidth=pv?2.4:2;ctx.stroke();
  ctx.beginPath();let first=true;for(let i=0;i<rt.line.length&&rt.cum[i]<=t;i++){const q=P(rt.line[i]);first?ctx.moveTo(q[0],q[1]):ctx.lineTo(q[0],q[1]);first=false;}
  const cp=P(pos);if(!first){ctx.lineTo(cp[0],cp[1]);ctx.strokeStyle=css('--accent');ctx.lineWidth=2.5;ctx.stroke();}
  const s0=P(rt.line[0]);ctx.beginPath();ctx.arc(s0[0],s0[1],3,0,7);ctx.fillStyle=css('--fg-3');ctx.fill();
  ctx.beginPath();ctx.arc(cp[0],cp[1],6,0,7);ctx.fillStyle=css('--surface');ctx.fill();
  ctx.beginPath();ctx.arc(cp[0],cp[1],4.5,0,7);ctx.fillStyle=css('--accent');ctx.fill();
}
