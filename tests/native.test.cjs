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
test('wishlist subscriptions accept only HTTPS GitHub files',()=>{
 assert.equal(native.wishlistURL('https://github.com/owner/repo/blob/main/list.txt'),'https://raw.githubusercontent.com/owner/repo/main/list.txt');
 assert.equal(native.wishlistURL('https://raw.githubusercontent.com/o/r/main/list.txt'),'https://raw.githubusercontent.com/o/r/main/list.txt');
 for(const url of ['http://raw.githubusercontent.com/o/r/main/x','https://evil.test/o/r/main/x','https://github.com/o/r','https://user:password@github.com/o/r/blob/main/x','https://raw.githubusercontent.com/o/r/main/x?token=secret'])assert.throws(()=>native.wishlistURL(url));
});
test('missing build repair prioritizes exact definitions and excludes used, wrong-class, junk and postmaster gear',()=>{
 const snapshot={bucket:'Helmet',itemHash:'123',classType:1,perks:['Keep perk']};
 const items=[{id:'exact',bucket:'Helmet',itemHash:'123',classType:1,power:1,perks:[]},{id:'similar',bucket:'Helmet',classType:1,power:200,perks:['Keep perk']},{id:'wrong',bucket:'Helmet',classType:0},{id:'junk',bucket:'Helmet',classType:1,tags:['junk']},{id:'post',bucket:'Helmet',classType:1,isPostmaster:true}];
 assert.deepEqual(native.repairCandidates(snapshot,items).map(c=>c.item.id),['exact','similar']);assert.deepEqual(native.repairCandidates(snapshot,items,['exact']).map(c=>c.item.id),['similar']);assert.deepEqual(native.repairCandidates(null,items),[]);
});
test('stat arithmetic and class custom totals do not invent missing values',()=>{
 const item={classType:1,stats:{Resilience:20,Recovery:10}};
 assert.equal(core.statValue(item,'resilience+recovery'),30);assert.equal(core.statValue(item,'resilience+recovery/2'),15);assert.equal(core.statValue(item,'resilience+missing'),undefined);assert.equal(core.statValue(item,'resilience/0'),undefined);
 assert.equal(core.matches(item,'stat:resilience+recovery:>=30'),true);assert.equal(core.matches(item,'stat.resilience+recovery/2:15'),true);assert.equal(core.matches(item,'stat.missing:0'),false);
 assert.equal(native.customTotal(item,{'1':['Recovery'],'0':['Resilience']}),10);assert.equal(core.matches(item,'custom:>=10',{custom:i=>native.customTotal(i,{'1':['Recovery']})}),true);
});
