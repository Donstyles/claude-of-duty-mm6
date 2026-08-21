import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const port=5241;
const server=spawn('npx',['vite','preview','--port',String(port),'--strictPort','--host','127.0.0.1'],
 {cwd:'/home/user/claude-of-duty-mm6',stdio:'ignore',detached:true});
await new Promise(r=>setTimeout(r,6000));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
 headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
// iPhone 14 Pro Max, landscape, as the mobile gate measures it.
const p=await b.newPage({viewport:{width:932,height:430},deviceScaleFactor:2,
  isMobile:true,hasTouch:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'});
p.setDefaultTimeout(180000);
await p.goto(`http://127.0.0.1:${port}/?quality=high`,{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>window.__GAME?.ready===true,undefined,{timeout:180000});
await p.waitForTimeout(3500);
await p.screenshot({path:'shots/phone-landscape.png'});
const geo = await p.evaluate(()=>{
  const r=(sel)=>{const n=document.querySelector(sel); if(!n) return null;
    const b=n.getBoundingClientRect(); return {sel,x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)};};
  return {
    vw:innerWidth, vh:innerHeight, u:getComputedStyle(document.documentElement).getPropertyValue('--u'),
    nodes:['.mm-frame','.mm-sidebar','.mm-side-field','.mm-arch','.mm-bar','.mm-view','.mm-architrave','.mm-column','.mm-col-left','.mm-col-right']
      .map(r).filter(Boolean),
    columns:[...document.querySelectorAll('[class*="column"],[class*="col-"],[class*="pillar"]')]
      .map(n=>{const b=n.getBoundingClientRect();return{cls:n.className,x:+b.x.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0)};}).slice(0,10),
  };
});
console.log(JSON.stringify(geo,null,1));
await b.close(); try{process.kill(-server.pid);}catch{}
