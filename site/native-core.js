/* Native data operations; no application embedding or third-party runtime. */
(function(root){
'use strict';
function parseCSV(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let n=0;n<text.length;n++){const c=text[n];if(c==='"'){if(quoted&&text[n+1]==='"'){cell+='"';n++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[n+1]==='\n')n++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('Unclosed quoted CSV field.');row.push(cell);if(row.some(Boolean))rows.push(row);return rows;
}
function annotationChanges(items,csv){
 const rows=parseCSV(csv),headers=(rows.shift()||[]).map(s=>s.replace(/^\uFEFF/,'').trim().toLowerCase());
 const id=headers.findIndex(h=>['id','iteminstanceid','instance id'].includes(h)),tag=headers.findIndex(h=>['tag','tags'].includes(h)),note=headers.indexOf('notes');
 if(id<0||(tag<0&&note<0))throw Error('CSV needs Id and Tags and/or Notes columns.');
 const known=new Map(items.map(i=>[String(i.id),i])),seen=new Set(),changes=[];let unmatched=0;
 for(const row of rows){const key=row[id];if(!known.has(key)){unmatched++;continue;}if(seen.has(key))throw Error('Duplicate item ID: '+key);seen.add(key);const change={id:key};if(tag>=0)change.tags=(row[tag]||'').split(/[,;]/).map(t=>t.trim()).filter(Boolean);if(note>=0)change.notes=row[note]||'';changes.push(change);}
 return {changes,unmatched};
}
function csv(items){const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';return [['Id','Name','Type','Bucket','Owner','Power','Tags','Notes','Perks'],...items.map(i=>[i.id,i.name,i.type,i.bucket,i.owner,i.power,(i.tags||[]).join(';'),i.notes,(i.perks||[]).join(';')])].map(r=>r.map(cell).join(',')).join('\r\n');}
function optimize(items,{classType=1,weights={},minimum={},maximum={},pinned=[],exotic='any',query='',limit=200000}={},core){
 const pools=core.slots.slice(3,8).map(bucket=>{
 let pool=items.filter(i=>(i.gearBucket||i.bucket)===bucket&&!i.isPostmaster&&!(i.tags||[]).includes('junk')&&(i.classType==null||Number(i.classType)===3||Number(i.classType)===Number(classType))&&core.matches(i,query));
 const pinIds=items.filter(i=>(i.gearBucket||i.bucket)===bucket&&pinned.includes(i.id)).map(i=>i.id);if(pinIds.length)pool=pool.filter(i=>pinIds.includes(i.id));
 return pool.filter(i=>exotic!=='none'||!i.exotic).sort((a,b)=>core.total(b)-core.total(a));});
 const missing=core.slots.slice(3,8).filter((_,n)=>!pools[n].length);if(missing.length)return {sets:[],missing,visited:0,truncated:false};
 let visited=0,truncated=false;const sets=[];
 const walk=(n,chosen,stats,exotics)=>{if(visited>=limit){truncated=true;return;}if(n===5){visited++;if(exotic==='required'&&!exotics)return;if(exotic!=='any'&&exotic!=='none'&&exotic!=='required'&&!chosen.some(i=>i.id===exotic))return;if(Object.entries(minimum).some(([k,v])=>(stats[k]||0)<v)||Object.entries(maximum).some(([k,v])=>(stats[k]||0)>v))return;const score=Object.entries(weights).reduce((t,[k,v])=>t+(stats[k]||0)*Number(v),0);sets.push({itemIds:chosen.map(i=>i.id),stats,score});sets.sort((a,b)=>b.score-a.score);if(sets.length>10)sets.pop();return;}
 for(const i of pools[n]){if(exotics+!!i.exotic>1)continue;const next={...stats};for(const k of core.stats)next[k]=(next[k]||0)+(Number(i.stats?.[k])||0);walk(n+1,[...chosen,i],next,exotics+!!i.exotic);if(truncated)break;}};
 walk(0,[],{},0);return {sets,missing,visited,truncated};
}
function wishlistURL(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)throw Error('Use an HTTPS GitHub file URL without credentials, query, or fragment.');
 if(url.hostname==='github.com'){
  const parts=url.pathname.split('/');if(parts.length<6||parts[3]!=='blob')throw Error('Choose a GitHub file, not a repository or folder.');
  url.hostname='raw.githubusercontent.com';url.pathname=[...parts.slice(0,3),...parts.slice(4)].join('/');
 }
 if(url.hostname!=='raw.githubusercontent.com'||url.pathname.split('/').filter(Boolean).length<4)throw Error('Only GitHub-hosted raw wishlist files are supported.');
 return url.href;
}
function repairCandidates(snapshot,items,used=[]){
 if(!snapshot)return [];
 return items.filter(i=>!used.includes(i.id)&&!i.isPostmaster&&!(i.tags||[]).includes('junk')&&(i.gearBucket||i.bucket)===(snapshot.gearBucket||snapshot.bucket)&&(snapshot.classType==null||i.classType==null||Number(i.classType)===3||Number(i.classType)===Number(snapshot.classType))).map(item=>{
 const same=!!snapshot.itemHash&&String(snapshot.itemHash)===String(item.itemHash);
 const wanted=new Set((snapshot.perks||[]).map(p=>p.toLowerCase()));
 const overlap=(item.perks||[]).filter(p=>wanted.has(p.toLowerCase())).length;
 return {item,same,overlap};
 }).sort((a,b)=>Number(b.same)-Number(a.same)||b.overlap-a.overlap||Number(b.item.power||0)-Number(a.item.power||0)||String(a.item.id).localeCompare(String(b.item.id)));
}
function customTotal(item,preferences={}){
 const keys=preferences[String(item.classType??3)]||[];
 return keys.reduce((sum,key)=>sum+(Number(item.stats?.[key])||0),0);
}
const api={parseCSV,annotationChanges,csv,optimize,wishlistURL,repairCandidates,customTotal};if(typeof module==='object')module.exports=api;else root.NativeCore=api;
})(typeof window==='object'?window:globalThis);
