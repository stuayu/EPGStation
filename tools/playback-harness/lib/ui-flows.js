'use strict';

const {
    openPageSession,
    closePlayback,
    startPlayback,
    readVideoState,
    seekRelative,
} = require('./browser');
const { result } = require('./output');

const exactText = (page, text) => page.getByText(text, { exact: true }).last();

const clickStreamingButton = async page => {
    await page.locator('button').filter({ has: page.locator('.mdi-play-circle') }).first().click();
};

// Vuetify の v-menu / v-dialog は body 直下へテレポートされるので、コンポーネントのルートからは辿れない。
// 表示中のオーバーレイ (.v-overlay--active) を起点に探す
const clickFileButton = async (page, fileLabel) => {
    const button = page.locator('.v-overlay--active button').filter({ hasText: fileLabel }).last();
    await button.waitFor({ state: 'visible' });
    await button.click();
};

const chooseSelectOption = async (page, select, label) => {
    await select.click();
    const option = page.locator('.v-overlay--active .v-list-item-title').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u') }).last();
    await option.waitFor({ state: 'visible' });
    await option.click();
};

const chooseDetailStream = async (page, options) => {
    const dialog = page.locator('.v-overlay--active .v-card').filter({ has: page.locator('button', { hasText: '画質:' }) }).last();
    await dialog.waitFor({ state: 'visible' });
    const selects = dialog.locator('.v-select');
    await selects.first().waitFor({ state: 'visible' });
    await chooseSelectOption(page, selects.first(), options.streamingTypeLabel ?? 'オリジナル');
    await page.waitForTimeout(1000);

    const qualityButton = dialog.locator('button').filter({ hasText: '画質:' }).first();
    await qualityButton.click();
    const quality = options.quality ?? (options.profile === 'original-hevc' ? 'オリジナル (HEVC・無変換)' : 'オリジナル (MPEG-2・端末で変換)');
    const qualityItem = dialog.locator('.quality-list').getByText(quality, { exact: false }).first();
    await qualityItem.waitFor({ state: 'visible' });
    await qualityItem.click();
    await page.waitForTimeout(500);
    const selectedLabel = (await qualityButton.innerText()).trim();
    // 画質一覧の要素は profile id を属性に持たないため、選択結果はボタン表示と遷移後 URL の profile で判定する
    return { label: quality, selectedLabel, profileId: selectedLabel.includes(quality) ? options.profile : null };
};

const routeQuery = page => page.evaluate(() => {
    const query = location.hash.split('?')[1] ?? '';
    return Object.fromEntries(new URLSearchParams(query).entries());
});

const sample = async (page, seconds, interval = 2) => {
    const rows = [];
    for (let elapsed = 0; elapsed <= seconds; elapsed += interval) {
        rows.push({ at: elapsed, state: await readVideoState(page) });
        if (elapsed < seconds) await page.waitForTimeout(interval * 1000);
    }
    return rows;
};

const isAdvancing = (before, after) =>
    before !== null && after !== null && after.paused === false && after.currentTime > before.currentTime + 0.05;

