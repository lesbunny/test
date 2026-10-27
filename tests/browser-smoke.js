(async () => {
  const app=window.LittleLightApp;
  if(!app?.getState().demo)throw new Error('Run this smoke check only in the sample workspace.');
  const original=structuredClone(app.getState()),oldPrompt=window.prompt;
  const passed=[];
  const assert=(condition,label)=>{if(!condition)throw new Error(label);passed.push(label);};
  const click=selector=>{const el=document.querySelector(selector);if(!el)throw new Error('Missing '+selector);el.click();};
  const set=(selector,value,event='change')=>{const el=document.querySelector(selector);el.value=value;el.dispatchEvent(new Event(event,{bubbles:true}));};
  try {
    for(const button of document.querySelectorAll('.nav-item')){button.click();assert(!!document.querySelector('h1'),button.dataset.page+' renders');}
    app.go('inventory');
    assert(document.querySelector('.inventory-section h2').textContent.includes('Kinetic Weapons'),'slots start with kinetic');
    set('#inventorySearch','perk:"bait and switch" -is:exotic','input');
    assert(document.querySelectorAll('.gear-card').length===3,'quoted perk and negative filters');
    click('[data-action="select-results"]');set('#bulkTag','review');click('[data-action="tag-selected"]');
    assert(app.getState().items.filter(i=>i.tags.includes('review')).length===3,'bulk tagging');
    click('[data-action="undo-tags"]');assert(!app.getState().items.some(i=>i.tags.includes('review')),'tag undo');
    window.prompt=()=> 'Smoke saved search';click('[data-action="save-search"]');
    click('[data-action="reset-filters"]');click('[data-action="use-search"]');
    assert(document.querySelectorAll('.gear-card').length===3,'saved search restores filters');
    click('[data-action="delete-search"]');click('[data-action="reset-filters"]');
    set('#groupSelect','flat');set('#sortSelect','name');set('#viewSelect','list');
    assert(document.querySelector('.view-list')&&document.querySelector('.gear-title').textContent==='Apex Predator','global name sort and list display');
    click('[data-action="toggle-compare"]');app.go('compare');
    assert(document.querySelector('.compare-perks').textContent.includes('Apex Predator'),'weapon comparison includes perks');
    assert(document.querySelector('.data-table').textContent.includes('Blast Radius'),'weapon comparison includes weapon stats');
    app.go('builder');assert(!document.querySelector('[data-action="save-armor-build"]').disabled,'armor builder produces a complete sample set');
    window.prompt=()=> 'Smoke armor';click('[data-action="save-armor-build"]');
    assert(app.getState().loadouts[0].itemIds.length===5,'armor loadout saved');
    click('[data-action="duplicate-loadout"]');assert(app.getState().loadouts.length===2,'loadout duplicate');
    window.prompt=()=> 'Renamed armor';click('[data-action="rename-loadout"]');assert(app.getState().loadouts[0].name==='Renamed armor','loadout rename');
    click('[data-action="apply-loadout"]');assert(app.getState().items.filter(i=>i.equipped&&i.owner==='Hunter'&&i.exotic&&app.isArmor(i)).length===1,'local armor loadout equips one exotic');
    app.go('inventory');click('[data-action="reset-filters"]');click('.gear-card');
    assert(document.querySelector('.detail-sheet[role="dialog"]'),'item inspector is a dialog');
    assert(document.querySelector('.detail-sheet').textContent.includes('Reconstruction'),'inspector renders perks');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(!document.querySelector('.detail-sheet'),'Escape closes inspector');
    const theme=document.documentElement.dataset.theme;click('[data-action="toggle-theme"]');assert(document.documentElement.dataset.theme!==theme,'theme toggle');
    assert(document.documentElement.scrollWidth<=innerWidth,'no horizontal page overflow');
    app.go('data');
    const input=document.querySelector('#importFile');
    const transfer=new DataTransfer();transfer.items.add(new File(['Id,Name,Bucket,Type,Owner,Power,Range,Perks\nfixture,"Test, weapon",Kinetic Weapons,Weapon,Vault,2000,75,"One for All;Rangefinder"'], 'fixture.csv',{type:'text/csv'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    for(let tries=0;tries<100&&app.getState().items[0]?.id!=='fixture';tries++)await new Promise(resolve=>setTimeout(resolve,10));
    assert(app.getState().items.length===1&&app.getState().items[0].name==='Test, weapon','quoted CSV import');
    assert(app.getState().items[0].stats.Range===75,'weapon stats survive CSV import');
    assert(app.getState().source==='import'&&!app.getState().items[0].isLiveItem,'imported inventory cannot issue live mutations');
    let exported;const createObjectURL=URL.createObjectURL;
    try{URL.createObjectURL=blob=>{exported=blob;return createObjectURL(blob);};app.go('data');click('[data-action="export-csv"]');}finally{URL.createObjectURL=createObjectURL;}
    const csv=await exported.text();assert(csv.includes('Range')&&csv.includes('75')&&csv.includes('"Test, weapon"'),'CSV export retains stats and escaping');
    return {passed:passed.length,checks:passed};
  } finally {
    window.prompt=oldPrompt;app.replaceState(original);document.documentElement.dataset.theme=original.preferences?.theme||'light';app.go('dashboard');
  }
})();
