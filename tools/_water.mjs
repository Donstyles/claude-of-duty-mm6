import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const port=5251;
const server=spawn('npx',['vite','preview','--port',String(port),'--strictPort','--host','127.0.0.1'],
 {cwd:'/home/user/claude-of-duty-mm6',stdio:'ignore',detached:true});
await new Promise(r=>setTimeout(r,6000));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
 headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const p=await b.newPage({viewport:{width:900,height:600}});
p.setDefaultTimeout(180000);
await p.goto(`http://127.0.0.1:${port}/?quality=high&capture=1`,{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>window.__GAME?.ready===true,undefined,{timeout:180000});
await p.waitForTimeout(3000);
const r = await p.evaluate(()=>{
  const ctx=window.__GAME.ctx;
  const terrain=ctx.get('terrain'), water=ctx.get('water'), town=ctx.get('town'), player=ctx.get('player');
  const out={ waterLevel: water?.level ?? water?.seaLevel ?? water?.y ?? null,
    waterKeys: water?Object.keys(water).slice(0,16):null,
    playerAt: player?.position?{x:+player.position.x.toFixed(0),y:+player.position.y.toFixed(1),z:+player.position.z.toFixed(0)}:null,
    townCentre: town?{x:town.centreX,z:town.centreZ,baseY:town.baseY}:null };
  if (terrain?.heightAt && town) {
    out.groundAtTown = +terrain.heightAt(town.centreX, town.centreZ).toFixed(2);
    out.isWaterAtTown = terrain.isWater ? terrain.isWater(town.centreX, town.centreZ) : null;
    // sample a ring around the town centre
    const ring=[];
    for(let i=0;i<8;i++){const a=i/8*Math.PI*2;
      const x=town.centreX+Math.cos(a)*60, z=town.centreZ+Math.sin(a)*60;
      ring.push(+terrain.heightAt(x,z).toFixed(1));}
    out.ringHeights=ring;
  }
  if (terrain?.heightAt && player?.position) {
    out.groundUnderPlayer = +terrain.heightAt(player.position.x, player.position.z).toFixed(2);
    out.isWaterUnderPlayer = terrain.isWater ? terrain.isWater(player.position.x, player.position.z) : null;
  }
  return out;
});
console.log(JSON.stringify(r,null,1));
await b.close(); try{process.kill(-server.pid);}catch{}
