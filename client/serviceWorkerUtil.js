'use strict';

/**
 * Service Worker が扱う要求の分類。
 * 純粋関数にして、API や WebSocket をキャッシュ経路へ入れない契約を固定する。
 */
const classifyServiceWorkerRequest = (request, scopeUrl) => {
    if (request.method !== 'GET') return 'passthrough';

    const scope = new URL(scopeUrl);
    const url = new URL(request.url, scope);
    if (url.origin !== scope.origin || url.pathname.startsWith(scope.pathname) === false) return 'passthrough';

    const relativePath = url.pathname.slice(scope.pathname.length).replace(/^\/+|\/+$/gu, '');
    if (relativePath === 'local/offline' || relativePath.startsWith('local/offline/')) return 'offline';

    // API、配信、socket.io、データ放送/SNS WebSocket は常にネットワークへ渡す。
    if (
        relativePath === 'api' ||
        relativePath.startsWith('api/') ||
        relativePath === 'streamfiles' ||
        relativePath.startsWith('streamfiles/') ||
        relativePath === 'socket.io' ||
        relativePath.startsWith('socket.io/')
    ) {
        return 'passthrough';
    }

    if (request.mode === 'navigate') return 'navigation';

    // Vite のハッシュ付き assets と、index.html から参照する静的ファイルだけを対象にする。
    if (
        relativePath.startsWith('assets/') ||
        request.destination === 'script' ||
        request.destination === 'style' ||
        request.destination === 'font' ||
        request.destination === 'image' ||
        request.destination === 'manifest'
    ) {
        return 'asset';
    }

    return 'passthrough';
};

if (typeof module !== 'undefined' && module.exports !== undefined) {
    module.exports = { classifyServiceWorkerRequest };
}

