(async()=>{
 const app=LittleLightApp,original=structuredClone(app.getState()),checks=[];
 const assert=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
 const set=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
 try{
  app.go('inventory');set('groupSelect','board');
  assert(document.querySelectorAll('.store-banner').length===3,'character and vault columns');
  assert(document.querySelector('.store-slot h3').textContent.includes('Kinetic Weapons'),'slot-aligned Destiny order');
  assert(document.querySelectorAll('.store-items .gear-card').length===app.getState().items.length,'board contains every item exactly once');
  assert(document.querySelectorAll('.gear-art img').length>20,'Bungie sample artwork');
  app.go('appraisal');assert(document.querySelector('h1').textContent==='Know what you’re keeping','appraisal renders');
  assert(document.body.textContent.includes('Armor · highest total first'),'armor appraisal available');
  app.go('goals');let form=document.querySelector('#lootGoalForm');form.elements.name.value='<img src=x onerror=alert(1)>';form.elements.notes.value='test';form.requestSubmit();
  assert(!document.querySelector('.review-row img'),'goal content escaped');
  assert(app.getState().preferences.lootGoals.at(-1).notes==='test','goal persisted');
  document.querySelector('[data-tool="remove-goal"]:last-child').click();
  app.getState().items[0].firstSeen=Date.now()+1000;app.getState().preferences.reviewedDropsAt=0;app.go('drops');
  assert(document.querySelectorAll('.review-item').length===1,'new drops based on first observation');
  app.getState().items[0].firstSeen=Date.now()-1000;document.querySelector('[data-tool="review-drops"]').click();
  assert(document.querySelectorAll('.review-item').length===0,'reviewed drops cleared');
  app.getState().loadouts.push({name:'Missing fixture',itemIds:['missing-test']});app.go('watch');
  assert(document.body.textContent.includes('A saved item is missing'),'build watcher detects missing gear');
  for(const page of ['dim','organizer','optimizer','dimloadouts','vendors','collections','progress','feed','settings']){app.go(page);assert(document.querySelector('iframe')?.src.includes('/engine/#/'),page+' native route');}
  app.go('inventory');set('groupSelect','board');assert(document.documentElement.scrollWidth<=innerWidth,'board scroll contained inside page');
  return {passed:checks.length,checks};
 }finally{app.replaceState(original);app.go('inventory');}
})();
