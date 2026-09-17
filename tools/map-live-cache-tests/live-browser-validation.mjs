/** Full-stack loopback validation. Requires a disposable seeded OpenAO stack. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
const [configPath,outputPath]=process.argv.slice(2);
if(!configPath||!outputPath)throw Error('Usage: node live-browser-validation.mjs fixture-config.json NEW_OUTPUT_DIR');
const cfg=JSON.parse(await fs.readFile(configPath,'utf8'));
assert.equal(cfg.fixtureOnly,true,'Only a disposable fixture database is supported');
for(const url of [cfg.apiOrigin,cfg.frontendOrigin,cfg.gameOrigin])assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),'Loopback test services only');
const out=path.resolve(outputPath);await fs.mkdir(out,{recursive:false});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const hash=b=>createHash('sha256').update(b).digest('hex');
const requests=[],checks=[],clients=[];
const check=(name,value)=>{checks.push({name,passed:Boolean(value)});assert.ok(value,name)};
const request=async (route,method='GET',body,role)=>{
 const headers={'Content-Type':'application/json'};
 if(role==='admin'){headers.Authorization='Bearer '+cfg.admin.sessionToken;headers['x-game-data-admin-token']=cfg.admin.proxyHeader;}
 const response=await fetch(cfg.apiOrigin+route,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await response.json();requests.push({at:new Date().toISOString(),route,method,body,status:response.status,data});assert.ok(response.ok,`${route}: ${response.status} ${JSON.stringify(data)}`);return data;
};
const position=async p=>{const m=(await p.locator('body').innerText()).match(/Mapa (\d+) \((\d+), (\d+)\)/);return m?{map:+m[1],x:+m[2],y:+m[3]}:null;};
const procStart=async()=>{const stat=await fs.readFile(`/proc/${cfg.gamePid}/stat`,'utf8');return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];};
const browser=await chromium.launch({executablePath:cfg.browser||'/usr/bin/brave',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-first-run']});
const result={started:new Date().toISOString(),scope:'Real local API, PostgreSQL, game server and two isolated Chromium clients; no production services',checks,requests,clients,passed:false};
let cleanupTiles;
try{
 const processBefore=await procStart();
 const pages=[];
 for(let i=0;i<2;i++){
  const context=await browser.newContext({viewport:{width:1365,height:1000}});const page=await context.newPage();pages.push(page);
  const evidence={errors:[],sockets:[],overrideRequests:[]};clients.push(evidence);
  page.on('pageerror',e=>evidence.errors.push(e.message));
  page.on('websocket',ws=>{if(new URL(ws.url()).port!==new URL(cfg.gameOrigin).port)return;const item={opened:Date.now(),closed:false,markers:[]};evidence.sockets.push(item);ws.on('close',()=>item.closed=true);ws.on('framereceived',e=>{const text=Buffer.isBuffer(e.payload)?e.payload.toString():e.payload;for(const m of text.matchAll(/\[MAP_LIVE_RELOAD\] map=\d+ version=\d+/g))item.markers.push({at:Date.now(),text:m[0]});});});
  page.on('response',r=>{if(r.url().includes('/overrides'))evidence.overrideRequests.push({at:Date.now(),url:r.url(),status:r.status()});});
  await page.goto(cfg.frontendOrigin+'/login',{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByPlaceholder('Email o nombre de usuario').fill(cfg.users[i].name);
  await page.getByPlaceholder('Contraseña',{exact:true}).fill(cfg.users[i].password);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL(u=>u.pathname!='/login',{timeout:60000});
  await page.goto(cfg.frontendOrigin+'/characters',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('button',{name:new RegExp('^'+cfg.users[i].name+' Guerrero')}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('Conectado como'),{},{timeout:90000});
  const welcome=page.getByRole('button',{name:'Entendido',exact:true});if(await welcome.count())await welcome.click();
 }
 const positions=await Promise.all(pages.map(position));result.initialPositions=positions;check('Both real clients entered map 1',positions.every(p=>p?.map===1));
 const target=positions[0],observer=positions[1];const probe=cfg.visualTile||{x:54,y:61};
 const map=await(await fetch(cfg.frontendOrigin+'/maps/mapa_1.json')).json();
 const ground=(x,y)=>{let v=map.d[(y-1)*map.h+x-1];if(v>100000)return v-100000;if(v>0)return v;throw Error('Choose a simple ground tile for this fixture');};
 const original=await request('/maps/1/overrides');
 const originalTile=(x,y)=>original.overrides.find(o=>o.x===x&&o.y===y&&o.layer===1)||{x,y,layer:1,grhIndex:ground(x,y),blocked:null};
 cleanupTiles=[originalTile(target.x,target.y),originalTile(probe.x,probe.y)].map(({x,y,layer,grhIndex,blocked})=>({x,y,layer,grhIndex,blocked}));
 const rect=await pages[1].locator('canvas').first().boundingBox();assert.ok(rect);const tileSize=rect.width/21;
 const clip={x:Math.ceil(rect.x+(10+probe.x-observer.x)*tileSize),y:Math.ceil(rect.y+(10+probe.y-observer.y)*tileSize),width:Math.floor(tileSize)-1,height:Math.floor(tileSize)-1};
 assert.ok(clip.x>=rect.x&&clip.x+clip.width<=rect.x+rect.width&&clip.y>=rect.y&&clip.y+clip.height<=rect.y+rect.height);
 const capture=async name=>{await pages[1].waitForTimeout(1500);const bytes=await pages[1].screenshot({clip,path:path.join(out,name+'.png')});return hash(bytes);};
 result.probeTile=probe;result.pixelClip=clip;
 const baseline=await capture('tile-baseline');
 for(let i=0;i<2;i++)await pages[i].screenshot({path:path.join(out,`client-${i}-before.png`)});
 await request('/admin/game-data/maps/1/tiles','PUT',{tiles:[{x:target.x,y:target.y,layer:1,grhIndex:ground(target.x,target.y),blocked:true},{...probe,layer:1,grhIndex:1,blocked:null}]},'admin');
 check('Unpublished drafts are invisible to ordinary requests',JSON.stringify(await request('/maps/1/overrides'))===JSON.stringify(original));
 check('Unpublished draft leaves rendered pixels unchanged',(await capture('tile-draft'))===baseline);
 const socketCounts=clients.map(c=>c.sockets.length);const publishStart=Date.now();
 const published=await request('/admin/game-data/maps/1/publish','POST',{},'admin');result.publication=published;
 check('API notified the running game server',published.liveReload.notified===true);
 check('Server notified both players',published.liveReload.result.notifiedPlayers===2);
 check('Only the affected player was relocated',published.liveReload.result.relocatedPlayers===1);
 await pages[0].waitForFunction(t=>!document.body.innerText.includes(`Mapa 1 (${t.x}, ${t.y})`),target,{timeout:30000});
 const after=await Promise.all(pages.map(position));result.afterPublishPositions=after;
 check('Unaffected player stayed in place',JSON.stringify(after[1])===JSON.stringify(observer));
 check('Trapped player moved to an adjacent safe tile',after[0].map===1&&Math.abs(after[0].x-target.x)+Math.abs(after[0].y-target.y)===1);
 check('Connected observer sees published graphic',(await capture('tile-live'))!==baseline);
 check('Both clients requested fresh overrides',clients.every(c=>c.overrideRequests.some(r=>r.at>=publishStart&&r.status===200)));
 check('Both clients received the publication marker',clients.every(c=>c.sockets.some(s=>s.markers.some(m=>m.text.endsWith('version='+published.version)))));
 for(let i=0;i<2;i++)await pages[i].screenshot({path:path.join(out,`client-${i}-live.png`)});
 const relocated=after[0];const dx=target.x-relocated.x,dy=target.y-relocated.y;const toward=dx===1?'d':dx===-1?'a':dy===1?'s':'w';
 await pages[0].bringToFront();await pages[0].keyboard.down(toward);await pages[0].waitForTimeout(450);await pages[0].keyboard.up(toward);await pages[0].waitForTimeout(800);
 check('Movement cannot enter the new wall',JSON.stringify(await position(pages[0]))===JSON.stringify(relocated));
 let moved=false;for(const key of ['a','d','w','s'].filter(k=>k!==toward)){await pages[0].keyboard.down(key);await pages[0].waitForTimeout(300);await pages[0].keyboard.up(key);await pages[0].waitForTimeout(800);if(JSON.stringify(await position(pages[0]))!==JSON.stringify(relocated)){moved=true;break;}}
 result.afterMovement=await position(pages[0]);check('Relocated player remains able to move',moved);
 await request('/admin/game-data/maps/1/tiles','PUT',{tiles:cleanupTiles},'admin');await request('/admin/game-data/maps/1/publish','POST',{},'admin');
 check('A second publication restores original pixels',(await capture('tile-restored'))===baseline);
 await request('/admin/game-data/maps/1/tiles','PUT',{tiles:[{...probe,layer:1,grhIndex:null,blocked:null}]},'admin');await request('/admin/game-data/maps/1/publish','POST',{},'admin');
 check('Removing a colored layer clears its existing sprite',(await capture('tile-removed'))!==baseline);
 await request('/admin/game-data/maps/1/tiles','PUT',{tiles:cleanupTiles},'admin');await request('/admin/game-data/maps/1/publish','POST',{},'admin');
 check('Fixture terrain is restored',(await capture('tile-end'))===baseline);
 check('Neither player reconnected during publication',clients.every((c,i)=>c.sockets.length===socketCounts[i]&&!c.sockets.at(-1).closed));
 check('Game process did not restart',await procStart()===processBefore);
 check('No browser page exceptions',clients.every(c=>c.errors.length===0));
 result.passed=true;
}catch(error){result.error=String(error.stack||error);console.error(result.error);}
finally{
 result.finished=new Date().toISOString();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));await browser.close();
}
console.log(JSON.stringify({passed:result.passed,checks:checks.length,failed:checks.filter(x=>!x.passed),output:out}));
process.exitCode=result.passed?0:1;
