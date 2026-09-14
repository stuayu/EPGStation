'use strict';

const { openPageSession, openPersistentPageSession, startPlayback, closePlayback, normalizeBaseUrl } = require('./browser');
const { result } = require('./output');

const activeOverlay = page => page.locator('.v-overlay--active').last();

/** 設定画面に表示したブラウザー能力を JSON として採取する。 */
const capabilityReport = async options => {
    const session = await openPageSession({ ...options, hash: '#/settings' });
    try {
        const report = await session.page.locator('[data-testid="client-capability-report"]').getAttribute('data-capabilities', { timeout: 30_000 });
        let capabilities = null;
        try { capabilities = report === null ? null : JSON.parse(report); } catch (_error) { capabilities = null; }
        const passed = capabilities !== null && typeof capabilities.hevcMain10 === 'boolean' && typeof capabilities.hdr === 'boolean';
        return result('capability-report', passed, { capabilities }, passed ? null : '設定画面の能力 JSON が取得できない');
    } finally {
        await closePlayback(session);
    }
};

/** HEVC Original を保存し、オフライン視聴の音声メニューから副音声へ切り替える。 */
const offlineAudioSwitch = async options => {
    if (options.recordedId === undefined || options.videoFileId === undefined) throw new Error('--recorded-id と --video-file-id が必要');
    if (typeof options.profileDir !== 'string' || options.profileDir.length === 0) throw new Error('--profile-dir が必要');
    const session = await openPersistentPageSession({
        ...options,
        hash: `#/recorded/detail/${encodeURIComponent(String(options.recordedId))}`,
    });
    const { page } = session;
    try {
        await page.getByRole('button', { name: 'オフライン保存' }).click();
        const dialog = activeOverlay(page);
        const original = dialog.getByText('オリジナル (HEVC・無変換)', { exact: false });
        await original.waitFor({ state: 'visible', timeout: 30_000 });
        await original.click();
        await dialog.getByRole('button', { name: '保存開始' }).click();
        await page.getByText('オフライン保存が完了しました', { exact: false }).waitFor({ state: 'visible', timeout: options.saveTimeoutMs ?? 600_000 });

        await session.context.setOffline(true);
        await page.goto(`${normalizeBaseUrl(options.baseUrl)}/#/offline-videos`);
        await page.locator('.offline-item').first().getByRole('button', { name: '再生', exact: true }).click();
        await page.waitForFunction(() => location.hash.includes('/watch'), null, { timeout: 30_000 });
        await page.waitForSelector('video', { timeout: 30_000 });
        await startPlayback(page);
        await page.waitForTimeout(2_000);

        await page.locator('.dplayer-setting').click();
        const items = page.locator('.dplayer-setting-audio-item');
        await items.first().waitFor({ state: 'visible', timeout: 30_000 });
        const count = await items.count();
        const before = await page.evaluate(() => {
            const video = document.querySelector('video');
            return {
                current: document.querySelector('.dplayer-setting-audio-current')?.textContent?.trim() ?? null,
                native: video?.audioTracks === undefined ? null : Array.from(video.audioTracks).map((track, index) => ({ index, enabled: track.enabled })),
            };
        });
        if (count < 2) return result('offline-audio-switch', false, { count, before }, 'オフライン音声メニューが2件未満');
        await items.nth(1).click();
        await page.waitForTimeout(2_000);
        const after = await page.evaluate(() => {
            const video = document.querySelector('video');
            return {
                current: document.querySelector('.dplayer-setting-audio-current')?.textContent?.trim() ?? null,
                actual: document.querySelector('[data-epgstation-audio-track]')?.getAttribute('data-epgstation-audio-track') ?? null,
                native: video?.audioTracks === undefined ? null : Array.from(video.audioTracks).map((track, index) => ({ index, enabled: track.enabled })),
                progressed: video === null ? false : video.currentTime > 0,
            };
        });
        const nativeSwitched = Array.isArray(after.native) && after.native.length >= 2 && after.native[1].enabled === true;
        const actualSwitched = after.actual === '1';
        const passed = (nativeSwitched || actualSwitched) && after.progressed === true;
        return result('offline-audio-switch', passed, { count, before, after, browser: options.browser ?? 'chromium' }, passed ? null : '副音声への切替結果を確認できない');
    } finally {
        await closePlayback(session);
    }
};

module.exports = { capabilityReport, offlineAudioSwitch };