const uiOriginalFlow = async options => {
    const session = await openPageSession({ ...options, hash: `#/recorded/detail/${options.recordedId ?? 16526}` });
    try {
        await pageWait(session.page, '.mdi-play-circle', options);
        await clickStreamingButton(session.page);
        await clickFileButton(session.page, options.fileLabel ?? 'TS');
        const quality = await chooseDetailStream(session.page, {
            ...options,
            streamingTypeLabel: options.streamingTypeLabel ?? 'オリジナル',
            streamingType: options.streamingType ?? 'original',
            profile: options.profile ?? 'original-mpeg2',
        });
        await session.page.locator('.v-overlay--active button').filter({ hasText: /^\s*視聴\s*$/u }).last().click();
        await session.page.waitForSelector('video', { timeout: options.timeoutMs ?? 30_000 });
        await startPlayback(session.page);
        const initial = await readVideoState(session.page);
        const progress = await sample(session.page, Math.min(options.duration ?? 8, 12), options.interval ?? 2);
        const seek80Before = await readVideoState(session.page);
        await seekRelative(session.page, 0.8);
        await session.page.waitForTimeout(5000);
        const seek80After = await readVideoState(session.page);
        await seekRelative(session.page, 0.3);
        await session.page.waitForTimeout(5000);
        const seek30After = await readVideoState(session.page);
        const query = await routeQuery(session.page);
        const expectedProfile = options.profile ?? 'original-mpeg2';
        const value = {
            selectedQuality: quality.label,
            selectedProfileId: quality.profileId,
            expectedProfile,
            route: query,
            initial,
            progress,
            seeks: {
                forward80: { before: seek80Before, after: seek80After, advanced: isAdvancing(seek80Before, seek80After) },
                backward30: { after: seek30After, advanced: seek30After?.paused === false && seek30After.currentTime > 0 },
            },
            pageErrors: session.logs.filter(log => log.startsWith('[pageerror]')).length,
        };
        const progressed = progress.some((row, index) => index > 0 && isAdvancing(progress[index - 1].state, row.state));
        const passed = value.pageErrors === 0 && quality.profileId === expectedProfile && query.profile === quality.profileId && progressed && value.seeks.forward80.advanced && value.seeks.backward30.advanced;
        return result('ui-original-flow', passed, value, passed ? null : '画質 profile、再生進行、または80%/30%シーク復帰に失敗');
    } finally {
        await closePlayback(session);
    }
};

const pageWait = async (page, selector, options) => page.waitForSelector(selector, { timeout: options.timeoutMs ?? 30_000 });

const watchHistoryFlow = async options => {
    const session = await openPageSession({ ...options, hash: '#/watch-history' });
    try {
        const target = await session.page.evaluate(async videoFileId => {
            const response = await fetch('./api/watch-history?offset=0&limit=100&isHalfWidth=false');
            if (!response.ok) throw new Error(`watch-history HTTP ${response.status}`);
            const json = await response.json();
            const index = (json.records ?? []).findIndex(record => record.videoFileId === Number(videoFileId));
            return index < 0 ? null : { index, recordedId: json.records[index].recordedId, position: json.records[index].position, status: json.records[index].status };
        }, options.videoFileId ?? 31017);
        if (target === null) throw new Error(`videoFileId=${options.videoFileId ?? 31017} の視聴履歴がない`);
        if (options.recordedId !== undefined && target.recordedId !== Number(options.recordedId)) {
            throw new Error(`履歴の recordedId=${target.recordedId} が指定値 ${options.recordedId} と違う`);
        }
        await pageWait(session.page, '.history-item', options);
        await session.page.locator('.history-item').nth(target.index).click();
        const dialog = session.page.locator('.v-overlay--active .v-card').last();
        await dialog.waitFor({ state: 'visible' });
        const selects = dialog.locator('.v-select');
        await selects.first().waitFor({ state: 'visible' });
        await chooseSelectOption(session.page, selects.first(), options.streamingTypeLabel ?? 'オリジナル');
        await selects.nth(1).waitFor({ state: 'visible' });
        const quality = options.quality ?? (options.profile === 'original-hevc' ? 'オリジナル (HEVC・無変換)' : 'オリジナル (MPEG-2・端末で変換)');
        await chooseSelectOption(session.page, selects.nth(1), quality);
        await dialog.getByRole('button', { name: 'ストリーミング', exact: true }).click();
        await session.page.waitForSelector('video', { timeout: options.timeoutMs ?? 30_000 });
        await session.page.waitForTimeout(2500);
        const resume = await readVideoState(session.page);
        await startPlayback(session.page);
        const progress = await sample(session.page, Math.min(options.duration ?? 8, 12), options.interval ?? 2);
        const query = await routeQuery(session.page);
        const expectedProfile = options.profile ?? 'original-mpeg2';
        const progressed = progress.some((row, index) => index > 0 && isAdvancing(progress[index - 1].state, row.state));
        const value = { history: target, selectedQuality: quality, expectedProfile, route: query, resume, progress, pageErrors: session.logs.filter(log => log.startsWith('[pageerror]')).length };
        const passed = value.pageErrors === 0 && query.profile === expectedProfile && resume !== null && resume.currentTime >= Math.max(0, target.position - 10) && progressed;
        return result('watch-history-flow', passed, value, passed ? null : '履歴位置からの再開、profile、または再生進行に失敗');
    } finally {
        await closePlayback(session);
    }
};

