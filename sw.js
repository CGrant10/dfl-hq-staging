// DFL HQ service worker
const CACHE_NAME = "dfl-hq-staging-motion-3-v5";
const CDN_HOSTS = new Set(["cdn.jsdelivr.net","fonts.googleapis.com","fonts.gstatic.com","a.espncdn.com"]);
const APP_SHELL = [
  "./","./index.html","./manifest.json","./css/motion-3-v5.css",
  "./css/tokens.css","./css/style.css","./css/ui.css","./css/screens.css","./css/sportsbook.css","./js/sportsbook-slip.js","./css/golf.css","./css/home.css","./css/nav-neutral.css","./css/update-gate.css",
  "./js/config.js","./js/app.js","./js/motion-3-v5.js","./js/season-nav.js","./js/router.js","./js/ui.js","./js/store.js","./js/supabase.js","./js/members.js","./js/member-preview.js","./js/member-lock.js",
  "./js/notifications.js","./js/notification-core.js","./js/notify-nudge.js","./js/profile-notifications.js","./js/weekly-outlook.js","./js/trade-desk.js","./js/pages/trade.js","./js/player-history.js","./js/season-outlook.js","./js/trend-panel.js","./js/weekly-outlook-panel.js","./css/weekly-outlook.css","./js/pages/notifications.js","./js/pages/admin_notifications.js","./css/notifications.css","./icons/badge-96.png",
  "./js/pages/home.js","./js/pages/golf.js","./js/golf-theme.js","./js/golf-event-modes.js","./js/golf-gps-course-map.js","./js/golf-gps-distance.js","./js/golf-gps-beta.js","./js/golf-gps-red-trail-beta.js","./js/golf-gps-rolla-beta.js","./js/golf-gps-imported.js","./js/nav-neutral.js",
  "./js/golf-tournament-beta.js","./js/golf-tournament-beta-format.js","./js/golf-tournament-beta-rules.js","./js/golf-score-result.js","./js/golf-club-recommendation.js","./js/golf-offline.js","./js/golf-battle.js","./js/golf-board.js",
  /* The rendering marks, not the launcher icons. app-512.png was 232KB of
     precache for an image the page never draws - only the OS reads it, at
     install time, when there is by definition a network. The splash mark and
     brand mark ARE drawn on first paint and were not cached at all. */
  "./icons/dfl-seal-heritage-512.webp","./icons/dfl-seal-heritage-64.webp","./assets/dfl-update-stadium.png",
  "./icons/app-192.png","./icons/app-update-512.png","./icons/apple-touch-icon.png"
];
const SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE_NAME).then(async c=>{
  const missing=[];
  await Promise.all(APP_SHELL.map(url=>c.add(url).catch(()=>missing.push(url))));
  if(missing.length)console.warn("[sw] not precached:",missing);
}).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
function revalidating(request){try{return new Request(request,{cache:"no-cache"});}catch{return request;}}
async function refreshCached(request){
  try{
    const response=await fetch(revalidating(request));
    if(response.ok){const copy=response.clone();await caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));}
    return response;
  }catch{return null;}
}
function usableCached(response,request){
  if(!response)return false;
  const type=response.headers.get("content-type")||"";
  if(request.destination==="style")return type.includes("text/css");
  if(request.destination==="script")return /javascript|ecmascript/.test(type);
  if(request.mode==="navigate")return type.includes("text/html");
  return true;
}
self.addEventListener("fetch",event=>{
  const{request}=event;if(request.method!=="GET")return;const url=new URL(request.url);
  if(url.hostname.endsWith("supabase.co")||url.hostname.endsWith("sleeper.app")||url.pathname.endsWith("/version.txt"))return;
  const shellRequest=url.origin===location.origin&&(request.mode==="navigate"||SHELL_URLS.has(url.href.split("?")[0]));
  if(shellRequest){
    const refreshRequest=request.mode==="navigate"?new Request(new URL("./index.html",self.registration.scope),{credentials:"same-origin"}):request;
    const refresh=refreshCached(refreshRequest);
    event.waitUntil(refresh.then(()=>{}));
    /* The update button deliberately adds ?u=. That navigation must wait for
       the network response instead of immediately handing the old shell back
       from cache, otherwise the same update banner can loop forever. */
    if(request.mode==="navigate"&&url.searchParams.has("u")){
      event.respondWith((async()=>{
        const fresh=await refresh;
        if(usableCached(fresh,request))return fresh;
        return await caches.match("./index.html")||Response.error();
      })());
      return;
    }
    event.respondWith((async()=>{
      const candidate=await caches.match(request,{ignoreSearch:true})||request.mode==="navigate"&&await caches.match("./index.html");
      const cached=usableCached(candidate,request)?candidate:null;
      if(cached)return cached;
      return await refresh||Response.error();
    })());
    return;
  }
  event.respondWith(fetch(revalidating(request)).then(response=>{
    if(response.ok&&(url.origin===location.origin||CDN_HOSTS.has(url.hostname))){const copy=response.clone();caches.open(CACHE_NAME).then(c=>c.put(request,copy));}
    return response;
  }).catch(async()=>await caches.match(request)||Response.error()));
});

/* Web Push arrives here even while the installed app is closed. Payloads are
   deliberately small and every destination is an internal hash route. */
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || "" }; }
  const url = /^#\/[a-z0-9-]+(?:\?[^\s]*)?$/i.test(data.url || "") ? data.url : "#/notifications";
  /*
    THE BADGE IS NOT THE APP ICON, AND USING THE APP ICON FOR IT IS WHY THE
    STATUS BAR SHOWED A WHITE BOX.

    Android throws away the badge's colour and keeps ONLY its alpha channel, so
    every opaque pixel becomes solid white. app-192.png is a full-bleed seal
    with no transparency, which is a perfect white square by the time Android
    is done with it. badge-96.png is the shape drawn in transparency instead.

    Fixed here rather than taken from the payload, so a sender cannot put a
    colour icon back in this slot - and so the fix lands with the service
    worker, without waiting on an Edge Function deploy.

    renotify needs a tag, which is always set below. Without it a second
    notification silently replaces the first: no sound, no buzz, no banner.
  */
  event.waitUntil(self.registration.showNotification(data.title || "DFL HQ", {
    body: data.body || "You have a new league update.",
    icon: data.icon || "icons/app-192.png",
    badge: "icons/badge-96.png",
    tag: data.messageId ? `dfl-notification-${data.messageId}` : "dfl-notification",
    renotify: true,
    vibrate: [90, 60, 90],
    data: { url, messageId: data.messageId || null },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "#/notifications", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => new URL(client.url).origin === new URL(target).origin);
    if (existing) { await existing.focus(); existing.navigate(target); return; }
    return self.clients.openWindow(target);
  }));
});
