const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const core=require('../site/inventory-core.js');
const source=fs.readFileSync('site/extension.js','utf8');
// Exercise the actual production mapper/loader with synthetic Bungie responses.
function fn(name){
 const start=source.search(new RegExp('  (?:async )?function '+name+'\\('));
 assert.ok(start>=0,name);
 const rest=source.slice(start);const end=rest.slice(3).search(/\n  (?:async )?function /);
 return end<0?rest:rest.slice(0,end+3);
}
function context(overrides={}){
 const ctx={URL,Set,Map,window:{InventoryCore:core},live:{characters:[{characterId:'c1',name:'Hunter'}]},setStatus:()=>{},unique:xs=>[...new Set(xs)],POSTMASTER_HASH:215593132,BUCKETS:{1498876634:'Kinetic Weapons',3448274439:'Helmet'},STAT_NAMES:{},WEAPON_BUCKETS:['Kinetic Weapons'],ARMOR_BUCKETS:['Helmet'],...overrides};
 vm.createContext(ctx);
 for(const name of ['loadManifest','bucketName','definitionFor','componentFor','componentStatName','componentPerkName','itemKillCount','buildLiveItems'])vm.runInContext(fn(name),ctx);
 return ctx;
}
test('manifest downloads components and assigns decoded definitions without const reassignment',async()=>{
 const defs={123:{displayProperties:{name:'The Call'}}};let requests=[];
 const ctx=context({bungieRequest:async()=>({version:'v1',jsonWorldComponentContentPaths:{en:{DestinyInventoryItemDefinition:'/items',DestinyStatDefinition:'/stats',DestinyInventoryBucketDefinition:'/buckets'}}}),fetchJsonCached:async url=>{requests.push(url);return defs;}});
 await ctx.loadManifest();assert.equal(ctx.live.itemDefs[123].displayProperties.name,'The Call');assert.equal(requests.length,3);
 await ctx.loadManifest();assert.equal(requests.length,3);
});
test('manifest supports aggregated world fallback and rejects malformed databases',async()=>{
 const defs={123:{displayProperties:{name:'Item'}}};const data=Object.fromEntries(['DestinyInventoryItemDefinition','DestinyStatDefinition','DestinyInventoryBucketDefinition'].map(t=>[t,defs]));
 const ctx=context({bungieRequest:async()=>({jsonWorldContentPaths:{en:'/world'}}),fetchJsonCached:async()=>data});
 await ctx.loadManifest();assert.equal(ctx.live.itemDefs[123].displayProperties.name,'Item');
 const bad=context({bungieRequest:async()=>({}),fetchJsonCached:async()=>({})});await assert.rejects(bad.loadManifest(),/Missing or invalid/);
});
test('profile mapper preserves resolved names, weapon stats, class, exotic tier, and equipped deduplication',()=>{
 const raw={itemHash:123,itemInstanceId:'9007199254740993',bucketHash:1498876634,state:9};
 const profile={characterInventories:{data:{c1:{items:[raw]}}},characterEquipment:{data:{c1:{items:[raw]}}},itemComponents:{instances:{data:{[raw.itemInstanceId]:{primaryStat:{value:2000},damageType:3}}},stats:{data:{[raw.itemInstanceId]:{stats:{44:{value:72}}}}}}};
 const ctx=context();ctx.live.itemDefs={123:{displayProperties:{name:'The Call',description:'A named weapon',icon:'/icon.png'},inventory:{bucketTypeHash:1498876634,tierType:6},classType:3,itemTypeDisplayName:'Sidearm'}};ctx.live.statDefs={44:{displayProperties:{name:'Range'}}};ctx.live.profile=profile;
 const items=ctx.buildLiveItems(profile);assert.equal(items.length,1);
 const item=items[0];assert.equal(item.name,'The Call');assert.equal(item.id,raw.itemInstanceId);assert.equal(item.stats.Range,72);assert.equal(item.exotic,true);assert.equal(item.rarity,'Exotic');assert.equal(item.equipped,true);assert.equal(item.crafted,true);assert.equal(item.classType,3);assert.equal(item.locked,true);assert.equal(item.definitionDescription,'A named weapon');
});
test('missing definitions stay identifiable and Postmaster keeps its equipment slot',()=>{
 const profile={characterInventories:{data:{c1:{items:[{itemHash:999,itemInstanceId:'a',bucketHash:1498876634},{itemHash:123,itemInstanceId:'b',bucketHash:215593132}]}}}};
 const ctx=context();ctx.live.profile=profile;ctx.live.itemDefs={123:{displayProperties:{name:'Helmet'},inventory:{bucketTypeHash:3448274439}}};
 const items=ctx.buildLiveItems(profile);assert.equal(items[0].name,'Item #999');assert.equal(items[0].definitionMissing,true);assert.equal(items[1].isPostmaster,true);assert.equal(items[1].gearBucket,'Helmet');assert.equal(items[1].bucket,'Postmaster');
});
test('loadout preview blocks missing items, class mismatches and multiple exotics',()=>{
 const ctx=context({state:()=>({loadouts:[{id:'l',name:'Test',itemIds:['a','b']}]}),needConnection:()=>true,getSelectedCharacter:()=>({characterId:'c1',name:'Hunter'}),isGear:()=>true,classCanUse:()=>true,bucketFor:i=>i.bucket,isWeapon:i=>i.type==='Weapon',isArmor:i=>i.type==='Armor',openConfirm:()=>{throw new Error('Unexpected confirmation')}});
 const items={a:{id:'a',name:'A',type:'Weapon',bucket:'Kinetic Weapons',isLiveItem:true,itemInstanceId:'a',exotic:true},b:{id:'b',name:'B',type:'Weapon',bucket:'Energy Weapons',isLiveItem:true,itemInstanceId:'b',exotic:true}};
 ctx.getItem=id=>items[id];vm.runInContext(fn('prepareLoadout'),ctx);
 assert.throws(()=>ctx.prepareLoadout('l'),/at most one exotic/);
 items.b.exotic=false;items.b.equipped=true;items.b.characterId='c2';assert.throws(()=>ctx.prepareLoadout('l'),/Unequip/);
 delete items.b;assert.throws(()=>ctx.prepareLoadout('l'),/missing/);
});
test('loadout execution equips legendary replacements before exotics and skips worn gear',async()=>{
 const items={a:{id:'a',exotic:true},b:{id:'b',exotic:false},c:{id:'c',equipped:true,characterId:'c1'}};const equipped=[];
 const ctx=context({getSelectedCharacter:()=>({characterId:'c1'}),getItem:id=>items[id],executeSequential:async(_label,jobs,executor)=>{for(const job of jobs)await executor(job);},setLiveEquip:async i=>equipped.push(i.id)});
 vm.runInContext(fn('executeLoadout'),ctx);await ctx.executeLoadout({characterId:'c1',ids:['a','b','c']});assert.deepEqual(equipped,['b','a']);
 await assert.rejects(ctx.executeLoadout({characterId:'c2',ids:['a']}),/changed/);
});
test('transfer refuses equipped and nontransferable items and a full vault before issuing requests',async()=>{
 let requests=0;
 const ctx=context({normalizeTransferable:i=>i.transferable!==false,vaultFree:()=>0,ownerCharacterId:()=> 'c1',bungieRequest:async()=>requests++});
 vm.runInContext(fn('moveToVault'),ctx);
 const item={itemHash:1,itemInstanceId:'a',owner:'Hunter'};
 await assert.rejects(ctx.moveToVault({...item,equipped:true}),/cannot currently/);
 await assert.rejects(ctx.moveToVault({...item,transferable:false}),/cannot currently/);
 await assert.rejects(ctx.moveToVault(item),/full/);assert.equal(requests,0);
});
test('new and legacy armor names both retain the 65-stat protection threshold',()=>{
 const ctx=context();vm.runInContext(fn('totalStats'),ctx);
 assert.equal(ctx.totalStats({stats:{Health:20,Melee:10,Grenade:10,Super:10,Class:10,Weapons:5}}),65);
 assert.equal(ctx.totalStats({stats:{Mobility:20,Resilience:10,Recovery:10,Discipline:10,Intellect:10,Strength:5,Range:99}}),65);
});
test('equipped items load even when the inventory component omits that character',()=>{
 const profile={characterEquipment:{data:{c1:{items:[{itemHash:123,itemInstanceId:'a',bucketHash:1498876634}]}}}};
 const ctx=context();ctx.live.profile=profile;ctx.live.itemDefs={123:{displayProperties:{name:'The Call'}}};
 const items=ctx.buildLiveItems(profile);assert.equal(items.length,1);assert.equal(items[0].name,'The Call');assert.equal(items[0].equipped,true);
});
test('native Organizer bulk actions refresh before execution and resolve each item again',async()=>{
 const calls=[];let refreshed=false;const items={a:{id:'a',name:'A',locked:false},b:{id:'b',name:'B',locked:true}};
 const ctx=context({needConnection:()=>true,refreshProfileOnly:async()=>{refreshed=true;calls.push('refresh');},executeSequential:async(label,jobs,executor)=>{assert.equal(refreshed,true);for(const job of jobs)await executor(job);},getItem:id=>items[id],setLiveLock:async item=>{calls.push('lock:'+item.id);item.locked=!item.locked;},moveLiveItem:async(item,target)=>calls.push('move:'+item.id+':'+target)});
 vm.runInContext(fn('executeWorkbench'),ctx);await ctx.executeWorkbench({ids:['a','b'],operation:'lock'});assert.deepEqual(calls,['refresh','lock:a']);
 await ctx.executeWorkbench({ids:['b'],operation:'move',target:'Vault'});assert.equal(calls.at(-1),'move:b:Vault');
});
test('free socket changes revalidate eligibility and use only the free plug endpoint',async()=>{
 const calls=[];let eligible=true;
 const ctx=context({needConnection:()=>true,getItem:()=>({id:'a',itemInstanceId:'900719925474099333'}),socketOptions:()=>[{index:2,plugs:[{hash:123,canInsert:eligible}]}],ownerCharacterId:()=> 'c1',refreshProfileOnly:async()=>{},bungieRequest:async(path,options)=>calls.push({path,body:options.body}),updateHeader:()=>{},LL:{toast:()=>{},renderPage:()=>{} }});
 ctx.live.membership={membershipType:3};vm.runInContext(fn('executeGameAction'),ctx);
 await ctx.executeGameAction({action:'socket',id:'a',index:2,hash:123});assert.equal(calls[0].path,'/Destiny2/Actions/Items/InsertSocketPlugFree/');assert.equal(calls[0].body.itemId,'900719925474099333');assert.equal(calls[0].body.plug.socketArrayType,0);assert.equal(calls[0].body.plug.socketIndex,2);
 eligible=false;await assert.rejects(ctx.executeGameAction({action:'socket',id:'a',index:2,hash:123}),/eligibility changed/);assert.equal(calls.length,1);assert.equal(ctx.live.busy,false);
});
test('in-game loadout writes validate slot and action before sending request',async()=>{
 const calls=[];const ctx=context({needConnection:()=>true,gameLoadouts:()=>[{characterId:'c1',loadouts:[{items:[]}]}],refreshProfileOnly:async()=>{},bungieRequest:async(path,options)=>calls.push({path,body:options.body}),updateHeader:()=>{},LL:{toast:()=>{},renderPage:()=>{}}});ctx.live.membership={membershipType:3};vm.runInContext(fn('executeGameAction'),ctx);
 await ctx.executeGameAction({action:'equip',characterId:'c1',index:0});assert.equal(calls[0].path,'/Destiny2/Actions/Loadouts/EquipLoadout/');
 await ctx.executeGameAction({action:'snapshot',characterId:'c1',index:0});assert.equal(calls[1].path,'/Destiny2/Actions/Loadouts/SnapshotLoadout/');
 await assert.rejects(ctx.executeGameAction({action:'snapshot',characterId:'c1',index:1}),/slot changed/);await assert.rejects(ctx.executeGameAction({action:'delete',characterId:'c1',index:0}),/Unsupported/);assert.equal(calls.length,2);
});
