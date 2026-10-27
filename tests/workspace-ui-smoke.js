(async () => {
  const app=LittleLightApp;
  if(!app.getState().demo)throw Error('Run only against the sample workspace.');
  const original=structuredClone(app.getState()),checks=[];
  const assert=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const click=selector=>{const el=document.querySelector(selector);if(!el)throw Error('Missing '+selector);el.click();};
  const change=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
  const search=value=>{document.querySelector('#workspaceSearch').value=value;document.querySelector('#workspaceSearchForm').requestSubmit();};
  try {
    for(const page of ['dashboard','equipped','vault','weapons','armor','search']){
      app.go(page);await new Promise(r=>setTimeout(r,0));
      assert(document.querySelector('h1').textContent.toLowerCase()===page,page+' renders');
      assert(document.querySelector('.nav-item[aria-current="page"]').dataset.workspacePage===page,page+' active navigation');
      assert(document.documentElement.scrollWidth<=innerWidth,page+' contains horizontal scrolling');
    }
    app.go('dashboard');
    const values=[...document.querySelectorAll('.workspace-stat strong')].map(el=>Number(el.textContent));
    assert(values[0]===original.items.filter(i=>i.owner==='Vault').length,'vault count reflects inventory');
    assert(values[2]===original.items.filter(app.isProtected).length,'keeper count reflects protected gear');
    assert(!document.querySelector('.workspace-panel-heading').textContent.includes('Latest drops'),'sample gear not labelled as observed drops');
    click('[data-workspace-filter="protected"]');
    assert(document.querySelectorAll('.loot-card').length===values[2],'keeper tile opens matching results');
    search('');
    click('[data-workspace-page="equipped"]');
    const items=app.getState().items;
    const carried=[...document.querySelectorAll('.equipment-carried .loot-card')];
    const equipped=[...document.querySelectorAll('.equipment-worn .loot-card')];
    assert(equipped.every(el=>items.find(i=>i.id===el.dataset.id).equipped),'worn lane only contains equipped items');
    assert(carried.every(el=>!items.find(i=>i.id===el.dataset.id).equipped),'carried lane excludes equipped items');
    assert(equipped.length+carried.length===items.filter(i=>i.owner!=='Vault'&&!i.isPostmaster).length,'each carried/equipped item appears once');
    app.getState().items.push({...items[0],id:'postmaster-fixture',equipped:false,isPostmaster:true});app.renderPage();
    assert(!document.querySelector('.loot-card[data-id="postmaster-fixture"]'),'equipped view excludes Postmaster items');
    app.getState().items.pop();app.renderPage();
    click('[data-save-owner="Warlock"]');
    assert(document.querySelector('#loadoutOwner').value==='Warlock','row save selects correct Guardian');
    document.querySelector('#loadoutName').value='Screenshot UI fixture';click('[data-action="confirm-save-loadout"]');
    assert(app.getState().loadouts[0].owner==='Warlock'&&app.getState().loadouts[0].itemIds.length===4,'row save snapshots correct equipped gear');
    search('perk:"bait and switch" -is:exotic');
    assert(document.querySelectorAll('.loot-card').length===3,'global search supports perk quotes and exclusions');
    change('workspaceOwner','Vault');
    assert(document.querySelectorAll('.loot-card').length===0,'location filter intersects global search');
    click('[data-workspace-reset]');change('workspaceSort','name');
    assert(document.querySelector('.loot-card .loot-name').textContent==='Apex Predator','new views use deterministic name ordering');
    const first=document.querySelector('.loot-card');first.focus();first.click();
    assert(document.querySelector('.detail-sheet[role="dialog"]'),'new cards open existing inspector');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert(document.activeElement.classList.contains('loot-card'),'inspector returns focus to new card');
    search('<img src=x onerror=alert(1)>');
    assert(!document.querySelector('.workspace-filters img'),'search text is escaped');
    assert(document.querySelector('.workspace-empty'),'search empty state renders');
    search('');click('[data-workspace-page="vault"]');
    assert([...document.querySelectorAll('.loot-card')].every(el=>items.find(i=>i.id===el.dataset.id).owner==='Vault'),'vault view only shows stored gear');
    app.getState().items[0].firstSeen=Date.now();app.go('dashboard');
    assert(document.querySelector('.workspace-panel-heading').textContent.includes('Latest drops'),'observed inventory uses recent-drop panel');
    app.getState().items=[];app.go('equipped');assert(document.querySelector('.workspace-empty'),'empty equipped inventory explains next step');
    app.replaceState(structuredClone(original));app.go('dashboard');
    document.querySelector('#pageContent').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}));
    assert(document.activeElement.id==='workspaceSearch','slash shortcut focuses global search');
    if(matchMedia('(max-width:700px)').matches){
      assert(document.querySelector('#sidebar').inert,'closed mobile navigation is excluded from keyboard focus');
      click('#menuToggle');await new Promise(r=>setTimeout(r,0));
      assert(!document.querySelector('#sidebar').inert&&document.querySelector('#menuToggle').getAttribute('aria-expanded')==='true','mobile menu opens accessibly');
      click('.nav-item[data-workspace-page="equipped"]');await new Promise(r=>setTimeout(r,0));
      assert(app.getPage()==='equipped'&&!document.querySelector('#sidebar').classList.contains('open'),'mobile menu navigates and closes');
    }
    return {passed:checks.length,checks};
  } finally {
    app.replaceState(original);search('');app.go('dashboard');
  }
})();
