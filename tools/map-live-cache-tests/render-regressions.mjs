import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const sourceRoot=process.argv[2] || fileURLToPath(new URL('../../',import.meta.url));
async function load(relative, bindings={}, globals={}) {
 const source=fs.readFileSync(path.join(sourceRoot,relative),'utf8');
 const code=stripTypeScriptTypes(source,{mode:'transform'});
 const context=vm.createContext({console:{log(){},warn(){},error(){}},structuredClone,process:{env:{}},...globals});
 const imports=new Map();
 for(const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) imports.set(m[2],m[1].split(',').map(x=>x.trim().split(/\s+as\s+/)[0]).filter(Boolean));
 const mod=new vm.SourceTextModule(code,{context});
 await mod.link(async spec=>new vm.SyntheticModule(imports.get(spec)||[],function(){for(const name of imports.get(spec)||[])this.setExport(name,bindings[name])},{context}));
 await mod.evaluate();return mod.namespace;
}
let passed=0,failed=0;
async function test(name,fn){try{await fn();console.log('PASS',name);passed++}catch(e){console.log('FAIL',name+':',e.message);failed++}}
const packet={type:'console',payload:{msg:'[MAP_LIVE_RELOAD] map=1 version=7'}};
const engine=()=>({mapNumber:1,mapData:{1:{}},isDestroyed:false});
await test('live marker redraws the exact changed tiles after refresh',async()=>{
 const drawn=[];const m=await load('frontend/components/game/session/incomingUiPackets.ts',{invalidateMapCache(){},async refreshMapOverridesInPlace(d,n,cb){cb?.([{x:3,y:4}]);return 1}});
 const e=engine();assert.equal(await m.handleIncomingUiPacket({packet,engine:e,ctx:{async redrawMapTiles(target,tiles){assert.equal(target,e);drawn.push(...tiles)}}}),true);
 assert.equal(JSON.stringify(drawn),JSON.stringify([{x:3,y:4}]));
});
await test('packet handling waits for refresh and scene redraw',async()=>{
 let release;const wait=new Promise(r=>release=r);let drawn=false,finished=false;
 const m=await load('frontend/components/game/session/incomingUiPackets.ts',{invalidateMapCache(){},async refreshMapOverridesInPlace(d,n,cb){await wait;cb?.([{x:2,y:3}]);return 1}});
 const pending=m.handleIncomingUiPacket({packet,engine:engine(),ctx:{async redrawMapTiles(){drawn=true}}}).then(()=>finished=true);
 await new Promise(r=>setImmediate(r));const premature=finished;release();await pending;assert.equal(premature,false);assert.equal(drawn,true);
});
await test('unchanged map needs no scene redraw',async()=>{
 let drawn=0;const m=await load('frontend/components/game/session/incomingUiPackets.ts',{invalidateMapCache(){},async refreshMapOverridesInPlace(){return 0}});
 await m.handleIncomingUiPacket({packet,engine:engine(),ctx:{async redrawMapTiles(){drawn++}}});assert.equal(drawn,0);
});
await test('destroyed engine is not redrawn after asynchronous refresh',async()=>{
 const e=engine();let drawn=false;const m=await load('frontend/components/game/session/incomingUiPackets.ts',{invalidateMapCache(){},async refreshMapOverridesInPlace(d,n,cb){e.isDestroyed=true;cb?.([{x:2,y:3}]);return 1}});
 await m.handleIncomingUiPacket({packet,engine:e,ctx:{async redrawMapTiles(){drawn=true}}});assert.equal(drawn,false);
});
function scene(tile){
 const parent={removeChild(){}};const sprites=new Map(['1','2','3'].map(l=>['layer'+l+':1,1',{layer:l,parent,destroyed:false}]));
 const roof={parent,destroyed:false};
 return {mapNumber:1,mapDimensions:{width:1,height:1},mapData:{1:{1:{1:tile}}},mapContainer:{},roofContainer:{},graphicsDB:{},objectsDB:{},sceneLayerSprites:sprites,roofSprites:new Map([['1,1',[roof]]]),roofTiles:new Set(['1,1']),animatedSpriteFrameCounters:new Map(),treeSprites:new Map(),treeSpritesByRow:new Map(),fadedTreeSprites:new Set(),treeGraphicIds:new Set(),objectSprites:new Map([['1,1',{runtimeObject:true}]]),roof};
}
const sceneBindings={AnimatedSprite:class{},Container:class{},Sprite:class{},getTileAt:(d,n,x,y)=>d[n]?.[y]?.[x],collectMapGraphicIds:()=>[],isTileWithinBounds:()=>false,getBottomAnchoredGraphicPosition(){},getRowZIndex:()=>0,Z_INDEX_LAYERS:{FLOOR:0,BELOW:1,ABOVE:2,ROOF:3},destroyDisplayObjectSafely:s=>{s.destroyed=true},registerCullEntry(){},unregisterCullEntry(){},getMapRowLayerContainer:e=>e.mapContainer,getRoofRowContainer:e=>e.roofContainer,isTreeObjectData:()=>false};
const params={canUseEngineContainer:()=>true,preloadGraphicIds:async()=>{},syncTileObjectVisual:async()=>{},renderTileLayer:(e,c,g,x,y,z,p)=>({graphic:g,parent:p}),renderRoofLayer(){}};
await test('removed graphic layers and roof leave no stale display objects',async()=>{
 const m=await load('frontend/components/game/rendering/sceneRenderer.ts',sceneBindings);const e=scene({graphics:{}});const old=[...e.sceneLayerSprites.values(),e.roof];await m.renderMap(e,params,{replaceLayers:true,includeObjects:false});assert.equal(e.sceneLayerSprites.size,0);assert.equal(e.roofSprites.size,0);assert.ok(old.every(s=>s.destroyed));assert.equal(e.objectSprites.size,1);
});
await test('replacement preserves nonselected layers',async()=>{
 const m=await load('frontend/components/game/rendering/sceneRenderer.ts',sceneBindings);const e=scene({});await m.renderMap(e,params,{replaceLayers:true,includeObjects:false,includeLayers:['1']});assert.equal(e.sceneLayerSprites.has('layer1:1,1'),false);assert.equal(e.sceneLayerSprites.has('layer2:1,1'),true);assert.equal(e.roofSprites.size,1);
});
await test('changed floor is replaced with the published graphic',async()=>{
 const m=await load('frontend/components/game/rendering/sceneRenderer.ts',sceneBindings);const e=scene({graphics:{1:88}});await m.renderMap(e,params,{replaceLayers:true,includeObjects:false});assert.equal(e.sceneLayerSprites.get('layer1:1,1').graphic,88);assert.equal(e.sceneLayerSprites.has('layer2:1,1'),false);
});
await test('failed texture preload leaves old scene objects intact',async()=>{
 const m=await load('frontend/components/game/rendering/sceneRenderer.ts',{...sceneBindings,collectMapGraphicIds:()=>['88']});const e=scene({graphics:{1:88}});const old=[...e.sceneLayerSprites.values(),e.roof];await assert.rejects(m.renderMap(e,{...params,preloadGraphicIds:async()=>{throw Error('fixture texture unavailable')}},{replaceLayers:true}),/fixture/);assert.ok(old.every(s=>!s.destroyed));assert.equal(e.sceneLayerSprites.size,3);
});
await test('loader reports changed coordinates without replacing live tile references',async()=>{
 let calls=0;const m=await load('frontend/utils/gameLoader.ts',{getApiBaseUrl:()=> 'http://fixture.invalid'},{fetch:async u=>({ok:true,status:200,json:async()=>String(u).includes('/overrides')?{overrides:[{x:1,y:1,layer:1,grhIndex:88,blocked:true}]}:{id:1,w:1,h:1,d:[10]}})});
 const tile={graphics:{1:10},runtimeMarker:'keep'};const data={1:{1:{1:tile}}};const changed=[];assert.equal(await m.refreshMapOverridesInPlace(data,1,tiles=>{calls++;changed.push(...tiles)}),1);assert.equal(calls,1);assert.equal(JSON.stringify(changed),JSON.stringify([{x:1,y:1}]));assert.equal(data[1][1][1],tile);assert.equal(tile.runtimeMarker,'keep');assert.equal(tile.graphics[1],88);
});
console.log(`RESULT passed=${passed} failed=${failed}`);process.exitCode=failed?1:0;
