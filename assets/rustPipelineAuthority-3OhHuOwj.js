import{b as rt,x as ie}from"./index-B4fxzHFJ.js";import{readPersistedRustArtifact as le}from"./rustPipelineRuntime-8hR7xmiU.js";function Ft(t,n){return t.dx===void 0?t.x:(n?n(t.x):t.x)+t.dx}function Ve(t,n,e,o){const s=Math.max(0,o);let c,l=Number.POSITIVE_INFINITY;for(const i of t){if(e<i.y||e>i.y+i.h)continue;const p=Math.min(i.x,i.x+i.w),h=Math.max(i.x,i.x+i.w),f=n<p?p-n:n>h?n-h:0;if(f===0)return i;f<=s&&f<l&&(c=i,l=f)}return c}const Bt="system-ui, sans-serif";function z(t){return Math.round(t*100)/100}function Dt(t){return t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,"�").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function ce(t){const n=/\bbold\b/i.test(t)?"bold":"normal",e=t.match(/(\d+(?:\.\d+)?)px/),o=e?`${e[1]}px`:"13px";let s=Bt;if(e){const c=t.slice(t.indexOf(e[0])+e[0].length).trim();c&&(s=c)}return{fontSize:o,fontWeight:n,fontFamily:s}}function pe(t){return t==="start"?"start":t==="middle"?"middle":"end"}function fe(t){return t==="top"?"hanging":t==="middle"?"central":"alphabetic"}function de(t){const n=[`x="${z(t.x)}"`,`y="${z(t.y)}"`,`width="${z(Math.max(t.w,0))}"`,`height="${z(Math.max(t.h,0))}"`,`fill="${t.fill??"none"}"`];return t.alpha!==void 0&&t.alpha<1&&n.push(`fill-opacity="${z(t.alpha)}"`),t.stroke&&n.push(`stroke="${t.stroke}"`,`stroke-width="${t.strokeWidth??1}"`),`<rect ${n.join(" ")} />`}function ue(t){const{fontSize:n,fontWeight:e,fontFamily:o}=ce(t.font);return`<text ${[`x="${z(Ft(t))}"`,`y="${z(t.y)}"`,`fill="${t.fill}"`,`font-size="${n}"`,`font-weight="${e}"`,`font-family="${Dt(o)}"`,`text-anchor="${pe(t.anchor)}"`,`dominant-baseline="${fe(t.baseline)}"`].join(" ")}>${Dt(t.text)}</text>`}function me(t){const n=[`x1="${z(t.x1)}"`,`y1="${z(t.y1)}"`,`x2="${z(t.x2)}"`,`y2="${z(t.y2)}"`,`stroke="${t.stroke}"`,`stroke-width="${t.strokeWidth??1}"`];return t.dash&&t.dash.length&&n.push(`stroke-dasharray="${t.dash.join(",")}"`),`<line ${n.join(" ")} />`}function he(t){const e=[`points="${t.points.map(([o,s])=>`${z(o)},${z(s)}`).join(" ")}"`,`fill="${t.fill??"none"}"`];return t.stroke&&e.push(`stroke="${t.stroke}"`,`stroke-width="${t.strokeWidth??1}"`),t.closed?`<polygon ${e.join(" ")} />`:`<polyline ${e.join(" ")} />`}function ge(t){switch(t.type){case"rect":return de(t);case"text":return ue(t);case"line":return me(t);case"poly":return he(t)}}function ve(t){const n=t.primitives.map(ge).join(`
  `);return`<svg xmlns="http://www.w3.org/2000/svg" width="${t.width}" height="${t.height}" viewBox="0 0 ${t.width} ${t.height}" font-family="${Bt}">
  ${n}
</svg>
`}function wt(t){return new Blob([ve(t)],{type:"image/svg+xml"})}const ft="the loop bound `i + 1 < length` keeps both indices inside the array";function ye(t,n){for(const e of n.primitives)e.type==="rect"?(t.globalAlpha=e.alpha??1,e.fill&&(t.fillStyle=e.fill,t.fillRect(e.x,e.y,e.w,e.h)),e.stroke&&(t.strokeStyle=e.stroke,t.lineWidth=e.strokeWidth??1,t.setLineDash([]),t.strokeRect(e.x,e.y,e.w,e.h)),t.globalAlpha=1):e.type==="text"?(t.font=e.font,t.fillStyle=e.fill,t.textAlign=e.anchor==="start"?"left":e.anchor==="middle"?"center":"right",t.textBaseline=e.baseline,t.fillText(e.text,Ft(e),e.y)):e.type==="line"?(t.strokeStyle=e.stroke,t.lineWidth=e.strokeWidth??1,t.setLineDash(e.dash??[]),t.beginPath(),t.moveTo(e.x1,e.y1),t.lineTo(e.x2,e.y2),t.stroke(),t.setLineDash([])):(t.beginPath(),e.points.forEach(([o,s],c)=>c===0?t.moveTo(o,s):t.lineTo(o,s)),e.closed&&t.closePath(),e.fill&&(t.fillStyle=e.fill,t.fill()),e.stroke&&(t.strokeStyle=e.stroke,t.lineWidth=e.strokeWidth??1,t.stroke()));t.textBaseline="alphabetic",t.textAlign="left"}const _t="#222222",et={Games:"#e6194b","Video Players (e.g. YouTube)":"#4363d8","Social & Communication":"#fabed4",Entertainment:"#f58231",Lifestyle:"#42d4f4","Productivity & Business":"#aaffc3",Health:"#469990",Education:"#800000","Travel & Local":"#9a6324","News & Magazines":"#dcbeff",Photography:"yellow","System / OEM":"#a9a9a9",Uncategorised:_t,Unknown:"#555555"},xe={GAMING:"Games",GAME:"Games",VIDEO:"Video Players (e.g. YouTube)",VIDEO_PLAYERS:"Video Players (e.g. YouTube)",COMMUNICATION:"Social & Communication",SOCIAL:"Social & Communication",SOCIAL_AND_COMMUNICATION:"Social & Communication",PRODUCTIVITY_AND_BUSINESS:"Productivity & Business",PRODUCTIVITY:"Productivity & Business",UTILITIES:"Productivity & Business",TOOLS:"Productivity & Business",LIFESTYLE_MANAGEMENT:"Lifestyle",ARTS_AND_LEISURE:"Entertainment",KNOWLEDGE_AND_INFORMATION:"Education",SYSTEM_OEM:"System / OEM",OTHER:"Uncategorised"};function Yt(t){return t.trim().toUpperCase().replace(/&/g,"AND").replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"")}const we=(()=>{const t=new Map;for(const[n,e]of Object.entries(et))t.set(Yt(n),e);for(const[n,e]of Object.entries(xe))t.set(n,et[e]??_t);return t})();function zt(t){return t==null?et.Unknown:et[t]??we.get(Yt(t))??_t}const mt="#808080",bt="App Usage",it="Filtered App Usage",St="Filtered App Background Usage",_e="Filtered App Usage event",dt="Device Shutdown",ut="Device Startup",Gt="End of Usage Missing",X=1800,A=28,b={top:60,right:260,bottom:60,left:160},nt="13px system-ui, sans-serif",Q="11px system-ui, sans-serif",Xt="9px system-ui, sans-serif",Ot=new Map,Rt=new Map;function ht(t){let n=Ot.get(t);return n||(n=new Intl.DateTimeFormat("en-US",{timeZone:t,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1}),Ot.set(t,n)),n}function Tt(t){let n=Rt.get(t);return n||(n=new Intl.DateTimeFormat("sv",{timeZone:t}),Rt.set(t,n)),n}function lt(t){const n=ht(t),e=Tt(t),o=new Map,s=new Map,c=new Map,l=f=>e.format(new Date(f));function i(f){let r=o.get(f);return r===void 0&&(r=l(Number(f/1000000n)),o.set(f,r)),r}function p(f){let r=c.get(f);if(r===void 0){const d=H(f)*864e5;let T=d-15*36e5,v=d+13*36e5;for(;v-T>1e3;){const u=T+Math.floor((v-T)/2e3)*1e3;l(u)>=f?v=u:T=u}r=v,c.set(f,r)}return r}function h(f){let r=s.get(f);if(r===void 0){const d=Number(f/1000000n);try{const T=Math.floor((d-p(i(f)))/1e3);r=Math.floor(T/3600)+Math.floor(T%3600/60)/60+T%60/3600}catch{r=d/36e5%24}s.set(f,r)}return r}return{iso:i,hours:h,dayHours:f=>(p(be(H(f)+1))-p(f))/36e5,clockMinutes:(f,r)=>{const d=n.formatToParts(new Date(p(f)+r*36e5));return Number(d.find(v=>v.type==="hour")?.value??0)%24*60+Number(d.find(v=>v.type==="minute")?.value??0)}}}function be(t){return new Date(t*864e5).toISOString().slice(0,10)}function jt(t,n,e){const o=s=>e.format(new Date(Number(s/1000000n)));for(const s of n){if(s.start_timestamp_ns===null||s.stop_timestamp_ns===null)continue;const c=o(s.start_timestamp_ns),l=H(c),i=H(o(s.stop_timestamp_ns));for(let p=l;p<=i;p++)t.add(p===l?c:new Date(p*864e5).toISOString().slice(0,10))}}function H(t){const[n,e,o]=t.split("-").map(Number);return Math.floor(Date.UTC(n,e-1,o)/864e5)}function gt(t){return new Date(t+"T12:00:00Z").toLocaleDateString("en-US",{year:"numeric",month:"short",day:"2-digit",weekday:"short",timeZone:"UTC"})}function V(t,n){const e=Number(n/1000000n);try{const o=t.formatToParts(new Date(e)),s=String(Number(o.find(i=>i.type==="hour")?.value??0)%24).padStart(2,"0"),c=(o.find(i=>i.type==="minute")?.value??"00").padStart(2,"0"),l=(o.find(i=>i.type==="second")?.value??"00").padStart(2,"0");return`${s}:${c}:${l}`}catch{return""}}function Se(t,n,e,o,s){const c=V(t,e),l=V(t,s);return n===o?`${n} ${c} → ${l}`:`${n} ${c} → ${o} ${l}`}function Te(t,n){if(typeof OffscreenCanvas<"u")return new OffscreenCanvas(t,n);const e=document.createElement("canvas");return e.width=t,e.height=n,e}function B(){return X-b.left-b.right}function kt(t){return b.top+t*20+40+b.bottom}function O(t){return b.left+t/24*B()}function ke(t,n){return`App Usage for ${t}${n?" (Including Filtered Apps)":" (Excluding Filtered Apps)"}`}function Vt(t,n,e,o){return[{type:"text",x:X/2,y:28,text:t,fill:"#111",font:"bold 16px system-ui, sans-serif",anchor:"middle",baseline:"alphabetic"},{type:"text",x:X/2,y:46,text:`Created on ${n} · Preprocessor v${e} · build ${ie} · ${o}`,fill:"#666",font:Q,anchor:"middle",baseline:"alphabetic"}]}const ct=12,J=20;function K(t,n,e,o,s={}){return[{type:"rect",x:t,y:n-ct/2,w:ct,h:ct,fill:e,...s.alpha!==void 0?{alpha:s.alpha}:{},...s.outline?{stroke:"#aaa",strokeWidth:.5}:{}},{type:"text",x:t+ct+5,y:n,text:o,fill:"#333",font:Q,anchor:"start",baseline:"middle"}]}function Ae(t,n,e,o,s,c=0){const l=X-b.right+16+c;let i=t;const p=[],h=f=>{p.push({type:"text",x:l,y:i,text:f,fill:"#333",font:"bold 12px system-ui, sans-serif",anchor:"start",baseline:"middle"})};h("App Categories"),i+=J+4;for(const[f,r]of Object.entries(et))p.push(...K(l,i,r,f,{outline:!0})),i+=J;return(s||n||e||o)&&(i+=6,h("Events & Gaps"),i+=J+4),s&&(p.push(...K(l,i,mt,"Data Gap",{alpha:.35})),i+=J),n&&(p.push(...K(l,i,"red","Device Shutdown")),i+=J),e&&(p.push(...K(l,i,"green","Device Startup")),i+=J),o&&p.push(...K(l,i,"#888","End of Usage Missing")),p}function pt(t,n,e){return[{type:"line",x1:t,y1:n-10/2,x2:t,y2:n+10/2,stroke:e,strokeWidth:2},{type:"poly",points:[[t-5/2,n+10/2-5],[t,n+10/2],[t+5/2,n+10/2-5]],fill:e,closed:!0}]}function Jt(t,n,e,o,s,c,l=()=>24){const i=3600000000000n,p=[];let h=!1;for(let f=0;f+1<t.length;f++){const r=rt(t[f],ft),d=rt(t[f+1],ft);if(d-r<=i)continue;h=!0;const v=e(r),u=e(d),y=o(r),I=o(d),_=x=>{p.push(x)};if(y===I){const x=n.get(y);if(x!==void 0){const N=O(v);_({x:N,y:x-A/2,w:O(u)-N,h:A})}}else{const x=n.get(y);if(x!==void 0){const a=O(v);_({x:a,y:x-A/2,w:O(l(y))-a,h:A})}const N=H(y),D=H(I);for(let a=N+1;a<D;a++){const m=new Date(a*864e5).toISOString().slice(0,10),S=n.get(m);S!==void 0&&_({x:b.left,y:S-A/2,w:B()*l(m)/24,h:A})}const w=n.get(I);w!==void 0&&_({x:b.left,y:w-A/2,w:O(u)-b.left,h:A})}}return{rects:p,hadGap:h}}function Zt(t){return t.map(n=>({type:"rect",x:n.x,y:n.y,w:n.w,h:n.h,fill:mt,alpha:.15}))}const k={width:1200,gutter:112,padRight:0,padTop:6,padBottom:10,rowH:32};function tt(){return k.width-k.gutter-k.padRight}function F(t){return k.gutter+t/24*tt()}const Je={width:k.width,gutter:k.gutter,get plotWidth(){return tt()},hoursToX:F};function Kt(t,n,e,o,s=[]){if(t.length===0&&s.length===0)return{width:1,height:1,primitives:[]};const c=ht(e),l=lt(e),i=l.hours,p=l.iso,h=new Set;let f=Number.POSITIVE_INFINITY,r=Number.NEGATIVE_INFINITY;for(const a of t){const m=p(a.startNs),S=p(a.stopNs),R=H(m),g=H(S);f=Math.min(f,R,g),r=Math.max(r,R,g);for(let E=R;E<=g;E++)h.add(E===R?m:new Date(E*864e5).toISOString().slice(0,10))}for(const a of s){const m=p(a.ns);h.add(m);const S=H(m);f=Math.min(f,S),r=Math.max(r,S)}for(const a of n){const m=p(a);h.add(m);const S=H(m);f=Math.min(f,S),r=Math.max(r,S)}if(Number.isFinite(f)&&Number.isFinite(r))for(let a=f;a<=r;a++)h.add(new Date(a*864e5).toISOString().slice(0,10));const d=[...h].sort(),T=k.padTop+d.length*k.rowH+k.padBottom,v=It(d,l,tt()),u=k.width+v,y=d.map((a,m)=>{const S=Et(l,a);return{date:a,y:k.padTop+m*k.rowH,h:k.rowH,...S?{dst:S}:{}}}),I=new Map;d.forEach((a,m)=>{I.set(a,k.padTop+m*k.rowH+k.rowH/2)});const _=[{type:"rect",x:0,y:0,w:u,h:T,fill:"#ffffff"}];for(const[a,m]of d.entries())_.push({type:"text",x:k.gutter-10,y:k.padTop+a*k.rowH+k.rowH/2,text:gt(m),fill:"#555",font:Q,anchor:"end",baseline:"middle"});for(let a=1;a<d.length;a++){const m=k.padTop+a*k.rowH;_.push({type:"line",x1:0,y1:m,x2:u,y2:m,stroke:"#e4e7eb",strokeWidth:1})}for(const a of y)a.dst&&_.push(...Nt(a.dst,a.y,a.h,F));const x=[],N=n.slice().sort((a,m)=>a<m?-1:a>m?1:0),D=3600000000000n,w=(a,m)=>{_.push({type:"rect",x:a.x,y:a.y,w:a.w,h:a.h,fill:mt,alpha:.15}),o&&x.push({...a,title:"Data gap",lines:m,kind:"gap"})};for(let a=0;a+1<N.length;a++){const m=rt(N[a],ft),S=rt(N[a+1],ft),R=S-m;if(R<=D)continue;const g=p(m),E=p(S),$=Number(R)/6e10,Y=$>=60?`${($/60).toFixed(1)} h`:`${$.toFixed(1)} min`,L=g===E?`${g} ${V(c,m)} → ${V(c,S)}`:`${g} ${V(c,m)} → ${E} ${V(c,S)}`,M=[`No device events · ${Y}`,L];if(g===E){const P=I.get(g);if(P!==void 0){const W=F(i(m));w({x:W,y:P-k.rowH/2,w:F(i(S))-W,h:k.rowH},M)}}else{const P=I.get(g);if(P!==void 0){const U=F(i(m));w({x:U,y:P-k.rowH/2,w:F(l.dayHours(g))-U,h:k.rowH},M)}const W=H(g),G=H(E);for(let U=W+1;U<G;U++){const q=new Date(U*864e5).toISOString().slice(0,10),j=I.get(q);j!==void 0&&w({x:k.gutter,y:j-k.rowH/2,w:tt()*l.dayHours(q)/24,h:k.rowH},M)}const C=I.get(E);C!==void 0&&w({x:k.gutter,y:C-k.rowH/2,w:F(i(S))-k.gutter,h:k.rowH},M)}}for(const a of t){const m=p(a.startNs),S=p(a.stopNs),R=H(m),g=H(S),E=a.instant?`${m} ${V(c,a.startNs)}`:Se(c,m,a.startNs,S,a.stopNs);for(let $=R;$<=g;$++){const Y=$===R?m:new Date($*864e5).toISOString().slice(0,10),L=I.get(Y);if(L===void 0)continue;let M,P;if(a.instant?(M=F(i(a.startNs)),P=1):$===R&&$===g?(M=F(i(a.startNs)),P=F(Math.min(i(a.stopNs),l.dayHours(Y)))-M):$===R?(M=F(i(a.startNs)),P=F(l.dayHours(Y))-M):$===g?(M=k.gutter,P=F(i(a.stopNs))-M):(M=k.gutter,P=tt()*l.dayHours(Y)/24),P<=0)continue;const W=L-k.rowH*.35,G=Math.max(P,1),C=k.rowH*.7;_.push({type:"rect",x:M,y:W,w:G,h:C,fill:a.color}),o&&o.push({x:M,y:W,w:G,h:C,title:a.title,lines:[...a.detail,E],fill:a.color,kind:"session"})}}for(const a of s){const m=p(a.ns),S=I.get(m);if(S===void 0)continue;const R=F(i(a.ns));_.push(...pt(R,S,a.color)),o&&o.push({x:R-8,y:S-10,w:16,h:20,title:a.title,lines:[...a.detail??[],`${m} ${V(c,a.ns)}`],fill:a.color,kind:"marker"})}return o&&o.push(...x),{width:u,height:T,primitives:_,meta:{kind:"waterfall",gutter:k.gutter,plotWidth:tt()+v,rows:y}}}function At(t,n=0){return{type:"rect",x:0,y:0,w:X+n,h:t,fill:"#ffffff"}}function Qt(t,n){const e=[];for(let o=0;o<=24;o+=4){const s=O(o);e.push({type:"line",x1:s,y1:t,x2:s,y2:n,stroke:"#cccccc",strokeWidth:1,dash:[4,4]}),e.push({type:"text",x:s,y:n+6,text:String(o).padStart(2,"0")+":00",fill:"#444",font:Q,anchor:"middle",baseline:"top"})}return e}function qt(t,n){const e=[];for(let o=1;o<t;o++){const s=n+o*A;e.push({type:"line",x1:b.left,y1:s,x2:b.left+B(),y2:s,stroke:"#cccccc",strokeWidth:1})}return e}function It(t,n,e){return(t.reduce((s,c)=>Math.max(s,n.dayHours(c)),24)-24)/24*e}function te(t){const n=Math.floor(t/60),e=t%60;return e===0?String(n):`${n}:${String(e).padStart(2,"0")}`}function Et(t,n){const e=t.dayHours(n);if(e===24)return;const o=[];for(let s=0;s<e;s++)o.push(te(t.clockMinutes(n,s)));return{dayHours:e,labels:o}}function Nt(t,n,e,o){const s=t.dayHours,c=[],l=o(s);return s<24&&c.push({type:"rect",x:l,y:n,w:o(24)-l,h:e,fill:"#f3f3f3"}),t.labels.forEach((i,p)=>{c.push({type:"text",x:o(p),dx:2,y:n+1,text:i,fill:"#888",font:Xt,anchor:"start",baseline:"top"})}),c.push({type:"line",x1:l,y1:n,x2:l,y2:n+e,stroke:"#666",strokeWidth:1.5}),c}function ee(t,n,e,o,s,c,l,i){const p=new Set;for(const g of n)g.date&&p.add(g.date);jt(p,n,Tt(e));const h=[...p].sort();if(h.length===0)return{width:1,height:1,primitives:[]};const f=h.length*A,r=Math.max(b.top+f+b.bottom,kt(Object.keys(et).length+6)),d=b.top,T=b.top+f,v=new Map;h.forEach((g,E)=>{v.set(g,d+E*A+A/2)}),ht(e);const u=lt(e),y=u.hours,I=u.iso,_=It(h,u,B()),x=[];x.push(At(r,_)),x.push(...Vt(ke(t,o.includeFilteredAppUsageInPlots),c,s,e)),h.forEach((g,E)=>{x.push({type:"text",x:b.left-8,y:d+E*A+A/2,text:gt(g),fill:"#555",font:nt,anchor:"end",baseline:"middle"})}),x.push(...qt(h.length,d)),x.push(...Qt(d,T)),h.forEach((g,E)=>{const $=Et(u,g);$&&x.push(...Nt($,d+E*A,A,O))});const N=(l??n.map(g=>g.event_timestamp_ns)).slice().sort((g,E)=>g<E?-1:g>E?1:0),{rects:D,hadGap:w}=Jt(N,v,y,I,void 0,void 0,u.dayHours);x.push(...Zt(D));const a=new Set([bt]);o.includeFilteredAppUsageInPlots&&(a.add(it),a.add(St));for(const g of n){if(!a.has(g.interaction_type))continue;const E=zt(g.broad_app_category);if(g.start_timestamp_ns===null||g.stop_timestamp_ns===null){if(g.interaction_type!==it)continue;const P=I(g.event_timestamp_ns),W=v.get(P)??v.get(g.date);if(W===void 0)continue;const G=O(y(g.event_timestamp_ns)),C=W-A*.35;x.push({type:"rect",x:G,y:C,w:2,h:A*.7,fill:E});continue}const $=I(g.start_timestamp_ns),Y=I(g.stop_timestamp_ns),L=H($),M=H(Y);for(let P=L;P<=M;P++){const W=P===L?$:new Date(P*864e5).toISOString().slice(0,10),G=v.get(W);if(G===void 0)continue;let C,U;const q=u.dayHours(W);if(P===L&&P===M){const j=y(g.start_timestamp_ns),vt=y(g.stop_timestamp_ns);C=O(j),U=O(Math.min(vt,q))-C}else if(P===L){const j=y(g.start_timestamp_ns);C=O(j),U=O(q)-C}else if(P===M){const j=y(g.stop_timestamp_ns);C=b.left,U=O(j)-C}else C=b.left,U=B()*q/24;if(U>0){const j=G-A*.35,vt=Math.max(U,1),re=A*.7;x.push({type:"rect",x:C,y:j,w:vt,h:re,fill:E})}}}let m=!1,S=!1,R=!1;for(const g of n){const{interaction_type:E,event_timestamp_ns:$,date:Y}=g;if(E!==dt&&E!==ut&&E!==Gt)continue;const L=v.get(Y);if(L===void 0)continue;const M=O(y($));E===dt?(x.push(...pt(M,L,"red")),m=!0):E===ut?(x.push(...pt(M,L,"green")),S=!0):(x.push(...pt(M,L,"#888")),R=!0)}return x.push({type:"rect",x:b.left,y:d,w:B(),h:f,stroke:"#ccc",strokeWidth:1}),x.push({type:"text",x:b.left+B()/2,y:T+b.bottom-10,text:"Time of Day (Hours)",fill:"#444",font:nt,anchor:"middle",baseline:"alphabetic"}),x.push(...Ae(d,m,S,R,w,_)),{width:X+_,height:r,primitives:x}}function ot(){return new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}async function Mt(t){const n=Te(Math.max(t.width,X),t.height),e=n.getContext("2d");return ye(e,t),Ee(n)}async function Ie(t,n,e,o,s,c){const l=ee(t,n,e,o,s,ot(),c);return Mt(l)}async function Ee(t){return t instanceof OffscreenCanvas?t.convertToBlob({type:"image/png"}):new Promise((n,e)=>{t.toBlob(o=>o?n(o):e(new Error("toBlob returned null")),"image/png")})}const ne="#9E9E9E",st={probable_manual_lock:"#4CAF50",probable_auto_lock:"#2196F3",app_kept_awake_or_extended:"#FF9800",lock_screen_only:"#9C27B0",extended_idle_or_unknown:"#607D8B",unknown:ne,missing_stop:"#F44336"},oe={probable_manual_lock:"Probable manual lock",probable_auto_lock:"Probable auto-lock",app_kept_awake_or_extended:"App kept awake / extended",lock_screen_only:"Lock screen only",extended_idle_or_unknown:"Extended idle / unknown",unknown:"Unknown",missing_stop:"Missing stop"};function se(t,n,e,o,s,c,l){const i=new Set;for(const w of n)w.date&&i.add(w.date);jt(i,n,Tt(e));const p=[...i].sort();if(p.length===0)return{width:1,height:1,primitives:[]};const h=p.length*A,f=Math.max(b.top+h+b.bottom,kt(Object.keys(st).length+3)),r=b.top,d=b.top+h,T=new Map;p.forEach((w,a)=>{T.set(w,r+a*A+A/2)}),ht(e);const v=lt(e),u=v.hours,y=v.iso,I=It(p,v,B()),_=[];_.push(At(f,I)),_.push(...Vt(`Screen Usage for ${t}`,s,o,e)),p.forEach((w,a)=>{_.push({type:"text",x:b.left-8,y:r+a*A+A/2,text:gt(w),fill:"#555",font:nt,anchor:"end",baseline:"middle"})}),_.push(...qt(p.length,r)),_.push(...Qt(r,d)),p.forEach((w,a)=>{const m=Et(v,w);m&&_.push(...Nt(m,r+a*A,A,O))});const x=(c??n.map(w=>w.event_timestamp_ns)).slice().sort((w,a)=>w<a?-1:w>a?1:0),{rects:N,hadGap:D}=Jt(x,T,u,y,void 0,void 0,v.dayHours);_.push(...Zt(N));for(const w of n){if(w.start_timestamp_ns===null||w.stop_timestamp_ns===null)continue;const a=w.screen_usage_end_reason??"unknown",m=st[a]??st.unknown,S=y(w.start_timestamp_ns),R=y(w.stop_timestamp_ns),g=H(S),E=H(R);for(let $=g;$<=E;$++){const Y=$===g?S:new Date($*864e5).toISOString().slice(0,10),L=T.get(Y);if(L===void 0)continue;let M,P;const W=v.dayHours(Y);if($===g&&$===E?(M=O(u(w.start_timestamp_ns)),P=O(Math.min(u(w.stop_timestamp_ns),W))-M):$===g?(M=O(u(w.start_timestamp_ns)),P=O(W)-M):$===E?(M=b.left,P=O(u(w.stop_timestamp_ns))-M):(M=b.left,P=B()*W/24),P>0){const G=L-A*.35,C=Math.max(P,1),U=A*.7;_.push({type:"rect",x:M,y:G,w:C,h:U,fill:m})}}}return _.push({type:"rect",x:b.left,y:r,w:B(),h,stroke:"#ccc",strokeWidth:1}),_.push({type:"text",x:b.left+B()/2,y:d+b.bottom-10,text:"Time of Day (Hours)",fill:"#444",font:nt,anchor:"middle",baseline:"alphabetic"}),_.push(...Ne(r,D,I)),{width:X+I,height:f,primitives:_}}function Ne(t,n,e=0){const o=X-b.right+16+e;let s=t;const c=[{type:"text",x:o,y:s,text:"End Reason",fill:"#333",font:"bold 12px system-ui, sans-serif",anchor:"start",baseline:"middle"}];s+=J+4;for(const[l,i]of Object.entries(st))c.push(...K(o,s,i,oe[l]??l,{outline:!0})),s+=J;return n&&(s+=6,c.push(...K(o,s,mt,"Data Gap",{alpha:.35}))),c}async function Me(t,n,e,o,s){return Mt(se(t,n,e,o,ot(),s))}function Z(t){const n=new Map;for(const e of t){const o=e.participant_id??"unknown",s=n.get(o)??[];s.push(e),n.set(o,s)}return n}async function Pe(t,n,e,o){const s=new Map;for(const[c,l]of Z(t)){const i=o?.get(c);s.set(c,await Me(c,l,n,e,i))}return s}function $e(t,n,e,o){const s=ot(),c=new Map;for(const[l,i]of Z(t)){const p=se(l,i,n,e,s,o?.get(l));c.set(l,wt(p))}return Promise.resolve(c)}async function De(t,n,e,o,s){const c=new Map;for(const[l,i]of Z(t)){const p=s?.get(l);c.set(l,await Ie(l,i,n,e,o,p))}return c}function Oe(t,n,e,o,s){const c=ot(),l=new Map;for(const[i,p]of Z(t)){const h=ee(i,p,n,e,o,c,s?.get(i));l.set(i,wt(h))}return Promise.resolve(l)}function Ht(t,n,e,o,s,c=e.includeFilteredAppUsageInPlots){const l=[],i=new Set([bt]);c&&(i.add(it),i.add(St));for(const[p,h]of Z(t)){const f=[],r=[],d=[];for(const u of h){if(u.interaction_type===dt||u.interaction_type===ut||u.interaction_type===Gt){const m=u.interaction_type===dt?"red":u.interaction_type===ut?"green":"#888";d.push({ns:u.event_timestamp_ns,color:m,title:u.interaction_type});continue}if(!i.has(u.interaction_type))continue;const y=u.broad_app_category??"Unknown",I=zt(y),_=u.application_label?.trim(),x=u.app_package_name||"(app)",N=_||x,D=_&&_!==x?[x]:[];if(u.start_timestamp_ns===null||u.stop_timestamp_ns===null){if(u.interaction_type!==it)continue;r.push({startNs:u.event_timestamp_ns,stopNs:u.event_timestamp_ns,instant:!0,color:I,title:N,detail:[...D,y,_e]});continue}const w=Number(u.stop_timestamp_ns-u.start_timestamp_ns)/6e10,a=_&&_!==x?[x,y,`${w.toFixed(1)} min · ${u.interaction_type}`]:[y,`${w.toFixed(1)} min · ${u.interaction_type}`];r.push({startNs:u.start_timestamp_ns,stopNs:u.stop_timestamp_ns,color:I,title:N,detail:a})}const T=s?.get(p)??h.map(u=>u.event_timestamp_ns),v=Kt(r,T,n,f,d);l.push({participantId:p,scene:v,regions:f})}return l}function Re(t,n,e,o){const s=[];for(const[c,l]of Z(t)){const i=[],p=[];for(const r of l){if(r.start_timestamp_ns===null||r.stop_timestamp_ns===null)continue;const d=r.screen_usage_end_reason??"unknown",T=Number(r.stop_timestamp_ns-r.start_timestamp_ns)/6e10;p.push({startNs:r.start_timestamp_ns,stopNs:r.stop_timestamp_ns,color:st[d]??ne,title:"Screen",detail:[oe[d]??d,`${T.toFixed(1)} min`]})}const h=o?.get(c)??l.map(r=>r.event_timestamp_ns),f=Kt(p,h,n,i);s.push({participantId:c,scene:f,regions:i})}return s}function He(t,n,e={includeFilteredAppUsageInPlots:!1}){const o=lt(n),s=o.iso,c=new Set([bt]);e.includeFilteredAppUsageInPlots&&(c.add(it),c.add(St));const l=new Set;for(const r of t){if(!c.has(r.interaction_type)||r.start_timestamp_ns===null||r.stop_timestamp_ns===null)continue;const d=H(s(r.start_timestamp_ns)),T=H(s(r.stop_timestamp_ns));for(let v=d;v<=T;v++)l.add(v===d?s(r.start_timestamp_ns):new Date(v*864e5).toISOString().slice(0,10))}const i=[...l].sort(),p=new Map(i.map((r,d)=>[r,d])),h=i.map(r=>new Array(Math.ceil(o.dayHours(r))).fill(0));for(const r of t){if(!c.has(r.interaction_type)||r.start_timestamp_ns===null||r.stop_timestamp_ns===null)continue;const d=s(r.start_timestamp_ns),T=s(r.stop_timestamp_ns),v=H(d),u=H(T);for(let y=v;y<=u;y++){const I=y===v?d:new Date(y*864e5).toISOString().slice(0,10),_=p.get(I);if(_===void 0)continue;const x=rt(h[_],"`cells` has one row per entry of `dates`, which is what `dateIndex` indexes");let N,D;const w=o.dayHours(I);if(y===v&&y===u?(N=o.hours(r.start_timestamp_ns),D=o.hours(r.stop_timestamp_ns)):y===v?(N=o.hours(r.start_timestamp_ns),D=w):y===u?(N=0,D=o.hours(r.stop_timestamp_ns)):(N=0,D=w),!(D<=N))for(let a=Math.floor(N);a<Math.ceil(D)&&a<x.length;a++){const m=Math.min(D,a+1)-Math.max(N,a);m>0&&(x[a]=(x[a]??0)+m*3600)}}}let f=0;for(const r of h)for(const d of r)d>f&&(f=d);return{dates:i,cells:h,maxCell:f}}function Ce(t){if(!(t>0))return{max:"0 min",min:"0 min"};if(t<60)return t<.05?{max:"<0.1 s",min:"0 s"}:{max:`${t<10?t.toFixed(1).replace(/\.0$/,""):String(Math.round(t))} s`,min:"0 s"};const n=t/60;return{max:n<10?`${n.toFixed(1)} min`:`${Math.round(n)} min`,min:"0 min"}}function Ct(t){const n=Math.max(0,Math.min(1,t)),e=Math.round(255+-247*n),o=Math.round(255+-174*n),s=Math.round(255+-99*n);return`rgb(${e}, ${o}, ${s})`}function ae(t,n,e,o,s,c){const{dates:l,cells:i,maxCell:p}=He(n,e,o);if(l.length===0||p===0)return{width:1,height:1,primitives:[]};const h=lt(e),f=l.length*A,r=Math.max(b.top+f+b.bottom,kt(8)),d=b.top,T=b.top+f,v=B()/24,u=(i.reduce((a,m)=>Math.max(a,m.length),24)-24)*v,y=[];y.push(At(r,u)),y.push({type:"text",x:b.left,y:28,text:`${t} — Hourly Activity Heatmap`,fill:"#222",font:"bold 18px system-ui, sans-serif",anchor:"start",baseline:"alphabetic"}),y.push({type:"text",x:b.left,y:46,text:`Generated ${c} · v${s} · ${e}`,fill:"#777",font:Q,anchor:"start",baseline:"alphabetic"});for(let a=0;a<l.length;a++){const m=d+a*A,S=i[a];if(S===void 0)continue;for(let g=0;g<S.length;g++)y.push({type:"rect",x:O(g),y:m,w:v,h:A,fill:Ct((S[g]??0)/p)});const R=l[a];R!==void 0&&h.dayHours(R)!==24&&y.push(...Le(h,R,S,p,m,v))}l.forEach((a,m)=>{y.push({type:"text",x:b.left-8,y:d+m*A+A/2,text:gt(a),fill:"#555",font:nt,anchor:"end",baseline:"middle"})});for(let a=0;a<=24;a+=2)y.push({type:"text",x:O(a),y:d-6,text:String(a),fill:"#666",font:Q,anchor:"middle",baseline:"alphabetic"});y.push({type:"rect",x:b.left,y:d,w:B(),h:f,stroke:"#ccc",strokeWidth:1}),y.push({type:"text",x:b.left+B()/2,y:T+b.bottom-10,text:"Time of Day (Hours)",fill:"#444",font:nt,anchor:"middle",baseline:"alphabetic"});const I=X-b.right+24+u,_=d,x=Math.min(f,200),N=32;for(let a=0;a<N;a++){const m=1-a/(N-1);y.push({type:"rect",x:I,y:_+a/N*x,w:16,h:x/N+1,fill:Ct(m)})}const D=(a,m,S)=>({type:"text",x:a,y:m,text:S,fill:"#555",font:Q,anchor:"start",baseline:"middle"}),w=Ce(p);return y.push(D(I+22,_,w.max)),y.push(D(I+22,_+x,w.min)),y.push(D(I,_-12,"App usage / hour")),{width:X+u,height:r,primitives:y}}function Le(t,n,e,o,s,c){const l=[],i=t.dayHours(n),p=Math.max(24,e.length);if(i<p){const h=O(i);l.push({type:"rect",x:h,y:s,w:O(p)-h,h:A,fill:"#e6e6e6"})}for(let h=0;h<e.length;h++){const f=t.clockMinutes(n,h),r=h===0?0:(t.clockMinutes(n,h-1)+60)%1440,d=((f-r)%1440+1440+720)%1440-720;if(d===0)continue;const T=te(f);let v;if(d<0)v=d===-60?`${T} (repeat)`:`${T} −${-d}m`;else if(d%60===0&&r%60===0){const u=r/60,y=(u+d/60-1)%24;v=`${T} (${u===y?u:`${u}–${y}`} skip)`}else v=`${T} +${d}m`;l.push({type:"text",x:O(h)+c/2,y:s+A/2,text:v,fill:(e[h]??0)/o>.5?"#fff":"#333",font:Xt,anchor:"middle",baseline:"middle"})}return l}async function We(t,n,e,o,s){return Mt(ae(t,n,e,o,s,ot()))}async function Ue(t,n,e,o){const s=new Map;for(const[c,l]of Z(t))s.set(c,await We(c,l,n,e,o));return s}function Fe(t,n,e,o){const s=ot(),c=new Map;for(const[l,i]of Z(t))c.set(l,wt(ae(l,i,n,e,o,s)));return Promise.resolve(c)}const Be=`// Runtime for the exported standalone timeline viewer (#18).
//
// This file is inlined verbatim into the exported .html (via \`?raw\`) as a
// classic <script>, so it must run in any browser straight from \`file://\`
// with no modules, no imports, and no network. It is a faithful vanilla-JS
// port of the in-app \`InteractiveScene\` (TimelineViewPanel.tsx): each
// participant canvas renders fit-to-width, the page scrolls vertically, and
// hover hit-testing reads the same \`SceneRegion\` boxes embedded as JSON.
//
// Kept as a real .js file (not a template literal) so \`node --check\` and the
// e2e "open the export and exercise it" test can catch errors in it.
(function () {
  "use strict";

  var dataEl = document.getElementById("tv-data");
  if (!dataEl) return;
  var DATA = JSON.parse(dataEl.textContent || "{}");
  DATA.app = DATA.app || [];
  DATA.screen = DATA.screen || [];

  var MAX_ROW_ZOOM = 24;
  var HOVER_HIT_RADIUS_CSS_PX = 2;

  function rowAtY(meta, y) {
    if (!meta) return null;
    for (var i = 0; i < meta.rows.length; i++) {
      var row = meta.rows[i];
      if (y >= row.y && y < row.y + row.h) return i;
    }
    return null;
  }

  function clampRowTransform(meta, transform) {
    var zoom = Math.max(1, Math.min(MAX_ROW_ZOOM, transform.zoom));
    if (zoom <= 1.001) return { zoom: 1, offset: 0 };
    var minOffset = meta.plotWidth - meta.plotWidth * zoom;
    return { zoom: zoom, offset: Math.min(0, Math.max(minOffset, transform.offset)) };
  }

  function transformX(x, meta, transform) {
    return meta.gutter + (x - meta.gutter) * transform.zoom + transform.offset;
  }

  function inverseTransformX(x, meta, transform) {
    return meta.gutter + (x - meta.gutter - transform.offset) / transform.zoom;
  }

  function findNearestRegion(regions, x, y, maxHorizontalDistance) {
    var tolerance = Math.max(0, maxHorizontalDistance);
    var nearest = null;
    var nearestDistance = Infinity;
    for (var i = 0; i < regions.length; i++) {
      var region = regions[i];
      if (y < region.y || y > region.y + region.h) continue;
      var left = Math.min(region.x, region.x + region.w);
      var right = Math.max(region.x, region.x + region.w);
      var distance = x < left ? left - x : x > right ? x - right : 0;
      if (distance === 0) return region;
      if (distance <= tolerance && distance < nearestDistance) {
        nearest = region;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function dataRowForPrimitive(meta, p) {
    if (!meta) return null;
    if (p.type === "rect") {
      if (p.x + p.w < meta.gutter) return null;
      var row = rowAtY(meta, p.y + p.h / 2);
      if (row === null) return null;
      var rowMeta = meta.rows[row];
      if (p.y < rowMeta.y - 0.01 || p.y + p.h > rowMeta.y + rowMeta.h + 0.01) return null;
      return row;
    }
    if (p.type === "line") {
      if (Math.abs(p.x1 - p.x2) > 0.01) return null;
      if (p.x1 < meta.gutter - 16) return null;
      return rowAtY(meta, (p.y1 + p.y2) / 2);
    }
    if (p.type === "poly") {
      var sumY = 0;
      var maxX = -Infinity;
      for (var i = 0; i < p.points.length; i++) {
        sumY += p.points[i][1];
        maxX = Math.max(maxX, p.points[i][0]);
      }
      if (maxX < meta.gutter - 16) return null;
      return rowAtY(meta, sumY / Math.max(1, p.points.length));
    }
    if (p.type === "text") {
      // Only row-anchored text (a DST row's clock labels, which carry \`dx\`)
      // follows its row's zoom; every other label stays where the scene puts it.
      if (p.dx === undefined) return null;
      return rowAtY(meta, p.y);
    }
    return null;
  }

  function paintPrimitive(ctx, p, meta, rowTransform) {
    function tx(x) {
      return meta && rowTransform ? transformX(x, meta, rowTransform) : x;
    }
    function scaledWidth(x, w) {
      return meta && rowTransform ? tx(x + w) - tx(x) : Math.max(w, 0);
    }
    function preserveGlyphX(points, x) {
      if (!meta || !rowTransform) return x;
      var minX = Infinity;
      var maxX = -Infinity;
      for (var i = 0; i < points.length; i++) {
        minX = Math.min(minX, points[i][0]);
        maxX = Math.max(maxX, points[i][0]);
      }
      var center = (minX + maxX) / 2;
      return tx(center) + (x - center);
    }
    if (p.type === "rect") {
      ctx.globalAlpha = p.alpha == null ? 1 : p.alpha;
      var x = tx(p.x);
      var w = Math.max(scaledWidth(p.x, p.w), 0);
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fillRect(x, p.y, w, Math.max(p.h, 0));
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth == null ? 1 : p.strokeWidth;
        ctx.strokeRect(x, p.y, w, Math.max(p.h, 0));
      }
      ctx.globalAlpha = 1;
    } else if (p.type === "text") {
      ctx.fillStyle = p.fill;
      ctx.font = p.font;
      ctx.textAlign = p.anchor === "start" ? "left" : p.anchor === "middle" ? "center" : "right";
      ctx.textBaseline = p.baseline === "top" ? "top" : p.baseline === "middle" ? "middle" : "alphabetic";
      // Mirrors textPaintX in plotScene.ts: the anchor zooms, the pad does not.
      ctx.fillText(p.text, p.dx === undefined ? p.x : tx(p.x) + p.dx, p.y);
    } else if (p.type === "line") {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth == null ? 1 : p.strokeWidth;
      ctx.setLineDash(p.dash || []);
      ctx.beginPath();
      ctx.moveTo(tx(p.x1), p.y1);
      ctx.lineTo(tx(p.x2), p.y2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (p.type === "poly") {
      ctx.beginPath();
      for (var j = 0; j < p.points.length; j++) {
        var pt = p.points[j];
        var px = preserveGlyphX(p.points, pt[0]);
        if (j === 0) ctx.moveTo(px, pt[1]);
        else ctx.lineTo(px, pt[1]);
      }
      if (p.closed) ctx.closePath();
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fill();
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth == null ? 1 : p.strokeWidth;
        ctx.stroke();
      }
    }
  }

  // Paint a Scene's primitives onto an already-scaled 2D context. Mirrors
  // renderScene in TimelineViewPanel.tsx and renderSceneToCanvas in
  // plotGenerator.ts, reading the identical primitive list.
  function renderScene(ctx, scene, transforms) {
    var prims = scene.primitives || [];
    var meta = scene.meta && scene.meta.kind === "waterfall" ? scene.meta : null;
    for (var i = 0; i < prims.length; i++) {
      var p = prims[i];
      var rowIndex = dataRowForPrimitive(meta, p);
      var rowTransform = rowIndex !== null ? transforms[rowIndex] : null;
      if (meta && rowIndex !== null && rowTransform && rowTransform.zoom > 1) {
        var row = meta.rows[rowIndex];
        ctx.save();
        ctx.beginPath();
        ctx.rect(meta.gutter, row.y, meta.plotWidth, row.h);
        ctx.clip();
        paintPrimitive(ctx, p, meta, rowTransform);
        ctx.restore();
      } else {
        paintPrimitive(ctx, p, meta, rowTransform);
      }
    }
  }

  function makeController(fig) {
    var type = fig.getAttribute("data-tv-type");
    var index = parseInt(fig.getAttribute("data-tv-index"), 10);
    var view = (DATA[type] || [])[index];
    var canvas = fig.querySelector(".tv-canvas");
    var wrap = fig.querySelector(".tv-canvas-wrap");
    var tooltip = fig.querySelector(".tv-tooltip");
    if (!view || !canvas || !wrap) return null;

    var scene = view.scene || { width: 1, height: 1, primitives: [] };
    var regions = view.regions || [];
    var meta = scene.meta && scene.meta.kind === "waterfall" ? scene.meta : null;
    var state = { scale: 1, boxW: 0, sized: false, transforms: {}, drag: null };

    function hideTip() {
      if (tooltip) tooltip.hidden = true;
    }

    function showTip(left, top, region) {
      if (!tooltip) return;
      tooltip.textContent = "";
      var strong = document.createElement("strong");
      strong.textContent = region.title;
      tooltip.appendChild(strong);
      for (var i = 0; i < region.lines.length; i++) {
        var div = document.createElement("div");
        div.textContent = region.lines[i];
        tooltip.appendChild(div);
      }
      tooltip.style.left = left + "px";
      tooltip.style.top = top + "px";
      tooltip.hidden = false;
    }

    function draw() {
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      var dpr = window.devicePixelRatio || 1;
      var boxW = state.boxW;
      var cssH = Math.max(1, scene.height * state.scale);
      canvas.width = Math.round(boxW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = "100%";
      canvas.style.height = cssH + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, boxW, cssH);
      ctx.setTransform(dpr * state.scale, 0, 0, dpr * state.scale, 0, 0);
      renderScene(ctx, scene, state.transforms);
    }

    // Size to the wrapper's width and (re)draw. Lazy: a canvas in a hidden tab
    // panel reports clientWidth 0, so it is sized only once its panel is shown.
    function activate() {
      var w = Math.max(320, wrap.getBoundingClientRect().width);
      if (state.sized && w === state.boxW) return;
      state.boxW = w;
      state.scale = state.boxW / Math.max(scene.width, 1);
      state.sized = true;
      hideTip();
      draw();
    }

    canvas.addEventListener(
      "wheel",
      function (e) {
        if (!meta || !e.shiftKey) return;
        var delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        if (delta === 0) return;
        e.preventDefault();
        var rect = canvas.getBoundingClientRect();
        var sx = (e.clientX - rect.left) / state.scale;
        var sy = (e.clientY - rect.top) / state.scale;
        var row = rowAtY(meta, sy);
        if (row === null || sx < meta.gutter) return;
        var factor = delta < 0 ? 1.2 : 1 / 1.2;
        var old = state.transforms[row] || { zoom: 1, offset: 0 };
        var contentX = inverseTransformX(sx, meta, old);
        var next = clampRowTransform(meta, {
          zoom: old.zoom * factor,
          offset: sx - meta.gutter - (contentX - meta.gutter) * old.zoom * factor,
        });
        if (next.zoom <= 1.001) delete state.transforms[row];
        else state.transforms[row] = next;
        state.drag = null;
        hideTip();
        draw();
      },
      { passive: false },
    );

    canvas.addEventListener("pointerdown", function (e) {
      if (!meta) return;
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var row = rowAtY(meta, y / state.scale);
      if (row === null) return;
      var transform = state.transforms[row];
      if (!transform || transform.zoom <= 1) return;
      state.drag = { row: row, x: x, offset: transform.offset, pointerId: e.pointerId };
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      hideTip();
    });

    canvas.addEventListener("pointermove", function (e) {
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      if (state.drag && meta) {
        var deltaSceneX = (x - state.drag.x) / state.scale;
        var current = state.transforms[state.drag.row] || { zoom: 1, offset: 0 };
        state.transforms[state.drag.row] = clampRowTransform(meta, {
          zoom: current.zoom,
          offset: state.drag.offset + deltaSceneX,
        });
        hideTip();
        draw();
        return;
      }
      var sx = x / state.scale;
      var sy = y / state.scale;
      var row = rowAtY(meta, sy);
      var rowTransform = row !== null ? state.transforms[row] : null;
      var hitX = meta && rowTransform ? inverseTransformX(sx, meta, rowTransform) : sx;
      var horizontalScale = state.scale * (rowTransform ? rowTransform.zoom : 1);
      var hit = findNearestRegion(
        regions,
        hitX,
        sy,
        HOVER_HIT_RADIUS_CSS_PX / Math.max(horizontalScale, 1e-9),
      );
      if (hit) showTip(x + 14, y + 14, hit);
      else hideTip();
    });

    function endDrag(e) {
      state.drag = null;
      if (e && canvas.releasePointerCapture) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // Some browsers throw if capture was already released.
        }
      }
    }

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointerleave", function (e) {
      endDrag(e);
      hideTip();
    });

    canvas.addEventListener("dblclick", function (e) {
      if (!meta) return;
      var rect = canvas.getBoundingClientRect();
      var y = e.clientY - rect.top;
      var row = rowAtY(meta, y / state.scale);
      if (row === null || !state.transforms[row]) return;
      delete state.transforms[row];
      hideTip();
      draw();
    });

    return { activate: activate };
  }

  var controllers = { app: [], screen: [] };
  var figs = document.querySelectorAll(".tv-scene");
  for (var f = 0; f < figs.length; f++) {
    var fig = figs[f];
    var type = fig.getAttribute("data-tv-type");
    var controller = makeController(fig);
    if (controller && controllers[type]) controllers[type].push(controller);
  }

  var current = null;

  function show(which) {
    var keys = ["app", "screen"];
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var panel = document.querySelector('[data-tv-panel="' + key + '"]');
      var tab = document.querySelector('[data-tv-tab="' + key + '"]');
      if (panel) panel.classList.toggle("is-active", key === which);
      if (tab) tab.setAttribute("aria-selected", String(key === which));
    }
    current = which;
    var list = controllers[which] || [];
    for (var j = 0; j < list.length; j++) list[j].activate();
  }

  var tabs = document.querySelectorAll("[data-tv-tab]");
  for (var t = 0; t < tabs.length; t++) {
    (function (tab) {
      tab.addEventListener("click", function () {
        show(tab.getAttribute("data-tv-tab"));
      });
    })(tabs[t]);
  }

  window.addEventListener("resize", function () {
    if (!current) return;
    var list = controllers[current] || [];
    for (var j = 0; j < list.length; j++) {
      list[j].activate();
    }
  });

  // Open on the first tab that actually has data.
  show(DATA.app.length > 0 ? "app" : DATA.screen.length > 0 ? "screen" : "app");
})();
`;function at(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function Ye(t){return JSON.stringify(t).replace(/</g,"\\u003c")}function Lt(t,n,e){return n.length===0?`<p class="tv-empty">${at(e)}</p>`:n.map((o,s)=>`<figure class="tv-scene" data-tv-type="${t}" data-tv-index="${s}">
  <figcaption class="tv-scene-head">
    <span class="tv-scene-title">${at(o.participantId)}</span>
  </figcaption>
  <div class="tv-canvas-wrap">
    <canvas class="tv-canvas"></canvas>
    <div class="tv-tooltip" hidden></div>
  </div>
</figure>`).join(`
`)}function ze(t){const{fileName:n,timezone:e,app:o,screen:s}=t,c=Ye({app:o,screen:s}),l=Lt("app",o,"No app usage data for this file."),i=Lt("screen",s,"No screen usage data for this file."),p=o.length>0?"app":s.length>0?"screen":"app",h=`${n} Timeline viewer`;return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${at(h)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2933; background: #f5f7fa; }
  header { padding: 16px 20px; border-bottom: 1px solid #e6e9ec; background: #fff; }
  h1 { margin: 0 0 4px; font-size: 18px; word-break: break-word; }
  .tv-meta { color: #5b6671; font-size: 13px; }
  .tv-tabs { display: flex; gap: 4px; padding: 12px 20px 0; background: #fff; border-bottom: 1px solid #e6e9ec; position: sticky; top: 0; z-index: 2; }
  .tv-tab { appearance: none; border: 1px solid #e6e9ec; border-bottom: none; background: #f0f2f5; color: #5b6671; padding: 8px 16px; font: inherit; font-weight: 600; border-radius: 8px 8px 0 0; cursor: pointer; }
  .tv-tab[aria-selected="true"] { background: #fff; color: #1f2933; }
  .tv-panel { display: none; padding: 12px 0 20px; }
  .tv-panel.is-active { display: block; }
  .tv-hint { color: #5b6671; font-size: 13px; margin: 0 12px 12px; }
  .tv-scene { margin: 0 0 28px; }
  .tv-scene-head { display: flex; align-items: center; gap: 12px; margin: 0 12px 6px; flex-wrap: wrap; }
  .tv-scene-title { font-weight: 600; }
  .tv-canvas-wrap { position: relative; border-top: 1px solid #e6e9ec; border-bottom: 1px solid #e6e9ec; background: #fff; overflow: visible; }
  .tv-canvas { display: block; touch-action: pan-y; cursor: default; }
  .tv-tooltip { position: absolute; z-index: 3; pointer-events: none; max-width: 280px; background: #1f2933; color: #fff; padding: 6px 8px; border-radius: 6px; font-size: 12px; line-height: 1.4; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); }
  .tv-tooltip[hidden] { display: none; }
  .tv-tooltip strong { display: block; margin-bottom: 2px; }
  .tv-empty { color: #5b6671; font-style: italic; }
</style>
</head>
<body>
<header>
  <h1>${at(n)}</h1>
  <div class="tv-meta">Timeline viewer · timezone ${at(e||"—")}</div>
</header>
<div class="tv-tabs" role="tablist">
  <button class="tv-tab" id="tab-app" role="tab" data-tv-tab="app" aria-controls="panel-app" aria-selected="${p==="app"}">App usage</button>
  <button class="tv-tab" id="tab-screen" role="tab" data-tv-tab="screen" aria-controls="panel-screen" aria-selected="${p==="screen"}">Screen usage</button>
</div>
<section class="tv-panel${p==="app"?" is-active":""}" id="panel-app" data-tv-panel="app" role="tabpanel" aria-labelledby="tab-app">
  <p class="tv-hint">Hover a bar for details · Shift scroll a row to zoom · drag zoomed rows · double click to reset</p>
${l}
</section>
<section class="tv-panel${p==="screen"?" is-active":""}" id="panel-screen" data-tv-panel="screen" role="tabpanel" aria-labelledby="tab-screen">
  <p class="tv-hint">Hover a bar for details · Shift scroll a row to zoom · drag zoomed rows · double click to reset</p>
${i}
</section>
<script type="application/json" id="tv-data">${c}<\/script>
<script>${Be}<\/script>
</body>
</html>`}const yt=["participantId","date","startTimestampNs","stopTimestampNs","eventTimestampNs","interactionType","broadAppCategory","appPackageName","applicationLabel","username","screenUsageEndReason"],Wt={"chronicle-visualization-data/v2":yt,"chronicle-visualization-data/v3":yt,"chronicle-visualization-data/v4":[...yt,"microUseClassification"]};function xt(t,n){return t.replace(/\.csv$/i,"")+n}function Ut(t){return{participant_id:t[0],date:t[1],start_timestamp_ns:t[2]===null?null:BigInt(t[2]),stop_timestamp_ns:t[3]===null?null:BigInt(t[3]),event_timestamp_ns:BigInt(t[4]),interaction_type:t[5],broad_app_category:t[6],app_package_name:t[7],application_label:t[8],username:t[9],screen_usage_end_reason:t[10]}}function Ge(t){let n;try{n=JSON.parse(new TextDecoder().decode(t))}catch(o){throw new Error("Rust visualization data is invalid JSON",{cause:o})}const e=n;if(!n||typeof n!="object"||typeof e.protocolVersion!="string"||!Object.hasOwn(Wt,e.protocolVersion)||JSON.stringify(e.columns)!==JSON.stringify(Wt[e.protocolVersion])||!Array.isArray(e.appRows)||!Array.isArray(e.screenRows)||!e.eventTimestampsByParticipant||typeof e.eventTimestampsByParticipant!="object")throw new Error("Rust visualization data does not match a known row schema");return e}async function Pt(t,n,e,o,s,c,l=!0,i=!0,p=[]){const h=c.appRows.map(Ut),f=c.screenRows.map(Ut),r=new Map(Object.entries(c.eventTimestampsByParticipant).map(([x,N])=>[x,N.map(D=>BigInt(D))])),d=h,T=f,v=async(x,N)=>{let D;try{D=await N()}catch(w){p.push({outputFileName:xt(n,` ${x}`),reason:w instanceof Error?w.message:String(w)});return}for(const[w,a]of D)t.push({kind:"plot",outputFileName:xt(n,` ${w} ${x}`),blob:a,rowCount:0,previewRows:[]})};if(l&&e.enablePlotting&&e.processAppUsage&&(await v("App Usage Plot.png",()=>De(d,o,e,s,r)),e.exportPlotsAsSvg&&await v("App Usage Plot.svg",()=>Oe(d,o,e,s,r)),e.enableActivityHeatmap&&(await v("App Usage Heatmap.png",()=>Ue(d,o,e,s)),e.exportPlotsAsSvg&&await v("App Usage Heatmap.svg",()=>Fe(d,o,e,s)))),l&&e.enablePlotting&&e.processScreenUsage&&(await v("Screen Usage Plot.png",()=>Pe(T,o,s,r)),e.exportPlotsAsSvg&&await v("Screen Usage Plot.svg",()=>$e(T,o,s,r))),!e.enableInteractiveTimeline)return;const u=e.processAppUsage?Ht(d,o,e,s,r,!1):[],y=e.processAppUsage?Ht(d,o,e,s,r,!0):[],I=e.includeFilteredAppUsageInPlots?y:u,_=e.processScreenUsage?Re(T,o,s,r):[];return i&&t.push({kind:"plot",outputFileName:xt(n," Timeline Viewer.html"),blob:new Blob([ze({fileName:n,timezone:o,app:I,screen:_})],{type:"text/html;charset=utf-8"}),rowCount:0,previewRows:[]}),{timezone:o,includeFilteredAppUsageInPlots:e.includeFilteredAppUsageInPlots,appFilteredIncluded:y,appFilteredExcluded:u,app:I,screen:_}}async function $t(t){return Ge(await le(t.workspaceId,"visualization-data-json",t.workspaceRootDigest))}async function Ze(t,n=[]){const e=await $t(t),o=[];return await Pt(o,t.inputFileName,{...t.options,enableInteractiveTimeline:!1},t.timezone,t.preprocessorVersion,e,!0,!0,n),o.filter(s=>s.kind==="plot"&&!s.outputFileName.endsWith(" Timeline Viewer.html"))}async function Ke(t){const e=await Pt([],t.inputFileName,{...t.options,enablePlotting:!1,enableActivityHeatmap:!1,exportPlotsAsSvg:!1},t.timezone,t.preprocessorVersion,await $t(t),!1,!1);if(!e)throw new Error("Persisted timeline request did not enable the timeline");return e}async function Qe(t){const n=[];await Pt(n,t.inputFileName,{...t.options,enablePlotting:!1,enableActivityHeatmap:!1,exportPlotsAsSvg:!1},t.timezone,t.preprocessorVersion,await $t(t),!1,!0);const e=n.find(o=>o.outputFileName.endsWith(" Timeline Viewer.html"));if(!e)throw new Error("Persisted timeline viewer was not generated");return e}export{et as C,Je as W,Qe as a,Ke as b,Nt as d,Ve as f,Ze as m,wt as s,Ft as t};
