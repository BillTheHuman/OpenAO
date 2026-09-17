import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const ts=(await import(process.env.TS_COMPILER_PATH || 'typescript')).default;
const root=process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=name=>fs.readFileSync(path.join(root,'server/src',name+'.ts'),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
const row=(layer=1,blocked=true,extra={})=>({x:50,y:50,layer,grhIndex:90+layer,blocked,status:'published',...extra});
const tile=h=>h.vars.mapa[1][50][50];
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(originalBlocked=undefined){
 const vars={mapa:{1:{50:{50:{graphics:{1:10,2:20},...(originalBlocked===undefined?{}:{blocked:originalBlocked})}}}},mapData:{1:{50:{50:{id:1},49:{id:0},51:{id:0}}}},personajes:{},clients:{},tokenAuth:'fixture-only'};
 const clients=new Map(),sent=[],moves=[],packets=[];
 const protocol={console:(message,color,a,b,client)=>sent.push({message,id:client.id}),blockMap:(map,pos,blocked,client)=>packets.push({map,pos:{...pos},blocked,id:client.id})};
 let responses=[];
 const funct={fetchUrl:async()=>{const response=responses.shift();if(response instanceof Error)throw response;return typeof response==='function'?await response():response},dumpError:e=>{throw e}};
 const runtime={getClientById:id=>clients.get(Number(id))};
 const gameSource=ts.createSourceFile('game.ts',source('game'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),snippets={};
 function visit(node){
  if(ts.isVariableDeclaration(node)&&['isPlayerWaterGraphic','hasLegalOccupancy'].includes(node.name.getText(gameSource)))snippets[node.name.getText(gameSource)]='const '+node.getText(gameSource)+';';
  if(ts.isBinaryExpression(node)&&['this.legalPos','this.blockMap'].includes(node.left.getText(gameSource)))snippets[node.left.getText(gameSource)]=node.getText(gameSource)+';';
  ts.forEachChild(node,visit);
 }
 visit(gameSource);assert.equal(Object.keys(snippets).length,4,'exact game implementations extracted');
 const gameFactory=compile('(function(vars,funct,handleProtocol,isSameEntityId){const game=this;'+Object.values(snippets).join('\n')+';return this})');
 const game=vm.runInNewContext(gameFactory).call({},vars,funct,protocol,(a,b)=>a!=null&&b!=null&&String(a)===String(b));
 game.loopAreaPos=(map,pos,cb)=>Object.values(vars.personajes).filter(u=>u.map===map).forEach(cb);
 game.telep=(client,map,x,y)=>{const u=vars.personajes[client.id];moves.push({id:client.id,map,x,y});vars.mapData[u.map][u.pos.y][u.pos.x].id=0;u.pos={x,y};vars.mapData[map]??={};vars.mapData[map][y]??={};vars.mapData[map][y][x]={id:client.id};};
 const modules=new Map();
 const unloaded=()=>{throw Error('Unexpected unrelated game-data path')};
 const deps={'./vars':vars,'./functions':funct,'./game':game,'./balance':{},'./handleProtocol':protocol,'./runtimeRegistry':runtime,'./npcData':{normalizeNpcData:unloaded},'./objectData':{normalizeObjectsData:unloaded},'./balanceData':{applyBalanceDataToVars:unloaded,normalizeBalanceData:unloaded},'./craftingRecipeData':{normalizeCraftingRecipesData:unloaded},'./smeltingRecipeData':{normalizeSmeltingRecipesData:unloaded}};
 function load(name){
  if(modules.has(name))return modules.get(name).exports;
  const m={exports:{}};modules.set(name,m);
  const req=spec=>{if(['./gameDataSync','./mapLiveApply','./mapLivePublish'].includes(spec))return load(spec.slice(2));if(spec in deps)return deps[spec];throw Error('Unexpected dependency '+spec)};
  const code=compile(source(name));new vm.Script('(function(require,module,exports){'+code+'\n})',{filename:name+'.ts'}).runInThisContext()(req,m,m.exports);return m.exports;
 }
 const sync=load('gameDataSync'),live=load('mapLiveApply');
 function player(id=1,map=1,x=50,y=50){const client={id,readyState:1,OPEN:1};clients.set(id,client);vars.clients[id]=client;vars.personajes[id]={id,map,pos:{x,y},navegando:false};vars.mapData[map]??={};vars.mapData[map][y]??={};vars.mapData[map][y][x]={id};return vars.personajes[id]}
 return {vars,sync,live,game,sent,moves,packets,player,respond:(rows,version=1)=>responses.push({mapNum:1,overrides:rows,version}),error:e=>responses.push(e),defer:()=>{let resolve;const promise=new Promise(r=>resolve=r);responses.push(()=>promise);return rows=>resolve(rows)}};
}
let passed=0,failed=0;
async function test(name,fn){try{await fn();console.log('PASS '+name);passed++}catch(e){console.log('FAIL '+name+': '+e.message);failed++}}
await test('single deleted edit restores original graphics and blocking',async()=>{const h=harness();h.sync.applyMapTileOverridesToVars(1,[row()]);h.sync.applyMapTileOverridesToVars(1,[]);assert.equal(tile(h).blocked,undefined);assert.deepEqual(plain(tile(h).graphics),{1:10,2:20})});
await test('removing two layers restores the pre-edit blocking value',async()=>{const h=harness();h.sync.applyMapTileOverridesToVars(1,[row(1,true),row(2,true)]);h.sync.applyMapTileOverridesToVars(1,[]);assert.equal(Boolean(tile(h).blocked),false)});
await test('changing blocked=true to null restores original terrain',async()=>{const h=harness();h.sync.applyMapTileOverridesToVars(1,[row()]);h.sync.applyMapTileOverridesToVars(1,[row(1,null)]);assert.equal(Boolean(tile(h).blocked),false)});
await test('restoring an original wall never broadcasts a false unblock',async()=>{const h=harness(1);h.sync.applyMapTileOverridesToVars(1,[row(1,true)]);h.respond([],2);await h.live.applyPublishedMapToLiveServer(1);assert.equal(Boolean(tile(h).blocked),true)});
await test('removing a temporary unblock broadcasts the restored wall',async()=>{const h=harness(1);h.sync.applyMapTileOverridesToVars(1,[row(1,false)]);h.respond([],2);const r=await h.sync.reloadMapDiff(1);assert.deepEqual(plain(r.blockedChanges),[{x:50,y:50,blocked:true}])});
await test('unmodified publication does not relocate the occupying player',async()=>{const h=harness();h.player();h.respond([],1);const r=await h.live.applyPublishedMapToLiveServer(1);assert.equal(r.relocatedPlayers,0);assert.equal(h.moves.length,0);assert.equal(r.notifiedPlayers,1)});
await test('new wall relocates the trapped player to a free neighbor',async()=>{const h=harness();h.player();h.player(2,1,49,50);h.respond([row()],2);const r=await h.live.applyPublishedMapToLiveServer(1);assert.equal(r.relocatedPlayers,1);assert.deepEqual(plain(h.moves),[{id:1,map:1,x:51,y:50}]);assert.ok(h.sent.some(x=>x.message==='[MAP_LIVE_RELOAD] map=1 version=2'))});
await test('players on other maps receive no reload or relocation',async()=>{const h=harness();h.player(3,2);h.respond([row()],2);const r=await h.live.applyPublishedMapToLiveServer(1);assert.equal(r.notifiedPlayers,0);assert.equal(h.moves.length,0);assert.equal(h.sent.length,0)});
await test('fetch failure preserves current map and surfaces the error',async()=>{const h=harness();h.sync.applyMapTileOverridesToVars(1,[row()]);h.error(Error('fixture offline'));await assert.rejects(h.sync.reloadMapDiff(1),/fixture offline/);assert.equal(Boolean(tile(h).blocked),true)});
await test('deleted graphic layer can be restored without touching other fields',async()=>{const h=harness();tile(h).runtimeValue='preserve';h.sync.applyMapTileOverridesToVars(1,[row(1,null,{grhIndex:null})]);assert.equal(tile(h).graphics[1],undefined);h.sync.applyMapTileOverridesToVars(1,[]);assert.equal(tile(h).graphics[1],10);assert.equal(tile(h).runtimeValue,'preserve')});
await test('draft-only update removes old edits without applying the draft',async()=>{const h=harness();h.sync.applyMapTileOverridesToVars(1,[row()]);h.respond([row(1,true,{status:'draft',grhIndex:999})],2);await h.sync.reloadMapDiff(1);assert.equal(tile(h).graphics[1],10);assert.equal(Boolean(tile(h).blocked),false)});
await test('out-of-order older version cannot replace the latest publication',async()=>{const h=harness();const finishOld=h.defer();const old=h.sync.reloadMapDiff(1);h.respond([row(1,true,{grhIndex:300})],3);await h.sync.reloadMapDiff(1);finishOld({mapNum:1,overrides:[row(1,false,{grhIndex:200})],version:2});await old;assert.equal(tile(h).graphics[1],300);assert.equal(h.sync.getMapPublishVersion(1),3)});
await test('unchanged blocked terrain yields no unnecessary collision packet',async()=>{const h=harness(1);h.respond([row(1,true)],1);const r=await h.sync.reloadMapDiff(1);assert.deepEqual(plain(r.blockedChanges),[])});
console.log(`RESULT passed=${passed} failed=${failed}`);process.exitCode=failed?1:0;
