(() => {
  'use strict';
  const LL = window.LittleLightApp;
  if (!LL) return;

  const CONFIG_KEY = 'little-light-bungie-config-v1';
  const TOKEN_KEY = 'little-light-bungie-session-v1';
  const CACHE_NAME = 'little-light-bungie-cache-v1';
  const API = 'https://www.bungie.net/Platform';
  const VAULT_CAPACITY = 1300;
  const CHARACTER_BUCKET_CAPACITY = 10;
  const POSTMASTER_HASH = 215593132;
  const BUCKETS = {
    1498876634: 'Kinetic Weapons',
    2465295065: 'Energy Weapons',
    953998645: 'Power Weapons',
    3448274439: 'Helmet',
    3551918588: 'Gauntlets',
    14239492: 'Chest Armor',
    20886954: 'Leg Armor',
    1585787867: 'Class Item',
    3284755031: 'Subclass',
    1506418338: 'Artifact',
    4023194814: 'Ghost',
    2025709351: 'Sparrow',
    284967655: 'Ship',
    215593132: 'Postmaster'
  };
  const STAT_NAMES = {
    2996146975: 'Mobility',
    392767087: 'Resilience',
    1943323491: 'Recovery',
    1735777505: 'Discipline',
    144602215: 'Intellect',
    4244567218: 'Strength'
  };
  const CLASS_NAMES = {0:'Titan',1:'Hunter',2:'Warlock'};
  const PLATFORM_NAMES = {1:'Xbox',2:'PlayStation',3:'Steam',4:'Battle.net',5:'Stadia',6:'Epic',10:'Demon'};
  const GEAR_BUCKETS = ['Kinetic Weapons','Energy Weapons','Power Weapons','Helmet','Gauntlets','Chest Armor','Leg Armor','Class Item'];
  const WEAPON_BUCKETS = ['Kinetic Weapons','Energy Weapons','Power Weapons'];
  const ARMOR_BUCKETS = ['Helmet','Gauntlets','Chest Armor','Leg Armor','Class Item'];
  // The manifest determines which character buckets are equippable and transferable,
  // matching DIM's inventory-driven Farming Mode instead of hard-coding only weapons/armor.
  const WISHLIST_GOOD_URL = 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/voltron.txt';
  const WISHLIST_CHOOSY_URL = 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/choosy_voltron.txt';
  const config = readConfig();
  const live = {
    connected:false, busy:false, operation:'', error:'', membership:null, memberships:[], profile:null,
    characters:[], selectedCharacterId:config.selectedCharacterId||'', itemDefs:null, statDefs:null, bucketDefs:null,
    savedLoadoutIds:new Set(), goodRolls:new Map(), choosyRolls:new Map(), rollStatus:'idle', rollError:'',
    rollStats:{good:0,choosy:0}, farmTimer:null, farmCycleRunning:false, lastSync:null, lastOperation:'',
    version:'', profileDisplayName:'', connectionOrigin:location.origin
  };

  function readConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')||{}; }
    catch (_) { return {}; }
  }
  function saveConfig(next) {
    Object.assign(config,next);
    try { localStorage.setItem(CONFIG_KEY,JSON.stringify(config)); }
    catch (_) { LL.toast('Could not save connection preferences in this browser.','error'); }
  }
  function tokenState() {
    try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY)||'null'); }
    catch (_) { return null; }
  }
  function saveToken(t) {
    try { sessionStorage.setItem(TOKEN_KEY,JSON.stringify(t)); }
    catch (_) { throw new Error('The browser could not keep the Bungie session. Allow session storage and try again.'); }
  }
  function dropToken() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {} }
  function redirectUri() {
    const u = new URL('./',location.href);
    u.search=''; u.hash='';
    return u.href;
  }
  function originForRedirect() { return new URL(redirectUri()).origin; }
  function h(v) { return LL.escapeHtml(v==null?'':String(v)); }
  function fmt(n) { return Number(n||0).toLocaleString(); }
  function sleep(ms) { return new Promise(resolve=>setTimeout(resolve,ms)); }
  function unique(xs) { return [...new Set(xs)]; }
  function titleCase(v) { return String(v||'').replace(/([a-z])([A-Z])/g,'$1 $2'); }
  function isLiveSnapshot() { return !!(state().source==='bungie' && state().items.some(i=>i.isLiveItem)); }
  function state() {
    const s=LL.getState();
    if(!Array.isArray(s.shardList))s.shardList=[];
    if(!Array.isArray(s.items))s.items=[];
    if(!Array.isArray(s.loadouts))s.loadouts=[];
    if(!s.farm)s.farm={owner:'Hunter',spaces:1,includeWeapons:true,includeArmor:true,includeUtility:true,enabled:false};
    return s;
  }
  function isConnected() { return live.connected && !!tokenState() && !!live.membership; }
  function needConnection() {
    if(isConnected())return true;
    LL.toast('Connect a Bungie account first. Sample and imported data cannot perform live actions.','error');
    openConnectModal();
    return false;
  }
  function distinguishCharacterNames(rows) {
    const totals=new Map(),seen=new Map();
    rows.forEach(c=>{
      const base=CLASS_NAMES[Number(c.classType)];
      if(base)totals.set(base,(totals.get(base)||0)+1);
    });
    return rows.map(c=>{
      const base=CLASS_NAMES[Number(c.classType)];
      if(!base||totals.get(base)<=1)return c;
      const index=(seen.get(base)||0)+1;
      seen.set(base,index);
      return Object.assign({},c,{name:base+' '+index});
    });
  }
  function getSelectedCharacter() {
    return live.characters.find(c=>String(c.characterId)===String(live.selectedCharacterId)) || live.characters[0] || null;
  }
  function getSelectedCharacterName() { const c=getSelectedCharacter(); return c?c.name:(state().farm.owner||'Guardian'); }
  function characterName(characterId) {
    const c=live.characters.find(x=>String(x.characterId)===String(characterId));
    return c?c.name:'Guardian';
  }
  function isGear(item) {
    const b=item.gearBucket||item.bucket||'';
    return GEAR_BUCKETS.includes(b) || /^(?:Kinetic|Energy|Power) Weapons$/.test(b);
  }
  function isWeapon(item) { return WEAPON_BUCKETS.includes(item.gearBucket||item.bucket); }
  function isArmor(item) { return ARMOR_BUCKETS.includes(item.gearBucket||item.bucket); }
  function ownerCharacterId(item) {
    if(item.characterId)return String(item.characterId);
    const c=live.characters.find(x=>x.name===item.owner);
    return c?String(c.characterId):'';
  }
  function bucketFor(item) { return item.gearBucket||item.bucket||'Other'; }
  function localProtected(item) {
    return LL.isProtected(item) ||
      (item.tags||[]).some(t=>/^(keep|favorite|favourite|protect|protected|loadout|do-not-shard)$/i.test(String(t))) ||
      live.savedLoadoutIds.has(String(item.id)) ||
      live.savedLoadoutIds.has(String(item.itemInstanceId||'')) ||
      live.savedLoadoutIds.has('hash:'+String(item.itemHash||''));
  }
  function shardIds() { return new Set((state().shardList||[]).map(String)); }
  function getItem(id) { return state().items.find(i=>String(i.id)===String(id)); }
  function vaultCount() { return state().items.filter(i=>i.owner==='Vault'&&!i.isPostmaster).length; }
  function vaultFree() { return Math.max(0,VAULT_CAPACITY-vaultCount()); }
  function characterBucketItems(characterId,bucket) {
    return state().items.filter(i=>String(i.characterId||'')===String(characterId)&&!i.isPostmaster&&bucketFor(i)===bucket);
  }
  function bucketCapacity(bucket) {
    const def=Object.values(live.bucketDefs||{}).find(b=>Number(b.category)===3&&bucketName(b.hash)===bucket);
    return Math.max(1,Number(def&&def.itemCount)||CHARACTER_BUCKET_CAPACITY);
  }
  function equippedItem(characterId,bucket) {
    return state().items.find(i=>String(i.characterId||'')===String(characterId)&&i.equipped&&!i.isPostmaster&&bucketFor(i)===bucket);
  }
  function classCanUse(item, character) {
    if(!character || !isArmor(item))return true;
    const d=live.itemDefs&&live.itemDefs[String(item.itemHash)];
    const classType=d&&d.classType;
    return classType===undefined||classType===3||Number(classType)===Number(character.classType);
  }
  function normalizeTransferable(item) {
    if(item.transferable===false)return false;
    if(item.transferStatus!==undefined && Number(item.transferStatus)!==0)return false;
    return true;
  }

  function purgeLegacyCredentials() {
    try {
      sessionStorage.removeItem('little-light-bungie-client-secret-v1');
      delete config.workerUrl;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch (_) {}
  }
  purgeLegacyCredentials();
  function openConnectModal(message, editSettings = false) {
    const connected=isConnected()&&!editSettings;
    const modal=document.getElementById('modal');
    modal.innerHTML =
      '<div class="ll-modal-head"><span class="ll-eyebrow">BUNGIE.NET CONNECTION</span><button class="icon-button" data-action="close-modal" aria-label="Close">×</button></div>'+
      '<h2 id="modalTitle">'+(connected?'Bungie is connected':'Connect your Guardian')+'</h2>'+
      '<p class="ll-muted">Direct Bungie OAuth using a Public client—no Cloudflare account, server, or OAuth client secret required.</p>'+
      (message?'<div class="inline-alert warning"><span class="alert-symbol">!</span><div>'+h(message)+'</div></div>':'')+
      (connected?
        '<div class="ll-connection-success"><span class="status-dot"></span><div><b>'+h(live.profileDisplayName||'Bungie account')+'</b><small>'+h(live.membership&&live.membership.displayName||'Connected profile')+' · '+h(getSelectedCharacterName())+' selected</small></div></div>'+
        '<div class="ll-modal-actions"><button class="button button-quiet" data-action="refresh-bungie">Refresh inventory</button><button class="button button-quiet" data-action="change-bungie-settings">Change API settings</button><button class="button button-outline" data-action="disconnect-bungie">Disconnect</button><button class="button" data-action="close-modal">Done</button></div>'
      :
        '<ol class="ll-setup-steps"><li>Open the <a href="https://www.bungie.net/en/Application" target="_blank" rel="noreferrer">Bungie Application Portal ↗</a>. Create or edit an application with <b>Client Type: Public</b>—public clients must not use a client secret.</li><li>Set Origin to <code>'+h(originForRedirect())+'</code> and Redirect URL to this exact address: <code>'+h(redirectUri())+'</code>.</li><li>Enable <code>ReadBasicUserProfile</code>, <code>ReadDestinyInventoryAndVault</code>, and <code>MoveEquipDestinyItems</code>. Bungie’s portal binds the API key to the registered origin.</li></ol>'+
        '<div class="field-stack"><label class="field-label" for="llApiKey">Bungie API Key</label><input class="control" id="llApiKey" autocomplete="off" spellcheck="false" value="'+h(config.apiKey||'')+'" placeholder="Paste API key"></div>'+
        '<div class="field-stack"><label class="field-label" for="llClientId">Public OAuth Client ID</label><input class="control" id="llClientId" autocomplete="off" spellcheck="false" value="'+h(config.clientId||'')+'" placeholder="Paste public client ID"></div>'+
        '<div class="ll-security-note"><b>No secret needed.</b> Bungie’s documented Public client flow does not issue a client secret or refresh token. Your API key and Client ID are stored in this browser’s local storage; the access token is kept in session storage and you’ll need to sign in again when it expires. Do not paste a confidential Client Secret here or commit any credential to source files. The API key is still visible to browsers, so set the Bungie application Origin to this site only.</div>'+
        '<div class="ll-modal-actions"><button class="button button-quiet" data-action="close-modal">Cancel</button><button class="button" data-action="save-bungie-settings">Save & sign in to Bungie ↗</button></div>'
      );
    document.getElementById('modalScrim').hidden=false;
  }
  function openAccountModal(memberships) {
    const options=memberships.map((m,i)=>'<option value="'+i+'">'+h(m.displayName||m.membershipId)+' · '+h(PLATFORM_NAMES[m.membershipType]||('Platform '+m.membershipType))+' · ID '+h(m.membershipId)+'</option>').join('');
    document.getElementById('modal').innerHTML=
      '<div class="ll-modal-head"><span class="ll-eyebrow">DESTINY PROFILE</span><button class="icon-button" data-action="close-modal">×</button></div>'+
      '<h2 id="modalTitle">Choose your Destiny account</h2><p class="ll-muted">Select the cross-save/platform membership whose inventory you want Little Light to manage.</p>'+
      '<div class="field-stack"><label class="field-label" for="llMembershipChoice">Destiny account</label><select class="control" id="llMembershipChoice" style="width:100%">'+options+'</select></div>'+
      '<div class="ll-modal-actions"><button class="button button-quiet" data-action="close-modal">Cancel</button><button class="button" data-action="choose-membership">Load inventory</button></div>';
    document.getElementById('modalScrim').hidden=false;
  }
  function openConfirm(title,description,action,label,secondary) {
    live.pendingAction=action;
    document.getElementById('modal').innerHTML=
      '<div class="ll-modal-head"><span class="ll-eyebrow">CONFIRM LIVE ACTION</span><button class="icon-button" data-action="close-modal">×</button></div>'+
      '<h2 id="modalTitle">'+h(title)+'</h2><p>'+h(description)+'</p>'+
      '<div class="ll-security-note"><b>Nothing is dismantled.</b> The app will only use Bungie’s documented inventory move/equip endpoints. Review the move list carefully before continuing.</div>'+
      '<div class="ll-modal-actions"><button class="button button-quiet" data-action="close-modal">Cancel</button><button class="button" data-action="confirm-live-action">'+h(label||'Confirm & run')+'</button></div>';
    document.getElementById('modalScrim').hidden=false;
  }

  async function saveSettingsAndConnect() {
    const apiKey=(document.getElementById('llApiKey')?.value||'').trim();
    const clientId=(document.getElementById('llClientId')?.value||'').trim();
    if(!apiKey||!clientId) {
      LL.toast('Enter your Bungie API Key and Public OAuth Client ID.','error');
      return;
    }
    saveConfig({apiKey,clientId});
    startOAuth();
  }
  function startOAuth() {
    if(!config.apiKey||!config.clientId) {
      openConnectModal('Enter your Bungie API Key and Public OAuth Client ID first.');
      return;
    }
    const stateValue=randomState();
    sessionStorage.setItem('little-light-oauth-state',stateValue);
    const url=new URL('https://www.bungie.net/en/oauth/authorize');
    url.searchParams.set('client_id',config.clientId);
    url.searchParams.set('response_type','code');
    url.searchParams.set('redirect_uri',redirectUri());
    url.searchParams.set('state',stateValue);
    location.assign(url.toString());
  }
  function randomState() {
    const data=new Uint8Array(32);
    crypto.getRandomValues(data);
    return Array.from(data,x=>x.toString(16).padStart(2,'0')).join('');
  }
  function closeModal() { const scrim=document.getElementById('modalScrim');if(scrim)scrim.hidden=true; }
  function decodeOAuthPayload(value) {
    const normalized=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
    const binary=atob(normalized+'='.repeat((4-normalized.length%4)%4));
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function handleOAuthCallback() {
    const url=new URL(location.href);
    const code=url.searchParams.get('code');
    const error=url.searchParams.get('error');
    if(error) {
      cleanOAuthUrl();
      sessionStorage.removeItem('little-light-oauth-state');
      if(error!=='access_denied')openConnectModal('Bungie authorization failed: '+(url.searchParams.get('error_description')||error));
      return;
    }
    if(!code)return;
    const expected=sessionStorage.getItem('little-light-oauth-state');
    const given=url.searchParams.get('state');
    if(!expected||!given||expected!==given) {
      cleanOAuthUrl();
      sessionStorage.removeItem('little-light-oauth-state');
      openConnectModal('OAuth state did not match. Start Bungie sign-in again.');
      return;
    }
    if(!config.apiKey||!config.clientId) {
      cleanOAuthUrl();
      sessionStorage.removeItem('little-light-oauth-state');
      openConnectModal('Your API Key or Public Client ID is missing. Enter them and sign in again.');
      return;
    }
    try {
      setStatus('Exchanging Bungie authorization code…');
      const body=new URLSearchParams({grant_type:'authorization_code',code,client_id:config.clientId,redirect_uri:redirectUri()});
      const response=await fetch(API+'/App/OAuth/token/',{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json','X-API-Key':config.apiKey},
        body:body.toString(),cache:'no-store'
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.access_token)throw new Error(data.error_description||data.Message||('Bungie token exchange failed (HTTP '+response.status+'). Check that the Bungie app is configured as Public and its redirect URL matches exactly.'));
      saveToken({access_token:data.access_token,refresh_token:'',expires_at:Date.now()+Number(data.expires_in||3600)*1000,refresh_expires_at:0});
      cleanOAuthUrl();
      sessionStorage.removeItem('little-light-oauth-state');
      await findMemberships();
    } catch(err) {
      cleanOAuthUrl();
      sessionStorage.removeItem('little-light-oauth-state');
      dropToken();
      setStatus('Bungie connection failed');
      openConnectModal('Could not complete Bungie sign-in: '+(err&&err.message||String(err)));
    }
  }
  function cleanOAuthUrl() {
    const url=new URL(location.href);
    ['code','state','error','error_description'].forEach(k=>url.searchParams.delete(k));
    history.replaceState({},document.title,url.pathname+url.search);
  }
  async function accessToken() {
    const t=tokenState();
    if(!t||!t.access_token)throw new Error('Your Bungie session has expired. Connect again.');
    if(Number(t.expires_at||0)>Date.now()+90000)return t.access_token;
    dropToken();
    live.connected=false;
    throw new Error('Your Bungie access token expired. Bungie Public clients do not receive refresh tokens, so sign in again to continue.');
  }
  async function bungieRequest(path,options) {
    options=options||{};
    if(!config.apiKey)throw new Error('Missing Bungie API Key. Open Connect Bungie to configure it.');
    const headers={'X-API-Key':config.apiKey,'Accept':'application/json'};
    if(options.auth!==false)headers.Authorization='Bearer '+await accessToken();
    if(options.body!==undefined)headers['Content-Type']='application/json';
    let response;
    try {
      response=await fetch(API+path,{
        method:options.method||'GET',headers,
        body:options.body===undefined?undefined:JSON.stringify(options.body),cache:'no-store'
      });
    } catch(err) {
      throw new Error('Could not reach Bungie’s API. Check that the Origin in your Bungie Application Portal is exactly '+originForRedirect()+'. '+(err&&err.message||''));
    }
    const data=await response.json().catch(()=>({}));
    if(!response.ok) {
      if(response.status===401||response.status===403)throw new Error((data.Message||data.ErrorStatus||'Bungie rejected this request')+' (HTTP '+response.status+'). Check OAuth scopes and sign in again if needed.');
      throw new Error((data.Message||data.ErrorStatus||'Bungie API request failed')+' (HTTP '+response.status+').');
    }
    if(data.ErrorCode!==undefined&&Number(data.ErrorCode)!==1)throw new Error((data.Message||data.ErrorStatus||'Bungie API error')+' ('+(data.ErrorCode||'unknown')+').');
    return data.Response;
  }
  async function fetchJsonCached(url) {
    if(window.caches) {
      try {
        const cache=await caches.open(CACHE_NAME);
        const cached=await cache.match(url);
        if(cached)return await cached.json();
      } catch (_) {}
    }
    const response=await fetch(url);
    if(!response.ok)throw new Error('Could not download game data (HTTP '+response.status+').');
    if(window.caches) {
      try { const cache=await caches.open(CACHE_NAME);await cache.put(url,response.clone()); } catch (_) {}
    }
    return await response.json();
  }
  async function loadManifest() {
    if(live.itemDefs&&live.statDefs&&live.bucketDefs)return;
    setStatus('Loading Destiny item definitions…');
    const manifest=await bungieRequest('/Destiny2/Manifest/',{auth:false});
    live.version=String(manifest.version||'');
    const worldPaths=manifest.jsonWorldContentPaths&&manifest.jsonWorldContentPaths.en||{};
    const componentPaths=manifest.jsonWorldComponentContentPaths&&manifest.jsonWorldComponentContentPaths.en||{};
    // Item definitions must come from the full world-content database. Component
    // paths are a separate lightweight database and must never override these URLs.
    const itemDefinitionPath=componentPaths.DestinyInventoryItemDefinition||worldPaths.DestinyInventoryItemDefinition;
    if(!itemDefinitionPath)throw new Error('Bungie’s manifest response did not include the full item definitions.');
    const base='https://www.bungie.net';
    const makeUrl=p=>/^https?:/i.test(p)?p:new URL(p,base).href;
    const itemUrl=makeUrl(itemDefinitionPath);
    const statPath=componentPaths.DestinyStatDefinition||worldPaths.DestinyStatDefinition;
    const bucketPath=componentPaths.DestinyInventoryBucketDefinition||worldPaths.DestinyInventoryBucketDefinition;
    const statUrl=statPath?makeUrl(statPath):null;
    const bucketUrl=bucketPath?makeUrl(bucketPath):null;
    const results=await Promise.all([
      fetchJsonCached(itemUrl),
      statUrl?fetchJsonCached(statUrl):Promise.resolve({}),
      bucketUrl?fetchJsonCached(bucketUrl):Promise.resolve({})
    ]);
    const itemDefs=results[0];
    const sample= itemDefs && Object.values(itemDefs).find(d=>d&&d.displayProperties&&d.displayProperties.name);
    if(!itemDefs||typeof itemDefs!=='object'||!sample) {
      if(window.caches)try{const cache=await caches.open(CACHE_NAME);await cache.delete(itemUrl);}catch(_){}
      throw new Error('Bungie returned an invalid item-definition database. Reload the page and try Load inventory again.');
    }
    function unwrapDefs(data, tableName) {
      if(!data||typeof data!=='object')return null;
      const sample=Object.values(data).find(d=>d&&d.displayProperties&&d.displayProperties.name);
      if(sample)return data;
      if(tableName&&data[tableName]&&typeof data[tableName]==='object'){
        const nested=data[tableName];
        if(Object.values(nested).find(d=>d&&d.displayProperties&&d.displayProperties.name))return nested;
      }
      if(data.Response)return unwrapDefs(data.Response, tableName);
      return null;
    }
    itemDefs=unwrapDefs(itemDefs,'DestinyInventoryItemDefinition')||itemDefs;
    live.itemDefs=itemDefs;
    live.statDefs=unwrapDefs(results[1],'DestinyStatDefinition')||results[1]||{};
    live.bucketDefs=unwrapDefs(results[2],'DestinyInventoryBucketDefinition')||results[2]||{};
    setStatus('Destiny definitions loaded');
  }
  async function findMemberships() {
    setStatus('Finding linked Destiny accounts…');
    const result=await bungieRequest('/User/GetMembershipsForCurrentUser/');
    const memberships=(result&&result.destinyMemberships||[]).filter(m=>m&&m.membershipId&&m.membershipType!==undefined);
    if(!memberships.length)throw new Error('Bungie did not return a Destiny membership. Make sure your app has ReadBasicUserProfile scope and your Bungie account has a Destiny profile.');
    live.memberships=memberships;
    if(config.membershipId) {
      const saved=memberships.find(m=>String(m.membershipId)===String(config.membershipId)&&Number(m.membershipType)===Number(config.membershipType));
      if(saved){live.membership=saved;await loadLiveProfile();return;}
    }
    if(memberships.length===1){live.membership=memberships[0];saveConfig({membershipId:memberships[0].membershipId,membershipType:memberships[0].membershipType});await loadLiveProfile();return;}
    openAccountModal(memberships);
  }
  async function chooseMembership() {
    const select=document.getElementById('llMembershipChoice');
    const m=live.memberships[Number(select&&select.value)||0];
    if(!m){LL.toast('Choose a Destiny account.','error');return;}
    live.membership=m;
    saveConfig({membershipId:m.membershipId,membershipType:m.membershipType,profileDisplayName:m.displayName||''});
    closeModal();
    await loadLiveProfile();
  }
  function showInventoryLoading(message) {
    const modal=document.getElementById('modal');
    if(!modal)return;
    modal.innerHTML='<div class="ll-modal-head"><span class="ll-eyebrow">BUNGIE INVENTORY</span></div>'+
      '<h2 id="modalTitle">Loading your inventory…</h2>'+
      '<p class="ll-muted">Your Bungie account is connected. The first sync also downloads Destiny item definitions, which can take a little while. Keep this tab open.</p>'+
      '<div class="ll-security-note"><b id="llLoadStage">'+h(message||'Preparing inventory sync…')+'</b></div>';
    const scrim=document.getElementById('modalScrim');
    if(scrim)scrim.hidden=false;
  }
  function showInventoryFailure(message) {
    const modal=document.getElementById('modal');
    if(!modal)return;
    modal.innerHTML='<div class="ll-modal-head"><span class="ll-eyebrow">BUNGIE INVENTORY</span><button class="icon-button" data-action="close-modal" aria-label="Close">×</button></div>'+
      '<h2 id="modalTitle">Inventory could not load</h2><div class="inline-alert warning"><span class="alert-symbol">!</span><div>'+h(message||'Unknown inventory error')+'</div></div>'+
      '<p class="ll-muted">Your Bungie sign-in is separate from the inventory sync. You can retry with Refresh inventory after closing this message.</p>'+
      '<div class="ll-modal-actions"><button class="button" data-action="close-modal">Close</button><button class="button" data-action="refresh-bungie">Try again</button></div>';
    const scrim=document.getElementById('modalScrim');
    if(scrim)scrim.hidden=false;
  }
  async function loadLiveProfile() {
    if(!live.membership)throw new Error('No Destiny profile is selected.');
    live.busy=true;
    live.operation='Loading Destiny inventory';
    live.error='';
    showInventoryLoading('Starting Bungie inventory request…');
    try {
      setStatus('Downloading inventory and item definitions…');
      await loadManifest();
      const m=live.membership;
      const path='/Destiny2/'+encodeURIComponent(m.membershipType)+'/Profile/'+encodeURIComponent(m.membershipId)+'/?components=100,102,103,200,201,202,205,206,300,301,302,304,305,307,400';
      live.profile=await bungieRequest(path);
      const charactersData=live.profile&&live.profile.characters&&live.profile.characters.data||{};
      live.characters=distinguishCharacterNames(Object.entries(charactersData).map(([id,c],i)=>({
        characterId:String(id),classType:Number(c.classType),name:CLASS_NAMES[Number(c.classType)]||('Guardian '+(i+1)),
        light:Number(c.light||0),raceHash:c.raceHash,genderHash:c.genderHash,emblemPath:c.emblemPath||'',
        dateLastPlayed:c.dateLastPlayed||''
      })).sort((a,b)=>a.classType-b.classType));
      if(!live.characters.length)throw new Error('No Destiny 2 characters were returned for this account.');
      if(!live.characters.some(c=>String(c.characterId)===String(config.selectedCharacterId))) {
        live.selectedCharacterId=live.characters[0].characterId;
        saveConfig({selectedCharacterId:live.selectedCharacterId});
      } else live.selectedCharacterId=String(config.selectedCharacterId);
      state().farm.owner=getSelectedCharacterName();
      live.savedLoadoutIds=extractSavedLoadoutIds(live.profile);
      const items=buildLiveItems(live.profile);
      const old=state().items||[];
      const oldById=new Map(old.map(i=>[String(i.id),i]));
      state().items=items.map((item,index)=>{
        const previous=oldById.get(String(item.id))||{};
        const merged=Object.assign({},previous,item,{
          id:String(item.id),tags:Array.isArray(previous.tags)?previous.tags:[],
          notes:previous.notes||'',localProtection:previous.localProtection||false
        });
        return LL.normalizeWorkspaceItem(merged,index);
      });
      state().source='bungie';
      state().demo=false;
      state().bannerDismissed=true;
      state().shardList=(state().shardList||[]).filter(id=>state().items.some(i=>String(i.id)===String(id)));
      state().loadouts=Array.isArray(state().loadouts)?state().loadouts:[];
      live.connected=true;
      live.busy=false;
      live.lastSync=new Date().toISOString();
      closeModal();
      live.profileDisplayName=(live.membership.displayName||config.profileDisplayName||'Bungie account');
      saveConfig({profileDisplayName:live.profileDisplayName,selectedCharacterId:live.selectedCharacterId});
      LL.persist();
      document.getElementById('sampleBanner')?.classList.add('hidden');
      updateHeader();
      LL.renderPage();
      LL.toast('Loaded '+fmt(state().items.length)+' live inventory items.','success');
      if(live.rollStatus==='idle'||live.rollStatus==='error')loadCommunityRolls().catch(()=>{});
    } catch(err) {
      live.busy=false;
      live.error=err&&err.message||String(err);
      setStatus('Bungie sync failed');
      if(/token|sign in|session has expired|OAuth/i.test(live.error))live.connected=false;
      updateHeader();
      showInventoryFailure(live.error);
      throw err;
    }
  }
  function extractSavedLoadoutIds(profile) {
    const out=new Set();
    const data=profile&&profile.characterLoadouts&&profile.characterLoadouts.data||{};
    function walk(o) {
      if(!o||typeof o!=='object')return;
      if(Array.isArray(o)){o.forEach(walk);return;}
      Object.keys(o).forEach(k=>{
        const v=o[k];
        if(/itemInstanceId|iteminstanceid/i.test(k)&&v!=null)out.add(String(v));
        if(k==='itemHash'&&v!=null)out.add('hash:'+String(v));
        walk(v);
      });
    }
    walk(data);
    return out;
  }
  function bucketName(hash) {
    const id=Number(hash);
    if(BUCKETS[id])return BUCKETS[id];
    const def=live.bucketDefs&&live.bucketDefs[String(id)];
    return def&&def.displayProperties&&def.displayProperties.name||'Other';
  }
  function definitionFor(itemHash) { if(!live.itemDefs||itemHash==null)return {}; const key=String(itemHash); return live.itemDefs[key]||live.itemDefs[Number(itemHash)]||{}; }
  function componentFor(name,itemId) {
    const c=live.profile&&live.profile.itemComponents&&live.profile.itemComponents[name];
    return c&&c.data&&c.data[String(itemId)]||{};
  }
  function componentStatName(hash) {
    if(STAT_NAMES[Number(hash)])return STAT_NAMES[Number(hash)];
    const def=live.statDefs&&live.statDefs[String(hash)];
    return def&&def.displayProperties&&def.displayProperties.name||String(hash);
  }
  function componentPerkName(hash) {
    const def=definitionFor(hash);
    return def.displayProperties&&def.displayProperties.name||'';
  }
  function itemKillCount(item,instance,objectives,stats) {
    const direct=[item.trackedKills,item.kills,instance.trackedKills,instance.kills,instance.weaponKills,instance.killCount];
    for(const v of direct)if(v!==undefined&&v!==null&&Number.isFinite(Number(v)))return Number(v);
    for(const [hash,stat] of Object.entries(stats.stats||{})) {
      const name=componentStatName(hash).toLowerCase();
      if(/weapon kills|tracked kills|enemies defeated|combatants defeated|guardian kills/.test(name)) {
        const value=typeof stat==='number'?stat:stat&&stat.value;
        if(value!==undefined&&Number.isFinite(Number(value)))return Number(value);
      }
    }
    const list=objectives&&objectives.objectives||[];
    for(const obj of list) {
      const name=String(obj.displayProperties&&obj.displayProperties.name||obj.progressDescription||'').toLowerCase();
      if(/weapon kills|tracked kills|enemies defeated|combatants defeated|guardian kills/.test(name)) {
        const value=obj.progress!==undefined?obj.progress:obj.progressValue;
        if(value!==undefined&&Number.isFinite(Number(value)))return Number(value);
      }
    }
    return null;
  }
  function buildLiveItems(profile) {
    const all=[];
    const equipIds=new Set();
    const equipment=profile.characterEquipment&&profile.characterEquipment.data||{};
    Object.values(equipment).forEach(group=>(group.items||[]).forEach(i=>{if(i.itemInstanceId) equipIds.add(String(i.itemInstanceId));}));
    const seen=new Set();
    function addGroup(items,owner,characterId,isVault) {
      (items||[]).forEach((raw,index)=>{
        const iid=raw.itemInstanceId==null?'':String(raw.itemInstanceId);
        const id=iid||('item-'+owner+'-'+raw.itemHash+'-'+raw.bucketHash+'-'+index);
        if(seen.has(id))return;
        seen.add(id);
        const def=definitionFor(raw.itemHash);
        const inst=componentFor('instances',iid);
        const stats=componentFor('stats',iid);
        const sockets=componentFor('sockets',iid);
        const objectives=componentFor('objectives',iid);
        const defBucket=Number(def.inventory&&def.inventory.bucketTypeHash||raw.bucketHash||0);
        const isPostmaster=Number(raw.bucketHash)===POSTMASTER_HASH;
        const gearBucket=bucketName(defBucket);
        const activePlugs=(sockets.sockets||[]).map(s=>Number(s.plugHash||0)).filter(n=>n>0);
        const perks=unique(activePlugs.map(componentPerkName).filter(Boolean));
        const statValues={};
        Object.entries(stats.stats||{}).forEach(([hash,value])=>{
          const name=componentStatName(hash);
          if(STAT_NAMES[Number(hash)])statValues[name]=Number(value&&value.value!==undefined?value.value:value)||0;
        });
        const flags=Number(raw.state!==undefined?raw.state:(inst.state||0));
        const name=(def.displayProperties&&def.displayProperties.name&&String(def.displayProperties.name).trim())||def.displayName||def.itemTypeDisplayName||('Item #'+raw.itemHash);
        const iconPath=def.displayProperties&&def.displayProperties.icon||'';
        const icon=iconPath?(/^(?:https?:)?\/\//i.test(iconPath)?iconPath:'https://www.bungie.net'+(iconPath.startsWith('/')?'':'/')+iconPath):'';
        const type=isPostmaster?'Postmaster':gearBucket;
        const isExotic=/exotic/i.test(def.itemTypeAndTierDisplayName||'')||/exotic/i.test(def.itemTypeDisplayName||'');
        const kills=itemKillCount(raw,inst,objectives,stats);
        const tracked=!!(flags&2)||!!inst.isTracked||!!inst.tracked;
        all.push({
          id:id,itemInstanceId:iid,itemHash:String(raw.itemHash),bucket:type,gearBucket,type:WEAPON_BUCKETS.includes(gearBucket)?'Weapon':ARMOR_BUCKETS.includes(gearBucket)?'Armor':String(def.itemTypeDisplayName||'Item'),
          owner:isVault?'Vault':owner,characterId:isVault?'':String(characterId||''),bucketHash:Number(raw.bucketHash||defBucket),
          quantity:Number(raw.quantity||1),power:Number(inst.primaryStat&&inst.primaryStat.value||raw.primaryStat&&raw.primaryStat.value||0),
          rarity:String(def.itemTypeAndTierDisplayName||'Legendary'),equipped:!isVault&&!isPostmaster&&equipIds.has(id),
          locked:!!(flags&1)||!!raw.locked,tracked,trackedKills:kills,trackedKillsUnknown:tracked&&kills===null,
          tags:[],notes:'',perks,perkHashes:activePlugs,stats:statValues,
          icon:icon,exotic:isExotic,transferable:raw.transferStatus===undefined?true:Number(raw.transferStatus)===0,
          transferStatus:raw.transferStatus,canEquip:inst.canEquip,damageType:Number(inst.damageType||0),definitionDescription:String(def.description||''),
          itemCategory:String(def.itemTypeDisplayName||''),isPostmaster, isLiveItem:true
        });
      });
    }
    const chars=profile.characterInventories&&profile.characterInventories.data||{};
    const vault=profile.profileInventory&&profile.profileInventory.data&&profile.profileInventory.data.items||[];
    Object.entries(chars).forEach(([characterId,group])=>{
      const c=live.characters.find(x=>String(x.characterId)===String(characterId));
      const owner=c?c.name:'Guardian';
      addGroup(group.items||[],owner,characterId,false);
      addGroup(equipment[characterId]&&equipment[characterId].items||[],owner,characterId,false);
    });
    addGroup(vault,'Vault','',true);
    return all;
  }

  function setStatus(text) {
    const el=document.getElementById('sourceStatus');
    if(el)el.textContent=text;
    const stage=document.getElementById('llLoadStage');
    if(stage)stage.textContent=text;
    updateHeader();
  }
  function updateHeader() {
    const connected=isConnected();
    const status=document.getElementById('sourceStatus');
    if(status)status.textContent=live.busy?(live.operation||'Syncing…'):connected?('Bungie connected · '+(live.lastSync?'synced':'loading')):state().source==='bungie'?'Last synced snapshot':state().demo?'Sample data':'Local workspace';
    const button=document.getElementById('connectBungieButton');
    if(button){button.textContent=connected?'Bungie connected':'Connect Bungie';button.classList.toggle('ll-connected-button',connected);}
    const profileLabel=document.getElementById('profileLabel');
    const profileSub=document.getElementById('profileSub');
    if(profileLabel)profileLabel.textContent=connected?(live.profileDisplayName||'Bungie account'):'Local workspace';
    if(profileSub)profileSub.textContent=connected?('Live · '+getSelectedCharacterName()):state().demo?'Sample inventory':state().source==='bungie'?'Offline snapshot':'Imported inventory';
    const picker=document.getElementById('guardianPicker');
    if(picker) {
      const current=connected?String(live.selectedCharacterId):(state().farm.owner||'');
      const opts=connected?live.characters.map(c=>'<option value="'+h(c.characterId)+'" '+(String(c.characterId)===current?'selected':'')+'>'+h(c.name)+' · '+h(c.light)+' power</option>').join(''):
        LL.ownerNames().filter(n=>n!=='Vault').map(n=>'<option value="'+h(n)+'" '+(n===current?'selected':'')+'>'+h(n)+' (local)</option>').join('');
      picker.innerHTML=opts||'<option value="">Select Guardian</option>';
      picker.disabled=connected?!live.characters.length:!opts;
    }
    const pCount=document.getElementById('postmasterNavCount');
    if(pCount)pCount.textContent=String(state().items.filter(i=>i.isPostmaster||i.bucket==='Postmaster').length);
    const sCount=document.getElementById('shardNavCount');
    if(sCount)sCount.textContent=String((state().shardList||[]).length);
    const iCount=document.getElementById('inventoryNavCount');
    if(iCount)iCount.textContent=String(state().items.length);
    const banner=document.getElementById('sampleBanner');
    if(banner&&(connected||state().bannerDismissed||!state().demo))banner.classList.add('hidden');
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===LL.getPage()));
  }

  function renderHeading(eyebrow,title,description,action) {
    return '<div class="page-heading"><div><div class="eyebrow">'+eyebrow+'</div><h1>'+title+'</h1><p>'+description+'</p></div><div class="heading-actions">'+(action||'')+'</div></div>';
  }
  function connectionNotice() {
    if(isConnected())return '<div class="ll-live-notice"><span class="status-dot"></span><span><b>Live Bungie inventory</b><small>Last refreshed '+h(live.lastSync?new Date(live.lastSync).toLocaleTimeString():'just now')+'. Live actions affect Destiny 2.</small></span><button class="button button-quiet button-small" data-action="refresh-bungie">Refresh</button></div>';
    return '<div class="inline-alert warning"><span class="alert-symbol">!</span><div><b>Bungie is not connected.</b><br>These actions stay disabled until you configure a Public Bungie API application and sign in. Imported/sample gear is never treated as live inventory.</div><button class="button button-small" data-action="connect-bungie">Connect</button></div>';
  }
  function btn(action,label,disabled,klass) {
    return '<button class="button '+(klass||'')+'" data-action="'+action+'" '+(disabled?'disabled':'')+'>'+label+'</button>';
  }
  function bulkMovePlan() {
    const picks=state().items.filter(i=>i.isLiveItem&&i.owner!=='Vault'&&!i.isPostmaster&&!i.equipped&&isGear(i)&&normalizeTransferable(i));
    return {items:picks.slice(0,vaultFree()),blocked:Math.max(0,picks.length-vaultFree()),free:vaultFree(),total:picks.length};
  }
  function shardItemById(id) { return getItem(id); }
  function safeToStage(item) {
    if(!item||!item.isLiveItem)return {ok:false,reason:'Not a live Bungie item'};
    if(live.rollStatus!=='ready')return {ok:false,reason:'Load community roll data before staging items'};
    if(item.isPostmaster||item.bucket==='Postmaster')return {ok:false,reason:'Pull it from the Postmaster first'};
    if(!isGear(item))return {ok:false,reason:'Only weapons and armor can be staged'};
    if(item.equipped)return {ok:false,reason:'Equipped items are never staged'};
    if(!normalizeTransferable(item))return {ok:false,reason:'Bungie reports this item cannot currently be transferred'};
    if(item.locked)return {ok:false,reason:'Locked in-game'};
    if(localProtected(item))return {ok:false,reason:'Protected or referenced by a loadout'};
    if(item.exotic)return {ok:false,reason:'Exotics are never staged'};
    if(item.trackedKills!==null&&Number(item.trackedKills)>=500)return {ok:false,reason:'500+ tracked kills'};
    if(item.trackedKillsUnknown)return {ok:false,reason:'Tracked kills could not be verified'};
    const roll=assessRoll(item);
    if(roll.status==='good')return {ok:false,reason:'Matches a community wishlist roll'};
    if(roll.status==='unverified')return {ok:false,reason:'Active weapon perks could not be verified'};
    if(isArmor(item)&&totalStats(item)>=65)return {ok:false,reason:'High-stat armor (65+) is protected from staging'};
    return {ok:true,reason:'No protected roll or safety flag found'};
  }
  function totalStats(item) {
    const s=item&&item.stats||{};
    return ['Mobility','Resilience','Recovery','Discipline','Intellect','Strength'].reduce((sum,k)=>sum+(Number(s[k])||0),0);
  }
  function isJunkListed(item) { return shardIds().has(String(item.id)); }
  function addToShardList(id) {
    const item=getItem(id);
    if(!item){LL.toast('That item is no longer in your inventory. Refresh and try again.','error');return;}
    const safe=safeToStage(item);
    if(!safe.ok){LL.toast('Cannot confirm this as shard-list junk: '+safe.reason+'.','error');return;}
    const s=state();
    if(!Array.isArray(s.shardList))s.shardList=[];
    if(s.shardList.includes(String(id))){LL.toast('Already on the Shard List.');return;}
    s.shardList.push(String(id));
    item.tags=unique((item.tags||[]).concat(['shard-list']));
    LL.persist();LL.renderPage();LL.toast(item.name+' added to the Shard List. This is a staging list only.','success');
  }
  function removeFromShardList(id) {
    const s=state();
    s.shardList=(s.shardList||[]).filter(x=>String(x)!==String(id));
    const item=getItem(id);
    if(item)item.tags=(item.tags||[]).filter(t=>String(t).toLowerCase()!=='shard-list');
    LL.persist();LL.renderPage();LL.toast('Removed from the Shard List.');
  }

  function renderBulk() {
    const move=bulkMovePlan();
    const shards=(state().shardList||[]).map(shardItemById).filter(Boolean);
    const shardPrep=buildShardPrepPreview();
    const safeShardItems=shardPrep.ready;
    const stageable=shardPrep.stage;
    const f=buildFuelPlan();
    const active=getSelectedCharacterName();
    return renderHeading('BULK INVENTORY TOOLS','Bulk actions','Move gear safely, prepare a dismantling session, or stage infusion fuel. Each action previews its scope before it changes live inventory.',
      btn('load-rolls',live.rollStatus==='ready'?'✓ Roll data loaded':'Load community rolls',live.rollStatus==='loading','button-quiet button-small')+' '+btn('refresh-bungie','↻ Refresh inventory',!isConnected(),'button-quiet button-small'))+
      connectionNotice()+
      '<div class="stat-grid"><div class="stat-card"><div class="stat-label">Vault slots free</div><div class="stat-value">'+fmt(vaultFree())+'</div><div class="stat-foot">'+fmt(vaultCount())+' of '+fmt(VAULT_CAPACITY)+' used · verify in game</div></div><div class="stat-card"><div class="stat-label">Move-to-vault candidates</div><div class="stat-value">'+fmt(move.total)+'</div><div class="stat-foot">Unequipped weapons and armor on characters</div></div><div class="stat-card"><div class="stat-label">Confirmed shard list</div><div class="stat-value">'+fmt(shards.length)+'</div><div class="stat-foot">'+fmt(safeShardItems.length)+' safe · '+fmt(stageable.length)+' to stage after clearing</div></div><div class="stat-card"><div class="stat-label">Infusion fuel</div><div class="stat-value">'+fmt(f.total)+'</div><div class="stat-foot">Vault items above your equipped power</div></div></div>'+
      '<div class="ll-action-grid">'+
        '<section class="panel ll-action-card"><div class="ll-action-icon">🏦</div><div class="eyebrow">INVENTORY MOVE</div><h2>Move everything to the Vault</h2><p>Moves every transferable, unequipped weapon and armor piece off your characters into the Vault. Equipped gear and Postmaster items stay where they are. Locked items can be moved but never dismantled here.</p><div class="ll-action-summary"><b>'+fmt(Math.min(move.total,move.free))+' items</b><span>'+fmt(move.free)+' vault slots free</span></div>'+
          (move.blocked?'<div class="ll-small-warning">'+fmt(move.blocked)+' items do not fit in the available Vault space and will be left on their characters.</div>':'')+
          btn('bulk-move-vault','Move '+fmt(Math.min(move.total,move.free))+' items to the Vault',!isConnected()||move.total===0||move.free===0,'ll-action-button')+'</section>'+
        '<section class="panel ll-action-card"><div class="ll-action-icon">🗑️</div><div class="eyebrow">SHARD SESSION PREP</div><h2>Prep a dismantling session</h2><p>Moves unequipped character weapons and armor into the Vault while leaving equipped gear, Postmaster items, and confirmed Shard List items alone. Then it stages as many safe, confirmed items as fit on your selected Guardian ('+h(active)+').</p><div class="ll-action-summary"><b>'+fmt(stageable.length)+' to stage</b><span>'+fmt(shardPrep.alreadyOnTarget.length)+' already staged · '+fmt(shardPrep.notFit)+' won’t fit</span></div>'+
          '<div class="ll-small-warning">Locked gear, Exotics, wishlist keepers, protected loadout items, high-stat armor, and any weapon with 500+ or unverifiable tracked kills are never staged. Dismantling stays in-game.</div>'+
          ((stageable.length||shardPrep.alreadyOnTarget.length)?btn('prep-shard-session',stageable.length?'Prepare session · '+fmt(stageable.length)+' to stage':'Clear other gear · '+fmt(shardPrep.alreadyOnTarget.length)+' already staged',!isConnected(),'ll-action-button'):safeShardItems.length?'<div class="ll-small-warning">Confirmed items are on the Shard List, but none currently fit the selected Guardian’s freed gear slots. Switch Guardian or make bucket space before staging.</div>'+btn('go-shard','Review Shard List',false,'button-quiet ll-action-button'):'<div class="ll-small-warning">No confirmed junk to stage. Confirm items on the Shard List first.</div>'+btn('go-shard','Review Shard List',false,'button-quiet ll-action-button'))+'</section>'+
        '<section class="panel ll-action-card"><div class="ll-action-icon">⚡</div><div class="eyebrow">POWER MANAGEMENT</div><h2>Stage infusion fuel</h2><p>Chooses up to two highest-power, safely burnable Vault pieces per weapon/armor slot—but only if each piece beats the selected Guardian’s equipped power. Low-power items are never staged.</p><div class="ll-action-summary"><b>'+fmt(f.total)+' fuel pieces</b><span>'+fmt(f.rows.filter(r=>r.count).length)+' slots with upgrades</span></div>'+
          '<div class="ll-small-warning">Exotics, locks, wishlist rolls, loadout-protected gear, high-stat armor and tracked-kill weapons are excluded. Check each row before moving the fuel.</div>'+
          btn('stage-infusion-fuel','Stage '+fmt(f.total)+' fuel pieces',!isConnected()||f.total===0,'ll-action-button')+'</section>'+
        '<section class="panel ll-action-card"><div class="ll-action-icon">✦</div><div class="eyebrow">EQUIP OPTIMIZER</div><h2>Equip maximum power</h2><p>Finds the highest-power eligible item in each supported equipment slot, brings it to your selected Guardian if needed, then equips the set. Items currently equipped on another Guardian are left alone.</p><div class="ll-action-summary"><b>8 gear slots</b><span>'+h(active)+' selected</span></div>'+
          btn('go-max-power','Review maximum-power set',!isConnected(),'ll-action-button')+'</section>'+
        '<section class="panel ll-action-card"><div class="ll-action-icon">🔍</div><div class="eyebrow">BUILD COHERENCE</div><h2>Check equipped setup</h2><p>Audits your selected Guardian’s equipped gear, active socket names, subclass and Artifact for common build keywords and possible gaps. This is a transparent heuristic, not a claim of AI certainty; recommended changes must be applied in-game.</p><div class="ll-action-summary"><b>Gear + subclass</b><span>'+h(active)+' selected</span></div>'+
          btn('go-audit','Check my setup',!isConnected(),'ll-action-button')+'</section>'+
      '</div>'+
      '<section class="panel ll-fuel-diagnostics"><div class="panel-head"><div><h2>Infusion fuel by slot</h2><p>Each line compares the best safe Vault candidate against the selected Guardian’s equipped piece. Nothing stages unless you confirm the bulk action.</p></div></div>'+
      '<div class="ll-fuel-list">'+f.rows.map(r=>{
        let title='',detail='',tone='neutral',mark='·';
        if(!isConnected()) {title='Connect Bungie for live gear';detail='The fuel planner only stages items from a live Vault inventory.';}
        else if(live.rollStatus!=='ready') {title='Load community roll data first';detail='Fuel staging stays disabled until the curated keeper list and trash-candidate list are available.';tone='warn';mark='!';}
        else if(r.count) {
          title=r.bucket+' — '+r.count+' piece'+(r.count===1?'':'s')+' to stage, above equipped ✦ '+(r.current||'—');
          detail=r.picked.map(i=>i.name+' · ✦ '+fmt(i.power)).join('  |  ');
          if(r.blockedBySpace)detail+=' · '+r.blockedBySpace+' additional candidate(s) do not fit in this Guardian’s current '+r.bucket+' inventory.';
          tone='good';mark='✓';
        } else if(r.candidates.length&&r.space===0) {
          title=r.bucket+' — safe upgrades exist, but the character bucket has no free slot';
          detail='Highest candidate ✦ '+fmt(r.candidates[0].power)+' vs equipped ✦ '+(r.current||'—')+'. Free a slot before staging.';
          tone='warn';mark='!';
        } else if(r.bestBurnable&&r.current&&Number(r.bestBurnable.power)<=r.current) {
          title=r.bucket+' — best burnable piece is ✦ '+fmt(r.bestBurnable.power)+', not above equipped ✦ '+fmt(r.current)+' — nothing will be staged';
          detail=r.bestBurnable.name+' is the highest-power item that passed the safety checks in the Vault.';
          tone='neutral';mark='—';
        } else if(r.bestBurnable&&!r.current) {
          title=r.bucket+' — best safe Vault piece is ✦ '+fmt(r.bestBurnable.power);
          detail='No equipped item power was detected for comparison. Review the loadout before staging.';
          tone='warn';mark='!';
        } else {
          title=r.bucket+' — no safe infusion-fuel candidate';
          detail='No Vault item passed the transfer, lock, Exotic, roll, protection, kill-count and armor-stat checks for this slot.';
          tone='neutral';mark='—';
        }
        return '<div class="ll-fuel-row"><span class="ll-fuel-mark '+tone+'">'+mark+'</span><div class="ll-fuel-copy"><b>'+h(title)+'</b><small>'+h(detail)+'</small></div></div>';
      }).join('')+'</div></section>'+
      '<div class="panel ll-bottom-note"><b>Live actions are reversible only where the game supports it.</b><span>Transfers can be undone by moving gear again. The app does not dismantle, infuse, spend materials, or change mods in this version.</span></div>';
  }

  function renderPostmaster() {
    const items=state().items.filter(i=>i.isPostmaster||i.bucket==='Postmaster');
    const groups=live.characters.map(c=>{
      const rows=items.filter(i=>String(i.characterId)===String(c.characterId));
      return '<section class="panel ll-postmaster-group"><div class="panel-head"><div><h2>'+h(c.name)+' Postmaster</h2><p>'+rows.length+' lost item'+(rows.length===1?'':'s')+'</p></div></div>'+
        (rows.length?'<div class="ll-postmaster-list">'+rows.map(i=>'<div class="ll-postmaster-row"><div class="ll-postmaster-icon">'+(i.icon?'<img src="'+h(i.icon)+'" alt="" loading="lazy">':'✦')+'</div><div class="ll-postmaster-copy"><b>'+h(i.name)+'</b><small>'+h(i.gearBucket||i.itemCategory||'Item')+' · '+h(i.rarity)+' · '+(i.power||'—')+' power</small><small>'+(i.locked?'Locked · ':'')+(i.trackedKills!==null&&i.trackedKills!==undefined?fmt(i.trackedKills)+' tracked kills':'')+'</small></div><button class="button button-small" data-action="pull-postmaster" data-id="'+h(i.id)+'" '+(!isConnected()?'disabled':'')+'>Pull to '+h(c.name)+'</button></div>').join(''):'<div class="empty-state">Nothing in this character’s Postmaster snapshot.</div>')+'</section>';
    }).join('');
    return renderHeading('LOST ITEMS INBOX','Postmaster','Retrieve gear before it disappears. Bungie lets companion apps pull an item back to its owning Guardian; this app cannot dismantle it or send it directly from Postmaster to the Vault.',
      btn('refresh-bungie','↻ Refresh',!isConnected(),'button-quiet button-small'))+
      connectionNotice()+
      '<div class="inline-alert warning"><span class="alert-symbol">!</span><div><b>Postmaster items can be lost.</b><br>Pulling returns the item to that character’s inventory. To keep or review it, refresh and then move it to the Vault or add it to your Shard List after it is no longer in Postmaster.</div></div>'+
      (live.characters.length?groups:'<section class="panel"><div class="empty-state">Connect to Bungie to see your characters’ Postmasters.</div></section>');
  }

  function renderShard() {
    const ids=state().shardList||[];
    const rows=ids.map(id=>{
      const item=getItem(id);
      if(!item)return '<tr><td colspan="5"><span class="ll-muted">Missing item ID '+h(id)+' — refresh inventory or remove this stale entry.</span></td><td><button class="button button-quiet button-small" data-action="remove-shard" data-id="'+h(id)+'">Remove</button></td></tr>';
      const safe=safeToStage(item);
      const roll=assessRoll(item);
      return '<tr><td><b>'+h(item.name)+'</b><span class="table-sub">'+h(item.gearBucket||item.bucket)+' · '+h(item.owner)+' · '+(item.power||'—')+' power</span></td><td>'+h(roll.label)+'</td><td>'+h(safe.ok?'Ready to stage':safe.reason)+'</td><td>'+h(item.locked?'Locked':item.exotic?'Exotic':item.trackedKills!==null&&item.trackedKills>=500?'500+ kills':'Unprotected')+'</td><td><button class="button button-quiet button-small" data-action="open-item" data-id="'+h(item.id)+'">Inspect</button></td><td><button class="button button-quiet button-small" data-action="remove-shard" data-id="'+h(item.id)+'">Remove</button></td></tr>';
    }).join('');
    const count=ids.map(getItem).filter(Boolean).length;
    const safeCount=ids.map(getItem).filter(i=>i&&safeToStage(i).ok).length;
    return renderHeading('CONFIRM FIRST, DISMANTLE IN-GAME','Shard List','Only put items here after you have personally confirmed they are junk. This list is a staging queue—not an automatic dismantle queue.',
      btn('load-rolls','↻ Load roll data',live.rollStatus==='loading','button-quiet button-small'))+
      connectionNotice()+
      '<div class="inline-alert warning"><span class="alert-symbol">!</span><div><b>You are responsible for every dismantle in-game.</b><br>Little Light will never dismantle items. Staging is blocked for locked items, Exotics, wishlist-matched rolls, protected/loadout gear, 500+ tracked kills, and weapons whose active tracked-kill count cannot be verified. Confirm every item before starting your session.</div></div>'+
      '<div class="stat-grid"><div class="stat-card"><div class="stat-label">Confirmed items</div><div class="stat-value">'+fmt(count)+'</div><div class="stat-foot">Manually added by you</div></div><div class="stat-card"><div class="stat-label">Ready to stage</div><div class="stat-value">'+fmt(safeCount)+'</div><div class="stat-foot">Pass current safety checks</div></div><div class="stat-card"><div class="stat-label">Selected Guardian</div><div class="stat-value" style="font-size:22px">'+h(getSelectedCharacterName())+'</div><div class="stat-foot">Use the top bar to change target</div></div><div class="stat-card"><div class="stat-label">Vault capacity</div><div class="stat-value">'+fmt(vaultFree())+'</div><div class="stat-foot">Free of '+fmt(VAULT_CAPACITY)+' slots</div></div></div>'+
      '<section class="panel"><div class="panel-head"><div><h2>Your confirmed shard queue</h2><p>Items in this table are not deleted or dismantled by the app.</p></div><div class="field-row">'+btn('go-cleaner','Review vault','', 'button-quiet button-small')+btn('prep-shard-session','Prep dismantling session',!isConnected()||safeCount===0,'button-small')+'</div></div><div class="table-wrap">'+(rows?'<table class="data-table"><thead><tr><th>Item</th><th>Roll check</th><th>Staging safety</th><th>Flags</th><th></th><th></th></tr></thead><tbody>'+rows+'</tbody></table>':'<div class="empty-state"><strong>Your Shard List is empty.</strong><br>Review the Vault page and manually confirm any truly disposable gear. Community roll data is a safety net, not a substitute for checking your own collection.</div>')+'</div></section>';
  }

  function buildFuelPlan() {
    const char=getSelectedCharacter();
    const owner=char?char.name:getSelectedCharacterName();
    const rows=[];
    for(const bucket of GEAR_BUCKETS) {
      const worn=char?equippedItem(char.characterId,bucket):null;
      const current=Number(worn&&worn.power||0);
      const targetCount=char?characterBucketItems(char.characterId,bucket).length:0;
      const burnableCandidates=state().items.filter(i=>bucketFor(i)===bucket&&safeToFuel(i))
        .sort((a,b)=>Number(b.power)-Number(a.power));
      const candidates=burnableCandidates.filter(i=>Number(i.power)>current);
      const picked=candidates.slice(0,2);
      const space=Math.max(0,CHARACTER_BUCKET_CAPACITY-targetCount);
      const selected=picked.slice(0,space);
      rows.push({bucket,current,targetCount,space,burnableCandidates,bestBurnable:burnableCandidates[0]||null,candidates,picked:selected,count:selected.length,blockedBySpace:Math.max(0,picked.length-selected.length)});
    }
    return {rows,total:rows.reduce((a,r)=>a+r.count,0)};
  }
  function safeToFuel(item) {
    if(live.rollStatus!=='ready')return false;
    if(!item||!item.isLiveItem||item.owner!=='Vault'||item.isPostmaster||!normalizeTransferable(item)||item.locked||item.exotic||localProtected(item)||isJunkListed(item))return false;
    if(item.trackedKills!==null&&Number(item.trackedKills)>=500)return false;
    if(item.trackedKillsUnknown)return false;
    const roll=assessRoll(item);
    if(roll.status==='good'||roll.status==='unverified')return false;
    if(isArmor(item)&&totalStats(item)>=65)return false;
    return true;
  }
  function renderPower() {
    const char=getSelectedCharacter();
    const plans=buildMaxPowerPlan();
    const rows=plans.rows.map(r=>{
      const current=r.current;
      return '<div class="ll-power-row"><div class="ll-power-slot"><span>'+h(r.bucket)+'</span><small>'+h(r.item?r.item.owner:'No eligible item found')+'</small></div><div class="ll-power-values"><span class="ll-old-power">'+(current?current:'—')+'</span><span class="ll-arrow">→</span><b>'+(r.item?fmt(r.item.power):'—')+'</b></div><div class="ll-power-result '+(r.improvement>0?'positive':r.improvement===0?'even':'')+'">'+(r.item?(r.improvement>0?'+'+r.improvement:r.improvement===0?'Already highest':'Ready'):'No pick')+'</div></div>';
    }).join('');
    const set=plans.rows.filter(r=>r.item).length;
    return renderHeading('POWER OPTIMIZER','Maximum power','Build the highest-power eligible set for the selected Guardian. Items on another Guardian are never pulled if they are currently equipped there.',
      btn('refresh-bungie','↻ Refresh',!isConnected(),'button-quiet button-small'))+
      connectionNotice()+
      '<div class="ll-live-notice"><span class="ll-max-power-icon">✦</span><span><b>'+h(char?char.name:'Select a Guardian')+'</b><small>Current character light: '+(char?fmt(char.light):'—')+' · set covers '+plans.rows.length+' equipment slots</small></span><span class="ll-spacer"></span><b>'+set+'/8</b></div>'+
      '<section class="panel"><div class="panel-head"><div><h2>Highest-power pick by slot</h2><p>Preview only—nothing moves until you confirm the action below.</p></div></div>'+
        (rows||'<div class="empty-state">No eligible items in the current inventory.</div>')+
        '<div class="ll-small-warning" style="margin-top:14px">This chooses the highest displayed power per bucket. It does not calculate the game’s full pinnacle/engram reward algorithm and will not take an item away from another Guardian if that item is equipped.</div>'+
        '<div class="ll-page-actions">'+btn('apply-max-power','Equip maximum-power set ('+set+' slots)',!isConnected()||!set,'')+btn('go-bulk','Back to bulk actions',false,'button-quiet')+'</div></section>';
  }
  function buildMaxPowerPlan() {
    const char=getSelectedCharacter();
    const rows=GEAR_BUCKETS.map(bucket=>{
      const current=char?equippedItem(char.characterId,bucket):null;
      const candidates=state().items.filter(i=>isGear(i)&&bucketFor(i)===bucket&&!i.isPostmaster&&i.isLiveItem&&normalizeTransferable(i)&&classCanUse(i,char)&&(
        i.owner==='Vault'||(char&&String(i.characterId)===String(char.characterId)&&!i.isPostmaster)||(!i.equipped&&i.owner!=='Vault')
      )).sort((a,b)=>{
        const powerDifference=Number(b.power)-Number(a.power);
        if(powerDifference)return powerDifference;
        const aIsWorn=!!(char&&a.equipped&&String(a.characterId)===String(char.characterId));
        const bIsWorn=!!(char&&b.equipped&&String(b.characterId)===String(char.characterId));
        return Number(bIsWorn)-Number(aIsWorn);
      });
      const item=candidates[0]||null;
      return {bucket,current:Number(current&&current.power||0),item,improvement:item?Number(item.power||0)-Number(current&&current.power||0):null};
    });
    return {rows};
  }

  function renderAudit() {
    const char=getSelectedCharacter();
    const gear=char?state().items.filter(i=>String(i.characterId||'')===String(char.characterId)&&i.equipped&&!i.isPostmaster):[];
    // Bungie may return the Seasonal Artifact in character inventory rather than characterEquipment.
    const artifacts=char?state().items.filter(i=>String(i.characterId||'')===String(char.characterId)&&!i.isPostmaster&&(/artifact/i.test(bucketFor(i))||/artifact/i.test(i.itemCategory||''))):[];
    const auditItems=gear.concat(artifacts.filter(a=>!gear.some(g=>String(g.id)===String(a.id))));
    const subclass=gear.find(i=>/subclass/i.test(bucketFor(i))||/subclass/i.test(i.itemCategory||''))||null;
    const element=subclass?inferSubclassElement(subclass):'Unknown';
    const gearText=auditItems.map(i=>[i.name,i.definitionDescription,(i.perks||[]).join(' ')].join(' ')).join(' ').toLowerCase();
    const allPerks=unique(auditItems.flatMap(i=>i.perks||[]));
    const strand=/strand|suspend|tangle|threadling|woven mail|sever|unravel/.test(gearText);
    const grenade=/grenade|discipline|demolitionist|explosive/.test(gearText);
    const melee=/melee|strength|pugilist|combination blow/.test(gearText);
    const orb=/orb of power|surge|reaper|heavy handed|firepower/.test(gearText);
    const exotics=gear.filter(i=>i.exotic);
    const cards=[];
    if(element==='Strand'&&!strand)cards.push({tone:'warn',title:'Strand synergy looks thin',body:'The equipped-item names and socket perks do not show obvious Strand, suspend, tangle, Threadling, Woven Mail, sever, or unravel support. Review your exotic and armor mods for a clear Strand loop.'});
    else if(element==='Strand'&&strand)cards.push({tone:'good',title:'Strand keywords detected',body:'At least one equipped item or socket perk refers to Strand or a related verb. Check that these pieces support the same loop in practice.'});
    else if(element!=='Unknown')cards.push({tone:'info',title:element+' subclass detected',body:'The equipped subclass reports '+element+'. This local audit cannot yet evaluate every ability aspect, fragment, artifact unlock, or activity modifier.'});
    else cards.push({tone:'warn',title:'Subclass details are incomplete',body:'The current profile response did not identify the equipped subclass element. Refresh Bungie inventory and inspect the subclass item.'});
    if(!orb)cards.push({tone:'info',title:'No obvious orb/surge loop found',body:'Equipped socket names do not include common orb-generation or weapon-surge terms. For DPS builds, verify your leg surge mods, orb generation, and activity-specific weapon type manually.'});
    if(!grenade&&!melee)cards.push({tone:'info',title:'Ability-energy focus is unclear',body:'No obvious grenade or melee energy keywords appeared in equipped item/socket names. Choose one primary ability loop and check that your armor mods support it.'});
    if(exotics.length>1)cards.push({tone:'warn',title:'More than one Exotic appears equipped',body:'The profile snapshot lists '+exotics.length+' Exotic items in equipment. Check that the currently equipped armor/weapon restrictions shown in-game are respected.'});
    if(!gear.length)cards.push({tone:'warn',title:'No equipped setup found',body:'Refresh inventory and choose a Guardian with equipped gear before running this check.'});
    const perkList=allPerks.slice(0,35);
    return renderHeading('BUILD COHERENCE CHECK','Equipped setup audit','A transparent local heuristic over your equipped gear, item descriptions, active socket names, and subclass element. It is not an LLM and it cannot see every combat interaction.',
      btn('refresh-bungie','↻ Refresh',!isConnected(),'button-quiet button-small'))+
      connectionNotice()+
      '<div class="ll-audit-banner"><div class="ll-audit-emblem">⌕</div><div><div class="eyebrow">SELECTED GUARDIAN</div><h2>'+h(char?char.name:'No Guardian')+' · '+h(element)+'</h2><p>'+gear.length+' equipped items · '+artifacts.length+' Artifact record(s) · '+exotics.length+' Exotics · '+allPerks.length+' active socket names captured</p></div></div>'+
      '<div class="ll-audit-grid">'+cards.map(c=>'<article class="panel ll-audit-card '+h(c.tone)+'"><span class="ll-audit-state">'+(c.tone==='good'?'✓':c.tone==='warn'?'!':'i')+'</span><h3>'+h(c.title)+'</h3><p>'+h(c.body)+'</p></article>').join('')+'</div>'+
      '<section class="panel"><div class="panel-head"><div><h2>Equipped gear & active socket names</h2><p>Equipped gear and its current socket plugs are the sources used by the audit.</p></div></div>'+
      (gear.length?'<div class="ll-equipped-audit-list">'+gear.map(i=>'<div class="ll-equipped-audit-row"><div class="ll-mini-item-icon">'+(i.icon?'<img src="'+h(i.icon)+'" alt="" loading="lazy">':'✦')+'</div><div class="ll-equipped-audit-copy"><b>'+h(i.name)+'</b><small>'+h(bucketFor(i))+' · '+(i.power||'—')+' power</small><div class="ll-chip-list">'+(i.perks||[]).slice(0,8).map(p=>'<span class="tag">'+h(p)+'</span>').join('')+'</div></div><button class="button button-quiet button-small" data-action="open-item" data-id="'+h(i.id)+'">Inspect</button></div>').join(''):'<div class="empty-state">No equipped items in the selected profile. Refresh inventory.</div>')+
      '</section><section class="panel"><div class="panel-head"><div><h2>Seasonal Artifact</h2><p>Selected Artifact and its active socket plugs, when returned by Bungie.</p></div></div>'+
      (artifacts.length?'<div class="ll-equipped-audit-list">'+artifacts.map(i=>'<div class="ll-equipped-audit-row"><div class="ll-mini-item-icon">'+(i.icon?'<img src="'+h(i.icon)+'" alt="" loading="lazy">':'✦')+'</div><div class="ll-equipped-audit-copy"><b>'+h(i.name)+'</b><small>'+h(bucketFor(i))+' · '+(i.power||'—')+' power</small><div class="ll-chip-list">'+(i.perks||[]).map(p=>'<span class="tag">'+h(p)+'</span>').join('')+'</div></div><button class="button button-quiet button-small" data-action="open-item" data-id="'+h(i.id)+'">Inspect</button></div>').join(''):'<div class="empty-state">No Artifact record was returned. This may mean the current Bungie component response does not expose it as an inventory item.</div>')+
      '</section><section class="panel"><div class="panel-head"><div><h2>Detected socket names</h2><p>Names from the Bungie manifest for your active socket plugs; actual combat synergy still needs a human review.</p></div></div><div class="ll-chip-list">'+(perkList.map(p=>'<span class="tag">'+h(p)+'</span>').join('')||'<span class="ll-muted">No active socket names available.</span>')+'</div></section>'+
      '<div class="ll-bottom-disclaimer">This is intentionally labelled an audit, not “AI advice.” Once the inventory model is stable, it can be extended with verified build rules, set-bonus data and an optional user-provided AI provider.</div>';
  }
  function inferSubclassElement(item) {
    const direct=damageName(item&&item.damageType);
    if(direct!=='Unknown'&&direct!=='Kinetic')return direct;
    const text=[item&&item.name,item&&item.definitionDescription,(item&&item.perks||[]).join(' ')].join(' ').toLowerCase();
    for(const [pattern,name] of [[/strand|threadrunner/,'Strand'],[/stasis|revenant/,'Stasis'],[/solar|gunslinger/,'Solar'],[/void|nightstalker/,'Void'],[/arc|arcstrider/,'Arc']])if(pattern.test(text))return name;
    return direct;
  }
  function damageName(id) { return ({1:'Kinetic',2:'Arc',3:'Solar',4:'Void',6:'Stasis',7:'Strand'})[Number(id)]||'Unknown'; }

  function renderFarmingLive() {
    const selected=getSelectedCharacter();
    if(!isConnected())return renderHeading('INVENTORY AUTOMATION','Farming Mode','Maintain open gear slots on a live Guardian so new drops have space.')+connectionNotice()+
      '<section class="panel"><div class="empty-state"><strong>Connect Bungie to start live Farming Mode.</strong><br>When enabled, the page refreshes inventory periodically and transfers one safe item out of any full eligible gear bucket. It never dismantles items.</div></section>';
    const plan=buildLiveFarmPlan();
    const enabled=!!state().farm.enabled;
    return renderHeading('INVENTORY AUTOMATION','Farming Mode','Keep room in your selected Guardian’s gear buckets. The app will observe the Bungie inventory while this tab remains open and move eligible items into your Vault.',
      btn('refresh-bungie','↻ Refresh inventory',live.busy,'button-quiet button-small'))+
      connectionNotice()+
      '<div class="farm-hero"><section class="farm-main-card"><div class="farm-status '+(enabled?'active':'')+'"><span class="status-dot"></span>'+ (enabled?'Live Farming Mode is running':'Farming Mode stopped')+'</div><h2>'+(enabled?'Space is being maintained.':'Keep your pockets ready.')+'</h2><p>'+h(selected?selected.name:'Selected Guardian')+' · moves unequipped, transferable items to your Vault whenever a monitored bucket falls below the target free-space count. This runs only while the page is open and authorized.</p>'+
      '<div class="ll-farm-primary-actions">'+btn('toggle-farm',enabled?'Stop Farming Mode':'Start Farming Mode',live.busy,'')+btn('farm-run-once','Run one check now',live.busy,'button-quiet')+'</div><span class="muted small">Automatic checks every 30 seconds while this browser tab is open.</span></section>'+
      '<div class="farm-side-stats"><div class="farm-small-card"><label>Safe moves queued</label><strong>'+plan.moves.length+'</strong><small>from '+h(plan.owner)+' to Vault</small></div><div class="farm-small-card"><label>Buckets checked</label><strong>'+plan.rows.length+'</strong><small>eligible gear buckets with items</small></div><div class="farm-small-card"><label>Free vault slots</label><strong>'+fmt(vaultFree())+'</strong><small>of '+VAULT_CAPACITY+' known slots</small></div><div class="farm-small-card"><label>Blocked buckets</label><strong>'+plan.blocked+'</strong><small>no safe item or no Vault room</small></div></div></div>'+
      '<div class="farm-settings"><section class="panel farm-controls"><div class="panel-head"><div><h2>Farm settings</h2><p>Choose the Guardian and empty-space target.</p></div></div><div class="field-stack"><label class="field-label" for="llFarmOwner">Guardian</label><select class="control" id="llFarmOwner" style="width:100%">'+live.characters.map(c=>'<option value="'+h(c.characterId)+'" '+(selected&&String(c.characterId)===String(selected.characterId)?'selected':'')+'>'+h(c.name)+'</option>').join('')+'</select></div><div class="field-stack"><label class="field-label" for="llFarmSpaces">Empty slots to preserve per bucket</label><div class="range-line"><input type="range" id="llFarmSpaces" min="1" max="9" value="'+Math.max(1,Math.min(9,Number(state().farm.spaces||1)))+'"><span class="range-value" id="llFarmSpacesValue">'+Math.max(1,Math.min(9,Number(state().farm.spaces||1)))+'</span></div><div class="field-note">The character gear bucket capacity is '+CHARACTER_BUCKET_CAPACITY+'. Eligible buckets are checked independently; Postmaster is never touched.</div></div><div class="separator"></div><div class="form-tip">Move priority: least valuable candidate first—community wishlist keepers, Exotics, locked items, saved-loadout items, protected tags and 500+ tracked-kill weapons are avoided. If the tracked-kill count is marked but could not be read, the item is left alone.</div></section>'+
      '<section class="panel"><div class="panel-head"><div><h2>Next move plan</h2><p>Every move uses Bungie’s TransferItem endpoint.</p></div><span class="tag">Live preview</span></div>'+
      (plan.rows.length?plan.rows.map(r=>'<div class="bucket-plan-row"><div class="bucket-plan-name">'+h(r.bucket)+'<small>'+r.count+' of '+r.capacity+' used · '+r.free+' currently free</small></div><div class="plan-count">'+(r.item?h(r.item.name):'—')+'<span>'+(r.item?h(r.item.power)+' power':'')+'</span></div><span class="plan-pill '+(r.blocked?'warn':r.item?'move':'clear')+'">'+(r.blocked?'Blocked':r.item?'Move one':'Clear')+'</span></div>').join(''):'<div class="empty-state">No equipped bucket needs to be cleared.</div>')+
      '<div class="separator"></div><div class="ll-small-warning">DIM’s own D2 Farming Mode maintains spare slots in equippable buckets as inventory updates. This version follows that central behavior, but does not yet implement every DIM-specific value heuristic or inventory state edge case.</div></section></div>';
  }
  function buildLiveFarmPlan() {
    const c=getSelectedCharacter();
    const owner=c?c.name:getSelectedCharacterName();
    const spaces=Math.max(1,Math.min(9,Number(state().farm.spaces||1)));
    const rows=[],moves=[];
    if(!c)return {owner,rows,moves,blocked:0};
    const dynamicBuckets=Object.values(live.bucketDefs||{})
      .filter(b=>Number(b.category)===3&&!!b.hasTransferDestination&&Number(b.scope)===0&&Number(b.hash)!==POSTMASTER_HASH)
      .map(b=>bucketName(b.hash));
    const monitoredBuckets=unique(dynamicBuckets.concat(GEAR_BUCKETS));
    monitoredBuckets.forEach(bucket=>{
      const items=state().items.filter(i=>String(i.characterId||'')===String(c.characterId)&&!i.isPostmaster&&bucketFor(i)===bucket);
      if(!items.length)return;
      const count=items.length;
      const bucketDefinition=Object.values(live.bucketDefs||{}).find(b=>bucketName(b.hash)===bucket);
      const capacity=Math.max(1,Number(bucketDefinition&&bucketDefinition.itemCount)||CHARACTER_BUCKET_CAPACITY);
      const free=Math.max(0,capacity-count);
      const threshold=capacity-spaces+1;
      let item=null,blocked=false;
      if(count>=threshold) {
        const candidates=items.filter(i=>!i.equipped&&!i.isPostmaster&&normalizeTransferable(i)&&safeToFarm(i)).sort(farmSort);
        item=candidates[0]||null;
        blocked=!item||vaultFree()<=0;
        if(item&&vaultFree()>0)moves.push(item);
        else item=null;
      }
      rows.push({bucket,count,free,capacity,item,blocked});
    });
    return {owner,rows,moves,blocked:rows.filter(r=>r.blocked).length};
  }
  function safeToFarm(item) {
    if(!item||!item.isLiveItem||item.equipped||item.locked||item.exotic||localProtected(item)||item.isPostmaster||!normalizeTransferable(item))return false;
    if(item.trackedKills!==null&&Number(item.trackedKills)>=500)return false;
    if(item.trackedKillsUnknown)return false;
    const roll=assessRoll(item);
    // choosy-only entries are likely trash candidates; only default wishlist keepers are excluded from moving aside.
    return roll.status!=='good';
  }
  function farmSort(a,b) {
    const score=i=>{
      const roll=assessRoll(i);
      return (i.exotic?100000:0)+(i.locked?100000:0)+(localProtected(i)?100000:0)+(roll.status==='good'?50000:0)+(Number(i.power)||0)*40+totalStats(i);
    };
    return score(a)-score(b);
  }
  async function liveFarmCycle() {
    if(!isConnected()||!state().farm.enabled||live.farmCycleRunning||live.busy)return;
    live.farmCycleRunning=true;
    let moved=0;
    try {
      await refreshProfileOnly();
      const plan=buildLiveFarmPlan();
      for(let index=0;index<plan.moves.length;index++) {
        if(!isConnected()||!state().farm.enabled)break;
        // Refreshing replaces item objects. Resolve the latest item before each move and
        // re-check the bucket threshold and safety flags to avoid acting on a stale plan.
        const planned=plan.moves[index];
        const item=getItem(planned.id);
        const character=getSelectedCharacter();
        if(!item||!character||String(item.characterId)!==String(character.characterId)||item.owner!==character.name)continue;
        if(!safeToFarm(item)||vaultFree()<=0)continue;
        const bucket=bucketFor(item);
        const bucketItems=characterBucketItems(character.characterId,bucket);
        const spaces=Math.max(1,Math.min(9,Number(state().farm.spaces||1)));
        if(bucketItems.length<bucketCapacity(bucket)-spaces+1)continue;
        setStatus('Farming Mode moving '+item.name+'…');
        await moveToVault(item);
        moved++;
        live.lastOperation='Farming Mode moved '+item.name+' to Vault';
        await sleep(180);
        await refreshProfileOnly();
      }
      if(moved) {
        LL.toast('Farming Mode moved '+moved+' item'+(moved===1?'':'s')+' to the Vault.','success');
        setStatus('Farming Mode watching inventory');
      } else setStatus(plan.blocked?'Farming Mode needs attention':'Farming Mode watching inventory');
    } catch(err) {
      state().farm.enabled=false;
      if(live.farmTimer)clearInterval(live.farmTimer);
      live.farmTimer=null;
      LL.persist();
      LL.toast('Farming Mode stopped after an API error: '+(err&&err.message||String(err)),'error');
    } finally {
      live.farmCycleRunning=false;
      updateHeader();
      if(LL.getPage()==='farming')LL.renderPage();
    }
  }
  async function toggleLiveFarm() {
    if(!needConnection())return;
    const s=state();
    s.farm.enabled=!s.farm.enabled;
    if(s.farm.enabled) {
      saveConfig({selectedCharacterId:live.selectedCharacterId});
      LL.persist();
      if(live.farmTimer)clearInterval(live.farmTimer);
      live.farmTimer=setInterval(()=>{liveFarmCycle();},30000);
      LL.toast('Live Farming Mode started. Leave this tab open for automatic checks.','success');
      await liveFarmCycle();
    } else {
      if(live.farmTimer)clearInterval(live.farmTimer);
      live.farmTimer=null;
      LL.persist();
      LL.toast('Live Farming Mode stopped.');
      LL.renderPage();
    }
  }
  async function runFarmOnce() {
    if(!needConnection())return;
    await liveFarmCycle();
  }
  async function setSelectedCharacter(characterId) {
    if(isConnected()) {
      const c=live.characters.find(x=>String(x.characterId)===String(characterId));
      if(!c)return;
      live.selectedCharacterId=String(c.characterId);
      saveConfig({selectedCharacterId:live.selectedCharacterId});
      state().farm.owner=c.name;LL.persist();LL.renderPage();
      LL.toast(c.name+' selected for bulk actions and loadout tools.','success');
    } else {
      state().farm.owner=String(characterId);
      LL.persist();LL.renderPage();
    }
  }

  async function refreshLiveInventory() {
    if(!needConnection())return;
    await loadLiveProfile();
    if(live.rollStatus==='idle'||live.rollStatus==='error')loadCommunityRolls().catch(()=>{});
  }
  async function refreshProfileOnly() {
    if(!live.membership)throw new Error('No Bungie profile is selected.');
    const m=live.membership;
    const path='/Destiny2/'+encodeURIComponent(m.membershipType)+'/Profile/'+encodeURIComponent(m.membershipId)+'/?components=100,102,103,200,201,202,205,206,300,301,302,304,305,307,400';
    live.profile=await bungieRequest(path);
    const charactersData=live.profile&&live.profile.characters&&live.profile.characters.data||{};
    live.characters=distinguishCharacterNames(Object.entries(charactersData).map(([id,c],i)=>({characterId:String(id),classType:Number(c.classType),name:CLASS_NAMES[Number(c.classType)]||('Guardian '+(i+1)),light:Number(c.light||0),emblemPath:c.emblemPath||''})).sort((a,b)=>a.classType-b.classType));
    if(!live.characters.some(c=>String(c.characterId)===String(live.selectedCharacterId))) {
      live.selectedCharacterId=live.characters[0]?String(live.characters[0].characterId):'';
      saveConfig({selectedCharacterId:live.selectedCharacterId});
    }
    live.savedLoadoutIds=extractSavedLoadoutIds(live.profile);
    const items=buildLiveItems(live.profile);
    const old=state().items||[],oldById=new Map(old.map(i=>[String(i.id),i]));
    state().items=items.map((item,index)=>{const previous=oldById.get(String(item.id))||{};return LL.normalizeWorkspaceItem(Object.assign({},previous,item,{id:String(item.id),tags:Array.isArray(previous.tags)?previous.tags:[],notes:previous.notes||''}),index);});
    state().demo=false;state().source='bungie';
    live.connected=true;live.lastSync=new Date().toISOString();
    state().shardList=(state().shardList||[]).filter(id=>state().items.some(i=>String(i.id)===String(id)));
    LL.persist();updateHeader();
  }

  async function executeSequential(label,jobs,executor,refresh=true) {
    if(!needConnection()||live.busy)return;
    if(!jobs.length){LL.toast('There are no eligible items for this action.');return;}
    live.busy=true;live.operation=label;updateHeader();LL.renderPage();
    let succeeded=0;const errors=[];
    try {
      for(let i=0;i<jobs.length;i++) {
        const job=jobs[i];
        try {
          await executor(job,i);
          succeeded++;
        } catch(err) {
          errors.push((job.name||job.bucket||'Item')+': '+(err&&err.message||String(err)));
        }
        setStatus(label+' · '+(i+1)+'/'+jobs.length);
        if(i<jobs.length-1)await sleep(160);
        if((i+1)%5===0) { live.lastOperation=label+' · '+(i+1)+'/'+jobs.length; }
      }
    } finally {
      try {
        if(refresh)await refreshProfileOnly();
      } catch(err) { errors.push('Inventory refresh: '+(err&&err.message||String(err))); }
      live.busy=false;live.operation='';
      LL.persist();updateHeader();LL.renderPage();
      live.lastOperation=label+': '+succeeded+'/'+jobs.length+' succeeded';
      LL.toast(live.lastOperation+(errors.length?' · '+errors.length+' issue(s)':''),errors.length?'error':'success');
      if(errors.length)showOperationErrors(label,errors);
    }
  }
  function showOperationErrors(title,errors) {
    document.getElementById('modal').innerHTML='<div class="ll-modal-head"><span class="ll-eyebrow">OPERATION REPORT</span><button class="icon-button" data-action="close-modal">×</button></div><h2 id="modalTitle">'+h(title)+'</h2><p>Some API operations failed. Successful moves remain completed; failed items were not assumed to have moved.</p><div class="ll-error-list">'+errors.slice(0,20).map(e=>'<div>'+h(e)+'</div>').join('')+(errors.length>20?'<div>…and '+(errors.length-20)+' more</div>':'')+'</div><div class="ll-modal-actions"><button class="button" data-action="close-modal">Close</button></div>';
    document.getElementById('modalScrim').hidden=false;
  }
  async function moveToVault(item) {
    if(!item||!item.itemHash||!item.itemInstanceId)throw new Error('This item lacks the instance ID required for a live transfer.');
    if(item.owner==='Vault')return;
    if(item.isPostmaster)throw new Error('Postmaster items must be pulled to their character first.');
    const characterId=ownerCharacterId(item);
    if(!characterId)throw new Error('Could not identify which character owns this item.');
    const body={itemReferenceHash:Number(item.itemHash),stackSize:Number(item.quantity||1),transferToVault:true,itemId:String(item.itemInstanceId),characterId:characterId,membershipType:Number(live.membership.membershipType)};
    await bungieRequest('/Destiny2/Actions/Items/TransferItem/',{method:'POST',body});
  }
  async function moveFromVaultToCharacter(item,characterId) {
    if(!item||!item.itemHash||!item.itemInstanceId)throw new Error('This item lacks the instance ID required for a live transfer.');
    if(item.owner!=='Vault')throw new Error('Only Vault items can use the direct Vault-to-Guardian transfer.');
    const body={itemReferenceHash:Number(item.itemHash),stackSize:Number(item.quantity||1),transferToVault:false,itemId:String(item.itemInstanceId),characterId:String(characterId),membershipType:Number(live.membership.membershipType)};
    await bungieRequest('/Destiny2/Actions/Items/TransferItem/',{method:'POST',body});
  }
  async function pullFromPostmaster(item) {
    if(!needConnection())return;
    if(!item||!item.isPostmaster)throw new Error('That item is not in a Postmaster.');
    const characterId=ownerCharacterId(item);
    if(!characterId)throw new Error('Could not identify the Postmaster owner.');
    const body={itemReferenceHash:Number(item.itemHash),stackSize:Number(item.quantity||1),itemId:String(item.itemInstanceId||''),characterId:characterId,membershipType:Number(live.membership.membershipType)};
    live.busy=true;updateHeader();
    try {
      await bungieRequest('/Destiny2/Actions/Items/PullFromPostmaster/',{method:'POST',body});
      await refreshProfileOnly();
      LL.toast('Pulled '+item.name+' to '+characterName(characterId)+'.','success');
    } catch(err) {
      LL.toast('Could not pull Postmaster item: '+(err&&err.message||String(err)),'error');
    } finally {
      live.busy=false;updateHeader();LL.renderPage();
    }
  }
  function buildShardPrepPreview() {
    const target=getSelectedCharacter();
    const queue=(state().shardList||[]).map(getItem).filter(Boolean);
    const ready=queue.filter(i=>safeToStage(i).ok);
    if(!target)return {target:null,queue,ready,clear:[],stage:[],alreadyOnTarget:[],notFit:ready.length,transitNeeded:false};
    const targetId=String(target.characterId);
    const clearCandidates=state().items.filter(i=>i.isLiveItem&&i.owner!=='Vault'&&!i.equipped&&!i.isPostmaster&&isGear(i)&&normalizeTransferable(i)&&!isJunkListed(i));
    const transitNeeded=ready.some(i=>i.owner!=='Vault'&&String(i.characterId||'')!==targetId&&!i.isPostmaster);
    const reserve=transitNeeded?1:0;
    const clear=clearCandidates.slice(0,Math.max(0,vaultFree()-reserve));
    const clearIds=new Set(clear.map(i=>String(i.id)));
    const counts={};
    GEAR_BUCKETS.forEach(bucket=>{
      counts[bucket]=state().items.filter(i=>String(i.characterId||'')===targetId&&!i.isPostmaster&&bucketFor(i)===bucket&&!clearIds.has(String(i.id))).length;
    });
    const freeAfterClear=Math.max(0,vaultFree()-clear.length);
    const stage=[],alreadyOnTarget=[];
    const sorted=ready.slice().sort((a,b)=>String(a.owner===target.name?0:a.owner==='Vault'?1:2).localeCompare(String(b.owner===target.name?0:b.owner==='Vault'?1:2)));
    for(const item of sorted) {
      const bucket=bucketFor(item);
      if(!GEAR_BUCKETS.includes(bucket))continue;
      if(item.owner===target.name&&String(item.characterId||'')===targetId){alreadyOnTarget.push(item);continue;}
      if((counts[bucket]||0)>=bucketCapacity(bucket))continue;
      if(item.owner==='Vault') {
        stage.push({item,source:'Vault'});
        counts[bucket]++;
      } else if(!item.isPostmaster&&String(item.characterId||'')!==targetId&&freeAfterClear>0) {
        // The same free Vault slot is reusable for each sequential character-to-vault-to-target transfer.
        stage.push({item,source:'Other'});
        counts[bucket]++;
      }
    }
    const stagedIds=new Set(stage.map(x=>String(x.item.id)));
    const onTargetIds=new Set(alreadyOnTarget.map(i=>String(i.id)));
    const notFit=ready.filter(i=>!stagedIds.has(String(i.id))&&!onTargetIds.has(String(i.id))).length;
    return {target,queue,ready,clear,stage,alreadyOnTarget,notFit,transitNeeded,freeAfterClear};
  }
  function prepareShardSession() {
    if(!needConnection())return;
    const plan=buildShardPrepPreview();
    const selected=plan.target;
    if(!selected){LL.toast('Select a Guardian first.','error');return;}
    const description='First move '+plan.clear.length+' unequipped non-junk weapon/armor pieces to the Vault. Then stage '+plan.stage.length+' manually confirmed items on '+selected.name+'. '+plan.alreadyOnTarget.length+' confirmed item(s) are already on this Guardian; '+plan.notFit+' safe item(s) will stay where they are because of bucket capacity or transfer restrictions. Equipped gear, Postmaster items and confirmed junk are left alone during the clearing step.';
    openConfirm('Prep a dismantling session',description,{type:'prep-shard',clearIds:plan.clear.map(i=>i.id),targetId:selected.characterId},'Prepare shard session');
  }
  async function executePrepShard(payload) {
    const clear=(payload.clearIds||[]).map(getItem).filter(i=>i&&i.owner!=='Vault'&&!i.equipped&&!i.isPostmaster&&!isJunkListed(i)&&isGear(i)&&normalizeTransferable(i));
    const targetId=String(payload.targetId||'');
    const target=live.characters.find(c=>String(c.characterId)===targetId);
    if(!target)throw new Error('Selected Guardian no longer exists in the live profile.');
    const toMove=clear.slice(0,vaultFree());
    await executeSequential('Clearing characters to Vault',toMove,async item=>{await moveToVault(item);item.owner='Vault';item.characterId='';},false);
    await refreshProfileOnly();
    const queue=(state().shardList||[]).map(getItem).filter(Boolean);
    const countsByBucket={};
    GEAR_BUCKETS.forEach(b=>countsByBucket[b]=characterBucketItems(targetId,b).length);
    const hasTransitSpace=vaultFree()>0;
    const stage=[];
    const sorted=queue.filter(i=>safeToStage(i).ok).sort((a,b)=>String(a.owner===target.name?0:a.owner==='Vault'?1:2).localeCompare(String(b.owner===target.name?0:b.owner==='Vault'?1:2)));
    for(const item of sorted) {
      const bucket=bucketFor(item);
      if(!GEAR_BUCKETS.includes(bucket)||(countsByBucket[bucket]||0)>=bucketCapacity(bucket))continue;
      if(item.owner==='Vault'){stage.push({item,source:'Vault'});countsByBucket[bucket]++;}
      else if(item.owner===target.name&&String(item.characterId)===targetId){/* already staged on this Guardian */}
      else if(item.owner!==target.name&&hasTransitSpace&&!item.equipped&&!item.isPostmaster){stage.push({item,source:'Other'});countsByBucket[bucket]++;}
    }
    live.busy=true;live.operation='Staging confirmed shard items';updateHeader();LL.renderPage();
    try {
      for(let i=0;i<stage.length;i++) {
        const {item,source}=stage[i];
        try {
          if(source==='Other') {
            await moveToVault(item);
            item.owner='Vault';item.characterId='';
            await sleep(180);
          }
          await moveFromVaultToCharacter(item,targetId);
          item.owner=target.name;item.characterId=targetId;item.isPostmaster=false;
          await sleep(160);
        } catch(err) { LL.toast('Could not stage '+item.name+': '+(err&&err.message||String(err)),'error'); }
        setStatus('Staging shard items · '+(i+1)+'/'+stage.length);
      }
      await refreshProfileOnly();
    } finally {
      live.busy=false;live.operation='';updateHeader();LL.renderPage();
    }
    LL.toast('Dismantling session prepared. Double-check each item and dismantle only in-game.','success');
  }
  function prepareBulkMove() {
    if(!needConnection())return;
    const p=bulkMovePlan();
    const count=Math.min(p.total,p.free);
    if(!count){LL.toast('No transferable character weapons/armor fit in the Vault.');return;}
    openConfirm('Move everything to the Vault','Move '+count+' unequipped weapon/armor items into the Vault. Equipped gear and Postmaster items remain where they are. '+p.blocked+' extra items will stay on their characters if capacity is reached.',{type:'move-all-vault',ids:p.items.slice(0,count).map(i=>i.id)},'Move '+count+' items');
  }
  async function executeMoveAll(payload) {
    const jobs=(payload.ids||[]).map(getItem).filter(i=>i&&i.owner!=='Vault'&&!i.equipped&&!i.isPostmaster&&isGear(i)&&normalizeTransferable(i)).slice(0,vaultFree());
    await executeSequential('Moving gear to Vault',jobs,async item=>{await moveToVault(item);item.owner='Vault';item.characterId='';},true);
  }
  function prepareFuelStage() {
    if(!needConnection())return;
    const plan=buildFuelPlan();
    if(!plan.total){LL.toast('No safe fuel pieces are above your equipped power and fit in the selected Guardian’s inventory.');return;}
    const names=plan.rows.filter(r=>r.count).map(r=>r.bucket+': '+r.picked.map(i=>i.name+' ('+i.power+')').join(', ')).join('; ');
    openConfirm('Stage infusion fuel', 'Stage '+plan.total+' Vault item(s) on '+getSelectedCharacterName()+'. Highest eligible power per slot only, up to two per slot. '+names+'. Items that do not fit or are no longer safe will be skipped.',{type:'stage-fuel',ids:plan.rows.flatMap(r=>r.picked.map(i=>i.id))},'Stage fuel');
  }
  async function executeStageFuel(payload) {
    const char=getSelectedCharacter();
    if(!char)throw new Error('No selected Guardian.');
    const candidates=(payload.ids||[]).map(getItem).filter(i=>i&&i.owner==='Vault'&&safeToFuel(i)&&Number(i.power)>Number((equippedItem(char.characterId,bucketFor(i))||{}).power||0));
    await executeSequential('Staging infusion fuel',candidates,async item=>{
      const bucket=bucketFor(item);
      if(characterBucketItems(char.characterId,bucket).length>=CHARACTER_BUCKET_CAPACITY)throw new Error('The '+bucket+' inventory is full.');
      await moveFromVaultToCharacter(item,char.characterId);
      item.owner=char.name;item.characterId=char.characterId;
    },true);
  }
  function prepareMaxPower() {
    if(!needConnection())return;
    const plan=buildMaxPowerPlan();
    const char=getSelectedCharacter();
    const picks=plan.rows.filter(r=>r.item&&!(char&&r.item.equipped&&String(r.item.characterId)===String(char.characterId)));
    if(!picks.length){LL.toast('Your selected Guardian already has the highest-power eligible item equipped in every available slot.','success');return;}
    const text=picks.map(r=>r.bucket+': '+r.item.name+' ('+r.item.power+')'+(r.current?' vs '+r.current:'')).join('; ');
    openConfirm('Equip maximum-power set','Equip up to '+picks.length+' highest-power item(s) on '+getSelectedCharacterName()+'. '+text+'. Items already equipped in their selected slots are skipped. The app may move unequipped gear through the Vault as required; it will not touch an item equipped on another Guardian.',{type:'max-power',ids:picks.map(r=>r.item.id)},'Equip set');
  }
  async function executeMaxPower(payload) {
    const char=getSelectedCharacter();
    if(!char)throw new Error('No selected Guardian.');
    const plan=buildMaxPowerPlan();
    const picked=plan.rows.filter(r=>r.item&&(payload.ids||[]).includes(r.item.id));
    const errors=[];
    for(let n=0;n<picked.length;n++) {
      const row=picked[n];let item=getItem(row.item.id);
      try {
        if(!item)continue;
        if(item.owner!==char.name||String(item.characterId)!==String(char.characterId)) {
          if(item.equipped)throw new Error('This item is equipped on another Guardian and was left alone.');
          if(item.owner!=='Vault') {
            if(vaultFree()<=0)throw new Error('Vault is full, so the item cannot be moved through it.');
            await moveToVault(item);item.owner='Vault';item.characterId='';await sleep(180);
          }
          if(characterBucketItems(char.characterId,row.bucket).length>=CHARACTER_BUCKET_CAPACITY) {
            const spare=characterBucketItems(char.characterId,row.bucket).filter(i=>!i.equipped&&!localProtected(i)&&!i.locked&&!isJunkListed(i)&&normalizeTransferable(i)).sort((a,b)=>Number(a.power)-Number(b.power))[0];
            if(!spare)throw new Error('No safe inventory slot is available in this bucket.');
            await moveToVault(spare);spare.owner='Vault';spare.characterId='';await sleep(180);
          }
          item=getItem(row.item.id)||item;
          await moveFromVaultToCharacter(item,char.characterId);
          item.owner=char.name;item.characterId=char.characterId;await sleep(180);
        }
        await bungieRequest('/Destiny2/Actions/Items/EquipItem/',{method:'POST',body:{itemId:String(item.itemInstanceId),characterId:String(char.characterId),membershipType:Number(live.membership.membershipType)}});
      } catch(err) { errors.push(row.bucket+' — '+row.item.name+': '+(err&&err.message||String(err))); }
      if(n<picked.length-1)await sleep(180);
      setStatus('Equipping maximum power · '+(n+1)+'/'+picked.length);
    }
    await refreshProfileOnly();
    LL.toast('Maximum-power set attempted on '+char.name+'.'+(errors.length?' '+errors.length+' slot(s) failed.':''),errors.length?'error':'success');
    if(errors.length)showOperationErrors('Maximum-power set',errors);
  }

  async function setLiveLock(item) {
    if(!item||!item.isLiveItem||!item.itemInstanceId)throw new Error('This item cannot be locked through Bungie.');
    const target=ownerCharacterId(item)||String((getSelectedCharacter()||{}).characterId||'');
    if(!target)throw new Error('Select a Guardian before changing this item lock.');
    const next=!item.locked;
    await bungieRequest('/Destiny2/Actions/Items/SetLockState/',{method:'POST',body:{state:next,itemId:String(item.itemInstanceId),characterId:target,membershipType:Number(live.membership.membershipType)}});
    await refreshProfileOnly();
    LL.toast((next?'Locked ':'Unlocked ')+item.name+' in Destiny 2.','success');
    if(document.querySelector('.detail-sheet'))LL.openItem(item.id);
  }
  async function setLiveEquip(item) {
    if(!item||!item.isLiveItem||!item.itemInstanceId)throw new Error('This item cannot be equipped through Bungie.');
    if(item.equipped) {LL.toast('Bungie’s API does not provide a direct unequip action. Equip another item in this slot to replace it.','error');return;}
    const char=getSelectedCharacter();if(!char)throw new Error('Select a Guardian first.');
    if(!classCanUse(item,char))throw new Error('This armor class does not match the selected Guardian.');
    if(item.owner!==char.name||String(item.characterId)!==String(char.characterId)) {
      if(item.equipped)throw new Error('An item equipped on another Guardian cannot be moved.');
      if(item.owner!=='Vault'){
        await moveToVault(item);
        item.owner='Vault';item.characterId='';
        await sleep(180);
      }
      if(characterBucketItems(char.characterId,bucketFor(item)).length>=CHARACTER_BUCKET_CAPACITY) {
        const spare=characterBucketItems(char.characterId,bucketFor(item)).filter(i=>!i.equipped&&!localProtected(i)&&!i.locked&&!isJunkListed(i)).sort((a,b)=>Number(a.power)-Number(b.power))[0];
        if(!spare)throw new Error('No safe open slot is available in the selected Guardian’s bucket.');
        await moveToVault(spare);await sleep(180);
      }
      await moveFromVaultToCharacter(item,char.characterId);
    }
    await bungieRequest('/Destiny2/Actions/Items/EquipItem/',{method:'POST',body:{itemId:String(item.itemInstanceId),characterId:String(char.characterId),membershipType:Number(live.membership.membershipType)}});
    await refreshProfileOnly();
    LL.toast('Equipped '+item.name+' on '+char.name+'.','success');
    if(document.querySelector('.detail-sheet'))LL.openItem(item.id);
  }
  async function moveLiveItem(item,targetOwner) {
    if(!item||!item.isLiveItem)throw new Error('This is not a live Bungie item.');
    if(item.equipped)throw new Error('Equipped gear cannot be moved directly. Equip something else first.');
    if(item.isPostmaster)throw new Error('Pull the item out of Postmaster before moving it.');
    const target=String(targetOwner||'Vault');
    if(target==='Vault') { await moveToVault(item); }
    else {
      const targetChar=live.characters.find(c=>c.name===target);
      if(!targetChar)throw new Error('Choose a valid Guardian or Vault location.');
      if(item.owner===targetChar.name&&String(item.characterId)===String(targetChar.characterId))return;
      if(item.owner!=='Vault') {
        await moveToVault(item);
        item.owner='Vault';item.characterId='';
        await sleep(180);
      }
      if(characterBucketItems(targetChar.characterId,bucketFor(item)).length>=CHARACTER_BUCKET_CAPACITY)throw new Error(targetChar.name+' has no free '+bucketFor(item)+' slot.');
      await moveFromVaultToCharacter(item,targetChar.characterId);
    }
    await refreshProfileOnly();
    LL.toast('Moved '+item.name+' to '+target+'.','success');
    if(document.querySelector('.detail-sheet'))LL.openItem(item.id);
  }
  async function saveDetailLive(item) {
    if(!item)return;
    item.tags=(document.getElementById('detailTags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean);
    item.notes=(document.getElementById('detailNotes')?.value||'').trim();
    const target=document.getElementById('detailOwner')?.value||item.owner;
    LL.persist();
    try { if(target!==item.owner)await moveLiveItem(item,target); }
    catch(err) {LL.toast('Tags saved, but the live move failed: '+(err&&err.message||String(err)),'error');}
    if(document.querySelector('.detail-sheet'))LL.openItem(item.id);
  }

  function assessRoll(item) {
    if(!item||!item.itemHash)return {status:'unknown',label:'No roll data',notes:'No item hash was available.'};
    // Do not treat missing socket data as evidence that a weapon is a bad roll.
    if(isWeapon(item)&&!(item.perkHashes||[]).length)return {status:'unverified',label:'Weapon perk data missing',notes:'Bungie did not return active socket plug hashes for this weapon. Staging and infusion-fuel selection are blocked until its roll can be verified.'};
    const hash=String(item.itemHash);
    const good=matchWishlist(live.goodRolls.get(hash)||[],item);
    if(good)return {status:'good',label:'Community wishlist match',notes:good.notes||'Matches a curated community weapon roll.',source:'voltron.txt'};
    const avoid=matchWishlist(live.choosyRolls.get(hash)||[],item);
    if(avoid)return {status:'avoid',label:'Choosy trash candidate',notes:avoid.notes||'This roll is in choosy_voltron.txt but not the default keeper list; the source describes these additional entries as opinionated trash rolls.',source:'choosy_voltron.txt'};
    if(live.goodRolls.has(hash)||live.choosyRolls.has(hash))return {status:'known',label:'Community rolls exist; current roll not matched',notes:'A roll for this item exists in the source list, but the active perks were not an exact match.'};
    return {status:live.rollStatus==='ready'?'none':'unknown',label:live.rollStatus==='ready'?'No matching wishlist roll':'Roll data not loaded',notes:live.rollStatus==='ready'?'No exact match was found in these community files. This does not prove an item is bad.':'Load community roll data before relying on wishlist-based safety checks.'};
  }
  function matchWishlist(entries,item) {
    if(!entries||!entries.length)return null;
    const activeIds=new Set((item.perkHashes||[]).map(String));
    const activeNames=new Set((item.perks||[]).map(n=>normalizeName(n)));
    for(const e of entries) {
      if(!e.perks.length)return e;
      let match=false;
      if(activeIds.size)match=e.perks.every(p=>activeIds.has(String(p)));
      if(!match&&activeNames.size&&live.itemDefs) {
        const names=e.perks.map(p=>normalizeName(componentPerkName(p)));
        match=names.every(n=>n&&activeNames.has(n));
      }
      if(match)return e;
    }
    return null;
  }
  function normalizeName(n) { return String(n||'').toLowerCase().replace(/[’']/g,"'").replace(/[^a-z0-9]+/g,' ').trim(); }
  function parseWishlist(text,kind) {
    const map=new Map();let notes='';let title='';let count=0;
    const lines=String(text||'').split(/\r?\n/);
    for(let i=0;i<lines.length;i++) {
      const line=lines[i].trim();
      if(!line)continue;
      if(line.startsWith('//')||line.startsWith('#')) {
        const n=line.match(/^\/\/\s*notes?\s*:\s*(.*)$/i);
        if(n)notes=n[1].trim();
        const t=line.match(/^\/\/\s*title\s*:\s*(.*)$/i);
        if(t)title=t[1].trim();
        continue;
      }
      const m=line.match(/dimwishlist:item=(\d+)(?:&[^ \r\n]*)?/i);
      if(!m)continue;
      const hash=String(m[1]);
      const perksM=line.match(/[?&]perks=([0-9,]+)/i);
      const perks=perksM?perksM[1].split(',').filter(Boolean).map(String):[];
      let inlineNotes='';
      const notesMatch=line.match(/#notes:([^#]*)/i);
      if(notesMatch) {
        inlineNotes=notesMatch[1].trim();
        try { inlineNotes=decodeURIComponent(inlineNotes.replace(/\\+/g,' ')); } catch (_) {}
      }
      const rec={perks,notes:inlineNotes||notes||title||'',source:kind};
      if(!map.has(hash))map.set(hash,[]);
      map.get(hash).push(rec);
      count++;
    }
    return {map,count};
  }
  async function fetchTextCached(url) {
    const timestampKey='little-light-roll-refresh:'+url;
    const maxAge=6*60*60*1000;
    if(window.caches) {
      try {
        const cache=await caches.open(CACHE_NAME);
        const cached=await cache.match(url);
        const cachedAt=Number(localStorage.getItem(timestampKey)||0);
        if(cached&&cachedAt&&Date.now()-cachedAt<maxAge)return await cached.text();
      } catch (_) {}
    }
    const response=await fetch(url,{cache:'no-cache'});
    if(!response.ok)throw new Error('Community roll source returned HTTP '+response.status+'.');
    const text=await response.text();
    if(window.caches) {
      try {
        const cache=await caches.open(CACHE_NAME);
        await cache.put(url,new Response(text,{headers:{'Content-Type':'text/plain;charset=utf-8'}}));
        localStorage.setItem(timestampKey,String(Date.now()));
      } catch (_) {}
    }
    return text;
  }
  async function loadCommunityRolls() {
    if(live.rollStatus==='loading')return;
    live.rollStatus='loading';live.rollError='';updateHeader();
    if(LL.getPage()==='cleaner'||LL.getPage()==='shard')LL.renderPage();
    try {
      const results=await Promise.all([fetchTextCached(WISHLIST_GOOD_URL),fetchTextCached(WISHLIST_CHOOSY_URL)]);
      const good=parseWishlist(results[0],'good');
      const choosy=parseWishlist(results[1],'avoid');
      live.goodRolls=good.map;live.choosyRolls=choosy.map;
      live.rollStats={good:good.count,choosy:choosy.count};
      live.rollStatus='ready';live.rollError='';
      if(isConnected())state().items.forEach(i=>{if(i.isLiveItem)i.communityRoll=assessRoll(i);});
      LL.persist();
      LL.toast('Loaded community roll lists: '+fmt(good.count)+' curated and '+fmt(choosy.count)+' choosy entries.','success');
    } catch(err) {
      live.rollStatus='error';live.rollError=err&&err.message||String(err);
      LL.toast('Could not load community roll data: '+live.rollError,'error');
    }
    updateHeader();LL.renderPage();
  }
  function rollBadge(item) {
    const r=assessRoll(item);
    const cls=r.status==='good'?'good':r.status==='avoid'?'avoid':r.status==='known'?'known':'';
    if(!cls)return '';
    return '<span class="ll-roll-badge '+cls+'" title="'+h(r.notes)+'">'+(r.status==='good'?'✓ Wishlist':r.status==='avoid'?'⚠ Trash candidate':'◇ Rolls available')+'</span>';
  }
  function renderCleaner() {
    const items=state().items.filter(i=>i.owner==='Vault'&&!i.isPostmaster&&isGear(i));
    const findings=items.map(item=>{
      const roll=assessRoll(item);
      const safe=safeToStage(item);
      let reason='No matching roll found; manual review only';
      let kind='Review';
      if(roll.status==='good'){reason=roll.notes||'Matches a curated community wishlist roll';kind='Community keeper';}
      else if(roll.status==='unverified'){reason=roll.notes||'Active weapon perk data is missing';kind='Data incomplete';}
      else if(roll.status==='avoid'){reason=roll.notes||'Choosy wishlist marks this as a trash-roll candidate';kind='Trash candidate';}
      else if(isArmor(item)&&totalStats(item)>=65){reason='High-stat armor ('+totalStats(item)+' total)';kind='High-stat keeper';}
      else if(item.locked||localProtected(item)){reason='Locked, tagged or loadout-protected';kind='Protected';}
      else if(item.exotic){reason='Exotic items need manual review';kind='Exotic';}
      else if(item.trackedKills!==null&&item.trackedKills>=500){reason=fmt(item.trackedKills)+' tracked kills';kind='Kill tracker';}
      return {item,roll,safe,reason,kind};
    });
    const dupes=new Map();
    items.forEach(i=>{
      // Same armor model + sockets is not necessarily a duplicate: random armor stats matter.
      // Only compare armor copies when Bungie returned the complete six-stat profile.
      const statEntries=Object.entries(i.stats||{}).sort(([a],[b])=>a.localeCompare(b));
      if(isArmor(i)&&statEntries.length<6)return;
      const statSignature=isArmor(i)?statEntries.map(([name,value])=>name+':'+Number(value||0)).join(','):'';
      const key=String(i.itemHash)+'|'+(i.perkHashes||[]).slice().sort().join(',')+'|'+statSignature;
      if(!dupes.has(key))dupes.set(key,[]);
      dupes.get(key).push(i);
    });
    const duplicateIds=new Set([...dupes.values()].filter(a=>a.length>1).flatMap(a=>a.map(i=>i.id)));
    const mode=live.cleanerFilter||'all';
    const filtered=findings.filter(f=>{
      if(mode==='good')return f.roll.status==='good';
      if(mode==='avoid')return f.roll.status==='avoid';
      if(mode==='duplicates')return duplicateIds.has(f.item.id);
      if(mode==='highstats')return isArmor(f.item)&&totalStats(f.item)>=65;
      if(mode==='shardable')return f.safe.ok;
      return true;
    });
    const rows=filtered.map(f=>'<tr><td><b>'+h(f.item.name)+'</b><span class="table-sub">'+h(f.item.gearBucket||f.item.bucket)+' · '+h(f.item.owner)+' · '+fmt(f.item.power)+' power</span><div class="ll-inline-badges">'+rollBadge(f.item)+'</div></td><td><span class="ll-kind-pill '+(f.roll.status==='good'?'good':f.roll.status==='avoid'?'warn':'')+'">'+h(f.kind)+'</span><span class="table-sub">'+h(f.reason)+'</span></td><td>'+(f.item.locked?'<span class="tag good">Locked</span>':localProtected(f.item)?'<span class="tag good">Protected</span>':'<span class="tag">Unlocked</span>')+'</td><td><button class="button button-quiet button-small" data-action="open-item" data-id="'+h(f.item.id)+'">Inspect</button>'+(isJunkListed(f.item)?'<button class="button button-quiet button-small" data-action="remove-shard" data-id="'+h(f.item.id)+'">Unconfirm</button>':f.safe.ok?'<button class="button button-outline button-small" data-action="add-shard" data-id="'+h(f.item.id)+'">Confirm junk</button>':'')+'</td></tr>').join('');
    const goodCount=findings.filter(f=>f.roll.status==='good').length;
    const avoidCount=findings.filter(f=>f.roll.status==='avoid').length;
    const highCount=findings.filter(f=>isArmor(f.item)&&totalStats(f.item)>=65).length;
    const shardable=findings.filter(f=>f.safe.ok).length;
    return renderHeading('VAULT MANAGEMENT','Vault review','Compare your actual rolls with the DIM community wishlist, spot duplicate copies and review potential junk without automatically dismantling anything.',
      btn('load-rolls',live.rollStatus==='ready'?'↻ Refresh roll lists':'Load community roll data',live.rollStatus==='loading','button-quiet button-small'))+
      connectionNotice()+
      '<div class="ll-roll-source-state '+(live.rollStatus==='ready'?'ready':'')+'"><span class="status-dot"></span><div><b>'+(live.rollStatus==='ready'?'Community roll lists loaded':'Community roll lists '+(live.rollStatus==='loading'?'loading':'not loaded'))+'</b><small>'+(live.rollStatus==='ready'?fmt(live.rollStats.good)+' curated + '+fmt(live.rollStats.choosy)+' choosy entries · sourced from 48klocs/DIM wishlist files':h(live.rollError||'Load the community wishlists before relying on roll matching.'))+'</small></div><a href="https://github.com/48klocs/dim-wish-list-sources" target="_blank" rel="noreferrer">Source ↗</a></div>'+
      '<div class="stat-grid"><div class="stat-card"><div class="stat-label">Community keepers</div><div class="stat-value">'+fmt(goodCount)+'</div><div class="stat-foot">Exact active-perk wishlist matches</div></div><div class="stat-card"><div class="stat-label">Choosy trash candidates</div><div class="stat-value">'+fmt(avoidCount)+'</div><div class="stat-foot">Opinionated trash-roll matches; still review</div></div><div class="stat-card"><div class="stat-label">High-stat armor</div><div class="stat-value">'+fmt(highCount)+'</div><div class="stat-foot">65+ total stat points</div></div><div class="stat-card"><div class="stat-label">Can confirm as junk</div><div class="stat-value">'+fmt(shardable)+'</div><div class="stat-foot">Still requires your explicit confirmation</div></div></div>'+
      '<section class="panel"><div class="panel-head"><div><h2>Vault roll review</h2><p>“No wishlist match” does not mean a roll is bad. Check your own builds before confirming junk.</p></div><button class="button button-quiet button-small" data-action="go-shard">Open Shard List ('+(state().shardList||[]).length+')</button></div>'+
      '<div class="filter-chip-row">'+[['all','All vault gear'],['good','Wishlist keepers'],['avoid','Choosy trash candidates'],['duplicates','Duplicate rolls'],['highstats','High-stat armor'],['shardable','Shard-list eligible']].map(([key,label])=>'<button class="filter-chip '+(mode===key?'active':'')+'" data-action="cleaner-filter" data-value="'+key+'">'+label+'</button>').join('')+'</div>'+
      '<div class="table-wrap">'+(rows?'<table class="data-table"><thead><tr><th>Item</th><th>Assessment</th><th>Protection</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table>':'<div class="empty-state"><strong>No vault items match this view.</strong><br>Connect Bungie, load your inventory, or change the review filter.</div>')+'</div></section>'+
      '<div class="ll-bottom-disclaimer">Community wishlists recommend specific weapon rolls; they are not an exhaustive authoritative list of every useful roll, and they do not replace your preferences. Armor quality here uses a simple 65+ total-stat guard, not a full armor optimizer.</div>';
  }

  function afterRender(page) {
    updateHeader();
    const s=state();
    document.querySelectorAll('.gear-card[data-id]').forEach(card=>{
      const item=getItem(card.dataset.id);
      if(!item)return;
      const bottom=card.querySelector('.gear-bottom');
      if(bottom&&!bottom.querySelector('.ll-roll-badge')){
        const badge=rollBadge(item);
        if(badge)bottom.insertAdjacentHTML('beforeend',badge);
      }
      if(item.isPostmaster)card.classList.add('ll-postmaster-card');
    });
    if(page==='farming')bindLiveFarmControls();
    injectItemInspectorActions();
  }
  function bindLiveFarmControls() {
    const owner=document.getElementById('llFarmOwner');
    if(owner&&!owner.dataset.llBound){owner.dataset.llBound='1';owner.addEventListener('change',()=>setSelectedCharacter(owner.value));}
    const slider=document.getElementById('llFarmSpaces');
    if(slider&&!slider.dataset.llBound){slider.dataset.llBound='1';slider.addEventListener('input',()=>{const s=state();s.farm.spaces=Number(slider.value);const label=document.getElementById('llFarmSpacesValue');if(label)label.textContent=slider.value;LL.persist();});slider.addEventListener('change',()=>LL.renderPage());}
  }
  function injectItemInspectorActions() {
    const sheet=document.querySelector('.detail-sheet');
    if(!sheet||sheet.querySelector('.ll-inspector-extensions'))return;
    const item=getItem(selectedDetailId(sheet));
    if(!item)return;
    const actions=sheet.querySelector('.detail-actions');
    if(!actions)return;
    const area=document.createElement('div');
    area.className='ll-inspector-extensions';
    if(isConnected()&&item.isLiveItem) {
      if(!isJunkListed(item)) {
        const safe=safeToStage(item);
        if(safe.ok)area.insertAdjacentHTML('beforeend','<button class="button button-outline" data-action="add-shard" data-id="'+h(item.id)+'">Confirm as junk</button>');
        else area.insertAdjacentHTML('beforeend','<div class="ll-small-warning">Shard staging blocked: '+h(safe.reason)+'.</div>');
      } else {
        area.insertAdjacentHTML('beforeend','<button class="button button-outline" data-action="remove-shard" data-id="'+h(item.id)+'">Remove from Shard List</button>');
      }
      if(item.isPostmaster)area.insertAdjacentHTML('beforeend','<div class="ll-small-warning">Postmaster items cannot be staged directly. Pull this item first.</div>');
    }
    if(area.children.length)actions.after(area);
  }
  function selectedDetailId(sheet) {
    const button=sheet.querySelector('[data-action="toggle-lock"]');
    return button&&button.dataset.id||'';
  }
  function syncConnectedItemAction(itemId) {
    const item=getItem(itemId);
    if(item&&isConnected()&&item.isLiveItem)return item;
    return null;
  }
  async function handleRefresh() {
    await refreshLiveInventory();
  }
  function disconnect() {
    if(live.farmTimer)clearInterval(live.farmTimer);
    live.farmTimer=null;
    state().farm.enabled=false;
    dropToken();
    live.connected=false;live.membership=null;live.profile=null;live.characters=[];live.selectedCharacterId='';
    live.savedLoadoutIds=new Set();
    saveConfig({membershipId:'',membershipType:'',selectedCharacterId:''});
    LL.persist();closeModal();updateHeader();LL.renderPage();
    LL.toast('Disconnected from Bungie. The last synced inventory stays as a local snapshot.','success');
  }
  function showHelpModal() {
    document.getElementById('modal').innerHTML='<div class="ll-modal-head"><span class="ll-eyebrow">LITTLE LIGHT</span><button class="icon-button" data-action="close-modal">×</button></div><h2 id="modalTitle">About the live connection</h2><p>Little Light uses Bungie’s documented OAuth and Destiny inventory endpoints through your Cloudflare Worker. Your Bungie API key and OAuth client secret stay in Cloudflare Worker secrets; only the Worker URL is stored in local browser preferences.</p><div class="ll-security-note"><b>Important API boundary:</b> this version can read inventory and use documented TransferItem, PullFromPostmaster, EquipItem, and SetLockState endpoints. The public Destiny API does not expose a dismantle-item endpoint, so dismantling stays in-game.</div><div class="help-links"><a href="https://github.com/Bungie-net/api/wiki/OAuth-Documentation" target="_blank" rel="noreferrer">Bungie OAuth documentation ↗</a><a href="https://bungie-net.github.io/" target="_blank" rel="noreferrer">Official API reference ↗</a><a href="https://github.com/48klocs/dim-wish-list-sources" target="_blank" rel="noreferrer">Community wishlist data ↗</a></div><div class="ll-modal-actions"><button class="button" data-action="close-modal">Got it</button></div>';
    document.getElementById('modalScrim').hidden=false;
  }

  const customPages=new Set(['bulk','postmaster','shard','power','audit','farming','cleaner']);
  function handlesPage(page) { return customPages.has(page); }
  function renderPage(page) {
    if(page==='bulk')return renderBulk();
    if(page==='postmaster')return renderPostmaster();
    if(page==='shard')return renderShard();
    if(page==='power')return renderPower();
    if(page==='audit')return renderAudit();
    if(page==='farming')return renderFarmingLive();
    if(page==='cleaner')return renderCleaner();
    return '';
  }

  const handlers = {
    'connect-bungie':async()=>{openConnectModal();},
    'change-bungie-settings':async()=>openConnectModal('Update your Bungie credentials.',true),
    'save-bungie-settings':saveSettingsAndConnect,
    'choose-membership':chooseMembership,
    'refresh-bungie':handleRefresh,
    'disconnect-bungie':disconnect,
    'close-modal':closeModal,
    'refresh-inventory':handleRefresh,
    'load-rolls':loadCommunityRolls,
    'bulk-move-vault':prepareBulkMove,
    'prep-shard-session':prepareShardSession,
    'stage-infusion-fuel':prepareFuelStage,
    'go-bulk':()=>LL.go('bulk'),
    'go-max-power':()=>LL.go('power'),
    'go-power':()=>LL.go('power'),
    'go-shard':()=>LL.go('shard'),
    'go-cleaner':()=>LL.go('cleaner'),
    'go-postmaster':()=>LL.go('postmaster'),
    'go-audit':()=>LL.go('audit'),
    'toggle-farm':toggleLiveFarm,
    'farm-run-once':runFarmOnce,
    'apply-max-power':prepareMaxPower,
    'confirm-live-action':async()=>{
      const p=live.pendingAction;live.pendingAction=null;closeModal();
      if(!p)return;
      if(p.type==='move-all-vault')await executeMoveAll(p);
      else if(p.type==='prep-shard') {
        try{await executePrepShard(p);}catch(err){live.busy=false;live.operation='';await refreshProfileOnly().catch(()=>{});updateHeader();LL.renderPage();LL.toast('Could not prepare the Shard List: '+(err&&err.message||String(err)),'error');}
      } else if(p.type==='stage-fuel')await executeStageFuel(p);
      else if(p.type==='max-power') {
        live.busy=true;live.operation='Equipping maximum-power set';updateHeader();
        try{await executeMaxPower(p);}catch(err){LL.toast('Maximum-power action failed: '+(err&&err.message||String(err)),'error');}
        finally{live.busy=false;live.operation='';updateHeader();LL.renderPage();}
      }
    },
    'pull-postmaster':async(button)=>{const item=getItem(button.dataset.id);if(!item)return;await pullFromPostmaster(item);},
    'add-shard':async(button)=>addToShardList(button.dataset.id),
    'remove-shard':async(button)=>removeFromShardList(button.dataset.id),
    'toggle-lock':async(button)=>{
      const item=syncConnectedItemAction(button.dataset.id);
      if(!item)return;
      if(!confirm((item.locked?'Unlock':'Lock')+' '+item.name+' in Destiny 2?'))return;
      await setLiveLock(item);
    },
    'toggle-equip':async(button)=>{
      const item=syncConnectedItemAction(button.dataset.id);
      if(!item)return;
      if(!confirm('Equip '+item.name+' on '+getSelectedCharacterName()+'?'))return;
      try{await setLiveEquip(item);}catch(err){LL.toast('Could not equip item: '+(err&&err.message||String(err)),'error');}
    },
    'move-item':async(button)=>{
      const item=syncConnectedItemAction(button.dataset.id);
      if(!item)return;
      const target=document.getElementById('detailOwner')?.value||'Vault';
      if(!confirm('Move '+item.name+' to '+target+' in Destiny 2?'))return;
      try{await moveLiveItem(item,target);}catch(err){LL.toast('Could not move item: '+(err&&err.message||String(err)),'error');}
    },
    'save-item-details':async(button)=>{
      const item=syncConnectedItemAction(button.dataset.id);
      if(!item)return;
      await saveDetailLive(item);
    },
    'cleaner-filter':async(button)=>{
      live.cleanerFilter=button.dataset.value||'all';LL.renderPage();
    },
    'guardian-change':async(_,target)=>setSelectedCharacter(target)
  };

    document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');
    if(!button)return;
    const action=button.dataset.action;
    if(action==='open-item') { setTimeout(injectItemInspectorActions,0); return; }
    if(action==='toggle-compare')return;
    // Allow the original local-workspace controls to work when the item is not connected live.
    if(['toggle-lock','toggle-equip','move-item','save-item-details'].includes(action) && !syncConnectedItemAction(button.dataset.id))return;
    const handler=handlers[action];
    if(!handler)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    try { await handler(button); }
    catch(err) {
      live.error=err&&err.message||String(err);
      updateHeader();
      LL.toast(live.error,'error');
    }
  },true);
  document.addEventListener('change',event=>{
    const target=event.target;
    if(target&&target.id==='guardianPicker') {
      setSelectedCharacter(target.value).catch(err=>LL.toast(err.message||String(err),'error'));
    }
  },true);
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');
    if(button&&button.dataset.action==='help') {
      event.preventDefault();event.stopPropagation();showHelpModal();
    }
  },true);

  // Farming Mode must never resume automatically after a full page reload or OAuth redirect.
  // The user has to explicitly enable live inventory moves again in the current tab.
  if(state().farm.enabled) {
    state().farm.enabled=false;
    LL.persist();
  }
  window.LittleLightExtension={handlesPage,renderPage,afterRender};
  updateHeader();
  LL.renderPage();
  const initialOAuthUrl=new URL(location.href);
  const hasOAuthCallback=initialOAuthUrl.searchParams.has('code')||initialOAuthUrl.searchParams.has('error');
  handleOAuthCallback().catch(err=>{
    LL.toast('Bungie sign-in failed: '+(err&&err.message||String(err)),'error');
  });
  if(!hasOAuthCallback&&tokenState()&&config.apiKey&&config.clientId&&config.membershipId) {
    setStatus('Restoring Bungie session…');
    findMemberships().catch(err=>{
      live.connected=false;live.error=err&&err.message||String(err);updateHeader();
      LL.toast('Could not restore Bungie session: '+live.error,'error');
    });
  }
})();