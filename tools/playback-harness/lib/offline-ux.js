'use strict';

const {
    openPersistentPageSession,
    readVideoState,
    seekRelative,
    startPlayback,
    closePlayback,
    normalizeBaseUrl,
} = require('./browser');
const { result } = require('./output');

const waitForText = async (page, text, timeout = 30_000) => {
    await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
};

const activeOverlay = page => page.locator('.v-overlay--active').last();

const openSession = options => openPersistentPageSession({
    ...options,
    hash: options.hash,
});

/** MPEG-2 Original の保存、回線断再読込、再生、シークを測る。 */
const offlineOriginalMpeg2 = async options => {
    if (options.recordedId === undefined) throw new Error('--recorded-id が必要');
    if (options.videoFileId === undefined) throw new Error('--video-file-id が必要');
    const session = await openSession({
        ...options,
        hash: `#/recorded/detail/${encodeURIComponent(String(options.recordedId))}`,
    });
    const { page } = session;
    try {
        await page.getByRole('button', { name: 'オフライン保存' }).click();
        const dialog = activeOverlay(page);
        await dialog.getByText('オリジナル (MPEG-2・端末で変換)', { exact: false }).click();
        await dialog.getByRole('button', { name: '保存開始' }).click();
        await waitForText(page, 'オフライン保存が完了しました', options.saveTimeoutMs ?? 300_000);
        await page.waitForTimeout(500);

        await session.context.setOffline(true);
        await page.goto(`${normalizeBaseUrl(options.baseUrl)}/#/offline-videos?videoId=${encodeURIComponent(String(options.videoFileId))}`);
        await page.waitForSelector('video', { timeout: 30_000 });
        await startPlayback(page);
        await page.waitForTimeout(3_000);
        const beforeSeek = await readVideoState(page);
        await seekRelative(page, 0.8);
        await page.waitForTimeout(5_000);
        const afterSeek = await readVideoState(page);
        const passed = beforeSeek !== null && afterSeek !== null && afterSeek.currentTime > beforeSeek.currentTime + 1;
        return result('offline-original-mpeg2', passed, { beforeSeek, afterSeek }, passed ? null : 'オフライン MPEG-2 の再生またはシークが進まない');
    } finally {
        await closePlayback(session);
    }
};

/** 回線断時の保存番組情報表示を測る。 */
const offlineProgramInfo = async options => {
    const session = await openSession({ ...options, offline: true, hash: '#/offline-videos' });
    const { page } = session;
    try {
        await page.getByRole('button', { name: '再生' }).first().click();
        await page.waitForSelector('.offline-program-info', { timeout: 30_000 });
        const info = await page.locator('.offline-program-info').first().innerText();
        const video = await readVideoState(page);
        const passed = info.includes('番組情報') && info.trim().length > '番組情報'.length;
        return result('offline-program-info', passed, { info, video }, passed ? null : '保存済みスナップショットの番組情報が表示されない');
    } finally {
        await closePlayback(session);
    }
};

/** オフライン表示だけを出し、画面覆いが無いことと復帰時の消去を測る。 */
const offlineIndicator = async options => {
    const session = await openSession({ ...options, hash: options.hash ?? '#/offline-videos' });
    const { page } = session;
    try {
        await page.waitForTimeout(1_000);
        await session.context.setOffline(true);
        await page.waitForTimeout(1_000);
        const offline = await page.evaluate(() => ({
            chip: Array.from(document.querySelectorAll('*')).some(element => element.textContent?.trim() === 'オフライン' && element.getBoundingClientRect().width > 0),
            overlays: document.querySelectorAll('.v-overlay--active').length,
        }));
        await session.context.setOffline(false);
        await page.waitForTimeout(1_000);
        const online = await page.evaluate(() => ({
            chip: Array.from(document.querySelectorAll('*')).some(element => element.textContent?.trim() === 'オフライン' && element.getBoundingClientRect().width > 0),
            overlays: document.querySelectorAll('.v-overlay--active').length,
        }));
        const passed = offline.chip === true && offline.overlays === 0 && online.chip === false;
        return result('offline-indicator', passed, { offline, online }, passed ? null : 'オフライン表示または画面覆いの状態が不正');
    } finally {
        await closePlayback(session);
    }
};

/** 録画一覧から保存データを直接再生し、配信 API を呼ばないことを測る。 */
const recordedOfflinePlay = async options => {
    const session = await openSession({ ...options, hash: '#/recorded' });
    const { page } = session;
    const streamRequests = [];
    const onRequest = request => {
        const url = request.url();
        if (url.includes('/api/streams') || url.includes('/streamfiles/')) streamRequests.push(url);
    };
    page.on('request', onRequest);
    try {
        await page.getByText('保存データで再生', { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 });
        streamRequests.length = 0;
        await page.getByText('保存データで再生', { exact: false }).first().click();
        await page.waitForSelector('video', { timeout: 30_000 });
        await startPlayback(page);
        await page.waitForTimeout(3_000);
        const state = await readVideoState(page);
        const passed = streamRequests.length === 0 && state !== null && state.currentTime > 0;
        return result('recorded-offline-play', passed, { state, streamRequests }, passed ? null : '録画一覧から保存データを直接再生できない、または配信 API を呼んだ');
    } finally {
        page.off('request', onRequest);
        await closePlayback(session);
    }
};

module.exports = {
    'offline-original-mpeg2': offlineOriginalMpeg2,
    'offline-program-info': offlineProgramInfo,
    'offline-indicator': offlineIndicator,
    'recorded-offline-play': recordedOfflinePlay,
};
