const CACHE_NAME = 'mon-app-cache-v1';

self.addEventListener('install', (event) => {
    console.log('Service Worker installé');
});

self.addEventListener('fetch', (event) => {
    // Laisse passer toutes les requêtes normalement
    event.respondWith(fetch(event.request));
});