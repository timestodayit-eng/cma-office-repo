const { chromium } = require('playwright'); const fs=require('fs');
const { G, bg, fg } = require('./defs');
const R=require('path').resolve(__dirname,'../..')+'/';
const S=(inner)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>${G}</defs>${inner}</svg>`;
const full=S(bg(false)+fg.stack);
const rounded=S(`<clipPath id="rc"><rect width="1024" height="1024" rx="230"/></clipPath><g clip-path="url(#rc)">${bg(false)+fg.stack}</g>`);
const fgOnly=S(`<g transform="translate(512 512) scale(.86) translate(-512 -512)">${fg.stack}</g>`);
const bgOnly=S(bg(false));
const mono=S(`<mask id="m"><rect width="1024" height="1024" fill="#fff"/><path d="M410 600 L480 668 L620 524" fill="none" stroke="#000" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/></mask>
<g transform="translate(512 512) scale(.86) translate(-512 -512)" fill="none" stroke="#fff" stroke-width="30">
<rect x="300" y="250" width="440" height="330" rx="70" transform="rotate(-12 520 415)" stroke-opacity=".6"/>
<rect x="290" y="330" width="440" height="330" rx="70" transform="rotate(-5 510 495)" stroke-opacity=".8"/>
<rect x="282" y="420" width="460" height="350" rx="76" fill="#fff" stroke="none" mask="url(#m)"/></g>`);
(async()=>{const b=await chromium.launch();
 const shot=async(svg,size,path,transparent=true)=>{const p=await b.newPage({viewport:{width:size,height:size}});
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await p.screenshot({path,omitBackground:transparent}); await p.close();};
 const out=__dirname+'/out/'; fs.mkdirSync(out,{recursive:true});
 await shot(full,1024,R+'mobile/assets/icon.png',false);
 await shot(fgOnly,512,R+'mobile/assets/android-icon-foreground.png');
 await shot(bgOnly,512,R+'mobile/assets/android-icon-background.png',false);
 await shot(mono,432,R+'mobile/assets/android-icon-monochrome.png');
 await shot(rounded,1024,R+'mobile/assets/splash-icon.png');
 await shot(rounded,48,R+'mobile/assets/favicon.png');
 await shot(rounded,512,R+'desktop/build/icon.png');
 await shot(rounded,512,R+'apps/web/src/app/icon.png');
 await shot(full,180,R+'apps/web/src/app/apple-icon.png',false);
 await shot(full,1024,out+'app-icon-1024.png',false);
 await shot(full,512,out+'app-icon-512.png',false);
 await shot(rounded,256,out+'r256.png');
 await shot(mono,432,out+'mono-preview.png');
 // feature graphic
 const img='data:image/png;base64,'+fs.readFileSync(R+'mobile/assets/splash-icon.png').toString('base64');
 const p=await b.newPage({viewport:{width:1024,height:500}});
 await p.setContent(`<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;800&display=swap" rel="stylesheet"><style>body{margin:0;width:1024px;height:500px;font-family:Inter;color:#fff;background:linear-gradient(135deg,#5b6cf0,#8b5cf6 55%,#e0559b);display:flex;align-items:center;gap:48px;padding-left:70px;box-sizing:border-box;overflow:hidden;position:relative}
 .c1{position:absolute;width:500px;height:500px;border-radius:50%;background:#7dd3fc;opacity:.35;filter:blur(90px);left:-120px;top:-200px}.c2{position:absolute;width:500px;height:500px;border-radius:50%;background:#fda4af;opacity:.45;filter:blur(90px);right:-150px;bottom:-250px}
 img{width:270px;height:270px;filter:drop-shadow(0 18px 30px #2a106566);position:relative}h1{font-size:76px;font-weight:800;margin:0 0 14px;letter-spacing:-2px}p{margin:6px 0;font-size:30px;font-weight:500}.s{font-size:24px;opacity:.85}div.t{position:relative}</style>
 <div class=c1></div><div class=c2></div><img src="${img}"><div class=t><h1>CMA Office</h1><p>Attendance · Tasks · Leave · Payroll</p><p class=s>The team app for CMA staff</p></div>`,{waitUntil:'networkidle'});
 await p.screenshot({path:out+'feature-graphic-1024x500.png'});
 await b.close();})();
