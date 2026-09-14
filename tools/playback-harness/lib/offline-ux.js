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

const samplePlayback = async (page, seconds, interval = 2) => {
    const samples = [];
    for (let elapsed = 0; elapsed <= seconds; elapsed += interval) {
        const state = await readVideoState(page);
        samples.push({ at: elapsed, currentTime: state?.currentTime ?? 0, paused: state?.paused ?? true, state });
        if (elapsed < seconds) await page.waitForTimeout(interval * 1000);
    }
    return samples;
};

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
        await page.goto(`${normalizeBaseUrl(options.baseUrl)}/#/offline-videos`);
        await page.locator('.offline-item').first().getByRole('button', { name: '再生', exact: true }).click();
        await page.waitForFunction(() => location.hash.includes('/watch'), null, { timeout: 30_000 });
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
        await page.locator('.offline-item').first().click();
        await page.waitForFunction(() => location.hash.includes('#/offline-videos/'), null, { timeout: 30_000 });
        const detail = page.locator('.offline-detail');
        await detail.waitFor({ state: 'visible', timeout: 30_000 });
        const info = await detail.innerText();
        const video = null;
        const passed = info.includes('番組情報') || info.includes('保存画質');
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
        await choosePlayOffline(page);
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

const waitForHash = async (page, fragment) => page.waitForFunction(target => location.hash.includes(target), fragment, { timeout: 30_000 });

/** オフライン一覧から別々の2件を視聴画面へ遷移できることを測る。 */
const offlineNavigation = async options => {
    const session = await openSession({ ...options, hash: '#/offline-videos' });
    const { page } = session;
    try {
        const items = page.locator('.offline-item');
        await items.nth(0).waitFor({ state: 'visible', timeout: 30_000 });
        if (await items.count() < 2) throw new Error('保存済み録画が2件以上ない');
        const play = index => items.nth(index).getByRole('button', { name: '再生', exact: true });
        await play(0).click();
        await waitForHash(page, '/watch');
        await page.waitForSelector('video', { timeout: 30_000 });
        await startPlayback(page);
        const first = await samplePlayback(page, 6, 2);
        await page.goBack();
        await waitForHash(page, '#/offline-videos');
        await play(1).click();
        await waitForHash(page, '/watch');
        await page.waitForSelector('video', { timeout: 30_000 });
        await startPlayback(page);
        const second = await samplePlayback(page, 6, 2);
        const progressed = samples => samples.some((row, index) => index > 0 && row.currentTime > samples[index - 1].currentTime + 0.05);
        const value = { itemCount: await items.count(), first, second, pageErrors: session.logs.filter(log => log.startsWith('[pageerror]')).length };
        const passed = progressed(first) && progressed(second) && value.pageErrors === 0;
        return result('offline-navigation', passed, value, passed ? null : 'オフライン一覧から1件目・2件目の視聴画面遷移または再生進行に失敗');
    } finally {
        await closePlayback(session);
    }
};

/** オフライン一覧 → 番組情報 → 視聴画面を回線断後も測る。 */
const offlineDetail = async options => {
    const session = await openSession({ ...options, hash: '#/offline-videos' });
    const { page } = session;
    try {
        const item = page.locator('.offline-item').first();
        await item.waitFor({ state: 'visible', timeout: 30_000 });
        const name = (await item.locator('.offline-title').innerText()).trim();
        await item.click();
        await waitForHash(page, '#/offline-videos/');
        const detail = page.locator('.offline-detail');
        await detail.waitFor({ state: 'visible', timeout: 30_000 });
        const detailText = await detail.innerText();
        await session.context.setOffline(true);
        await page.reload({ timeout: 30_000, waitUntil: 'domcontentloaded' }).catch(() => undefined);
        await detail.waitFor({ state: 'visible', timeout: 30_000 });
        const offlineDetailText = await detail.innerText();
        await page.getByRole('button', { name: '再生', exact: true }).click();
        await waitForHash(page, '/watch');
        await page.waitForSelector('video', { timeout: 30_000 });
        await startPlayback(page);
        const samples = await samplePlayback(page, 6, 2);
        const value = { name, detailText, offlineDetailText, samples, pageErrors: session.logs.filter(log => log.startsWith('[pageerror]')).length };
        const progressed = samples.some((row, index) => index > 0 && row.currentTime > samples[index - 1].currentTime + 0.05);
        const passed = detailText.includes(name) && offlineDetailText.includes(name) && progressed && value.pageErrors === 0;
        return result('offline-detail', passed, value, passed ? null : '保存スナップショットの番組情報または回線断後の再生に失敗');
    } finally {
        await closePlayback(session);
    }
};

/** 録画詳細から保存データ視聴画面へ遷移し、サーバー配信 API を呼ばないことを測る。 */
// 同じ録画を複数の画質で保存していると「保存データで再生」は選択メニューになる。メニューが出たら先頭を選ぶ
const choosePlayOffline = async page => {
    const item = page.locator('.v-overlay--active .offline-select-item').first();
    try {
        await item.waitFor({ state: 'visible', timeout: 1500 });
        await item.click();
    } catch {
        // 保存が 1 件なら直接視聴画面へ遷移しているのでメニューは出ない
    }
};

const recordedDetailOfflinePlay = async options => {
    const session = await openSession({ ...options, hash: `#/recorded/detail/${encodeURIComponent(String(options.recordedId ?? 16526))}` });
    const { page } = session;
    const streamRequests = [];
    const onRequest = request => {
        const url = request.url();
        if (url.includes('/api/streams') || url.includes('/streamfiles/')) streamRequests.push(url);
    };
    page.on('request', onRequest);
    try {
        const button = page.getByText('保存データで再生', { exact: false }).first();
        await button.waitFor({ state: 'visible', timeout: 30_000 });
        streamRequests.length = 0;
        await button.click();
        await choosePlayOffline(page);
        const overlay = activeOverlay(page);
        const choices = overlay.getByRole('button').filter({ hasText: /保存データで再生/u });
        if (await choices.count() > 0) await choices.first().click();
        await waitForHash(page, '/offline-videos/');
        await page.waitForSelector('video', { timeout: 30_000 });
        await startPlayback(page);
        const samples = await samplePlayback(page, 6, 2);
        const value = { samples, streamRequests, pageErrors: session.logs.filter(log => log.startsWith('[pageerror]')).length };
        const progressed = samples.some((row, index) => index > 0 && row.currentTime > samples[index - 1].currentTime + 0.05);
        const passed = streamRequests.length === 0 && progressed && value.pageErrors === 0;
        return result('recorded-detail-offline-play', passed, value, passed ? null : '録画詳細から保存データを再生できない、または配信 API を呼んだ');
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
    'offline-navigation': offlineNavigation,
    'offline-detail': offlineDetail,
    'recorded-detail-offline-play': recordedDetailOfflinePlay,
};
