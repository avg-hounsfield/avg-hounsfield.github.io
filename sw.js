const CACHE_NAME = 'radex-v2.19.1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/js/app.js',
  '/js/ui.js',
  '/js/data-loader.js',
  '/js/search-engine.js',
  '/js/intent-classifier.js',
  '/js/radlite-api.js',
  '/js/protocol-builder.js',
  '/js/summary-cards.js',
  '/manifest.json'
];

// Data files cached on install - includes full scenario search indexes for offline search
const DATA_ASSETS = [
  '/data/protocols.json',
  '/data/regions/neuro.json',
  '/data/regions/spine.json',
  '/data/regions/chest.json',
  '/data/regions/abdomen.json',
  '/data/regions/msk.json',
  '/data/regions/vascular.json',
  '/data/regions/breast.json',
  '/data/regions/peds.json',
  '/data/search/medical-synonyms.json',
  '/data/search/concept_index.json',
  '/data/search/summary_cards.json',
  '/data/search/lunr-scenarios.json',
  '/data/search/tfidf-index.json',
  '/data/search/scenario_metadata.json',
  '/data/sequence-library.json'
];

// External dependencies that should be cached
const EXTERNAL_ASSETS = [
  'https://unpkg.com/lunr@2.3.9/lunr.min.js'
];

// Send progress message to all window clients (including uncontrolled during install)
async function notifyProgress(loaded, total) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'SW_INSTALL_PROGRESS', loaded, total });
  }
}

// Install event - cache all assets sequentially with progress reporting
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const allAssets = [...STATIC_ASSETS, ...DATA_ASSETS, ...EXTERNAL_ASSETS];
    const total = allAssets.length;
    let loaded = 0;

    for (const url of allAssets) {
      try {
        await cache.add(url);
      } catch (e) {
        console.warn('Failed to cache:', url, e);
      }
      loaded++;
      await notifyProgress(loaded, total);
    }

    await self.skipWaiting();
  })());
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              // Deleting old cache
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - network-first for app files, cache-first for data
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const pathname = url.pathname;
  const isExternal = url.origin !== self.location.origin;

  // Determine if this is a data file (cache-first) or app file (network-first)
  const isDataFile = pathname.startsWith('/data/');
  const isAppFile = pathname.endsWith('.html') ||
                    pathname.endsWith('.js') ||
                    pathname.endsWith('.css') ||
                    pathname === '/';

  if (isAppFile && !isExternal) {
    // Network-first for app files - ensures updates are picked up
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(event.request);
        })
    );
    return;
  }

  // Cache-first for data files and external assets
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200) {
              return response;
            }

            // For external resources, only cache if it's a known dependency
            if (isExternal && !EXTERNAL_ASSETS.includes(event.request.url)) {
              return response;
            }

            // Cache the response
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              })
              .catch(error => {
                console.warn('Failed to cache response:', error);
              });

            return response;
          })
          .catch(error => {
            console.warn('Fetch failed:', error);
            throw error;
          });
      })
  );
});