const clickDplayerQuality = async (page, label) => {
    // DPlayer のコントロールはマウスが乗るまで隠れているので、先に映像へホバーしてから設定アイコンを押す
    await page.locator('.dplayer-video-wrap').first().hover();
    await page.locator('.dplayer-setting-icon').first().click({ force: true });
    await page.waitForTimeout(500);
    return page.evaluate(targetLabel => {
        const items = Array.from(document.querySelectorAll('.dplayer-setting-quality-item, .dplayer-quality-item'));
        const visible = item => {
            const style = getComputedStyle(item);
            const rect = item.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const item = items.find(candidate => visible(candidate) && (candidate.textContent ?? '').includes(targetLabel));
        if (item === undefined) return false;
        item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
    }, label);
};

const containerSwitch = async options => {
    const session = await openPageSession({
        ...options,
        videoFileId: options.videoFileId ?? 31017,
        recordedId: options.recordedId ?? 16526,
        streamingType: 'm2tsll',
        mode: options.mode ?? 0,
        profile: undefined,
    });
    try {
        await session.page.waitForSelector('video', { timeout: options.timeoutMs ?? 30_000 });
        await startPlayback(session.page);
        await session.page.waitForTimeout(5000);
        const before = await readVideoState(session.page);
        const toOriginal = await clickDplayerQuality(session.page, 'オリジナル (MPEG-2');
        await session.page.waitForTimeout(7000);
        const original = await readVideoState(session.page);
        const toM2ts = await clickDplayerQuality(session.page, '低遅延 (M2TS-LL)');
        await session.page.waitForTimeout(7000);
        const after = await readVideoState(session.page);
        const value = {
            toOriginal,
            toM2ts,
            before,
            original,
            after,
            pageErrors: session.logs.filter(log => log.startsWith('[pageerror]')).length,
        };
        const inherited = toOriginal && toM2ts && original !== null && after !== null && original.currentTime >= before.currentTime - 12 && after.currentTime >= original.currentTime - 12;
        const advanced = isAdvancing(before, original) || isAdvancing(original, after);
        const passed = value.pageErrors === 0 && inherited && advanced;
        return result('container-switch', passed, value, passed ? null : 'M2TS-LL と Original の切替後に位置継承または再生進行なし');
    } finally {
        await closePlayback(session);
    }
};

const liveOriginal = async options => {
    const channel = options.channelId ?? 3241621504;
    const duration = options.duration ?? 60;
    const interval = options.interval ?? 4;
    const session = await openPageSession({ ...options, hash: `#/onair/watch?type=original&channel=${channel}&mode=${options.mode ?? 0}` });
    try {
        await session.page.waitForSelector('video', { timeout: options.timeoutMs ?? 30_000 });
        await startPlayback(session.page);
        const samples = await sample(session.page, duration, interval);
        const increments = samples.slice(1).map((row, index) => Number(((row.state?.currentTime ?? 0) - (samples[index].state?.currentTime ?? 0)).toFixed(2)));
        const zeroRuns = increments.reduce((maximum, increment, index) => {
            let run = 0;
            for (let cursor = index; cursor < increments.length && increments[cursor] <= 0.1; cursor += 1) run += 1;
            return Math.max(maximum, run);
        }, 0);
        const value = { channel, duration, interval, samples, increments, zeroRunSamples: zeroRuns, pageErrors: session.logs.filter(log => log.startsWith('[pageerror]')).length };
        const passed = value.pageErrors === 0 && increments.length >= 10 && increments.filter(increment => increment > 0.1).length >= Math.floor(increments.length * 0.8) && zeroRuns < 4;
        return result('live-original', passed, value, passed ? null : 'ライブ Original の currentTime が15秒以内に継続進行しない');
    } finally {
        await closePlayback(session);
    }
};

const offlineHevc = async options => {
    if ((options.browser ?? 'webkit') !== 'webkit') throw new Error('offline-hevc は WebKit 前提');
    const session = await openPageSession({ ...options, hash: `#/recorded/detail/${options.recordedId ?? 16525}` });
    try {
        await pageWait(session.page, 'button', options);
        const recordedId = options.recordedId ?? 16525;
        const videoFileId = options.videoFileId ?? 31019;
        const targetFile = await session.page.evaluate(async ({ id, fileId }) => {
            const response = await fetch(`./api/recorded/${id}?isHalfWidth=false`);
            if (!response.ok) throw new Error(`recorded HTTP ${response.status}`);
            const recorded = await response.json();
            const file = (recorded.videoFiles ?? []).find(item => item.id === Number(fileId));
            return file === undefined ? null : { id: file.id, name: file.name };
        }, { id: recordedId, fileId: videoFileId });
        if (targetFile === null) throw new Error(`recordedId=${recordedId} に videoFileId=${videoFileId} がない`);
        await session.page.getByRole('button', { name: 'オフライン保存', exact: true }).click();
        const dialog = session.page.locator('.v-overlay--active .v-card').last();
        await dialog.waitFor({ state: 'visible' });
        const selects = dialog.locator('.v-select');
        await selects.first().click();
        await exactText(session.page, options.fileLabel ?? targetFile.name).click();
        const quality = options.quality ?? 'オリジナル (HEVC・無変換)';
        // ファイルを選ぶと playback-options を取り直してから画質のラジオが並ぶ
        const radio = dialog.locator('.v-radio').filter({ hasText: quality }).first();
        await radio.waitFor({ state: 'visible', timeout: options.timeoutMs ?? 30_000 });
        await radio.locator('input').check();
        await dialog.getByRole('button', { name: '保存開始', exact: true }).click();
        await session.page.getByText('オフライン保存が完了しました', { exact: true }).waitFor({ state: 'visible', timeout: options.saveTimeoutMs ?? 900_000 });
        const saved = true;
        await session.context.setOffline(true);
        let reloadError = null;
        try {
            await session.page.goto(`${options.baseUrl.replace(/\/$/u, '')}/#/offline-videos`, { timeout: 30_000, waitUntil: 'domcontentloaded' });
        } catch (error) {
            reloadError = String(error.message).split('\n')[0];
        }
        await session.page.waitForTimeout(2000);
        const playButton = session.page.getByRole('button', { name: '再生', exact: true }).first();
        const available = await playButton.count();
        if (available > 0) {
            await playButton.click();
            await session.page.waitForSelector('video', { timeout: options.timeoutMs ?? 30_000 });
            await startPlayback(session.page);
        }
        const offlineSamples = available > 0 ? await sample(session.page, Math.min(options.duration ?? 12, 20), options.interval ?? 2) : [];
        const value = { saved, reloadError, available, offlineSamples, pageErrors: session.logs.filter(log => log.startsWith('[pageerror]')).length };
        const progressed = offlineSamples.some((row, index) => index > 0 && isAdvancing(offlineSamples[index - 1].state, row.state));
        const passed = saved && reloadError === null && available > 0 && progressed && value.pageErrors === 0;
        return result('offline-hevc', passed, value, passed ? null : 'HEVC オフライン保存後の再読み込みまたは再生に失敗');
    } finally {
        await closePlayback(session);
    }
};

module.exports = { uiOriginalFlow, watchHistoryFlow, containerSwitch, liveOriginal, offlineHevc };
