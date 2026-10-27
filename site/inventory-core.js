/* Shared, deterministic inventory rules for the browser and regression tests. */
(function(root) {
  'use strict';
  const slots=['Kinetic Weapons','Energy Weapons','Power Weapons','Helmet','Gauntlets','Chest Armor','Leg Armor','Class Item','Subclass','Artifact','Ghost','Sparrow','Ship','Consumables','Materials','Postmaster'];
  const stats=['Mobility','Resilience','Recovery','Discipline','Intellect','Strength','Health','Melee','Grenade','Super','Class','Weapons'];
  const text=v=>String(v??'').toLocaleLowerCase().replace(/[’']/g,"'");
  const total=i=>Object.entries(i.stats||{}).reduce((sum,[key,value])=>sum+(stats.includes(key)?Number(value)||0:0),0);
  function slotCompare(a,b) {
    const rank=s=>slots.includes(s)?slots.indexOf(s):slots.length;
    return rank(a)-rank(b)||String(a).localeCompare(String(b));
  }
  function compare(a,b,sort='power') {
    const delta=sort==='name'?String(a.name).localeCompare(String(b.name)):sort==='stats'?total(b)-total(a):sort==='bucket'?slotCompare(a.bucket,b.bucket):sort==='rarity'?Number(b.exotic)-Number(a.exotic):Number(b.power||0)-Number(a.power||0);
    return delta||String(a.name).localeCompare(String(b.name))||String(a.id).localeCompare(String(b.id));
  }
  function matches(item,query,context={}) {
    const tokens=(text(query).match(/(?:[^\s"]+|"[^"]*")+/g)||[]);
    const check=token=>{
      let negative=token.startsWith('-'); if(negative)token=token.slice(1);
      const t=token.replace(/"/g,'');
      const [key,...rest]=t.split(':');const value=rest.join(':');
      let result;
      if(key==='is'&&value) {
        const flags={locked:!!item.locked,equipped:!!item.equipped,exotic:!!item.exotic,protected:!!context.protected?.(item),favorite:(item.tags||[]).some(t=>['favorite','fav'].includes(text(t))),vault:item.owner==='Vault',weapon:item.type==='Weapon',armor:item.type==='Armor',postmaster:!!item.isPostmaster,duplicate:!!context.duplicate?.(item),unresolved:!!item.definitionMissing,crafted:!!item.crafted};
        result=flags[value]??false;
      } else if(['power','stat','total','kills'].includes(key)||key.startsWith('stat.')) {
        const n=key==='power'?item.power:key==='kills'?item.trackedKills:key.startsWith('stat.')?Object.entries(item.stats||{}).find(([s])=>text(s)===key.slice(5))?.[1]:total(item);
        const m=value.match(/^(>=|<=|>|<|=)?(\d+)$/);
        result=!!m&&n!=null&&({'>' :Number(n)>Number(m[2]),'<':Number(n)<Number(m[2]),'>=':Number(n)>=Number(m[2]),'<=':Number(n)<=Number(m[2]),'=':Number(n)===Number(m[2])}[m[1]||'=']);
      } else if(value&&['owner','type','bucket','tag','perk','rarity','notes','element'].includes(key)) {
        const field={tag:(item.tags||[]).join(' '),perk:(item.perks||[]).join(' '),element:({1:'kinetic',2:'arc',3:'solar',4:'void',6:'stasis',7:'strand'})[item.damageType]}[key]??item[key];
        result=text(field).includes(value);
      } else result=text([item.name,item.bucket,item.type,item.owner,item.rarity,item.notes,...(item.tags||[]),...(item.perks||[])].join(' ')).includes(t);
      return negative?!result:result;
    };
    // OR separates groups; tokens within each group are ANDed.
    const groups=[[]];for(const token of tokens)token==='or'?groups.push([]):groups.at(-1).push(token);
    return groups.some(group=>group.length>0&&group.every(check))||!tokens.length;
  }
  function unwrapDefinitions(data,table) {
    if(!data||typeof data!=='object'||Array.isArray(data))return null;
    if(data.Response)return unwrapDefinitions(data.Response,table);
    if(data[table])return unwrapDefinitions(data[table],table);
    return Object.entries(data).some(([key,d])=>/^\d+$/.test(key)&&d&&typeof d==='object'&&d.displayProperties)?data:null;
  }
  function powerSet(items) {
    let plans=[{items:[],score:0,mask:0}];
    for(const [index,bucket] of slots.slice(0,8).entries()) {
      const candidates=items.filter(i=>(i.gearBucket||i.bucket)===bucket);
      if(!candidates.length)continue;
      const next=new Map();
      for(const plan of plans)for(const item of candidates) {
        const bit=item.exotic?(index<3?1:2):0;
        if(bit&&(plan.mask&bit))continue;
        const mask=plan.mask|bit,score=plan.score+Number(item.power||0)*10000+Number(!!item.equipped);
        if(!next.has(mask)||score>next.get(mask).score)next.set(mask,{items:[...plan.items,item],score,mask});
      }
      plans=[...next.values()];
    }
    return plans.sort((a,b)=>b.score-a.score)[0]?.items||[];
  }
  function armorPlan(items,{classType=1,weights={},exoticId=''}={}) {
    const armorSlots=slots.slice(3,8);
    let plans=[{items:[],score:0,exotics:0}];
    const missing=[];
    for(const bucket of armorSlots) {
      const candidates=items.filter(i=>(i.gearBucket||i.bucket)===bucket&&!i.isPostmaster&&!(i.tags||[]).includes('junk')&&(i.classType==null||Number(i.classType)===3||Number(i.classType)===Number(classType)));
      if(!candidates.length){missing.push(bucket);continue;}
      const next=new Map();
      for(const plan of plans)for(const item of candidates) {
        if(exoticId&&item.exotic&&item.id!==exoticId)continue;
        const exotics=plan.exotics+Number(!!item.exotic);if(exotics>1)continue;
        const score=plan.score+Object.entries(item.stats||{}).reduce((n,[stat,value])=>n+(stats.includes(stat)?(Number(value)||0)*(Number(weights[stat])||1):0),0);
        const key=exotics;
        if(!next.has(key)||score>next.get(key).score)next.set(key,{items:[...plan.items,item],score,exotics});
      }
      plans=[...next.values()];
    }
    if(exoticId)plans=plans.filter(plan=>plan.items.some(i=>i.id===exoticId));
    const best=plans.sort((a,b)=>b.score-a.score)[0];
    return {items:best?.items||[],score:best?.score||0,missing,complete:!!best&&best.items.length===5};
  }
  const api={powerSet,armorPlan,slots,stats,total,slotCompare,compare,matches,unwrapDefinitions};
  if(typeof module==='object')module.exports=api;else root.InventoryCore=api;
})(typeof window==='object'?window:globalThis);
