import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const port=5249;
const server=spawn('npx',['vite','preview','--port',String(port),'--strictPort','--host','127.0.0.1'],
 {cwd:'/home/user/claude-of-duty-mm6',stdio:'ignore',detached:true});
await new Promise(r=>setTimeout(r,6000));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
 headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const p=await b.newPage({viewport:{width:430,height:932},deviceScaleFactor:3,isMobile:true,hasTouch:true});
p.setDefaultTimeout(180000);
await p.goto(`http://127.0.0.1:${port}/?quality=high`,{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>window.__GAME?.ready===true,undefined,{timeout:180000});
await p.waitForTimeout(3000);
const probe = async (tag)=> {
  const g=await p.evaluate(()=>{
    const R=s=>{const n=document.querySelector(s);if(!n)return null;const b=n.getBoundingClientRect();
      return {x:+b.x.toFixed(0),r:+(b.x+b.width).toFixed(0),w:+b.width.toFixed(0)};};
    const field=R('.mm-side-field');
    const cols=[...document.querySelectorAll('.mm-column')].map(n=>+n.getBoundingClientRect().x.toFixed(0));
    const over = field ? cols.filter(x=>x>field.x+2 && x<field.r-2) : [];
    const bar=R('.mm-bar')||R('.mm-party-bar');
    return {vw:innerWidth, side:R('.mm-sidebar'), field, bar, cols, over,
      canvasW:document.querySelector('canvas')?.getBoundingClientRect().width|0};
  });
  console.log(tag.padEnd(22), JSON.stringify(g));
};
await probe('portrait 430x932');
// Rotate to landscape, as a hand does.
await p.setViewportSize({width:932,height:430});
await p.waitForTimeout(3000);
await probe('after rotate to 932x430');
await p.screenshot({path:'shots/phone-rotated.png'});
await b.close(); try{process.kill(-server.pid);}catch{}
