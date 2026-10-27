/* Little Light — local-first Destiny inventory companion. */
(() => {
  'use strict';
  const STORAGE_KEY = 'little-light-workspace-v2';
  const BUCKET_CAPACITY = 10; // equipped + inventory spaces; adjustable on imported bucket data in a future live adapter
  const FARM_BUCKETS = new Set(['Kinetic Weapons','Energy Weapons','Power Weapons','Helmet','Gauntlets','Chest Armor','Leg Armor','Class Item','Arms','Legs','Chest','Head','Consumables','Materials','Ghost','Ship','Sparrow','Vehicle','Emblem']);
  const SLOT_GLYPHS = {
    'Kinetic Weapons':'⌁','Energy Weapons':'⌁','Power Weapons':'⌁','Weapons':'⌁','Helmet':'◉','Head':'◉','Gauntlets':'♧','Arms':'♧','Chest Armor':'◇','Chest':'◇','Leg Armor':'⌑','Legs':'⌑','Class Item':'⌇','Subclass':'✧','Ghost':'◌','Ship':'△','Sparrow':'⌁','Vehicle':'⌁','Consumables':'✧','Materials':'◈','Emblem':'✦','General':'◈','Other':'◈'
  };
  const STAT_NAMES = window.InventoryCore.stats;
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];

  function demoItems() {
    const a = [];
    const add = (name, bucket, owner, power, rarity, opts={}) => a.push({id:opts.id || `demo-${a.length+1}`, name, bucket, type:opts.type || inferType(bucket), owner, power, rarity, equipped:!!opts.equipped, locked:!!opts.locked, tags:opts.tags || [], notes:opts.notes || '', icon:opts.icon || '', perks:opts.perks || [], stats:opts.stats || {}, exotic:rarity==='Exotic', transferable:opts.transferable!==false, itemHash:opts.itemHash||'', isDemo:true});
    const hunter='Hunter';
    add('The Navigator','Kinetic Weapons',hunter,2010,'Exotic',{equipped:true,locked:true,tags:['keep'],perks:['Weft Cutter','Protective Weave'],stats:{Range:35,Stability:60,Handling:55,Reload:48}});
    add('Rufus’s Fury','Energy Weapons',hunter,2010,'Legendary',{equipped:true,locked:true,perks:['Perpetual Motion','Target Lock'],stats:{Range:72,Stability:48,Handling:52,Reload:52}});
    add('Apex Predator','Power Weapons',hunter,2010,'Legendary',{equipped:true,perks:['Reconstruction','Bait and Switch'],stats:{'Blast Radius':55,Velocity:42,Handling:44,Reload:38}});
    add('Celestial Nighthawk','Helmet',hunter,2010,'Exotic',{equipped:true,locked:true,tags:['keep'],stats:{Mobility:12,Resilience:18,Recovery:2,Discipline:14,Intellect:10,Strength:10}});
    add('Renewal Grasps','Gauntlets',hunter,2009,'Exotic',{equipped:false,locked:true,tags:['keep'],stats:{Mobility:4,Resilience:22,Recovery:8,Discipline:18,Intellect:8,Strength:10}});
    add('Woven Mail Vest','Chest Armor',hunter,2010,'Legendary',{equipped:true,tags:['strand'],stats:{Mobility:10,Resilience:20,Recovery:12,Discipline:14,Intellect:6,Strength:10}});
    add('Threadrunner Strides','Leg Armor',hunter,2009,'Legendary',{equipped:true,stats:{Mobility:14,Resilience:12,Recovery:12,Discipline:10,Intellect:8,Strength:14}});
    add('Cloak of the Unraveling','Class Item',hunter,2010,'Legendary',{equipped:true,stats:{Mobility:0,Resilience:0,Recovery:0,Discipline:0,Intellect:0,Strength:0}});
    add('The Call','Kinetic Weapons',hunter,2009,'Legendary',{perks:['Lead from Gold','One for All'],stats:{Range:48,Stability:58,Handling:42,Reload:38}});
    add('Hung Jury SR4','Kinetic Weapons',hunter,2004,'Legendary',{perks:['Rapid Hit','Kinetic Tremors'],stats:{Range:72,Stability:40,Handling:32,Reload:45}});
    add('Smite of Merain','Kinetic Weapons',hunter,2003,'Legendary',{perks:['Demolitionist','Firefly']});
    add('Midnight Coup','Kinetic Weapons',hunter,2002,'Legendary',{perks:['Explosive Payload','One for All']});
    add('Succession','Kinetic Weapons',hunter,2001,'Legendary',{perks:['Reconstruction','Vorpal Weapon']});
    add('The Supremacy','Kinetic Weapons',hunter,2000,'Legendary',{perks:['Rewind Rounds','Bait and Switch']});
    add('Chattering Bone','Kinetic Weapons',hunter,1998,'Legendary',{perks:['Outlaw','Kill Clip']});
    add('Piece of Mind','Kinetic Weapons',hunter,1995,'Legendary',{perks:['Perpetual Motion','Moving Target']});
    add('Night Watch','Kinetic Weapons',hunter,1988,'Legendary',{perks:['Rapid Hit','Explosive Payload']});
    add('Quicksilver Storm','Energy Weapons',hunter,2008,'Exotic',{locked:true,tags:['keep'],perks:['Rocket Tracers','Grenade Launcher']});
    add('Edge Transit','Power Weapons',hunter,2007,'Legendary',{perks:['Envious Assassin','Bait and Switch'],stats:{'Blast Radius':50,Velocity:35,Handling:40,Reload:32}});
    add('Stasis Hood','Helmet',hunter,2004,'Legendary',{stats:{Mobility:8,Resilience:12,Recovery:16,Discipline:18,Intellect:4,Strength:10}});
    add('Strand Grips','Gauntlets',hunter,2003,'Legendary',{equipped:true,stats:{Mobility:14,Resilience:6,Recovery:12,Discipline:16,Intellect:10,Strength:8}});
    add('Solstice Vest','Chest Armor',hunter,2002,'Legendary',{stats:{Mobility:10,Resilience:18,Recovery:10,Discipline:12,Intellect:10,Strength:10}});
    add('Iron Banner Boots','Leg Armor',hunter,2001,'Legendary',{stats:{Mobility:8,Resilience:16,Recovery:12,Discipline:14,Intellect:8,Strength:12}});
    add('Threaded Cloak','Class Item',hunter,2000,'Legendary',{stats:{Mobility:0,Resilience:0,Recovery:0,Discipline:0,Intellect:0,Strength:0}});
    add('Lost Sector Engram','Consumables',hunter,0,'Legendary',{transferable:true});
    add('Upgrade Module','Consumables',hunter,0,'Legendary',{transferable:true});
    add('Prismatic Fragments','Materials',hunter,0,'Legendary',{transferable:true});
    add('Rufus’s Fury','Energy Weapons','Vault',1994,'Legendary',{perks:['Perpetual Motion','Target Lock']});
    add('Gjallarhorn','Power Weapons','Vault',2005,'Exotic',{locked:true,tags:['keep'],perks:['Wolfpack Rounds']});
    add('Calus Mini-Tool','Energy Weapons','Vault',1998,'Legendary',{perks:['Threat Detector','Incandescent']});
    add('Beloved','Kinetic Weapons','Vault',1996,'Legendary',{perks:['Snapshot Sights','Quickdraw']});
    add('Assassin’s Cowl','Helmet','Vault',1997,'Exotic',{locked:true,tags:['keep'],stats:{Mobility:12,Resilience:10,Recovery:10,Discipline:12,Intellect:8,Strength:16}});
    add('Lucky Pants','Leg Armor','Vault',1992,'Exotic',{stats:{Mobility:10,Resilience:14,Recovery:8,Discipline:8,Intellect:12,Strength:14}});
    add('Woven Mail Vest','Chest Armor','Vault',1999,'Legendary',{stats:{Mobility:10,Resilience:20,Recovery:12,Discipline:14,Intellect:6,Strength:10},perks:['Duplicate sample roll']});
    add('Apex Predator','Power Weapons','Vault',1995,'Legendary',{perks:['Tracking Module','Explosive Light']});
    add('Omolon Engram','Consumables','Vault',0,'Legendary');
    add('Ship — Starlight','Ship','Vault',0,'Legendary');
    add('Warlock Bond','Class Item','Warlock',2000,'Legendary',{stats:{}});
    add('Ophidian Aspect','Gauntlets','Warlock',2008,'Exotic',{equipped:true,locked:true,tags:['keep'],stats:{Mobility:6,Resilience:12,Recovery:18,Discipline:8,Intellect:10,Strength:10}});
    add('Solar Hood','Helmet','Warlock',2007,'Legendary',{equipped:true,stats:{Mobility:8,Resilience:10,Recovery:18,Discipline:14,Intellect:8,Strength:8}});
    add('Commemoration','Power Weapons','Warlock',2004,'Legendary',{equipped:true,perks:['Reconstruction','Killing Tally']});
    add('Funnelweb','Energy Weapons','Warlock',2003,'Legendary',{equipped:true,perks:['Subsistence','Frenzy']});
    return a.map(i=>({...i,...(window.LittleLightSampleArt?.[i.name]||{})}));
  }
  function inferType(bucket='Other') {
    if (/weapon/i.test(bucket)) return 'Weapon';
    if (/helmet|head|gauntlet|arm|chest|leg|class item|bond|cloak|mark|armor/i.test(bucket)) return 'Armor';
    if (/consumable|material|engram|ghost|ship|sparrow|vehicle|emblem|subclass/i.test(bucket)) return bucket;
    return 'Other';
  }
  function safeParse(raw) { try { return JSON.parse(raw); } catch { return null; } }
  function getDefaultState() {
    return {version:2,items:demoItems(),loadouts:[],demo:true,bannerDismissed:false,farm:{enabled:false,owner:'Hunter',spaces:1,includeWeapons:true,includeArmor:true,includeUtility:true},compareIds:[],log:[],preferences:{}};
  }
  let state = loadState();
  if(state.demo)state.items=state.items.map(i=>({...i,...(window.LittleLightSampleArt?.[i.name]||{})}));
  let page = 'inventory';
  state.preferences||={};
  if(!state.preferences.dimRefresh){state.preferences.theme='dark';state.preferences.inventoryGrouping='board';state.preferences.dimRefresh=1;persist();}
  document.documentElement.dataset.theme=state.preferences.theme||'dark';
  let inventoryFilter = 'All';
  let inventoryOwner = 'All locations';
  let inventoryQuery = '';
  let sortBy = state.preferences?.sortBy||'power';
  let inventoryView=state.preferences?.inventoryView||'cards';
  let inventoryGrouping=state.preferences?.inventoryGrouping||'location';
  const selectedIds=new Set();
  let tagUndo=null;
  let builderConfig={classType:1,priority:'Resilience',exoticId:''};
  let builderResult=null;
  let selectedItemId = null;
  let activeDrawer = null;
  let lastFarmPlan = null;
  let cleanerFilter = 'all';

  function loadState() {
    const raw = safeParse(localStorage.getItem(STORAGE_KEY) || '');
    if (!raw || !Array.isArray(raw.items)) return getDefaultState();
    raw.preferences=raw.preferences&&typeof raw.preferences==='object'?raw.preferences:{};
    raw.items=raw.items.map(normalizeWorkspaceItem);
    raw.loadouts = Array.isArray(raw.loadouts) ? raw.loadouts : [];
    raw.log = Array.isArray(raw.log) ? raw.log : [];
    raw.farm = {...getDefaultState().farm,...(raw.farm||{})};
    raw.compareIds = Array.isArray(raw.compareIds) ? raw.compareIds : [];
    return raw;
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { toast('Browser storage is full. Export your workspace before continuing.', 'error'); }
    syncSidebar();
  }
  function escapeHtml(value='') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function normalizeName(s='') { return String(s).toLowerCase().replace(/[’']/g,"'").replace(/[^a-z0-9]+/g,' ').trim(); }
  function numeric(x, fallback=0) { const v=Number(String(x??'').replace(/,/g,'')); return Number.isFinite(v)?v:fallback; }
  function isProtected(item) { return item.locked || (item.tags||[]).some(t => ['keep','favorite','favourite','protect','protected','favorite','fav'].includes(String(t).toLowerCase())) || state.loadouts.some(l => (l.itemIds||[]).includes(item.id)); }
  function isArmor(item) { return item.type==='Armor' || /helmet|head|gauntlet|arm|chest|leg|class item|bond|cloak|mark/i.test(item.bucket||item.type||''); }
  function isWeapon(item) { return item.type==='Weapon' || /weapon/i.test(item.bucket||item.type||''); }
  function totalStats(item) { return STAT_NAMES.reduce((n,k)=>n+numeric(item.stats?.[k],0),0); }
  function iconFor(item) { return SLOT_GLYPHS[item.bucket] || (isWeapon(item)?'⌁':isArmor(item)?'◇':'✦'); }
  function ownerNames() {
    const set = new Set(state.items.map(i=>i.owner||'Vault'));
    return ['Hunter','Titan','Warlock',...([...set].filter(x=>!['Hunter','Titan','Warlock','Vault'].includes(x)).sort()),'Vault'].filter((x,i,a)=>a.indexOf(x)===i && set.has(x));
  }
  function counts() {
    const locs={}; state.items.forEach(i=>{const o=i.owner||'Vault';locs[o]=(locs[o]||0)+1;});
    return {total:state.items.length,vault:locs.Vault||0,guardians:ownerNames().filter(x=>x!=='Vault').length,protected:state.items.filter(isProtected).length,locs};
  }
  function normalizeImportedItem(raw, index) {
    const n={}; Object.entries(raw||{}).forEach(([k,v])=>n[normalizeName(k).replace(/ /g,'')]=v);
    const get=(keys, fallback='')=>{for(const key of keys){const k=normalizeName(key).replace(/ /g,'');if(n[k]!==undefined&&n[k]!==null&&n[k]!=='')return n[k];}return fallback;};
    const name=String(get(['name','item name','item','display name','weapon name'],'')).trim();
    if(!name || /^(?:name|item name)$/i.test(name)) return null;
    const bucket=String(get(['bucket','bucket name','slot','item type','type','equipment slot'],'Other')).trim()||'Other';
    const rawType=String(get(['type','item category','category'],'')).trim();
    let type = /weapon/i.test(rawType)?'Weapon':/armor/i.test(rawType)?'Armor':(rawType||inferType(bucket));
    const tags=String(get(['tags','tag'],'')).split(/[;,|]/).map(s=>s.trim()).filter(Boolean);
    const perks=String(get(['perks','traits','perks 1','perk 1','trait 1'],'')).split(/[;,|]/).map(s=>s.trim()).filter(Boolean);
    const stats={};
    for(const stat of [...STAT_NAMES,'Range','Stability','Handling','Reload','Reload Speed','Impact','Aim Assistance','Zoom','Recoil Direction','Rounds Per Minute','Magazine','Blast Radius','Velocity','Charge Time','Draw Time','Accuracy','Ammo Capacity']){ const value=get([stat,`${stat} stat`,`stat ${stat}`],undefined); if(value!==undefined&&value!=='')stats[stat]=numeric(value,0); }
    const bool = (v) => /^(1|true|yes|y|locked|equipped)$/i.test(String(v).trim());
    const owner = String(get(['owner','character','location','store','character name'],'Vault')).trim()||'Vault';
    const pow = numeric(get(['power','power level','light','light level','item power'],0),0);
    const rarity = String(get(['rarity','tier','item rarity'],'Legendary')).trim()||'Legendary';
    const icon=String(get(['icon','image','icon url','image url'],'')).trim();
    return {id:String(get(['id','item id','instance id','hash'],`import-${Date.now()}-${index}`)).trim()||`import-${Date.now()}-${index}`,name,bucket,type,owner,power:pow,rarity,equipped:bool(get(['equipped','is equipped'],false)),locked:bool(get(['locked','lock','is locked'],false)),tags,notes:String(get(['notes','note','comment'],'')).trim(),icon,perks,stats,exotic:/exotic/i.test(rarity),transferable:!bool(get(['non-transferable','notransfer','cannot transfer'],false)),itemHash:String(get(['item hash','manifest hash','definition hash'],'')).trim()};
  }
  function parseCSV(text) {
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
      else if(c==='"')quoted=true;
      else if(c===','){row.push(field);field='';}
      else if(c==='\n'){row.push(field.replace(/\r$/,''));if(row.some(x=>x.trim()!==''))rows.push(row);row=[];field='';}
      else field+=c;
    }
    if(field.length||row.length){row.push(field.replace(/\r$/,''));if(row.some(x=>x.trim()!==''))rows.push(row);}
    if(rows.length<2) return [];
    const headers=rows.shift().map(h=>h.trim().replace(/^\uFEFF/,''));
    return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
  }
  function asWorkspace(data) {
    if(Array.isArray(data)) return {items:data};
    if(data && Array.isArray(data.items)) return data;
    if(data && data.response?.data?.items) return null; // Raw Bungie API profiles need manifest/hash resolution; don't mislabel as imported inventory.
    return null;
  }
  function normalizeWorkspaceItem(raw, index) {
    const item=raw&&typeof raw==='object'?raw:{};
    const bucket=String(item.bucket||item.slot||'Other');
    const rarity=String(item.rarity||'Legendary');
    const tags=Array.isArray(item.tags)?item.tags.map(String):String(item.tags||'').split(/[;,|]/).map(x=>x.trim()).filter(Boolean);
    const perks=Array.isArray(item.perks)?item.perks.map(String):String(item.perks||'').split(/[;,|]/).map(x=>x.trim()).filter(Boolean);
    const stats=item.stats&&typeof item.stats==='object'&&!Array.isArray(item.stats)?Object.fromEntries(Object.entries(item.stats).map(([key,value])=>[key,numeric(value)])):{};
    const bool=v=>typeof v==='string'?/^(true|1|yes|y)$/i.test(v.trim()):Boolean(v);
    return {...item,id:String(item.id||`workspace-${Date.now()}-${index}`),name:String(item.name||item.Name||(item.itemHash?'Unresolved item #'+item.itemHash:'Unnamed imported item')),bucket,type:String(item.type||inferType(bucket)),owner:String(item.owner||'Vault'),power:numeric(item.power,0),rarity,equipped:bool(item.equipped),locked:bool(item.locked),tags,notes:String(item.notes||''),icon:String(item.icon||''),perks,stats,exotic:item.exotic!==undefined?bool(item.exotic):/exotic/i.test(rarity),transferable:item.transferable!==false,itemHash:String(item.itemHash||'')};
  }
  function saveLog(text) { state.log.unshift({id:`log-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,text,at:new Date().toISOString()}); state.log=state.log.slice(0,30); }
  function toast(message, kind='') {
    const node=document.createElement('div');node.className=`toast ${kind}`;node.textContent=message;$('#toastRegion').append(node);setTimeout(()=>node.remove(),3600);
  }
  function syncSidebar() {
    const c=counts(); $('#inventoryNavCount').textContent=String(c.total);$('#loadoutNavCount').textContent=String(state.loadouts.length);
    $('#profileLabel').textContent=state.demo?'Local workspace':'Imported inventory';$('#profileSub').textContent=state.demo?'Sample inventory':'Saved in this browser';
    $('#sourceStatus').textContent=state.demo?'Sample data':'Local data';$('#farmNavDot').classList.toggle('on',!!state.farm.enabled);
    const banner=$('#sampleBanner');banner.classList.toggle('hidden',!state.demo||state.bannerDismissed);
  }
  function go(to) {
    page=to;activeDrawer=null;closeDetail();$('#pageCrumb').textContent=({dim:'DIM inventory',organizer:'Organizer',optimizer:'Loadout optimizer',dimloadouts:'DIM loadouts',vendors:'Vendors',collections:'Collections & catalysts',progress:'Progress & triumphs',feed:'Item feed',settings:'DIM settings',appraisal:'Gear appraisal',drops:'New drops',watch:'Build watcher',goals:'Loot goals',bulk:'Bulk actions',power:'Maximum power',postmaster:'Postmaster',shard:'Shard List',audit:'Setup audit',builder:'Armor builder',dashboard:'Overview',inventory:'Inventory',farming:'Farming Mode',loadouts:'Loadouts',compare:'Compare',cleaner:'Vault review',data:'Import & export'})[to]||'Overview';
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===to));$('#sidebar').classList.remove('open');renderPage();window.scrollTo({top:0,behavior:'instant'});$('#pageContent').focus({preventScroll:true});
  }
  function renderPage() {
    const target=$('#pageContent');
    const renderers={builder:renderBuilder,dashboard:renderDashboard,inventory:renderInventory,farming:renderFarming,loadouts:renderLoadouts,compare:renderCompare,cleaner:renderCleaner,data:renderData};
    target.innerHTML=(renderers[page]||renderDashboard)();syncSidebar();
    if(page==='inventory') bindInventoryControls();
  }
  function pageHeading(eyebrow,title,description,actions='') {return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;}
  function renderDashboard() {
    const c=counts(),owners=ownerNames().filter(n=>n!=='Vault');
    const top=state.items.filter(i=>i.owner!=='Vault').sort((a,b)=>numeric(b.power)-numeric(a.power)).slice(0,5);
    const locRows=owners.map(o=>{const items=state.items.filter(i=>i.owner===o);const armor=items.filter(isArmor).length;return `<div class="guardian-row"><div class="guardian-emblem">${o==='Hunter'?'✧':o==='Titan'?'⬡':'◈'}</div><div class="guardian-info"><b>${escapeHtml(o)}</b><small>${items.filter(i=>i.equipped).length} equipped · ${armor} armor pieces</small><div class="meter"><span style="width:${Math.min(100,items.length/50*100)}%"></span></div></div><div class="guardian-count"><b>${items.length}</b><small>items</small></div></div>`;}).join('')||'<div class="empty-state">Import your character inventory to see your Guardians here.</div>';
    return `${pageHeading('YOUR INVENTORY AT A GLANCE','A little light. A lot of possibilities.','Less time in your vault. More time out there. Your Guardians, favorite rolls and next great build, together.',`<button class="button" data-action="go-inventory">Explore your arsenal ↗</button>`)}
      <section class="welcome-card"><div><span class="eyebrow">A HOME FOR YOUR GEAR</span><h2>Make room for<br>your next favorite.</h2><p>Find the roll. Save the build. Head back to orbit.</p><div class="hero-actions"><button class="button" data-action="go-inventory">Open inventory <span>↗</span></button><button class="button button-outline" data-action="go-cleaner">Review your vault</button></div></div><div class="orbit-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="light-star">✧</div><span class="orbit-spark spark-one">✦</span><span class="orbit-spark spark-two">✦</span><span class="orbit-caption">YOUR NEXT ADVENTURE AWAITS</span></div></section>
      <div class="stat-grid"><div class="stat-card"><div class="stat-label">Tracked items <span>▦</span></div><div class="stat-value">${c.total}</div><div class="stat-foot">Across this workspace</div></div><div class="stat-card"><div class="stat-label">Vault items <span>◈</span></div><div class="stat-value">${c.vault}</div><div class="stat-foot">Stored away from Guardians</div></div><div class="stat-card"><div class="stat-label">Protected <span>♧</span></div><div class="stat-value stat-accent">${c.protected}</div><div class="stat-foot">Locked, tagged or in a loadout</div></div><div class="stat-card"><div class="stat-label">Saved loadouts <span>⟐</span></div><div class="stat-value">${state.loadouts.length}</div><div class="stat-foot">Ready when you are</div></div></div>
      <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Your Guardians</h2><p>Characters found in this workspace</p></div><button class="button button-quiet button-small" data-action="go-inventory">View inventory ↗</button></div>${locRows}<div class="guardian-row"><div class="guardian-emblem">◈</div><div class="guardian-info"><b>Vault</b><small>Stored items available to plan or compare</small><div class="meter"><span style="width:${Math.min(100,c.vault/500*100)}%"></span></div></div><div class="guardian-count"><b>${c.vault}</b><small>items</small></div></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Quick actions</h2><p>Jump into the usual gear workflows</p></div></div><div class="quick-actions"><button class="quick-action" data-action="go-farming"><span class="qa-icon">♧</span><b>Farming Mode</b><small>Plan space for upcoming drops</small></button><button class="quick-action" data-action="go-loadouts"><span class="qa-icon">⟐</span><b>Loadouts</b><small>Save or restore a setup</small></button><button class="quick-action" data-action="go-cleaner"><span class="qa-icon">⌁</span><b>Review vault</b><small>Find duplicate rolls safely</small></button><button class="quick-action" data-action="go-compare"><span class="qa-icon">⇄</span><b>Compare gear</b><small>Check stats side by side</small></button></div><div class="separator"></div><div class="panel-head"><div><h2>High-power gear</h2><p>Gear carried by your characters</p></div></div><div class="mini-list">${top.map(i=>`<div class="mini-item"><div class="mini-icon">${iconFor(i)}</div><div class="mini-item-text"><b>${escapeHtml(i.name)}</b><small>${escapeHtml(i.owner)} · ${escapeHtml(i.bucket)}</small></div><span class="power-pill">${i.power||'—'}</span></div>`).join('')||'<div class="empty-state">No items loaded.</div>'}</div></section></div>`;
  }
  function matchesQuery(item, query) {
    return window.InventoryCore.matches(item,query,{protected:isProtected,duplicate:i=>state.items.filter(other=>i.itemHash?other.itemHash===i.itemHash:other.name===i.name).length>1});
  }

  function filteredItems() {
    let items=state.items.filter(i=>matchesQuery(i,inventoryQuery));
    if(inventoryOwner!=='All locations')items=items.filter(i=>i.owner===inventoryOwner);
    if(inventoryFilter==='Weapons')items=items.filter(isWeapon);else if(inventoryFilter==='Armor')items=items.filter(isArmor);else if(inventoryFilter==='Exotics')items=items.filter(i=>i.exotic||/exotic/i.test(i.rarity));else if(inventoryFilter==='Protected')items=items.filter(isProtected);else if(inventoryFilter==='Vault')items=items.filter(i=>i.owner==='Vault');else if(inventoryFilter==='Equipped')items=items.filter(i=>i.equipped);
    return items.sort((a,b)=>window.InventoryCore.compare(a,b,sortBy));
  }

  function gearCard(item, compareMode=false) {
    const selected=state.compareIds.includes(item.id);const rarity=/exotic/i.test(item.rarity)?'exotic':/rare/i.test(item.rarity)?'rare':'legendary';
    let image='';
    const path=String(item.icon||'').trim();if(path){const url=/^https?:\/\//i.test(path)?path:`https://www.bungie.net${path.startsWith('/')?'':'/'}${path}`;if(/^https:\/\//i.test(url)&&/bungie\.net|bungie\.com|images\.bungie\.net/i.test(url))image=`<img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.remove()">`;}
    return `<div class="gear-card ${selected?'selected':''}" role="button" tabindex="0" data-action="open-item" data-id="${escapeHtml(item.id)}" aria-label="Inspect ${escapeHtml(item.name)}"><div class="gear-art ${image?'has-image':''}">${image}<span class="gear-glyph">${iconFor(item)}</span><span class="gear-power">${item.power||'—'}</span><span class="gear-rarity ${rarity}"></span>${compareMode?`<input class="card-select" type="checkbox" aria-label="Select ${escapeHtml(item.name)}" data-action="select-item" data-id="${escapeHtml(item.id)}" ${selectedIds.has(item.id)?'checked':''}><input class="card-add-compare" type="checkbox" aria-label="Add ${escapeHtml(item.name)} to compare" data-action="toggle-compare" data-id="${escapeHtml(item.id)}" ${selected?'checked':''}>`:''}</div><div class="gear-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div><div class="gear-tags">${(item.tags||[]).slice(0,2).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div><div class="gear-type">${escapeHtml(item.bucket)} · ${escapeHtml(item.rarity||'Unknown')}</div><div class="gear-bottom"><span class="gear-tag">${item.owner==='Vault'?'VAULT':escapeHtml(item.owner)}</span><span class="gear-lock">${item.equipped?'● ':''}${item.locked?'▣':''}${state.loadouts.some(l=>(l.itemIds||[]).includes(item.id))?' ⟐':''}</span></div></div>`;
  }
  function renderInventory() {
    for(const id of selectedIds)if(!state.items.some(i=>i.id===id))selectedIds.delete(id);
    const items=filteredItems();const owners=['All locations',...ownerNames()];
    const ownerOptions=owners.map(o=>`<option ${inventoryOwner===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
    const filters=['All','Weapons','Armor','Exotics','Equipped','Protected','Vault'];
    const sections=new Map();
    items.forEach(i=>{const key=`${i.owner}|||${i.bucket}`;if(!sections.has(key))sections.set(key,[]);sections.get(key).push(i);});
    const grouped=[...sections.entries()].sort(([a],[b])=>{const [ao,ab]=a.split('|||'),[bo,bb]=b.split('|||');return owners.indexOf(ao)-owners.indexOf(bo)||window.InventoryCore.slotCompare(ab,bb);});
    const content=inventoryGrouping==='board'?renderInventoryBoard(items):inventoryGrouping==='flat'?`<div class="bucket-grid view-${inventoryView}">${items.map(i=>gearCard(i,true)).join('')}</div>`:grouped.map(([key,values])=>{const [owner,bucket]=key.split('|||');return `<section class="inventory-section"><div class="inventory-section-head"><h2>${escapeHtml(owner)} <span class="muted">/</span> ${escapeHtml(bucket)}</h2><small>${values.length} item${values.length===1?'':'s'}</small></div><div class="bucket-grid view-${inventoryView}">${values.map(i=>gearCard(i,true)).join('')}</div></section>`;}).join('');
    return `${pageHeading('GEAR & STORAGE','Your arsenal','Your whole arsenal, in order. Select gear to organize it, or use the compare checkbox to inspect rolls side by side.',`<button class="button button-quiet" data-action="go-data">Import / export</button>`)}
      <div class="inventory-toolbar"><div class="search-wrap"><span>⌕</span><input class="control" id="inventorySearch" value="${escapeHtml(inventoryQuery)}" placeholder="Search gear, perks, tags… try is:locked or bucket:helmet" aria-label="Search inventory"></div><select class="control" id="ownerSelect" aria-label="Filter by location">${ownerOptions}</select><select class="control" id="sortSelect" aria-label="Sort inventory"><option value="power" ${sortBy==='power'?'selected':''}>Power: high to low</option><option value="name" ${sortBy==='name'?'selected':''}>Name: A–Z</option><option value="stats" ${sortBy==='stats'?'selected':''}>Armor stats</option><option value="rarity" ${sortBy==='rarity'?'selected':''}>Exotics first</option><option value="bucket" ${sortBy==='bucket'?'selected':''}>Item slot</option></select></div>
      <div class="filter-chip-row">${filters.map(f=>`<button class="filter-chip ${inventoryFilter===f?'active':''}" data-action="inventory-filter" data-value="${f}">${f==='All'?'All gear':f}${f==='Protected'?` (${state.items.filter(isProtected).length})`:''}</button>`).join('')}<span class="muted small" style="align-self:center;margin-left:auto">${items.length} results</span></div>
      <details class="inventory-advanced" ${selectedIds.size||state.compareIds.length?'open':''}><summary>Organize & display options · ${selectedIds.size} selected · ${state.compareIds.length}/3 comparing</summary><div class="inventory-options"><select class="control" id="viewSelect" aria-label="Inventory display">${['cards','compact','list'].map(v=>`<option value="${v}" ${v===inventoryView?'selected':''}>${v[0].toUpperCase()+v.slice(1)} view</option>`).join('')}</select><select class="control" id="groupSelect" aria-label="Inventory grouping"><option value="board" ${inventoryGrouping==='board'?'selected':''}>Character & vault board</option><option value="location" ${inventoryGrouping==='location'?'selected':''}>Group by location & slot</option><option value="flat" ${inventoryGrouping==='flat'?'selected':''}>All results, sorted together</option></select><button class="button button-quiet" data-action="save-search">Save search</button><button class="button button-quiet" data-action="reset-filters">Reset filters</button><button class="button button-quiet" data-action="export-results">Export results</button></div>
      <details class="search-help"><summary>Search tips & saved searches</summary><p>Combine filters: <code>is:weapon power:&gt;=2000 -is:locked</code> · <code>perk:"bait and switch"</code> · <code>is:duplicate</code> · <code>stat.resilience:&gt;=20</code> · <code>element:solar OR element:void</code></p><div class="filter-chip-row">${(state.preferences?.savedSearches||[]).map((q,n)=>`<button class="filter-chip" data-action="use-search" data-value="${n}">${escapeHtml(q.name)}</button><button class="icon-button" data-action="delete-search" data-value="${n}" aria-label="Delete saved search ${escapeHtml(q.name)}">×</button>`).join('')||'<span class="muted">Save your favorite filters for next time.</span>'}</div></details>
      <div class="selection-bar"><span>${selectedIds.size} selected · ${state.compareIds.length}/3 comparing</span><button class="button button-quiet" data-action="select-results">Select results</button><button class="button button-quiet" data-action="clear-selected">Clear</button><select class="control" id="bulkTag" aria-label="Tag selected items"><option value="keep">Keep</option><option value="favorite">Favorite</option><option value="review">Review</option><option value="junk">Junk (tag only)</option></select><button class="button" data-action="tag-selected" ${selectedIds.size?'':'disabled'}>Apply tag</button>${tagUndo?'<button class="button button-quiet" data-action="undo-tags">Undo tags</button>':''}${state.compareIds.length?'<button class="button button-quiet" data-action="go-compare">Compare →</button>':''}</div>
      </details>${content||'<div class="empty-state"><strong>No gear matches that view.</strong>Try removing a filter, or import a DIM inventory CSV.</div>'}`;
  }
  function renderInventoryBoard(items) {
    const owners=[...new Set([...ownerNames().filter(o=>o!=='Vault'),'Vault'])];
    const slots=[...new Set(items.map(i=>i.bucket))].sort(window.InventoryCore.slotCompare);
    return `<div class="arsenal-scroll"><div class="arsenal-board" style="--stores:${owners.length}">${owners.map(o=>`<header class="store-banner"><span>${o==='Vault'?'◈':'✧'}</span><div><h2>${escapeHtml(o)}</h2><small>${items.filter(i=>i.owner===o).length} items · ${items.filter(i=>i.owner===o&&i.equipped).length} equipped</small></div></header>`).join('')}${slots.map(slot=>owners.map(owner=>{const gear=items.filter(i=>i.owner===owner&&i.bucket===slot);return `<section class="store-slot"><h3>${escapeHtml(slot)} <span>${gear.length}</span></h3><div class="store-items">${gear.map(i=>gearCard(i,true)).join('')||'<span class="empty-slot">—</span>'}</div></section>`;}).join('')).join('')}</div></div>`;
  }
  function bindInventoryControls() {
    const search=$('#inventorySearch');if(search)search.addEventListener('input',e=>{inventoryQuery=e.target.value;const pos=e.target.selectionStart;renderPage();const el=$('#inventorySearch');el.focus();el.setSelectionRange(pos,pos);});
    const owner=$('#ownerSelect');if(owner)owner.addEventListener('change',e=>{inventoryOwner=e.target.value;renderPage();});
    for(const [id,set] of [['viewSelect',v=>inventoryView=v],['groupSelect',v=>inventoryGrouping=v]])$("#"+id)?.addEventListener('change',e=>{set(e.target.value);saveInventoryPreferences();renderPage();});
    const sort=$('#sortSelect');if(sort)sort.addEventListener('change',e=>{sortBy=e.target.value;saveInventoryPreferences();renderPage();});
  }
  function saveInventoryPreferences(){state.preferences={...(state.preferences||{}),sortBy,inventoryView,inventoryGrouping};persist();}
  function farmCandidateSort(a,b) {
    const score=i=>(isProtected(i)?100000:0)+(i.equipped?90000:0)+(i.exotic?20000:0)+(i.power||0)+((i.tags||[]).length*500);
    return score(a)-score(b)||a.name.localeCompare(b.name);
  }
  function farmBucketIncluded(bucket) {
    if(/weapon/i.test(bucket))return state.farm.includeWeapons;
    if(/helmet|head|gauntlet|arm|chest|leg|class item|cloak|bond|mark|armor/i.test(bucket))return state.farm.includeArmor;
    return state.farm.includeUtility;
  }
  function buildFarmPlan() {
    const owner=state.farm.owner||ownerNames().find(x=>x!=='Vault')||'Hunter';
    const spaces=Math.max(1,Math.min(9,numeric(state.farm.spaces,1)));
    const byBucket=new Map();
    state.items.filter(i=>i.owner===owner&&FARM_BUCKETS.has(i.bucket)&&farmBucketIncluded(i.bucket)).forEach(i=>{if(!byBucket.has(i.bucket))byBucket.set(i.bucket,[]);byBucket.get(i.bucket).push(i);});
    const plan=[];const rows=[];let blocked=0;
    for(const [bucket,items] of [...byBucket.entries()].sort(([a],[b])=>a.localeCompare(b))){
      const current=items.length;const target=Math.max(0,BUCKET_CAPACITY-spaces);const required=Math.max(0,current-target);
      const candidates=items.filter(i=>!i.equipped&&i.transferable!==false&&!isProtected(i)).sort(farmCandidateSort);
      const picked=candidates.slice(0,required);const unavailable=Math.max(0,required-picked.length);blocked+=unavailable;
      plan.push(...picked.map(i=>({id:i.id,name:i.name,bucket,from:owner,to:'Vault'})));
      rows.push({bucket,current,spaces:Math.max(0,BUCKET_CAPACITY-current),required,picked:picked.length,blocked:unavailable,items:items.length});
    }
    return {owner,spaces,plan,rows,blocked,ready:rows.length>0&&plan.length===0&&blocked===0};
  }
  function renderFarming() {
    const plan=buildFarmPlan();lastFarmPlan=plan;
    const owners=ownerNames().filter(o=>o!=='Vault');const opts=owners.map(o=>`<option ${state.farm.owner===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
    const rows=plan.rows.map(r=>`<div class="bucket-plan-row"><div class="bucket-plan-name">${escapeHtml(r.bucket)}<small>${r.current} of ${BUCKET_CAPACITY} spaces used · ${r.spaces} currently free</small></div><div class="plan-count">${r.picked?`−${r.picked} <span>move${r.picked===1?'':'s'}</span>`:`${r.spaces} <span>free</span>`}</div><span class="plan-pill ${r.blocked?'warn':r.picked?'move':'clear'}">${r.blocked?`${r.blocked} blocked`:r.picked?'Plan move':'Clear'}</span></div>`).join('');
    const locations=state.items.filter(i=>i.owner===plan.owner).length;
    return `${pageHeading('INVENTORY AUTOMATION','Farming Mode','Keep room in item buckets so newly earned gear has a slot instead of being pushed toward the Postmaster. This page previews and applies the logic to your local workspace.',`<button class="button button-quiet" data-action="farm-refresh">↻ Recalculate</button>`)}
      <div class="inline-alert warning"><span class="alert-symbol">ⓘ</span><div><b>Local planning only</b><br>DIM’s real Farming Mode automatically watches a live Bungie inventory and moves items through the vault. This project currently plans and simulates those moves against imported/local data only; it does not log in to Bungie or move live game items.</div></div>
      <div class="farm-hero"><section class="farm-main-card"><div class="farm-status ${state.farm.enabled?'active':''}"><span class="status-dot"></span>${state.farm.enabled?'Mode enabled in this workspace':'Mode stopped'}</div><h2>${state.farm.enabled?'Space is being maintained.':'Keep your pockets ready.'}</h2><p>${state.farm.enabled?'Local inventory changes will trigger another planning pass. Newly imported items may be moved into the vault when needed.':'Choose a Guardian and the number of spaces to preserve for each eligible item bucket, then preview the move plan before applying it.'}</p><button class="button farm-switch-button" data-action="toggle-farm">${state.farm.enabled?'Stop Farming Mode':'Start Farming Mode'}</button><span class="muted small" style="margin-left:12px">Changes only this browser’s workspace</span></section><div class="farm-side-stats"><div class="farm-small-card"><label>Items to move now</label><strong>${plan.plan.length}</strong><small>from ${escapeHtml(plan.owner)} to Vault</small></div><div class="farm-small-card"><label>Buckets checked</label><strong>${plan.rows.length}</strong><small>eligible item categories</small></div><div class="farm-small-card"><label>Protected gear</label><strong>${state.items.filter(i=>i.owner===plan.owner&&isProtected(i)).length}</strong><small>excluded from safe moves</small></div><div class="farm-small-card"><label>Capacity blocked</label><strong>${plan.blocked}</strong><small>could not be safely moved</small></div></div></div>
      <div class="farm-settings"><section class="panel farm-controls"><div class="panel-head"><div><h2>Farm settings</h2><p>Choose what the local planner will preserve</p></div></div><div class="field-stack"><label class="field-label" for="farmOwner">Guardian</label><select class="control" id="farmOwner" style="width:100%">${opts||'<option>Hunter</option>'}</select></div><div class="field-stack"><label class="field-label" for="farmSpaces">Empty spaces to preserve per bucket</label><div class="range-line"><input type="range" id="farmSpaces" min="1" max="9" value="${plan.spaces}"><span class="range-value" id="farmSpacesValue">${plan.spaces}</span></div><div class="field-note">DIM exposes a 1–9 empty-space setting. The preview uses a local per-bucket capacity of ${BUCKET_CAPACITY} to estimate moves.</div></div><div class="separator"></div><label class="switch-line"><input type="checkbox" id="farmWeapons" ${state.farm.includeWeapons?'checked':''}><span><b>Include weapons</b><small>Primary/kinetic, energy and power weapon buckets.</small></span></label><label class="switch-line"><input type="checkbox" id="farmArmor" ${state.farm.includeArmor?'checked':''}><span><b>Include armor</b><small>Helmet, arms, chest, legs and class-item buckets.</small></span></label><label class="switch-line"><input type="checkbox" id="farmUtility" ${state.farm.includeUtility?'checked':''}><span><b>Include other eligible gear</b><small>Utility buckets such as ships, vehicles and consumables when present.</small></span></label><div class="separator"></div><button class="button button-quiet" data-action="farm-refresh">Recalculate plan</button> <button class="button" data-action="farm-apply">Apply local plan</button></section>
      <section class="panel"><div class="panel-head"><div><h2>Next move plan</h2><p>Only un-equipped, transferable, unprotected items are candidates.</p></div><span class="tag">Preview</span></div>${plan.rows.length?rows:'<div class="empty-state"><strong>No eligible bucket data found.</strong>Import character and bucket columns from an inventory CSV. Buckets with no items are ignored, just as the live mode only checks buckets containing items.</div>'}<div class="separator"></div><div class="form-tip">Smart-move principle: item transfers between Guardians normally route through the Vault. This local planner only moves gear from the selected Guardian into the Vault; it never dismantles items. Locked items, gear tagged keep/favorite/protected, and items referenced by a saved loadout are excluded.</div>${plan.blocked?'<div class="inline-alert warning" style="margin-top:14px"><span>!</span><div>Some buckets cannot reach the requested free-space target without touching equipped or protected gear. Review the bucket rows above before changing your protection tags.</div></div>':''}<div class="panel-head" style="margin-top:18px"><div><h2>Recent local moves</h2><p>Audit trail for this browser</p></div></div>${state.log.length?`<div class="mini-list">${state.log.slice(0,5).map(l=>`<div class="mini-item"><div class="mini-icon">↗</div><div class="mini-item-text"><b>${escapeHtml(l.text)}</b><small>${new Date(l.at).toLocaleString()}</small></div></div>`).join('')}</div>`:'<div class="empty-state">No local move operations have been applied yet.</div>'}</section></div>`;
  }
  function bindFarmControls() {
    const owner=$('#farmOwner');if(owner)owner.addEventListener('change',e=>{state.farm.owner=e.target.value;persist();renderPage();});
    const range=$('#farmSpaces');if(range)range.addEventListener('input',e=>{state.farm.spaces=numeric(e.target.value,1);$('#farmSpacesValue').textContent=state.farm.spaces;});
    const updateCheck=(id,key)=>{const el=$(id);if(el)el.addEventListener('change',e=>{state.farm[key]=e.target.checked;persist();renderPage();});};
    updateCheck('#farmWeapons','includeWeapons');updateCheck('#farmArmor','includeArmor');updateCheck('#farmUtility','includeUtility');
  }
  function renderBuilder() {
    const weights={[builderConfig.priority]:3};
    const available=state.items.filter(i=>!i.equipped||i.owner===({0:'Titan',1:'Hunter',2:'Warlock'})[builderConfig.classType]||i.classType==null);
    builderResult=window.InventoryCore.armorPlan(available,{...builderConfig,weights});
    const names=[...new Set(state.items.filter(isArmor).flatMap(i=>Object.keys(i.stats||{})))].filter(n=>STAT_NAMES.includes(n));
    const exotics=available.filter(i=>isArmor(i)&&i.exotic&&(i.classType==null||Number(i.classType)===builderConfig.classType));
    return `${pageHeading('BUILD SOMETHING GREAT','Armor builder','Find a five-piece armor set using the stats you value. Preview it, then save it as a protected loadout.')}
    <section class="panel"><div class="inventory-options"><label>Class <select class="control" id="builderClass">${['Titan','Hunter','Warlock'].map((name,i)=>`<option value="${i}" ${builderConfig.classType===i?'selected':''}>${name}</option>`).join('')}</select></label><label>Prioritize <select class="control" id="builderPriority">${(names.length?names:STAT_NAMES.slice(0,6)).map(name=>`<option ${name===builderConfig.priority?'selected':''}>${escapeHtml(name)}</option>`).join('')}</select></label><label>Exotic <select class="control" id="builderExotic"><option value="">Best available</option>${exotics.map(i=>`<option value="${escapeHtml(i.id)}" ${i.id===builderConfig.exoticId?'selected':''}>${escapeHtml(i.name)}</option>`).join('')}</select></label><button class="button" data-action="save-armor-build" ${builderResult.complete?'':'disabled'}>Save armor loadout</button></div><p class="muted">Your priority stat counts 3×; other armor stats count 1×. At most one exotic. Junk-tagged and Postmaster items are excluded. Uses reported item stats; mods, fragments and set bonuses are not simulated. Imported items without class data need your class check.</p></section>
    ${builderResult.complete?`<div class="stat-grid">${names.map(name=>`<div class="stat-card"><div class="stat-label">${escapeHtml(name)}</div><div class="stat-value">${builderResult.items.reduce((sum,i)=>sum+numeric(i.stats?.[name]),0)}</div></div>`).join('')}</div><div class="bucket-grid">${builderResult.items.map(i=>gearCard(i)).join('')}</div>`:`<div class="empty-state"><strong>No complete set available.</strong>${escapeHtml(builderResult.missing.length?'Missing slots: '+builderResult.missing.join(', '):'Try a different exotic or class.')}</div>`}`;
  }
  function renderLoadouts() {
    const cards=state.loadouts.map(l=>{
      const items=(l.itemIds||[]).map(id=>state.items.find(i=>i.id===id)).filter(Boolean);const snapshot=l.itemsSnapshot||[];const displayed=items.length?items:snapshot;
      return `<article class="loadout-card"><div class="loadout-card-top"><div class="loadout-emblem">⟐</div><div class="loadout-title"><b>${escapeHtml(l.name)}</b><small>${escapeHtml(l.owner||'Any Guardian')} · ${displayed.length} saved items</small></div><button class="icon-button" data-action="delete-loadout" data-id="${escapeHtml(l.id)}" aria-label="Delete loadout">×</button></div><div class="loadout-slots">${['Kinetic Weapons','Energy Weapons','Power Weapons','Helmet','Gauntlets','Chest Armor','Leg Armor','Class Item'].map(b=>{const it=displayed.find(i=>i.bucket===b);return `<span class="loadout-slot" title="${escapeHtml(b)}">${it?iconFor(it):'·'}</span>`}).join('')}</div><div class="loadout-notes">${escapeHtml(l.notes||'Saved snapshot of selected gear.')} ${l.source==='demo'?'<span class="tag">Sample</span>':''}</div><div class="loadout-actions"><button class="button button-quiet button-small" data-action="rename-loadout" data-id="${escapeHtml(l.id)}">Rename</button><button class="button button-quiet button-small" data-action="duplicate-loadout" data-id="${escapeHtml(l.id)}">Duplicate</button><button class="button button-quiet button-small" data-action="view-loadout" data-id="${escapeHtml(l.id)}">Inspect</button><button class="button button-small" data-action="apply-loadout" data-id="${escapeHtml(l.id)}">${state.source==='bungie'?'Equip in Destiny':'Apply locally'}</button></div></article>`;
    }).join('');
    return `${pageHeading('GEAR CONFIGURATIONS','Loadouts','Save your equipped gear and restore a setup when you need it. Loadout-referenced items are protected from Farming Mode and vault review.',`<button class="button" data-action="save-loadout">＋ Save current setup</button>`)}
      <div class="inline-alert"><span class="alert-symbol">⟐</span><div><b>Loadouts are snapshots here.</b><br>The official Bungie loadout, subclass, socket, mod and artifact APIs have additional rules. Connected gear snapshots can equip weapons and armor in Destiny after a preview. Offline snapshots apply locally. Mods, subclass sockets and artifact selections are not restored.</div></div>
      ${cards?`<div class="loadout-grid">${cards}</div>`:'<div class="empty-state"><strong>No saved loadouts yet.</strong>Equip or select gear in your workspace, then use “Save current setup” to create a snapshot.</div>'}`;
  }
  function currentSetup(owner) { return state.items.filter(i=>i.owner===owner&&i.equipped); }
  function showSaveLoadoutModal() {
    const owners=ownerNames().filter(o=>o!=='Vault');const current=state.farm.owner||owners[0]||'Hunter';
    $('#modal').innerHTML=`<h2 id="modalTitle">Save a loadout</h2><p>Save the currently equipped items for one Guardian. The snapshot will protect those items from safe cleanup and Farming Mode moves.</p><div class="field-stack"><label class="field-label" for="loadoutName">Loadout name</label><input class="control" id="loadoutName" placeholder="Strand Hunter · Solo Dungeon" maxlength="70" style="width:100%"></div><div class="field-stack"><label class="field-label" for="loadoutOwner">Guardian</label><select class="control" id="loadoutOwner" style="width:100%">${owners.map(o=>`<option ${o===current?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select><div class="field-note" id="loadoutItemCount">${currentSetup(current).length} currently equipped items will be saved.</div></div><div class="field-stack"><label class="field-label" for="loadoutNotes">Build notes (optional)</label><textarea class="control" id="loadoutNotes" rows="3" maxlength="500" placeholder="Subclass, activity, reminders…" style="width:100%;resize:vertical"></textarea></div><div class="modal-actions"><button class="button button-quiet" data-action="close-modal">Cancel</button><button class="button" data-action="confirm-save-loadout">Save loadout</button></div>`;
    $('#modalScrim').hidden=false;$('#loadoutOwner').addEventListener('change',e=>$('#loadoutItemCount').textContent=`${currentSetup(e.target.value).length} currently equipped items will be saved.`);$('#loadoutName').focus();
  }
  function renderCompare() {
    state.compareIds=state.compareIds.filter(id=>state.items.some(i=>i.id===id)).slice(0,3);
    const chosen=state.compareIds.map(id=>state.items.find(i=>i.id===id)).filter(Boolean);
    const options=state.items.filter(i=>isArmor(i)||isWeapon(i)).sort((a,b)=>totalStats(b)-totalStats(a)).slice(0,45);
    const chooser=options.map(i=>`<label class="compare-pick"><input type="checkbox" data-action="toggle-compare" data-id="${escapeHtml(i.id)}" ${state.compareIds.includes(i.id)?'checked':''} ${!state.compareIds.includes(i.id)&&state.compareIds.length>=3?'disabled':''}><b>${escapeHtml(i.name)}</b><small>${escapeHtml(i.owner)} · ${i.power||'—'}</small></label>`).join('');
    let table='';
    if(chosen.length){const metrics=[...new Set(chosen.flatMap(i=>Object.keys(i.stats||{}))),'Total stats','Power'];table=`<div class="table-wrap"><table class="data-table"><thead><tr><th>Stat</th>${chosen.map(i=>`<th>${escapeHtml(i.name)}<span class="table-sub">${escapeHtml(i.bucket)} · ${escapeHtml(i.owner)}</span></th>`).join('')}</tr></thead><tbody>${metrics.map(metric=>{const values=chosen.map(i=>metric==='Total stats'?totalStats(i):metric==='Power'?numeric(i.power):numeric(i.stats?.[metric]));const max=Math.max(1,...values);return `<tr><td><strong>${escapeHtml(metric)}</strong></td>${values.map(v=>`<td class="metric-cell">${v||'—'}${metric!=='Power'?`<div class="stat-bar"><span style="width:${Math.min(100,v/max*100)}%"></span></div>`:''}</td>`).join('')}</tr>`}).join('')}</tbody></table></div>`;}
    return `${pageHeading('STAT-BY-STAT','Compare gear','Select up to three weapons or armor pieces to compare their visible stats. Imported rolls may not include masterwork or mod adjustments.',`<button class="button button-quiet" data-action="clear-compare">Clear selection</button>`)}<div class="settings-grid"><section class="panel"><div class="panel-head"><div><h2>Choose gear</h2><p>Showing up to 45 gear pieces from the workspace.</p></div><span class="tag">${chosen.length}/3</span></div>${chooser||'<div class="empty-state">Import armor items first.</div>'}</section><section class="panel"><div class="panel-head"><div><h2>Comparison</h2><p>Visible imported values only</p></div></div>${chosen.map(i=>`<div class="compare-perks"><b>${escapeHtml(i.name)}</b><p>${(i.perks||[]).map(escapeHtml).join(' · ')||'No perk data'}</p><button class="button button-quiet button-small" data-action="open-item" data-id="${escapeHtml(i.id)}">Inspect</button> <button class="button button-quiet button-small" data-action="toggle-compare" data-id="${escapeHtml(i.id)}">Remove</button></div>`).join('')}${table||'<div class="empty-state"><strong>No items selected.</strong>Choose one or more items from the list.</div>'}<div class="field-note" style="margin-top:15px">This lightweight comparison does not apply DIM’s manifest data, sockets, mods, artifice stats or optimizer rules.</div></section></div>`;
  }
  function duplicateGroups() {
    const groups=new Map();state.items.filter(i=>i.owner!=='Vault'||true).forEach(i=>{const key=`${normalizeName(i.name)}|${(i.perks||[]).map(normalizeName).sort().join(',')}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);});
    return [...groups.values()].filter(g=>g.length>1);
  }
  function cleanupSuggestions() {
    const duplicates=duplicateGroups().flatMap(group=>{const sorted=[...group].sort((a,b)=>(isProtected(b)?1:0)-(isProtected(a)?1:0)||numeric(b.power)-numeric(a.power)||totalStats(b)-totalStats(a));const keep=sorted[0];return sorted.slice(1).map(i=>({item:i,reason:`Duplicate roll — keep ${keep.name} (${keep.power||'—'} power)`,kind:'duplicate',keeper:keep}));});
    const lowArmor=state.items.filter(isArmor).map(i=>({item:i,score:totalStats(i)})).filter(x=>x.score>0).sort((a,b)=>a.score-b.score).slice(0,12).map(({item,score})=>({item,reason:`Low total stat roll (${score})`,kind:'low-stats'}));
    const unprotected=state.items.filter(i=>i.owner==='Vault'&&!isProtected(i)&&!i.equipped).map(item=>({item,reason:'In Vault and not protected — review before any cleanup',kind:'unprotected'}));
    return {duplicates,lowArmor,unprotected,all:[...duplicates,...lowArmor,...unprotected].filter((x,i,arr)=>arr.findIndex(y=>y.item.id===x.item.id)===i)};
  }
  function renderCleaner() {
    const groups=cleanupSuggestions();const entries=cleanerFilter==='duplicates'?groups.duplicates:cleanerFilter==='low'?groups.lowArmor:cleanerFilter==='unprotected'?groups.unprotected:groups.all;
    const rows=entries.map(s=>`<tr><td><strong>${escapeHtml(s.item.name)}</strong><span class="table-sub">${escapeHtml(s.item.bucket)} · ${escapeHtml(s.item.owner)} · ${s.item.power||'—'} power</span></td><td>${escapeHtml(s.reason)}${isProtected(s.item)?'<span class="tag good" style="margin-left:7px">Protected</span>':''}</td><td>${s.kind==='duplicate'?'Duplicate':s.kind==='low-stats'?'Low stats':'Review'}</td><td><button class="button button-quiet button-small" data-action="open-item" data-id="${escapeHtml(s.item.id)}">Inspect</button> ${isProtected(s.item)?'':`<button class="button button-quiet button-small" data-action="protect-item" data-id="${escapeHtml(s.item.id)}">Protect</button>`}</td></tr>`).join('');
    return `${pageHeading('SAFE VAULT TRIAGE','Vault review','Find exact duplicate-name/perk combinations, spot low-stat armor, and review unprotected vault items. This page never dismantles or deletes gear.',`<button class="button button-quiet" data-action="go-inventory">Back to inventory</button>`)}
      <div class="inline-alert warning"><span class="alert-symbol">!</span><div><b>Suggestions are not dismantle recommendations.</b><br>These local heuristics are deliberately conservative. They don’t know the complete Destiny manifest, wishlists, perk pools, set bonuses or current meta. Inspect a piece before doing anything to it.</div></div>
      <div class="stat-grid"><div class="stat-card"><div class="stat-label">Duplicate-roll candidates</div><div class="stat-value">${groups.duplicates.length}</div><div class="stat-foot">Same normalized name + imported perks</div></div><div class="stat-card"><div class="stat-label">Low-stat armor samples</div><div class="stat-value">${groups.lowArmor.length}</div><div class="stat-foot">Sorted by imported stat total</div></div><div class="stat-card"><div class="stat-label">Unprotected vault gear</div><div class="stat-value">${groups.unprotected.length}</div><div class="stat-foot">Review only; not auto-selected</div></div><div class="stat-card"><div class="stat-label">Protected items</div><div class="stat-value stat-accent">${state.items.filter(isProtected).length}</div><div class="stat-foot">Never proposed for a move here</div></div></div>
      <section class="panel"><div class="panel-head"><div><h2>Review suggestions</h2><p>Inspect an item to add protection, notes or a local move.</p></div></div><div class="filter-chip-row">${[['all','All suggestions'],['duplicates','Duplicates'],['low','Low stats'],['unprotected','Unprotected Vault']].map(([k,label])=>`<button class="filter-chip ${cleanerFilter===k?'active':''}" data-action="cleaner-filter" data-value="${k}">${label}</button>`).join('')}</div><div class="table-wrap">${rows?`<table class="data-table"><thead><tr><th>Item</th><th>Why it appeared</th><th>Rule</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty-state"><strong>No suggestions in this category.</strong>Try another filter or import your own inventory.</div>'}</div></section>`;
  }
  function renderData() {
    return `${pageHeading('YOUR SAVE FILE','Import & export','Bring in gear you exported from DIM or a Little Light workspace backup. Data is kept in local browser storage and is not uploaded to a server.',`<button class="button button-quiet" data-action="export-json">↓ Export workspace</button>`)}
      <div class="settings-grid"><section class="panel"><div class="panel-head"><div><h2>Import inventory</h2><p>CSV inventory exports or Little Light JSON backups</p></div><span class="tag">Local only</span></div><label class="dropzone" for="importFile"><span class="drop-icon">↥</span><b>Choose a CSV or JSON file</b><small>Files are read in your browser. Nothing is sent to a server.</small><input type="file" id="importFile" accept=".csv,.json,text/csv,application/json"></label><div class="field-stack" style="margin-top:16px"><label class="switch-line"><input type="checkbox" id="appendImport"><span><b>Append instead of replace</b><small>Leave this off to replace current gear with the imported inventory.</small></span></label></div><div class="inline-alert" style="margin-top:15px"><span class="alert-symbol">ⓘ</span><div><b>CSV headers are mapped flexibly.</b><br>Useful fields include Name, Bucket/Slot, Type, Owner/Character, Power, Rarity, Equipped, Locked, Tags, Notes, Perks and armor stats. Rows without a location default to Vault.</div></div><button class="button button-quiet button-small" data-action="download-sample">Download sample CSV</button></section>
      <section class="panel"><div class="panel-head"><div><h2>Export your workspace</h2><p>Create a backup or use the items in another tool</p></div></div><div class="quick-actions"><button class="quick-action" data-action="export-json"><span class="qa-icon">↓</span><b>Workspace JSON</b><small>Items, tags, notes, loadouts and local settings</small></button><button class="quick-action" data-action="export-csv"><span class="qa-icon">▤</span><b>Gear CSV</b><small>Inventory rows with owners, buckets and imported stats</small></button><button class="quick-action" data-action="export-farm"><span class="qa-icon">♧</span><b>Farm plan CSV</b><small>Export the latest move preview</small></button><button class="quick-action" data-action="reset-demo"><span class="qa-icon">↺</span><b>Reset sample</b><small>Discard local edits and restore preview gear</small></button></div><div class="separator"></div><div class="form-tip"><b>What this version can and cannot do</b><br>It can manage data you import, save local loadouts, compare imported stats, and plan Farming Mode moves. Connect Bungie to sync inventory, transfer, lock and equip gear. Mods, subclasses and dismantling are not changed by this app. Raw Bungie profile JSON requires game-manifest/hash resolution and is not treated as a ready-to-use inventory file.</div></section></div>
      <section class="panel" style="margin-top:15px"><div class="panel-head"><div><h2>Current workspace</h2><p>Browser-local storage summary</p></div><button class="button button-quiet button-small" data-action="clear-workspace">Clear workspace</button></div><div class="stat-grid" style="margin:0"><div class="stat-card"><div class="stat-label">Items</div><div class="stat-value">${state.items.length}</div></div><div class="stat-card"><div class="stat-label">Loadouts</div><div class="stat-value">${state.loadouts.length}</div></div><div class="stat-card"><div class="stat-label">Recent operations</div><div class="stat-value">${state.log.length}</div></div><div class="stat-card"><div class="stat-label">Dataset type</div><div class="stat-value" style="font-size:18px">${state.demo?'Sample':state.source==='bungie'?'Bungie':'Imported'}</div></div></div></section><section class="panel activity-panel"><h2 class="section-title">Recent activity</h2>${state.log.slice(0,10).map(entry=>`<div class="activity-row"><span>${escapeHtml(entry.text)}</span><time>${escapeHtml(new Date(entry.at).toLocaleString())}</time></div>`).join('')||'<p class="muted">Your workspace activity will appear here.</p>'}</section>`;
  }
  function download(filename, text, mime='text/plain;charset=utf-8') {
    const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function csvCell(value) { const s=String(value??'');return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
  function exportItemsCSV(items=state.items) {
    const exportStats=[...new Set([...STAT_NAMES,...items.flatMap(i=>Object.keys(i.stats||{}))])];
    const cols=['Id','Name','Bucket','Type','Owner','Power','Rarity','Equipped','Locked','Tags','Notes','Perks',...exportStats,'Icon','Item Hash'];
    return [cols.join(','),...items.map(i=>[i.id,i.name,i.bucket,i.type,i.owner,i.power,i.rarity,i.equipped,i.locked,(i.tags||[]).join(';'),i.notes,(i.perks||[]).join(';'),...exportStats.map(s=>i.stats?.[s]??''),i.icon,i.itemHash].map(csvCell).join(','))].join('\r\n');
  }
  function exportWorkspace() {download('little-light-workspace.json',JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2),'application/json');toast('Workspace backup downloaded.','success');}
  function exportFarmCSV() {const p=lastFarmPlan||buildFarmPlan();const rows=[['Item','Bucket','From','To','Action'],...p.plan.map(x=>[x.name,x.bucket,x.from,x.to,'Move to Vault'])];download('little-light-farm-plan.csv',rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast(`Exported ${p.plan.length} planned moves.`,'success');}
  function importFile(file) {
    const reader=new FileReader();reader.onerror=()=>toast('Could not read that file.','error');reader.onload=()=>{
      let imported=[], workspace=null, workspaceBackup=false;
      try{
        if(file.name.toLowerCase().endsWith('.json')){const parsed=JSON.parse(reader.result);workspace=asWorkspace(parsed);if(!workspace){toast('This JSON does not look like a Little Light workspace. Raw Bungie profile JSON needs manifest resolution first.','error');return;}workspaceBackup=!!(!Array.isArray(parsed)&&Array.isArray(parsed.items));imported=workspace.items.map((x,i)=>workspaceBackup?normalizeWorkspaceItem(x,i):normalizeImportedItem({...x},i)).filter(Boolean);}
        else imported=parseCSV(String(reader.result)).map(normalizeImportedItem).filter(Boolean);
      }catch(err){toast(`Import failed: ${err.message||'invalid file'}`,'error');return;}
      if(!imported.length){toast('No inventory rows were recognized. Check that the file has a Name or Item column.','error');return;}
      const append=$('#appendImport')?.checked;
      if(append){const existing=new Set(state.items.map(i=>i.id));imported=imported.map((i,n)=>({...i,id:existing.has(i.id)?`${i.id}-import-${Date.now()}-${n}`:i.id}));state.items.push(...imported);}
      else {state.items=imported;if(workspaceBackup){state.loadouts=Array.isArray(workspace.loadouts)?workspace.loadouts:[];state.farm={...getDefaultState().farm,...(workspace.farm||{})};state.log=Array.isArray(workspace.log)?workspace.log:[];state.compareIds=Array.isArray(workspace.compareIds)?workspace.compareIds:[];}else{state.loadouts=[];state.compareIds=[];state.log=[];}}
      state.demo=false;state.source='import';state.farm.enabled=false;state.preferences=workspaceBackup?(workspace.preferences||{}):(state.preferences||{});state.shardList=workspaceBackup?(workspace.shardList||[]):[];imported.forEach(i=>{i.isLiveItem=false;});state.bannerDismissed=true;saveLog(`${append?'Appended':'Imported'} ${imported.length} item rows from ${file.name}`);persist();
      state.farm.enabled=false;
      toast(`Imported ${imported.length} items into your local workspace.`,'success');go('inventory');
    };reader.readAsText(file);
  }
  function downloadSampleCSV() {
    const sample=[['Id','Name','Bucket','Type','Owner','Power','Rarity','Equipped','Locked','Tags','Notes','Perks','Mobility','Resilience','Recovery','Discipline','Intellect','Strength'],['sample-1','Demo Strand Helmet','Helmet','Armor','Hunter','2010','Legendary','true','false','strand;keep','Sample row','', '12','18','4','14','10','10'],['sample-2','Demo Rocket Launcher','Power Weapons','Weapon','Hunter','2010','Legendary','true','true','favorite','Sample row','Reconstruction;Bait and Switch','','','','','','']];download('little-light-sample.csv',sample.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
  }
  function openItem(id) {
    const item=state.items.find(i=>i.id===id);if(!item)return;selectedItemId=id;
    const owners=[...new Set([...ownerNames(),'Vault',item.owner])].filter((v,i,a)=>v&&a.indexOf(v)===i);
    document.querySelector('.detail-sheet')?.remove();document.querySelector('.detail-scrim')?.remove();
    const scrim=document.createElement('div');scrim.className='detail-scrim';scrim.dataset.action='close-detail';document.body.append(scrim);
    const sheet=document.createElement('aside');sheet.className='detail-sheet';sheet.id='detailSheet';sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-label','Item inspector');
    sheet.innerHTML=`<div class="detail-top"><span class="eyebrow" style="margin:0">ITEM INSPECTOR</span><button class="icon-button" data-action="close-detail" aria-label="Close item inspector">×</button></div><div class="detail-art"><span>${iconFor(item)}</span></div><h2>${escapeHtml(item.name)}</h2><div class="detail-meta">${escapeHtml(item.bucket)} · ${escapeHtml(item.rarity||'Unknown')} · ${item.power||'No power'} power</div><div class="field-row" style="margin-top:12px">${item.locked?'<span class="tag good">Locked</span>':''}${isProtected(item)?'<span class="tag good">Protected</span>':''}${item.equipped?'<span class="tag">Equipped</span>':''}</div><div class="detail-stats">${[...new Set(['Power',...Object.keys(item.stats||{}),...(isArmor(item)?['Total stats']:[])])].map(s=>`<div class="detail-stat"><b>${s==='Power'?(item.power||'—'):s==='Total stats'?totalStats(item):(item.stats?.[s]??'—')}</b><small>${escapeHtml(s)}</small></div>`).join('')}</div><div class="compare-perks">${(item.perks||[]).map(escapeHtml).join(' · ')||'No perk data available'}</div><div class="field-stack"><label class="field-label" for="detailOwner">Location</label><select class="control" id="detailOwner" style="width:100%">${owners.map(o=>`<option ${o===item.owner?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select></div><div class="field-stack"><label class="field-label" for="detailTags">Tags (comma separated)</label><input class="control" id="detailTags" style="width:100%" value="${escapeHtml((item.tags||[]).join(', '))}" placeholder="keep, favorite, strand"></div><div class="field-stack"><label class="field-label" for="detailNotes">Notes</label><textarea class="control" id="detailNotes" rows="3" style="width:100%;resize:vertical" placeholder="Why are you keeping this roll?">${escapeHtml(item.notes||'')}</textarea></div><div class="detail-actions"><button class="button button-quiet" data-action="toggle-lock" data-id="${escapeHtml(id)}">${item.locked?'Unlock item':'Lock item'}</button><button class="button button-quiet" data-action="toggle-equip" data-id="${escapeHtml(id)}">${item.equipped?'Unequip':'Equip locally'}</button><button class="button button-quiet" data-action="save-item-details" data-id="${escapeHtml(id)}">Save tags & notes</button><button class="button button-outline" data-action="move-item" data-id="${escapeHtml(id)}">Move locally</button></div><div class="form-tip">Local preview only. Changes here are stored by this browser and are not sent to Destiny 2.</div>`;
    document.body.append(sheet);sheet.querySelector('button').focus();window.LittleLightExtension?.afterRender?.(page);
  }
  function closeDetail(){const previous=selectedItemId;document.querySelector('.detail-sheet')?.remove();document.querySelector('.detail-scrim')?.remove();selectedItemId=null;if(previous)document.querySelector('[data-action="open-item"][data-id="'+CSS.escape(previous)+'"]')?.focus();}
  function closeModal(){$('#modalScrim').hidden=true;$('#modal').innerHTML='';}
  function applyFarmPlan(plan, notify=true) {
    if(!plan)plan=buildFarmPlan();const moved=[];
    for(const move of plan.plan){const i=state.items.find(x=>x.id===move.id);if(i&&i.owner===move.from&&!i.equipped&&!isProtected(i)&&i.transferable!==false){i.owner='Vault';i.equipped=false;moved.push(i);saveLog(`Farming Mode: ${i.name} → Vault (local)`);}}
    persist();lastFarmPlan=buildFarmPlan();
    if(notify)toast(moved.length?`Moved ${moved.length} item${moved.length===1?'':'s'} to Vault in this workspace.`:'No safe moves were needed.','success');
    return moved.length;
  }
  function farmAfterInventoryChange() {
    if (!state.farm.enabled) return 0;
    return applyFarmPlan(buildFarmPlan(), false);
  }
  function startFarm() {
    state.farm.enabled=!state.farm.enabled;
    if(state.farm.enabled){const plan=buildFarmPlan();applyFarmPlan(plan,false);saveLog(`Farming Mode enabled for ${state.farm.owner} (local simulation)`);toast('Farming Mode enabled for this workspace. No Bungie items were moved.','success');}
    else {saveLog('Farming Mode stopped');toast('Farming Mode stopped.');}
    persist();renderPage();
  }
  function toggleProtection(id) {const i=state.items.find(x=>x.id===id);if(!i)return;const tags=new Set(i.tags||[]);if(tags.has('keep'))tags.delete('keep');else tags.add('keep');i.tags=[...tags];persist();if(selectedItemId)openItem(id);else renderPage();toast(tags.has('keep')?'Item protected from safe moves.':'Keep tag removed.');}
  function equipLocally(item) {
    const owner=item.owner==='Vault'?(state.farm.owner||ownerNames().find(o=>o!=='Vault')||'Hunter'):item.owner;
    state.items.forEach(other=>{if(other.id!==item.id&&other.owner===owner&&other.bucket===item.bucket)other.equipped=false;});
    item.owner=owner;item.equipped=!item.equipped;saveLog(`${item.equipped?'Equipped':'Unequipped'} ${item.name} on ${owner} (local)`);persist();farmAfterInventoryChange();openItem(item.id);toast(`${item.equipped?'Equipped':'Unequipped'} locally. No game change was made.`,'success');
  }
  function moveLocally(id) {
    const item=state.items.find(i=>i.id===id);if(!item)return;
    const target=$('#detailOwner')?.value||'Vault';if(target===item.owner){toast('That item is already there.');return;}
    if(target!=='Vault'&&item.owner!=='Vault')saveLog(`Moved ${item.name} ${item.owner} → Vault → ${target} (local smart-move preview)`);else saveLog(`Moved ${item.name} ${item.owner} → ${target} (local)`);
    item.owner=target;item.equipped=false;persist();farmAfterInventoryChange();openItem(id);toast('Item location changed in the local workspace.','success');
  }
  function saveItemDetails(id) {
    const item=state.items.find(i=>i.id===id);if(!item)return;
    item.tags=$('#detailTags').value.split(',').map(t=>t.trim()).filter(Boolean);item.notes=$('#detailNotes').value.trim();const target=$('#detailOwner').value;if(target!==item.owner){const old=item.owner;item.owner=target;item.equipped=false;saveLog(`Moved ${item.name} ${old} → ${target} (local)`);}persist();farmAfterInventoryChange();openItem(id);toast('Tags and notes saved locally.','success');
  }
  function applyLoadout(id) {
    if(state.source==='bungie'){toast('Connect Bungie to apply this loadout in Destiny.','error');return;}
    const loadout=state.loadouts.find(l=>l.id===id);if(!loadout)return;const target=loadout.owner||state.farm.owner;let applied=0,missing=0;
    (loadout.itemIds||[]).forEach(itemId=>{const item=state.items.find(i=>i.id===itemId);if(!item){missing++;return;}const prior=item.owner;if(prior!==target&&prior!=='Vault'&&target!=='Vault')saveLog(`Loadout move ${item.name} ${prior} → Vault → ${target} (local)`);state.items.forEach(other=>{if(other.id!==item.id&&other.owner===target&&other.bucket===item.bucket)other.equipped=false;});item.owner=target;item.equipped=true;applied++;});
    saveLog(`Applied loadout “${loadout.name}” to ${target} in local workspace`);persist();farmAfterInventoryChange();renderPage();toast(`Applied ${applied} items locally${missing?`; ${missing} item(s) missing`:''}. No live game changes were made.`,'success');
  }
  function inspectLoadout(id) {
    const l=state.loadouts.find(x=>x.id===id);if(!l)return;const items=(l.itemIds||[]).map(i=>state.items.find(x=>x.id===i)).filter(Boolean);
    $('#modal').innerHTML=`<h2 id="modalTitle">${escapeHtml(l.name)}</h2><p>${escapeHtml(l.owner||'Any Guardian')} · ${items.length} of ${(l.itemIds||[]).length} items currently available</p>${l.notes?`<div class="form-tip">${escapeHtml(l.notes)}</div><div class="separator"></div>`:''}<div class="mini-list">${items.map(i=>`<div class="mini-item"><div class="mini-icon">${iconFor(i)}</div><div class="mini-item-text"><b>${escapeHtml(i.name)}</b><small>${escapeHtml(i.bucket)} · ${escapeHtml(i.owner)} · ${i.power||'—'}</small></div></div>`).join('')||'<div class="empty-state">No items from this snapshot are currently in the imported inventory.</div>'}</div><div class="modal-actions"><button class="button button-quiet" data-action="close-modal">Close</button><button class="button" data-action="apply-loadout" data-id="${escapeHtml(id)}">${state.source==='bungie'?'Equip in Destiny':'Apply locally'}</button></div>`;$('#modalScrim').hidden=false;
  }
  function confirmSaveLoadout() {
    const name=$('#loadoutName').value.trim();const owner=$('#loadoutOwner').value;const notes=$('#loadoutNotes').value.trim();if(!name){toast('Give the loadout a name first.','error');$('#loadoutName').focus();return;}
    const equipped=currentSetup(owner);const fallback=equipped;
    if(!fallback.length){toast('No gear is available for this Guardian. Import the inventory first.','error');return;}
    state.loadouts.unshift({id:`loadout-${Date.now()}`,name,owner,notes,itemIds:fallback.map(i=>i.id),itemsSnapshot:fallback.map(i=>({...i})),createdAt:new Date().toISOString()});saveLog(`Saved loadout “${name}” (${fallback.length} items)`);persist();closeModal();go('loadouts');toast(`Saved “${name}” and protected its gear.`, 'success');
  }
  function deleteLoadout(id) {const l=state.loadouts.find(x=>x.id===id);if(!l)return;if(!confirm(`Delete the local loadout “${l.name}”? Gear items will remain.`))return;state.loadouts=state.loadouts.filter(x=>x.id!==id);persist();renderPage();toast('Loadout deleted. Gear was not changed.');}
  function resetDemo() {if(!confirm('Replace this browser workspace with the original sample gear? Imported items, notes, tags, loadouts and local moves will be discarded. Export a backup first if needed.'))return;state=getDefaultState();persist();page='dashboard';renderPage();toast('Sample workspace restored.','success');}
  function openHelp() {
    $('#modal').innerHTML=`<h2 id="modalTitle">About Little Light</h2><p>A local-first Destiny companion prototype built as a GitHub Pages project.</p><div class="form-tip"><b>What is implemented</b><br>Inventory CSV/JSON import and export, local tagging/protection, a per-bucket Farming Mode move planner, local loadout snapshots, armor stat comparison, and conservative vault review.</div><div class="separator"></div><div class="form-tip"><b>What is not implemented</b><br>Little Light cannot dismantle gear through Bungie's API, and its equipped-setup audit is a transparent heuristic rather than a full mod/subclass optimizer. Dismantling must be done in-game by you.</div><div class="help-links"><a href="https://github.com/DestinyItemManager/DIM/wiki/Inventory" target="_blank" rel="noreferrer">DIM inventory guide ↗</a><a href="https://github.com/DestinyItemManager/DIM/wiki/Loadouts" target="_blank" rel="noreferrer">DIM loadouts ↗</a><a href="https://shardorkeep.com/features/loadout-builder" target="_blank" rel="noreferrer">Shard or Keep builder ↗</a></div><div class="modal-actions"><button class="button" data-action="close-modal">Got it</button></div>`;$('#modalScrim').hidden=false;
  }

  document.addEventListener('click', e=>{
    const button=e.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;const id=button.dataset.id;const value=button.dataset.value;
    switch(action){
      case 'toggle-theme':state.preferences||={};state.preferences.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=state.preferences.theme;persist();break;
      case 'go-data':go('data');break;case 'go-inventory':go('inventory');break;case 'go-farming':go('farming');break;case 'go-loadouts':go('loadouts');break;case 'go-cleaner':go('cleaner');break;case 'go-compare':go('compare');break;
      case 'help':openHelp();break;case 'dismiss-banner':state.bannerDismissed=true;persist();$('#sampleBanner').classList.add('hidden');break;
      case 'save-armor-build':if(builderResult?.complete){const name=prompt('Name this armor loadout',builderConfig.priority+' armor');if(name?.trim()){const items=builderResult.items;state.loadouts.unshift({id:'loadout-'+Date.now(),name:name.trim(),owner:({0:'Titan',1:'Hunter',2:'Warlock'})[builderConfig.classType],itemIds:items.map(i=>i.id),itemsSnapshot:items,notes:'Armor only · weighted '+builderConfig.priority,createdAt:new Date().toISOString()});persist();go('loadouts');}}break;
      case 'rename-loadout':{const l=state.loadouts.find(l=>l.id===id);if(l){const name=prompt('Loadout name',l.name);if(name?.trim()){l.name=name.trim();persist();renderPage();}}}break;
      case 'duplicate-loadout':{const l=state.loadouts.find(l=>l.id===id);if(l){state.loadouts.unshift({...structuredClone(l),id:'loadout-'+Date.now(),name:l.name+' (copy)'});persist();renderPage();}}break;
      case 'select-item':if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);renderPage();break;
      case 'select-results':filteredItems().forEach(i=>selectedIds.add(i.id));renderPage();break;
      case 'clear-selected':selectedIds.clear();renderPage();break;
      case 'tag-selected':{const tag=$('#bulkTag').value;tagUndo=state.items.filter(i=>selectedIds.has(i.id)).map(i=>({id:i.id,tags:[...(i.tags||[])]}));for(const i of state.items.filter(i=>selectedIds.has(i.id)))i.tags=[...new Set([...(i.tags||[]),tag])];persist();renderPage();toast('Tags saved. No game items changed.');}break;
      case 'undo-tags':for(const saved of tagUndo||[]){const i=state.items.find(i=>i.id===saved.id);if(i)i.tags=saved.tags;}tagUndo=null;persist();renderPage();break;
      case 'reset-filters':inventoryQuery='';inventoryOwner='All locations';inventoryFilter='All';renderPage();break;
      case 'save-search':{const name=prompt('Name this saved search',inventoryQuery||inventoryFilter);if(name?.trim()){state.preferences||={};state.preferences.savedSearches||=[];state.preferences.savedSearches.push({name:name.trim(),query:inventoryQuery,owner:inventoryOwner,filter:inventoryFilter});persist();renderPage();}}break;
      case 'use-search':{const q=state.preferences.savedSearches[Number(value)];if(q){inventoryQuery=q.query;inventoryOwner=q.owner;inventoryFilter=q.filter;renderPage();}}break;
      case 'delete-search':state.preferences.savedSearches.splice(Number(value),1);persist();renderPage();break;
      case 'export-results':download('little-light-search.csv',exportItemsCSV(filteredItems()),'text/csv;charset=utf-8');break;
      case 'inventory-filter':inventoryFilter=value;renderPage();break;case 'cleaner-filter':cleanerFilter=value;renderPage();break;
      case 'open-item': if(!button.classList.contains('card-add-compare'))openItem(id);break;
      case 'toggle-compare':e.stopPropagation();{const cb=button.matches('input')?button:null;const exists=state.compareIds.includes(id);if(exists)state.compareIds=state.compareIds.filter(x=>x!==id);else if(state.compareIds.length<3)state.compareIds.push(id);else{if(cb)cb.checked=false;toast('Compare supports up to three items.');return;}persist();if(page==='compare'||page==='inventory')renderPage();}break;
      case 'clear-compare':state.compareIds=[];persist();renderPage();break;
      case 'toggle-farm':startFarm();break;case 'farm-refresh':lastFarmPlan=buildFarmPlan();renderPage();toast(`Recalculated: ${lastFarmPlan.plan.length} safe local move(s).`);break;case 'farm-apply':{const p=buildFarmPlan();const n=applyFarmPlan(p);renderPage();}break;
      case 'save-loadout':showSaveLoadoutModal();break;case 'confirm-save-loadout':confirmSaveLoadout();break;case 'close-modal':closeModal();break;case 'delete-loadout':deleteLoadout(id);break;case 'view-loadout':inspectLoadout(id);break;case 'apply-loadout':if($('#modalScrim').hidden)applyLoadout(id);else{closeModal();applyLoadout(id);}break;
      case 'protect-item':toggleProtection(id);break;case 'toggle-lock':{const item=state.items.find(i=>i.id===id);if(item){item.locked=!item.locked;saveLog(`${item.locked?'Locked':'Unlocked'} ${item.name} locally`);persist();farmAfterInventoryChange();openItem(id);toast(`${item.locked?'Locked':'Unlocked'} in the workspace only.`);}}break;
      case 'toggle-equip':{const item=state.items.find(i=>i.id===id);if(item)equipLocally(item);}break;case 'save-item-details':saveItemDetails(id);break;case 'move-item':moveLocally(id);break;case 'close-detail':closeDetail();break;
      case 'export-json':exportWorkspace();break;case 'export-csv':download('little-light-gear.csv',exportItemsCSV(),'text/csv;charset=utf-8');toast('Gear CSV downloaded.','success');break;case 'export-farm':exportFarmCSV();break;case 'download-sample':downloadSampleCSV();break;case 'reset-demo':resetDemo();break;
      case 'clear-workspace':if(confirm('Clear all local items, saved loadouts, notes and move history? This does not affect Destiny itself.')){state={...getDefaultState(),items:[],loadouts:[],demo:false,bannerDismissed:true};persist();renderPage();toast('Local workspace cleared.');}break;
    }
  });
  document.addEventListener('change',e=>{if(e.target.id.startsWith('builder')){if(e.target.id==='builderClass'){builderConfig.classType=Number(e.target.value);builderConfig.exoticId='';}if(e.target.id==='builderPriority')builderConfig.priority=e.target.value;if(e.target.id==='builderExotic')builderConfig.exoticId=e.target.value;renderPage();}if(e.target.id==='importFile'){const f=e.target.files?.[0];if(f)importFile(f);e.target.value='';}});
  document.addEventListener('keydown',e=>{
    const dialog=!$('#modalScrim').hidden?$('#modal'):document.querySelector('.detail-sheet');
    if(e.key==='Tab'&&dialog){const controls=[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.offsetParent!==null);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first?.focus();}}
    if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();go('inventory');$('#inventorySearch').focus();return;}
    const tile=e.target.closest?.('.gear-card');if(tile&&e.target===tile&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openItem(tile.dataset.id);}if(e.key==='Escape'){closeDetail();closeModal();$('#sidebar').classList.remove('open');}
  });
  $$('.nav-item').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));
  $('#menuToggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#pageContent').addEventListener('change',e=>{
    if(e.target.id==='farmOwner'||e.target.id==='farmWeapons'||e.target.id==='farmArmor'||e.target.id==='farmUtility') return;
  });
  // Render once, and wire controls that only exist on the active page.
  const originalRenderPage=renderPage;
  renderPage=function patchedRenderPage(){
    document.body.dataset.page=page;
    if(window.LittleLightTools?.handlesPage(page)){
      $('#pageContent').innerHTML=window.LittleLightTools.renderPage(page);syncSidebar();return;
    }
    if(window.LittleLightExtension && window.LittleLightExtension.handlesPage(page)){
      $('#pageContent').innerHTML=window.LittleLightExtension.renderPage(page);
      syncSidebar();
      window.LittleLightExtension.afterRender?.(page);
      return;
    }
    originalRenderPage();
    if(page==='farming')bindFarmControls();
    window.LittleLightExtension?.afterRender?.(page);
  };
  renderPage();
  window.LittleLightApp = {
    getState:()=>state,
    replaceState:(next)=>{state=next;persist();},
    persist:()=>persist(),
    renderPage:()=>renderPage(),
    go:(next)=>go(next),
    getPage:()=>page,
    setPage:(next)=>go(next),
    toast:(message,type)=>toast(message,type),
    saveLog:(message)=>saveLog(message),
    isProtected:(item)=>isProtected(item),
    isArmor:(item)=>isArmor(item),
    isWeapon:(item)=>isWeapon(item),
    totalStats:(item)=>totalStats(item),
    normalizeWorkspaceItem:(item,index)=>normalizeWorkspaceItem(item,index||0),
    escapeHtml:(value)=>escapeHtml(value),
    ownerNames:()=>ownerNames(),
    openItem:(id)=>openItem(id),
    refreshHeader:()=>syncSidebar()
  };
})();
