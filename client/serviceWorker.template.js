'use strict';

__EPGSTATION_SERVICE_WORKER_UTIL__

const OFFLINE_CACHE_NAME = 'epgstation-offline-videos';
const APP_CACHE_NAME = __EPGSTATION_APP_CACHE_NAME__;
const PRECACHE_URLS = __EPGSTATION_PRECACHE_URLS__;
const APP_CACHE_PREFIX = 'epgstation-app-';

const getOfflineOriginalBase = (requestUrl, scopeUrl) => {
    const scope = new URL(scopeUrl);
    const url = new URL(requestUrl, scope);
    const relativePath = url.pathname.slice(scope.pathname.length).replace(/^\/+|\/+$/gu, '');
    const match = /^local\/offline\/(\d+)\/([^/]+)\/original\.ts$/u.exec(relativePath);
    return match === null ? null : new URL(`local/offline/${match[1]}/${match[2]}/`, scope).toString();
};

const readOfflineOriginal = async request => {
    const baseUrl = getOfflineOriginalBase(request.url, self.registration.scope);
    if (baseUrl === null) return null;
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const manifestResponse = await cache.match(new URL('original.ts.manifest', baseUrl));
    if (manifestResponse === undefined) return Response.error();
    const manifest = await manifestResponse.json();
    const plan = createOfflineRangePlan(request.headers.get('Range'), manifest.fileSize, manifest.chunkSize);
    if (plan.status === 416) return new Response(null, { status: 416, headers: plan.headers });
    const slices = plan.slices;
    const status = plan.status;
    const headers = new Headers({
        ...plan.headers,
        'Content-Type': 'video/mp2t',
    });
    const body = new ReadableStream({
        async start(controller) {
            try {
                for (const slice of slices) {
                    const chunkResponse = await cache.match(new URL(`original.ts/chunks/${slice.chunkStart}`, baseUrl));
                    if (chunkResponse === undefined) throw new Error('offline chunk is missing');
                    const chunk = new Uint8Array(await chunkResponse.arrayBuffer());
                    controller.enqueue(chunk.subarray(slice.offset, slice.offset + slice.length));
                }
                controller.close();
            } catch (error) {
                controller.error(error);
            }
        },
    });
    return new Response(body, { status, headers });
};

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
            (getOfflineOriginalBase(request.url, self.registration.scope) === null
                ? caches.open(OFFLINE_CACHE_NAME).then(cache => cache.match(request).then(response => response ?? fetch(request)))
                : readOfflineOriginal(request)),
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
