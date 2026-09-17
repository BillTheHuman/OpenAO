import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync(process.argv[2] || new URL('../../frontend/utils/gameLoader.ts',import.meta.url),'utf8');
const pause=()=>new Promise(r=>setImmediate(r));
async function harness(){
 const pending=[];let assetReads=0;
 const context=vm.createContext({structuredClone,console:{log(){},warn(){},error(){}},process:{env:{}},fetch:async url=>{
  if(String(url).includes('/overrides'))return new Promise((resolve,reject)=>pending.push({resolve,reject,url}));
  assetReads++; const number=Number(String(url).match(/mapa_(\d+)/)?.[1]||1);
  return {ok:true,status:200,json:async()=>({id:number,tiles:[[{g:[10,20],b:1}]]})};
 }});
 const code=stripTypeScriptTypes(source,{mode:'transform'});
 const mod=new vm.SourceTextModule(code,{context});
 await mod.link(async spec=>{
  if(spec==='../lib/api-base-url')return new vm.SyntheticModule(['getApiBaseUrl'],function(){this.setExport('getApiBaseUrl',()=> 'https://fixture.invalid')},{context});
  if(spec==='../types/game'){
   const names=['GraphicsDB','MapData','GraphicData','ObjectsDB','NPCsDB','BodiesDB','HeadsDB','WeaponsDB','ShieldsDB','HelmetsDB','FXsDB','SpellsDB'];
   return new vm.SyntheticModule(names,function(){for(const n of names)this.setExport(n,undefined)},{context});
  }
  throw Error('Unexpected import '+spec);
 });
 await mod.evaluate();
 return {api:mod.namespace,pending,get assetReads(){return assetReads},async wait(n){for(let i=0;i<100&&pending.length<n;i++)await pause();assert.ok(pending.length>=n,'expected request '+n)},done(i,overrides=[],status=200){pending[i].resolve({ok:status===200,status,json:async()=>({overrides})})}};
}
const edit=(graphic,blocked=false)=>[{x:1,y:1,layer:1,grhIndex:graphic,blocked}];
const tile=m=>m['1']['1']['1'];
let passed=0,failed=0;
async function test(name,fn){try{await fn();console.log('PASS',name);passed++}catch(e){console.log('FAIL',name+':',e.message);failed++}}
await test('normal loads are cloned and cached',async()=>{const h=await harness();const p=h.api.loadMapData(1);await h.wait(1);h.done(0,edit(100));const a=await p;tile(a).graphics['1']=555;assert.equal(tile(await h.api.loadMapData(1)).graphics['1'],100);assert.equal(h.pending.length,1)});
await test('late obsolete load cannot replace newer map or reach its original caller',async()=>{const h=await harness();const old=h.api.loadMapData(1);await h.wait(1);h.api.invalidateMapCache(1);const fresh=h.api.loadMapData(1);await h.wait(2);h.done(1,edit(200));await fresh;h.done(0,edit(100));assert.equal(tile(await old).graphics['1'],200);assert.equal(tile(await h.api.loadMapData(1)).graphics['1'],200)});
await test('old finalizer does not evict a replacement request',async()=>{const h=await harness();const old=h.api.loadMapData(1);await h.wait(1);h.api.invalidateMapCache(1);const fresh=h.api.loadMapData(1);await h.wait(2);h.done(0,edit(100));for(let i=0;i<8;i++)await pause();const third=h.api.loadMapData(1);for(let i=0;i<8;i++)await pause();assert.equal(h.pending.length,2);h.done(1,edit(200));const all=await Promise.all([old,fresh,third]);assert.ok(all.every(m=>tile(m).graphics['1']===200))});
await test('clearMapCache invalidates in-flight generations',async()=>{const h=await harness();const old=h.api.loadMapData(1);await h.wait(1);h.api.clearMapCache();const fresh=h.api.loadMapData(1);await h.wait(2);h.done(1,edit(300));await fresh;h.done(0,edit(100));assert.equal(tile(await old).graphics['1'],300)});
await test('removed overrides restore original graphics and blocking',async()=>{const h=await harness();const p=h.api.loadMapData(1);await h.wait(1);h.done(0,edit(99,false));const map=await p;const q=h.api.refreshMapOverridesInPlace(map,1);await h.wait(2);h.done(1,[]);assert.equal(await q,1);assert.equal(tile(map).graphics['1'],10);assert.equal(tile(map).blocked,1)});
await test('out-of-order refresh cannot repaint stale terrain',async()=>{const h=await harness();const p=h.api.loadMapData(1);await h.wait(1);h.done(0,[]);const map=await p;const first=h.api.refreshMapOverridesInPlace(map,1);await h.wait(2);const second=h.api.refreshMapOverridesInPlace(map,1);await h.wait(3);h.done(2,edit(300));await second;h.done(1,edit(200));await first;assert.equal(tile(map).graphics['1'],300)});
await test('failed refresh retains current terrain and reports failure',async()=>{const h=await harness();const p=h.api.loadMapData(1);await h.wait(1);h.done(0,edit(99));const map=await p;const q=h.api.refreshMapOverridesInPlace(map,1);const expected=assert.rejects(q,/HTTP 503/);await h.wait(2);h.done(1,[],503);await expected;assert.equal(tile(map).graphics['1'],99)});
await test('live map, row and tile references survive refresh',async()=>{const h=await harness();const p=h.api.loadMapData(1);await h.wait(1);h.done(0,[]);const map=await p;const entry=map['1'],row=map['1']['1'],t=tile(map);t.runtimeMarker='keep';const q=h.api.refreshMapOverridesInPlace(map,1);await h.wait(2);h.done(1,edit(60));await q;assert.equal(map['1'],entry);assert.equal(map['1']['1'],row);assert.equal(tile(map),t);assert.equal(t.runtimeMarker,'keep')});
await test('unchanged refresh reports no visible terrain difference',async()=>{const h=await harness();const p=h.api.loadMapData(1);await h.wait(1);h.done(0,[]);const map=await p;const q=h.api.refreshMapOverridesInPlace(map,1);await h.wait(2);h.done(1,[]);assert.equal(await q,0)});
await test('ordinary first-load fallback remains available',async()=>{const h=await harness();const p=h.api.loadMapData(1);await h.wait(1);h.done(0,[],503);assert.equal(tile(await p).graphics['1'],10)});
console.log(`RESULT passed=${passed} failed=${failed}`);process.exitCode=failed?1:0;
