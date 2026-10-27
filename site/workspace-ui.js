/* Screenshot-inspired companion views; inventory actions stay with the existing adapters. */
(() => {
  'use strict';
  const app = window.LittleLightApp;
  const escape = app.escapeHtml;
  const core = window.InventoryCore;
  const tools = window.LittleLightTools;
  const viewPages = new Set(['dashboard', 'equipped', 'vault', 'weapons', 'armor', 'search']);
  const titles = {dashboard:'Dashboard',equipped:'Equipped',vault:'Vault',weapons:'Weapons',armor:'Armor',search:'Search'};
  let query = '';
  let owner = 'all';
  let order = 'power';
  let rating = 'all';
  let displayLimit=120,viewIdentity='';

  const paths = {
    dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    equipped:'M20 21v-2a7 7 0 0 0-14 0v2 M15.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z',
    vault:'M4 8h16v13H4z M3 3h18v5H3z M9 12h6',
    weapons:'m13 2-9 12h7l-1 8 10-13h-7z',
    armor:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6',
    drops:'M12 2v12 m-4-4 4 4 4-4 M4 8H2v13h20V8h-2 M2 15h6l2 3h4l2-3h6',
    loadouts:'M4 7h16v14H4z M8 7V3h8v4 M4 12h16',
    compare:'M3 7h17m-4-4 4 4-4 4 M21 17H4m4-4-4 4 4 4',
    search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    shard:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
    postmaster:'M3 5h18v14H3z m0 0 9 8 9-8',
    power:'M4 21v-6h4v6 M10 21V9h4v12 M16 21V3h4v18',
    bulk:'M3 3h18v5H3z M5 8v13h14V8 M9 13h6 m-3-3v6',
    sparkle:'m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
    settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
    sync:'M20 7a9 9 0 0 0-15-2L2 8 M2 2v6h6 M4 17a9 9 0 0 0 15 2l3-3 M22 22v-6h-6',
    arrow:'M5 12h14 m-5-5 5 5-5 5',
    lock:'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',
    menu:'M3 6h18 M3 12h18 M3 18h18',
    chevron:'m9 5 7 7-7 7',
    book:'M3 3h7l2 2 2-2h7v17h-7l-2 2-2-2H3z M12 5v17',
    farm:'M12 22V9 M12 15C3 15 2 8 2 5c7 0 10 3 10 10Z M12 11c0-6 5-9 10-9 0 6-3 9-10 9Z'
  };
  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.sparkle}"/></svg>`;
  }
  const state = () => app.getState();
  const pageLink = (page, text, className='text-link') => `<button class="${className}" data-workspace-page="${page}">${text}</button>`;
  function assessment(item) {
    const tags = (item.tags || []).map(t => t.toLowerCase());
    if ((state().shardList || []).some(id => String(id) === item.id)) return {label:'Staged',kind:'shard',description:'On your Shard List. Inspect and confirm in-game.'};
    if (tags.includes('junk')) return {label:'Junk tag',kind:'shard',description:'Your local junk tag; not a dismantle recommendation.'};
    const roll = window.LittleLightExtension.assessRoll(item);
    if (roll.status === 'good') return {label:'Wishlist',kind:'good',description:roll.notes};
    if (app.isProtected(item)) return {label:'Keep',kind:'keep',description:'Locked, tagged, or protected by a companion loadout.'};
    if (tags.includes('review') || roll.status === 'avoid') return {label:'Review',kind:'review',description:roll.notes};
    return {label:'Unrated',kind:'neutral',description:'Inspect the perks and stats. No keep or dismantle decision has been made.'};
  }
  function artwork(item) {
    try {
      const url = new URL(item.icon, 'https://www.bungie.net');
      if (!item.icon || url.protocol !== 'https:' || !/(^|\.)bungie\.(net|com)$/.test(url.hostname)) return '';
      return url.href;
    } catch { return ''; }
  }
  function relativeTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
  }
  function card(item, showTime=false) {
    const result = assessment(item);
    const image = artwork(item);
    const armorTotal = app.isArmor(item) ? app.totalStats(item) : 0;
    return `<button class="loot-card ${item.exotic?'loot-exotic':''}" data-action="open-item" data-id="${escape(item.id)}" title="${escape(item.name)} · ${escape(result.description)}" aria-label="Inspect ${escape(item.name)}"><span class="loot-art">${image?`<img src="${escape(image)}" alt="" loading="lazy">`:`<span class="loot-placeholder">${icon(app.isArmor(item)?'armor':'weapons')}</span>`}${item.locked?`<span class="loot-lock" title="Locked">${icon('lock')}</span>`:''}${item.equipped?'<span class="loot-equipped" title="Equipped">E</span>':''}</span><span class="loot-name">${escape(item.name)}</span><span class="loot-meta"><span>✦ ${Number(item.power)||'—'}</span><span class="loot-rating ${result.kind}">${escape(result.label)}</span></span>${armorTotal?`<span class="loot-stat">${armorTotal} total stats</span>`:''}${showTime&&item.firstSeen?`<span class="loot-time">${relativeTime(item.firstSeen)}</span>`:''}</button>`;
  }
  function empty(message) {
    return `<div class="workspace-empty">${icon('search')}<h2>Nothing here yet</h2><p>${escape(message)}</p></div>`;
  }
  function sorted(items) {
    return [...items].sort((a,b) => core.compare(a,b,order));
  }
  function matching(items) {
    const duplicateCounts=new Map();
    const identity=i=>i.itemHash||i.name;
    for(const item of state().items)duplicateCounts.set(identity(item),(duplicateCounts.get(identity(item))||0)+1);
    return sorted(items.filter(item => (owner==='all'||item.owner===owner) && (rating==='all'||(rating==='protected'?(app.isProtected(item)||assessment(item).kind==='good'):assessment(item).kind===rating)) && core.matches(item,query,{custom:i=>window.NativeCore.customTotal(i,state().preferences.customStats||{}),loadout:i=>state().loadouts.some(l=>(l.itemIds||[]).includes(i.id)),wishlist:i=>window.LittleLightExtension?.assessRoll(i).status==='good',protected:app.isProtected,duplicate:i=>(duplicateCounts.get(identity(i))||0)>1})));
  }
  function header(title, subtitle='', actions='') {
    return `<div class="workspace-heading"><div><h1>${escape(title)}</h1>${subtitle?`<p>${escape(subtitle)}</p>`:''}</div><div class="workspace-heading-actions">${actions}</div></div>`;
  }
  function dashboard() {
    const items = state().items;
    const vault = items.filter(i=>i.owner==='Vault');
    const wishlist = items.filter(i=>assessment(i).kind==='good');
    const keepers = items.filter(i=>app.isProtected(i)||assessment(i).kind==='good');
    const staged = items.filter(i=>(state().shardList||[]).some(id=>String(id)===i.id));
    const recent = items.filter(i=>Number(i.firstSeen)>0).sort((a,b)=>b.firstSeen-a.firstSeen).slice(0,100);
    const display = recent.length ? recent : sorted(items).slice(0,36);
    const stats = [
      ['Items in vault',vault.length,'Across your stored gear','vault','blue'],
      ['Wishlist matches',wishlist.length,'Exact community roll matches','appraisal','green'],
      ['Keepers',keepers.length,'Protected gear + wishlist matches','keepers','blue'],
      ['Shard List',staged.length,'Review your staged items','shard','red']
    ];
    return header('Dashboard','Your gear, your builds, your next great drop.') +
      `<button class="workspace-callout" data-workspace-page="progress"><span class="callout-icon">${icon('sparkle')}</span><span><strong>A little progress, every session.</strong> Check your triumphs, pursuits, and character progression.</span>${icon('arrow')}</button>`+
      `<div class="workspace-stats">${stats.map(([label,value,description,page,color])=>`<button class="workspace-stat" ${page==='keepers'?'data-workspace-filter="protected"':`data-workspace-page="${page}"`}><span>${label}</span><strong class="${color}">${value}</strong><small>${description} <span>→</span></small></button>`).join('')}</div>`+
      `<section class="workspace-panel"><div class="workspace-panel-heading"><div><h2>${recent.length?'Latest drops':state().demo?'Explore your sample gear':'Your arsenal'} <span>— ${recent.length?'up to 100 most recently observed items':state().demo?'illustrative inventory · connect to see your drops':'items in this workspace'}</span></h2></div>${pageLink(recent.length?'drops':'equipped',recent.length?'Review new →':'View equipped →')}</div><div class="loot-grid">${display.map(i=>card(i,true)).join('')||empty('Connect Bungie or import an inventory to get started.')}</div></section>`+
      `<div class="workspace-bottom-grid"><section class="workspace-panel"><div class="workspace-panel-heading"><h2>Ready for your next run?</h2></div><p>Save the gear you love. Find a new combination.</p><div class="workspace-shortcuts">${pageLink('loadouts',icon('loadouts')+'My loadouts','workspace-shortcut')}${pageLink('optimizer',icon('armor')+'Optimize armor','workspace-shortcut')}${pageLink('goals',icon('sparkle')+'Loot goals','workspace-shortcut')}</div></section><section class="workspace-panel"><div class="workspace-panel-heading"><h2>Your Guardians</h2></div>${app.ownerNames().filter(o=>o!=='Vault').map(o=>`<button class="guardian-summary" data-workspace-owner="${escape(o)}">${icon('equipped')}<span><strong>${escape(o)}</strong><small>${items.filter(i=>i.owner===o&&i.equipped).length} equipped · ${items.filter(i=>i.owner===o&&!i.equipped).length} carried</small></span>${icon('chevron')}</button>`).join('')||'<p>No characters in this workspace.</p>'}</section></div>`;
  }
  function controls(page, count) {
    const owners = app.ownerNames().filter(o=>page!=='equipped'||o!=='Vault');
    return `<div class="workspace-filters"><div class="workspace-filter-fields">${page!=='vault'?`<label class="sr-only" for="workspaceOwner">Location</label><select class="control" id="workspaceOwner"><option value="all">${page==='equipped'?'All Guardians':'All locations'}</option>${owners.map(o=>`<option value="${escape(o)}" ${owner===o?'selected':''}>${escape(o)}</option>`).join('')}</select>`:''}<label class="sr-only" for="workspaceRating">Appraisal</label><select class="control" id="workspaceRating">${[['all','All appraisals'],['good','Wishlist matches'],['keep','Keep'],['protected','All keepers'],['review','Review'],['shard','Staged / junk tags'],['neutral','Unrated']].map(([value,label])=>`<option value="${value}" ${rating===value?'selected':''}>${label}</option>`).join('')}</select><label class="sr-only" for="workspaceSort">Sort gear</label><select class="control" id="workspaceSort">${[['power','Power: high to low'],['name','Name: A–Z'],['stats','Highest stats'],['rarity','Exotics first']].map(([value,label])=>`<option value="${value}" ${order===value?'selected':''}>${label}</option>`).join('')}</select>${query||rating!=='all'||owner!=='all'?'<button class="button button-quiet" data-workspace-reset>Clear filters</button>':''}</div><span>${count} item${count===1?'':'s'}${query?` · “${escape(query)}”`:''}</span></div>`;
  }
  function equipped() {
    const all = matching(state().items.filter(i=>i.owner!=='Vault'&&!i.isPostmaster));
    const owners = app.ownerNames().filter(o=>o!=='Vault'&&(owner==='all'||o===owner));
    return header('Equipped','Your Guardians, slot by slot. Equipped gear leads each row.')+controls('equipped',all.length)+(owners.length?owners.map(name=>{
      const items = all.filter(i=>i.owner===name);
      const slots = [...new Set(items.map(i=>i.bucket))].sort(core.slotCompare);
      const equippedGear = state().items.filter(i=>i.owner===name&&i.equipped&&Number(i.power)>0);
      const average = equippedGear.length ? Math.floor(equippedGear.reduce((sum,i)=>sum+Number(i.power),0)/equippedGear.length) : 0;
      return `<section class="character-section"><div class="character-heading"><h2>${escape(name)} ${average?`<span title="Average displayed power of equipped gear">✦ ${average}</span>`:''}</h2><button class="button button-outline button-small" data-action="save-loadout" data-save-owner="${escape(name)}">${icon('loadouts')} Save as loadout</button></div>${slots.map(slot=>{
        const gear = items.filter(i=>i.bucket===slot);
        const worn = gear.filter(i=>i.equipped);
        const carried = gear.filter(i=>!i.equipped);
        return `<section class="equipment-row"><h3>${escape(slot)} <span>${gear.length}</span></h3><div class="equipment-row-scroll"><div class="equipment-worn">${worn.map(i=>card(i)).join('')||'<span class="empty-equipped">No equipped item</span>'}</div><div class="equipment-carried">${carried.map(i=>card(i)).join('')||'<span class="no-carried">No carried alternatives</span>'}</div></div></section>`;
      }).join('')||empty('No gear matches these filters for this Guardian.')}</section>`;
    }).join(''):empty('Connect Bungie or import character gear to see your equipped items.'));
  }
  function gearView(page) {
    let items = state().items;
    if (page==='vault') items=items.filter(i=>i.owner==='Vault');
    if (page==='weapons') items=items.filter(app.isWeapon);
    if (page==='armor') items=items.filter(app.isArmor);
    const identity=[page,query,owner,order,rating].join('|');if(identity!==viewIdentity){viewIdentity=identity;displayLimit=120;}
    const allResults=matching(items),results=allResults.slice(0,displayLimit);
    const descriptions={vault:'Everything tucked away for your next adventure.',weapons:'Find your favorite rolls. Make room for the next one.',armor:'Every piece, every distribution. Build around what matters to you.',search:'Search names, perks, tags, stats, and more.'};
    const slots=[...new Set(results.map(i=>i.bucket))].sort(core.slotCompare);
    return header(titles[page],descriptions[page],page==='search'?pageLink('inventory','Advanced inventory →','button button-outline'):'')+controls(page,allResults.length)+
      (page==='search'?`<details class="workspace-search-help"><summary>Search examples</summary><p><code>is:weapon -is:locked</code> · <code>perk:"bait and switch"</code> · <code>stat.resilience:&gt;=20</code> · <code>is:duplicate</code></p></details>`:'')+
      (results.length?(page==='search'?`<section class="workspace-panel"><div class="loot-grid">${results.map(i=>card(i)).join('')}</div></section>`:slots.map(slot=>`<section class="workspace-panel gear-slot-panel"><div class="workspace-panel-heading"><h2>${escape(slot)} <span>${results.filter(i=>i.bucket===slot).length} items</span></h2></div><div class="loot-grid">${results.filter(i=>i.bucket===slot).map(i=>card(i)).join('')}</div></section>`).join('')):empty('Try another search or clear a filter.'))+(allResults.length>displayLimit?`<div class="native-pagination"><button class="button" data-workspace-more>Show next 120 · ${allResults.length-displayLimit} remaining</button></div>`:'');
  }
  const originalHandles=tools.handlesPage;
  const originalRender=tools.renderPage;
  tools.handlesPage=page=>viewPages.has(page)||originalHandles(page);
  tools.renderPage=page=>page==='dashboard'?dashboard():page==='equipped'?equipped():viewPages.has(page)?gearView(page):originalRender(page);

  // Build a single navigation tree for Little Light workflows.
  const groups=[
    ['', [['dashboard','Dashboard','dashboard'],['drops','New drops','drops']]],
    ['Builds & planning',[['loadouts','My loadouts','loadouts'],['gamebuilds','In-game loadouts','loadouts'],['sockets','Sockets & mods','settings'],['optimizer','Loadout optimizer','sparkle']]],
    ['Gear',[['equipped','Equipped','equipped'],['vault','Vault','vault'],['postmaster','Postmaster','postmaster'],['weapons','Weapons','weapons'],['armor','Armor','armor'],['shard','Shard List','shard'],['compare','Compare','compare'],['power','Maximum power','power'],['search','Search','search'],['bulk','Bulk actions','bulk']]],
    ['Discover',[['builder','Armor builder','armor'],['watch','Build watcher','search'],['goals','Loot goals','sparkle'],['appraisal','Appraisal','sparkle'],['cleaner','Vault review','vault'],['vendors','Vendors','vault'],['collections','Collections & catalysts','book'],['records','Records & seals','book'],['progress','Progress & triumphs','power'],['feed','Item feed','drops']]],
    ['Tools',[['inventory','Inventory board','dashboard'],['organizer','Organizer','bulk'],['farming','Farming mode','farm'],['data','Import & export','drops'],['audit','Setup audit','search'],['settings','Settings','settings'],['armory','Armory','book'],['activities','Activities','book'],['wishlist','Wishlists','sparkle'],['help','Help & shortcuts','book']]]
  ];
  const countIds={inventory:'inventoryNavCount',loadouts:'loadoutNavCount',postmaster:'postmasterNavCount',shard:'shardNavCount'};
  const legacy = new Set(['dashboard','inventory','loadouts','builder','postmaster','shard','compare','power','bulk','cleaner','farming','data','audit']);
  document.querySelector('.nav-list').innerHTML=groups.map(([label,entries])=>`<div class="workspace-nav-group">${label?`<div class="nav-label">${label}</div>`:''}${entries.map(([page,label,glyph])=>`<button class="nav-item" data-workspace-page="${page}" ${legacy.has(page)?`data-page="${page}"`:''}><span class="nav-icon">${icon(glyph)}</span><span>${label}</span>${countIds[page]?`<span class="nav-count" id="${countIds[page]}">0</span>`:''}${page==='farming'?'<span class="nav-live" id="farmNavDot"></span>':''}</button>`).join('')}</div>`).join('');
  document.querySelector('.topbar').insertAdjacentHTML('afterbegin','<a class="workspace-brand" href="./" aria-label="Little Light dashboard"><span>✦</span> little<span class="brand-light">light</span></a>');
  document.querySelector('.topbar-actions').insertAdjacentHTML('afterbegin',`<form class="workspace-global-search" id="workspaceSearchForm" role="search">${icon('search')}<input id="workspaceSearch" type="search" placeholder="Search your vault…" aria-label="Search all gear" autocomplete="off"><kbd>/</kbd></form><button class="button button-outline button-small workspace-sync" data-action="refresh-bungie">${icon('sync')} Sync</button>`);
  document.querySelector('#menuToggle').innerHTML=icon('menu');
  document.querySelector('#menuToggle').setAttribute('aria-controls','sidebar');

  function navigate(page) {
    if(viewPages.has(page)&&!['dashboard','search'].includes(page)) { owner='all';rating='all'; }
    app.go(page);
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-workspace-more]')){displayLimit+=120;app.renderPage();return;}
    const nav=event.target.closest('[data-workspace-page]');
    if(nav){event.preventDefault();navigate(nav.dataset.workspacePage);}
    if(event.target.closest('[data-workspace-reset]')){query='';owner='all';rating='all';document.querySelector('#workspaceSearch').value='';app.renderPage();}
    const filter=event.target.closest('[data-workspace-filter]');
    if(filter){owner='all';rating=filter.dataset.workspaceFilter;query='';document.querySelector('#workspaceSearch').value='';app.go('search');}
    const character=event.target.closest('[data-workspace-owner]');
    if(character){owner=character.dataset.workspaceOwner;rating='all';app.go('equipped');}
    const save=event.target.closest('[data-save-owner]');
    if(save){const select=document.querySelector('#loadoutOwner');if(select){select.value=save.dataset.saveOwner;document.querySelector('#loadoutItemCount').textContent=`${state().items.filter(i=>i.owner===select.value&&i.equipped).length} currently equipped items will be saved.`;}}
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='workspaceOwner')owner=event.target.value;
    else if(event.target.id==='workspaceRating')rating=event.target.value;
    else if(event.target.id==='workspaceSort')order=event.target.value;
    else return;
    app.renderPage();
  });
  document.querySelector('#workspaceSearchForm').addEventListener('submit',event=>{
    event.preventDefault();query=document.querySelector('#workspaceSearch').value.trim();owner='all';rating='all';app.go('search');
  });
  document.querySelector('#workspaceSearch').addEventListener('search',event=>{if(!event.target.value&&query){query='';app.renderPage();}});
  document.addEventListener('keydown',event=>{
    if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.isContentEditable&&!/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)){
      event.preventDefault();event.stopImmediatePropagation();document.querySelector('#workspaceSearch').focus();
    }
  },true);
  function syncNavigation() {
    const page=app.getPage();
    for(const button of document.querySelectorAll('.nav-item')){
      const active=button.dataset.workspacePage===page;button.classList.toggle('active',active);
      if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    }
    if(titles[page])document.querySelector('#pageCrumb').textContent=titles[page];
    const sidebar=document.querySelector('#sidebar');
    const open=sidebar.classList.contains('open');
    const hidden=matchMedia('(max-width:700px)').matches&&!open;
    sidebar.inert=hidden;
    if(hidden)sidebar.setAttribute('aria-hidden','true');else sidebar.removeAttribute('aria-hidden');
    document.querySelector('#menuToggle').setAttribute('aria-expanded',String(open));
  }
  new MutationObserver(syncNavigation).observe(document.querySelector('#pageContent'),{childList:true});
  new MutationObserver(syncNavigation).observe(document.querySelector('#sidebar'),{attributes:true,attributeFilter:['class']});
  matchMedia('(max-width:700px)').addEventListener('change',syncNavigation);
  const requested=new URL(location.href).searchParams.get('page');
  app.go(requested&&(viewPages.has(requested)||originalHandles(requested)||legacy.has(requested))?requested:'dashboard');
  syncNavigation();
})();
