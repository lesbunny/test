const {test}=require('node:test');const assert=require('node:assert/strict');const core=require('../site/inventory-core.js'),native=require('../site/native-core.js');
test('boolean search precedence, parentheses, NOT and quoted phrases',()=>{
 const i={name:'Arc thing',type:'Weapon',damageType:2,power:2000,stats:{Range:60},perks:['Bait and Switch']};
 for(const query of ['is:weapon (is:arc or is:solar)','not is:armor and perk:"bait and switch"','is:solar or is:arc and power:>=2000','stat:range:>=50','stat.range:50..70'])assert.equal(core.matches(i,query),true,query);
 for(const query of ['is:weapon and (is:solar or is:void)','not (is:arc or is:solar)','is:arc and','(is:arc','stat.range:61..70'])assert.equal(core.matches(i,query),false,query);
});
test('CSV annotations roundtrip multiline quoted text and large string IDs without replacing inventory',()=>{
 const items=[{id:'900719925474099333',name:'Name, "quoted"',power:20,tags:['keep','pvp'],notes:'line1\nline2, "yes"'}];
 const original=structuredClone(items);const result=native.annotationChanges(items,native.csv(items));assert.deepEqual(result.changes,[{id:items[0].id,tags:items[0].tags,notes:items[0].notes}]);assert.deepEqual(items,original);
 assert.equal(native.annotationChanges(items,'Id,Notes\nunknown,test').unmatched,1);
 assert.throws(()=>native.annotationChanges(items,'Name,Notes\nname,test'),/needs Id/);
 assert.throws(()=>native.annotationChanges(items,'Id,Notes\n900719925474099333,a\n900719925474099333,b'),/Duplicate/);
 assert.throws(()=>native.parseCSV('Id,Notes\nx,"unterminated'),/Unclosed/);
 assert.deepEqual(native.annotationChanges(items,'Id,Notes\n900719925474099333,""').changes,[{id:items[0].id,notes:''}]);
});
test('optimizer enforces min/max, pins, class, junk and exotic limits',()=>{
 const items=core.slots.slice(3,8).flatMap((bucket,n)=>[{id:'a'+n,bucket,classType:1,stats:{Resilience:10,Recovery:2},tags:[]},{id:'b'+n,bucket,classType:1,stats:{Resilience:5,Recovery:10},tags:[],exotic:true},{id:'wrong'+n,bucket,classType:0,stats:{Resilience:100},tags:[]}]);
 let r=native.optimize(items,{classType:1,weights:{Recovery:3},minimum:{Resilience:45},maximum:{Recovery:20},pinned:['b0']},core);assert.ok(r.sets.length);assert.ok(r.sets.every(s=>s.itemIds.includes('b0')&&s.stats.Resilience>=45&&s.stats.Recovery<=20&&s.itemIds.filter(id=>id.startsWith('b')).length<=1));
 r=native.optimize(items,{classType:1,weights:{Recovery:1},exotic:'none'},core);assert.ok(r.sets.every(s=>s.itemIds.every(id=>id.startsWith('a'))));
 r=native.optimize(items,{classType:1,minimum:{Resilience:999}},core);assert.equal(r.sets.length,0);
 r=native.optimize(items,{classType:1,limit:1},core);assert.equal(r.truncated,true);assert.equal(r.visited,1);
});
test('deployment and native tool code contain no embedded application',()=>{
 const fs=require('node:fs');for(const f of ['site/tools.js','site/native-tools.js','site/workspace-ui.js','site/index.html','.github/workflows/pages.yml'])assert.doesNotMatch(fs.readFileSync(f,'utf8'),/<iframe|build-dim|engine\/#|Native DIM/);
});
