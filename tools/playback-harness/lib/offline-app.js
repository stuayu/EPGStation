'use strict';

const fs = require('node:fs');
const { result } = require('./output');

const resolveExecutablePath = (browserType, browserName) => {
    const envName = `PLAYWRIGHT_${browserName.toUpperCase()}_EXECUTABLE_PATH`;
    const configured = process.env[envName] ?? process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    if (configured !== undefined && fs.existsSync(configured)) return configured;
    const bundled = browserType.executablePath();
    return fs.existsSync(bundled) ? bundled : undefined;
};

/** 既存の保存済みプロファイルで、機内モード再起動とオフライン再生を測る。 */
const offlineApp = async options => {
    let playwright;
    try {
        playwright = require('playwright-core');
    } catch (error) {
        const dependencyError = new Error('playwright-core が未導入。実機計測時だけ `npm install --no-save playwright-core` を実行する。');
        dependencyError.name = 'HarnessDependencyError';
        dependencyError.cause = error;
        throw dependencyError;
    }
    if (typeof options.profileDir !== 'string' || options.profileDir.length === 0) throw new Error('--profile-dir が必要 (offline.mjs で保存した永続プロファイル)');

    const browserType = playwright.chromium;
    const context = await browserType.launchPersistentContext(options.profileDir, {
        ...(resolveExecutablePath(browserType, 'chromium') === undefined ? {} : { executablePath: resolveExecutablePath(browserType, 'chromium') }),
        args: ['--autoplay-policy=no-user-gesture-required'],
        viewport: { width: 1280, height: 800 },
    });
    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    const pageErrors = [];
    const listen = target => target.on('pageerror', error => pageErrors.push(String(error?.message ?? error)));
    listen(page);
    const baseUrl = options.baseUrl.replace(/\/$/u, '');
    const state = () => page.evaluate(() => {
        const video = document.querySelector('video');
        return video === null ? null : { currentTime: Number(video.currentTime.toFixed(2)), readyState: video.readyState, paused: video.paused, error: video.error?.code ?? null };
    });
    const list = () => page.locator('button:has-text("再生")').count();

    await page.goto(`${baseUrl}/#/offline-videos`);
    await page.waitForTimeout(1000);
    if (await list() === 0) throw new Error('保存済み録画がない');
    await page.locator('button:has-text("再生")').first().click();
    await page.waitForFunction(() => location.hash.includes('/watch'), null, { timeout: 30_000 });
    await page.waitForTimeout(5000);
    const onlinePlay = await state();

    await context.setOffline(true);
    let reloadError = null;
    try {
        await page.goto(`${baseUrl}/#/offline-videos`, { timeout: 20_000 });
    } catch (error) {
        reloadError = String(error.message).split('\n')[0];
    }
    await page.waitForTimeout(2000);
    const offlineReload = { error: reloadError, buttons: await list() };
    if (offlineReload.buttons > 0) {
        await page.locator('button:has-text("再生")').first().click();
        await page.waitForFunction(() => location.hash.includes('/watch'), null, { timeout: 30_000 });
        await page.waitForTimeout(5000);
    }
    const offlinePlay = await state();

    const newPage = await context.newPage();
    listen(newPage);
    let newTabError = null;
    try {
        await newPage.goto(`${baseUrl}/#/offline-videos`, { timeout: 20_000 });
    } catch (error) {
        newTabError = String(error.message).split('\n')[0];
    }
    await newPage.waitForTimeout(1500);
    const newTabItems = await newPage.locator('.offline-item').count().catch(() => 0);
    await newPage.close();
    await context.close();

    const passed = reloadError === null && offlineReload.buttons > 0 && offlinePlay !== null && offlinePlay.currentTime > 0 && newTabError === null && newTabItems > 0 && pageErrors.length === 0;
    return result('offline-app', passed, { onlinePlay, offlineReload, offlinePlay, newTab: { error: newTabError, items: newTabItems }, pageErrors }, passed ? null : 'オフライン起動・再生・新規タブのいずれかに失敗');
};

module.exports = offlineApp;
