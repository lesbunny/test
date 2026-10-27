const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../site/inventory-core.js');
const item={id:'1',name:'Apex Predator',type:'Weapon',bucket:'Power Weapons',owner:'Vault',power:2010,perks:['Bait and Switch'],tags:['keep'],stats:{Resilience:22},damageType:3};
test('manifest accepts direct, aggregated and Response tables; rejects errors',()=>{
 const defs={123:{displayProperties:{name:'Apex Predator'}}};
 for(const data of [defs,{DestinyInventoryItemDefinition:defs},{Response:{DestinyInventoryItemDefinition:defs}}])assert.equal(core.unwrapDefinitions(data,'DestinyInventoryItemDefinition'),defs);
 for(const data of [null,[],{ErrorCode:5},{message:'error'}])assert.equal(core.unwrapDefinitions(data,'DestinyInventoryItemDefinition'),null);
});
test('equipment slots follow Destiny order, including unknown slots',()=>{
 const slots=['Ship','Helmet','Class Item','Energy Weapons','Kinetic Weapons','Other'];
 assert.deepEqual(slots.sort(core.slotCompare),['Kinetic Weapons','Energy Weapons','Helmet','Class Item','Ship','Other']);
});
test('sorting has reproducible name and instance tie breakers',()=>{
 const items=[{...item,id:'2'},{...item,id:'1'},{...item,id:'3',power:2020}];
 assert.deepEqual(items.sort((a,b)=>core.compare(a,b)).map(i=>i.id),['3','1','2']);
});
test('search supports quotes, negation, numerical comparisons, stats, OR, elements',()=>{
 for(const q of ['perk:"bait and switch" -is:locked','power:>=2010 stat.resilience:>20','element:void OR element:solar','owner:vault is:weapon','apex -is:exotic'])assert.equal(core.matches(item,q),true,q);
 for(const q of ['power:>2010','is:locked','element:void OR element:arc','stat.recovery:>5','kills:>=0'])assert.equal(core.matches(item,q),false,q);
});
test('unknown predicates do not match everything and protection is explicit',()=>{
 assert.equal(core.matches(item,'is:nonsense'),false);
 assert.equal(core.matches(item,'is:protected',{protected:()=>true}),true);
 assert.equal(core.matches(item,'is:favorite'),false);
});
test('armor planner finds the best complete class-compatible set with one exotic',()=>{
 const items=core.slots.slice(3,8).flatMap((bucket,n)=>[
  {id:'l'+n,bucket,classType:1,stats:{Resilience:10}},
  {id:'e'+n,bucket,classType:1,exotic:true,stats:{Resilience:20+n}},
  {id:'other'+n,bucket,classType:0,stats:{Resilience:100}}
 ]);
 const plan=core.armorPlan(items,{classType:1,weights:{Resilience:3}});
 assert.equal(plan.complete,true);assert.equal(plan.items.filter(i=>i.exotic).length,1);
 assert.equal(plan.items.find(i=>i.exotic).id,'e4');assert.equal(plan.score,192);
 assert.equal(core.armorPlan(items,{classType:1,exoticId:'e0'}).items.find(i=>i.exotic).id,'e0');
 assert.equal(core.armorPlan(items.filter(i=>i.bucket!=='Helmet'),{classType:1}).complete,false);
 assert.equal(core.armorPlan(items.map(i=>({...i,tags:['junk']})),{classType:1}).complete,false);
});
test('max power respects both exotic limits and prefers worn ties',()=>{
 const items=core.slots.slice(0,8).flatMap((bucket,i)=>[
  {id:'l'+i,bucket,power:2000},{id:'e'+i,bucket,power:2001+i,exotic:true}
 ]);
 const picks=core.powerSet(items);
 assert.equal(picks.length,8);assert.deepEqual(picks.filter(i=>i.exotic).map(i=>i.id),['e2','e7']);
 assert.equal(core.powerSet([{id:'a',bucket:core.slots[0],power:2000},{id:'b',bucket:core.slots[0],power:2000,equipped:true}])[0].id,'b');
});
