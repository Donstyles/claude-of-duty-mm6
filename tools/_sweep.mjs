import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const port=5243;
const server=spawn('npx',['vite','preview','--port',String(port),'--strictPort','--host','127.0.0.1'],
 {cwd:'/home/user/claude-of-duty-mm6',stdio:'ignore',detached:true});
await new Promise(r=>setTimeout(r,6000));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
 headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const sizes=[[932,430],[932,404],[874,402],[844,390],[1000,460],[896,414],[852,393],[800,360]];
for(const [w,h] of sizes){
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  p.setDefaultTimeout(120000);
  try{
    await p.goto(`http://127.0.0.1:${port}/?quality=high`,{waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>window.__GAME?.ready===true,undefined,{timeout:120000});
    await p.waitForTimeout(2500);
    const g=await p.evaluate(()=>{
      const R=s=>{const n=document.querySelector(s);if(!n)return null;const b=n.getBoundingClientRect();
        return {x:+b.x.toFixed(0),r:+(b.x+b.width).toFixed(0),w:+b.width.toFixed(0)};};
      const side=R('.mm-sidebar'), field=R('.mm-side-field'), arch=R('.mm-arch');
      const cols=[...document.querySelectorAll('.mm-column')].map(n=>{const b=n.getBoundingClientRect();
        return +b.x.toFixed(0);});
      // a column that starts inside the sidebar's own content is the defect
      const bad = field ? cols.filter(x=>x>field.x+2 && x<field.r-2) : [];
      return {vw:innerWidth, side, field, arch, cols, overlapping:bad, scrollW:document.documentElement.scrollWidth};
    });
    console.log(`${w}x${h}`.padEnd(10), 'sidebar', JSON.stringify(g.side), 'cols', JSON.stringify(g.cols),
      g.overlapping.length?`  ← COLUMN OVER SIDEBAR at ${g.overlapping}`:'', g.scrollW>w?`  ← overflows ${g.scrollW}`:'');
  }catch(e){console.log(`${w}x${h}`.padEnd(10),'ERROR',e.message.slice(0,60));}
  await p.close();
}
await b.close(); try{process.kill(-server.pid);}catch{}
