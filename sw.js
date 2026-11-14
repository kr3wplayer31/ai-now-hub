/* A.I. NOW — service worker (cache: ainow-v1)
 *
 * Job: make the hub installable (Chrome/Android require a registered SW
 * with a fetch handler before they fire beforeinstallprompt) and give the
 * app shell an offline fallback — WITHOUT ever serving stale news.
 *
 * Rules baked in:
 *  - Pages: network-first. Fresh wins whenever we're online; the cache is
 *    only an offline fallback for pages already visited.
 *  - Icons + manifest: cache-first (they basically never change).
 *  - Cross-origin traffic (news/RSS APIs, CoinGecko, USGS/NWS feeds,
 *    YouTube embeds): passed through completely untouched. Live data
 *    must stay live — it is never cached.
 *  - All shell paths are resolved from this worker's registration scope,
 *    so the identical file works at the apex root
 *    (https://artificial-intelligencenow.com/) and under the GitHub Pages
 *    project path (…/ai-now-hub/) during the transition.
 */

var CACHE = 'ainow-v1';
var SCOPE = self.registration.scope;

/* App shell basics, absolute-ized against the scope. */
var SHELL = [
  SCOPE,
  SCOPE + 'index.html',
  SCOPE + 'manifest.json',
  SCOPE + 'icon-192.png',
  SCOPE + 'icon-512.png'
];

/* Install: precache the shell. Each file is added on its own so one
   missing file can never fail the whole install. */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { /* keep going */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

/* Activate: delete every older cache version, then take control. */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        return name === CACHE ? null : caches.delete(name);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return; // never intercept writes

  var url = new URL(request.url);

  /* Cross-origin = live data (APIs, feeds, video). Hands off. */
  if (url.origin !== self.location.origin) return;

  /* Static shell assets: cache-first, network fills the cache. */
  if (/\/(icon-[^/]*\.png|manifest\.json)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(function (hit) {
        if (hit) return hit;
        return fetch(request).then(function (response) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
          return response;
        });
      })
    );
    return;
  }

  /* Everything else same-origin (pages above all): network-first.
     A successful navigation is copied into the cache so that page
     still opens offline later; if the network fails, serve the
     cached page, and for a never-visited page fall back to the
     cached front door rather than a dead screen. */
  event.respondWith(
    fetch(request).then(function (response) {
      if (request.mode === 'navigate' && response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (request.mode === 'navigate') return caches.match(SCOPE + 'index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
