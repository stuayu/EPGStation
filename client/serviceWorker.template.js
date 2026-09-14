'use strict';

__EPGSTATION_SERVICE_WORKER_UTIL__

const OFFLINE_CACHE_NAME = 'epgstation-offline-videos';
const APP_CACHE_NAME = __EPGSTATION_APP_CACHE_NAME__;
const PRECACHE_URLS = __EPGSTATION_PRECACHE_URLS__;
const APP_CACHE_PREFIX = 'epgstation-app-';

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(APP_CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS.map(path => new URL(path, self.registration.scope).toString()))),
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys => Promise.all(keys.filter(key => key.startsWith(APP_CACHE_PREFIX) && key !== APP_CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const kind = classifyServiceWorkerRequest(request, self.registration.scope);
    if (kind === 'passthrough') return;

    if (kind === 'offline') {
        event.respondWith(
            caches.open(OFFLINE_CACHE_NAME).then(cache => cache.match(request).then(response => response ?? fetch(request))),
        );
        return;
    }

    const appResponse = caches.open(APP_CACHE_NAME).then(cache => {
        if (kind === 'navigation') {
            return fetch(request)
                .then(response => response)
                .catch(() => cache.match(new URL('index.html', self.registration.scope)).then(response => response ?? Response.error()));
        }

        return cache.match(request).then(response => response ?? fetch(request));
    });
    event.respondWith(appResponse);
});
