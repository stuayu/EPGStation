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

/** Range ヘッダーをファイル長に対して解決する。 */
const resolveOfflineByteRange = (header, fileSize) => {
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return { kind: 'unsatisfiable' };
    if (header === undefined || header === null || (typeof header === 'string' && header.trim() === '')) {
        return { kind: 'full', start: 0, end: fileSize - 1 };
    }
    const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
    if (match === null || (match[1] === '' && match[2] === '')) return { kind: 'unsatisfiable' };
    if (match[1] === '') {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: 'unsatisfiable' };
        return { kind: 'partial', start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
    }
    const start = Number(match[1]);
    const requestedEnd = match[2] === '' ? fileSize - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= fileSize || start > requestedEnd || requestedEnd >= fileSize) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start, end: requestedEnd };
};

/** 指定 Range と交差する保存チャンクの読み出し範囲を求める。 */
const getOfflineChunkSlices = (range, chunkSize, fileSize) => {
    if (range === undefined || !Number.isSafeInteger(chunkSize) || chunkSize <= 0 || !Number.isSafeInteger(fileSize) || fileSize <= 0) return [];
    const slices = [];
    const firstChunk = Math.floor(range.start / chunkSize);
    const lastChunk = Math.floor(range.end / chunkSize);
    for (let chunk = firstChunk; chunk <= lastChunk; chunk += 1) {
        const chunkStart = chunk * chunkSize;
        const chunkEnd = Math.min(fileSize - 1, chunkStart + chunkSize - 1);
        slices.push({ chunkStart, offset: Math.max(range.start, chunkStart) - chunkStart, length: Math.min(range.end, chunkEnd) - Math.max(range.start, chunkStart) + 1 });
    }
    return slices;
};

/** SW が返すオフライン MPEG-TS 応答の status / headers / チャンク範囲を組み立てる。 */
const createOfflineRangePlan = (header, fileSize, chunkSize) => {
    const range = resolveOfflineByteRange(header, fileSize);
    if (range.kind === 'unsatisfiable') {
        return { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${fileSize}` }, slices: [] };
    }
    const slices = getOfflineChunkSlices(range, chunkSize, fileSize);
    return {
        status: range.kind === 'full' ? 200 : 206,
        headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(range.end - range.start + 1),
            // Content-Range は部分応答 (206) のときだけ付ける (RFC 9110)。200 に付けると実装によっては部分応答と誤認する
            ...(range.kind === 'full' ? {} : { 'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}` }),
        },
        slices,
        start: range.start,
        end: range.end,
    };
};

if (typeof module !== 'undefined' && module.exports !== undefined) {
    module.exports = { classifyServiceWorkerRequest, resolveOfflineByteRange, getOfflineChunkSlices, createOfflineRangePlan };
}
