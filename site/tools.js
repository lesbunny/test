/* Native inventory review workflows. */
(() => {
  'use strict';
  const LL=window.LittleLightApp,h=LL.escapeHtml;
  const pages={appraisal:'Gear appraisal',drops:'New drops',watch:'Build watcher',goals:'Loot goals'};
  const heading=(title,description)=>`<div class="page-heading"><div><div class="eyebrow">LITTLE LIGHT COMPANION</div><h1>${h(title)}</h1><p>${h(description)}</p></div></div>`;
  const inspect=i=>`<button class="review-item" data-action="open-item" data-id="${h(i.id)}"><strong>${h(i.name)}</strong><small>${h(i.owner)} · ${h(i.bucket)} · ${Number(i.power)||'—'}</small></button>`;
  function renderPage(page){
    const s=LL.getState();
    if(page==='appraisal'){
      const armor=s.items.filter(LL.isArmor).sort((a,b)=>LL.totalStats(b)-LL.totalStats(a));
      const weapons=s.items.filter(LL.isWeapon);
      return heading('Know what you’re keeping','Inspect your armor distribution and community weapon matches before making a decision.')+`<div class="review-columns"><section class="panel"><h2>Armor · highest total first</h2><p class="muted">Displayed stats include whatever bonuses the inventory source reports. Totals alone do not establish redundancy, set value, or tuning potential.</p>${armor.map(i=>`<div class="review-row">${inspect(i)}<b>${LL.totalStats(i)}</b><div class="stat-chips">${Object.entries(i.stats||{}).filter(([,v])=>Number(v)>0).map(([k,v])=>`<span>${h(k)} ${Number(v)}</span>`).join('')}</div></div>`).join('')}</section><section class="panel"><h2>Weapon rolls</h2><button class="button" data-action="load-rolls">Refresh community wishlists</button>${weapons.map(i=>{const r=window.LittleLightExtension.assessRoll(i);return `<div class="review-row">${inspect(i)}<span class="tag">${h(r.label)}</span><p class="muted">${h(r.notes)}</p><small>${h((i.perks||[]).join(' · '))}</small></div>`;}).join('')}</section></div>`;
    }
    if(page==='drops'){
      const seen=Number(s.preferences.reviewedDropsAt||0);
      const items=s.items.filter(i=>Number(i.firstSeen)>seen&&!i.reviewedAt).sort((a,b)=>b.firstSeen-a.firstSeen);
      return heading('Fresh from the field','Items first observed since your last review. The first account sync establishes the initial inventory; timestamps track this browser’s observations.')+`<div class="selection-bar"><b>${items.length} unreviewed items</b><button class="button" data-tool="review-drops">Mark all reviewed</button><button class="button button-quiet" data-action="refresh-bungie">Refresh inventory</button></div><section class="panel">${items.map(i=>`<div class="review-row">${inspect(i)}<time>${h(new Date(i.firstSeen).toLocaleString())}</time></div>`).join('')||'<div class="empty-state">All caught up. New items appear here after your next inventory sync.</div>'}</section>`;
    }
    if(page==='watch'){
      return heading('Your builds, kept in view','Track missing items and potential power upgrades for saved companion loadouts. Suggestions never replace your chosen perks or change a loadout automatically.')+`<section class="panel">${s.loadouts.map(l=>`<article class="build-watch"><h2>${h(l.name)}</h2>${(l.itemIds||[]).map(id=>{const item=s.items.find(i=>i.id===id);if(!item)return '<p class="inline-alert warning">A saved item is missing from the current inventory.</p>';const better=s.items.filter(i=>i.id!==id&&i.bucket===item.bucket&&i.classType===item.classType&&Number(i.power)>Number(item.power)).sort((a,b)=>b.power-a.power)[0];return `<div class="review-row">${inspect(item)}${better?`<span>Higher power available (+${better.power-item.power})</span>${inspect(better)}`:'<span class="muted">No higher-power alternative in this slot.</span>'}</div>`;}).join('')}</article>`).join('')||'<div class="empty-state">Save a companion loadout to track its items here.</div>'}<button class="button" data-action="go-loadouts">Manage companion loadouts</button></section>`;
    }
    if(page==='goals')return heading('Plan your next drop','Keep a personal wish list of gear and perk combinations to chase. Names are matched against your current inventory; check rolls in the inspector.')+`<form id="lootGoalForm" class="selection-bar"><label>Item name <input name="name" class="control" required maxlength="120" placeholder="Apex Predator"></label><label>Desired perks / source <input name="notes" class="control" maxlength="300" placeholder="Reconstruction · Bait and Switch"></label><button class="button">Add goal</button></form><section class="panel">${(s.preferences.lootGoals||[]).map((g,n)=>{const owned=s.items.filter(i=>i.name.toLowerCase()===g.name.toLowerCase());return `<div class="review-row"><h2>${h(g.name)}</h2><p>${h(g.notes)}</p><span class="tag">${owned.length?`${owned.length} owned — inspect perks`:'Not in current inventory'}</span>${owned.map(inspect).join('')}<button class="button button-quiet" data-tool="remove-goal" data-index="${n}">Remove goal</button></div>`;}).join('')||'<div class="empty-state">Add a weapon, armor piece, or exotic you want to find.</div>'}</section>`;
    return '';
  }
  window.LittleLightTools={handlesPage:p=>Boolean(pages[p]),renderPage};
  document.addEventListener('click',e=>{
    const nav=e.target.closest('[data-tool-page]');if(nav){LL.go(nav.dataset.toolPage);document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b===nav));document.querySelector('#pageCrumb').textContent=pages[nav.dataset.toolPage]||nav.dataset.toolPage;}
    const b=e.target.closest('[data-tool]');if(!b)return;
    const s=LL.getState();
    if(b.dataset.tool==='review-drops')s.preferences.reviewedDropsAt=Date.now();
    if(b.dataset.tool==='remove-goal')s.preferences.lootGoals.splice(Number(b.dataset.index),1);
    LL.persist();LL.renderPage();
  });
  document.addEventListener('submit',e=>{
    if(e.target.id!=='lootGoalForm')return;e.preventDefault();const f=new FormData(e.target),name=String(f.get('name')||'').trim();if(!name)return;
    const s=LL.getState();s.preferences.lootGoals||=[];s.preferences.lootGoals.push({name,notes:String(f.get('notes')||'').trim()});LL.persist();LL.renderPage();
  });
  const nav=document.querySelector('.nav-list');
  nav.insertAdjacentHTML('beforeend','<div class="nav-label nav-label-gap">DISCOVER & REVIEW</div>'+Object.entries(pages).map(([id,title])=>`<button class="nav-item" data-tool-page="${id}"><span class="nav-icon">✧</span><span>${h(title)}</span></button>`).join(''));
  document.addEventListener('click',e=>{if(!e.target.closest('#sidebar,#menuToggle'))document.querySelector('#sidebar').classList.remove('open');});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('#sidebar').classList.remove('open');});
  const requested=new URL(location.href).searchParams.get('page');
  if(requested&&([...Object.keys(pages),'inventory','loadouts','builder'].includes(requested)))LL.go(requested);
})();
