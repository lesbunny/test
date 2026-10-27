/* Cache the app shell only. Bungie/API responses and OAuth sessions are never cached here. */
const CACHE='little-light-shell-v2';
const FILES=['./','./index.html','./app.js','./extension.js','./inventory-core.js','./native-core.js','./native-tools.js','./tools.js','./workspace-ui.js','./workspace-qol.js','./sample-art.js','./app.css','./extension.css','./material.css','./arsenal.css','./workspace.css','./native.css'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('little-light-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),base=new URL('./',self.location.href);
 if(event.request.method!=='GET'||url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
 const key=url.pathname.slice(base.pathname.length);if(!FILES.some(f=>f.slice(2)===key))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(new URL(key||'./',base).href,copy)));}return response;}).catch(()=>caches.match(new URL(key||'./',base).href)));
});
