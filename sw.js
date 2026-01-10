const CACHE_NAME = 'protohelp-v1.3.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/js/app.js',
  '/js/ui.js',
  '/js/data-loader.js',
  '/js/search-engine.js',
  '/js/radlite-api.js',
  '/data/protocols/mri-protocols.json',
  '/data/regions/neuro.json',
  '/data/regions/spine.json',
  '/data/regions/chest.json',
  '/data/regions/abdomen.json',
  '/data/regions/msk.json',
  '/data/regions/vascular.json',
  '/data/regions/breast.json',
  '/data/regions/peds.json',
  '/manifest.json'
];

// External dependencies that should be cached
const EXTERNAL_ASSETS = [
  'https://unpkg.com/lunr@2.3.9/lunr.min.js'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Caching static assets
        // Cache static assets first
        return cache.addAll(STATIC_ASSETS)
          .then(() => {
            // Then cache external dependencies with error handling
            const externalPromises = EXTERNAL_ASSETS.map(url => 
              cache.add(url).catch(error => {
                console.warn('Failed to cache external asset:', url, error);
                return Promise.resolve(); // Don't fail installation if external assets fail
              })
            );
            return Promise.all(externalPromises);
          });
      })
      .then(() => self.skipWaiting())
  );
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

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  const url = event.request.url;
  const isExternal = !url.startsWith(self.location.origin);
  
  // Handle both internal and external requests (like CDN dependencies)
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(event.request)
          .then(response => {
            // Check if response is valid
            if (!response || response.status !== 200) {
              return response;
            }
            
            // For external resources, only cache if it's a known dependency
            if (isExternal && !EXTERNAL_ASSETS.includes(url)) {
              return response;
            }
            
            // For internal resources, cache if response type is basic or cors
            if (!isExternal && response.type !== 'basic') {
              return response;
            }
            
            // Clone the response for caching
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
            // For critical dependencies, you might want to return a fallback
            throw error;
          });
      })
  );
});
