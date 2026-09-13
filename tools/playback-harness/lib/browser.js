'use strict';

const fs = require('node:fs');
const path = require('node:path');

class HarnessDependencyError extends Error {}

const requirePlaywright = () => {
    try {
        return require('playwright-core');
    } catch (error) {
        throw new HarnessDependencyError(
            'playwright-core が未導入。実機計測時だけ `npm install --no-save playwright-core` を実行し、CI 依存へ追加しない。',
            { cause: error },
        );
    }
};

const normalizeBaseUrl = baseUrl => {
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
        throw new Error('--base-url または EPGSTATION_BASE_URL が必要');
    }
    return baseUrl.replace(/\/$/u, '');
};

const resolveHash = options => {
    if (typeof options.hash === 'string' && options.hash.length > 0) {
        return options.hash.startsWith('#') ? options.hash : `#${options.hash}`;
    }
    if (options.videoFileId === undefined) throw new Error('--hash または --video-file-id が必要');

    const videoFileId = encodeURIComponent(String(options.videoFileId));
    const recordedId = options.recordedId === undefined ? null : encodeURIComponent(String(options.recordedId));
    if (options.streamingType !== undefined) {
        if (recordedId === null || options.mode === undefined) throw new Error('--streaming-type 使用時は --recorded-id と --mode が必要');
        return `#/recorded/streaming/${videoFileId}?recordedId=${recordedId}&streamingType=${encodeURIComponent(options.streamingType)}&mode=${encodeURIComponent(String(options.mode))}`;
    }
    if (recordedId === null) throw new Error('--video-file-id 使用時は --recorded-id が必要');
    return `#/recorded/watch?videoId=${videoFileId}&recordedId=${recordedId}`;
};

const resolveExecutablePath = (browserType, browserName) => {
    const envName = `PLAYWRIGHT_${browserName.toUpperCase()}_EXECUTABLE_PATH`;
    const configured = process.env[envName] ?? process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    if (configured !== undefined && fs.existsSync(configured)) return configured;
    const bundled = browserType.executablePath();
    return fs.existsSync(bundled) ? bundled : undefined;
};

const createContext = async (browser, options, playwright) => {
    const deviceName = options.device;
    const device = deviceName === undefined || deviceName === 'none' ? undefined : playwright.devices[deviceName];
    if (deviceName !== undefined && deviceName !== 'none' && device === undefined) {
        throw new Error(`Playwright device 不明: ${deviceName}`);
    }
    return browser.newContext({
        viewport: { width: 1280, height: 800 },
        ...(device ?? {}),
        ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
    });
};

const applyThrottle = async (context, page, throttle) => {
    if (throttle === undefined) return;
    if (optionsBrowserName(page) !== 'chromium') throw new Error('--throttle は chromium のみ対応');
    const presets = { slow3g: [400, 400, 400], fast3g: [1600, 750, 150] };
    const [down, up, latency] = presets[throttle] ?? [Number(throttle), Number(throttle), 50];
    if (![down, up, latency].every(Number.isFinite)) throw new Error(`--throttle 不正: ${throttle}`);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency,
        downloadThroughput: (down * 1024) / 8,
        uploadThroughput: (up * 1024) / 8,
    });
    console.log(`throttle: ${down}kbps down, ${latency}ms latency`);
};

const optionsBrowserName = page => page.__harnessBrowserName;

const openPlayback = async options => {
    const playwright = requirePlaywright();
    const browserName = options.browser ?? 'chromium';
    const browserType = playwright[browserName];
    if (browserType === undefined) throw new Error(`ブラウザ不明: ${browserName}`);
    const executablePath = resolveExecutablePath(browserType, browserName);
    const browser = await browserType.launch({
        ...(executablePath === undefined ? {} : { executablePath }),
        headless: options.headful !== true,
        args: browserName === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [],
    });
    const context = await createContext(browser, options, playwright);
    const page = await context.newPage();
    page.__harnessBrowserName = browserName;
    await applyThrottle(context, page, options.throttle);
    const logs = [];
    page.on('console', message => {
        if (message.type() === 'error' || message.type() === 'warning' || /mpegts|hls|audio|stall|error/i.test(message.text())) {
            logs.push(`[${message.type()}] ${message.text().slice(0, 300)}`);
        }
    });
    page.on('pageerror', error => logs.push(`[pageerror] ${error.message.slice(0, 300)}`));
    page.on('response', response => {
        if (response.status() >= 400) logs.push(`[http ${response.status()}] ${response.url().slice(0, 240)}`);
    });
    const route = resolveHash(options);
    const url = options.hashUrl ?? `${normalizeBaseUrl(options.baseUrl)}/${route}`;
    await page.goto(url);
    await page.waitForSelector('video', { timeout: options.timeoutMs ?? 30_000 });
    return { browser, context, page, logs, url };
};

const startPlayback = async (page, retries = 8) => {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        const state = await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video === null) return { exists: false, paused: true };
            return { exists: true, paused: video.paused };
        });
        if (state.exists && state.paused === false) return;
        await page.evaluate(() => document.querySelector('video')?.play?.().catch(() => undefined));
        await page.waitForTimeout(1000);
    }
    throw new Error('video.play() 後も再生開始しない');
};

const readVideoState = page =>
    page.evaluate(() => {
        const video = document.querySelector('video');
        if (video === null) return null;
        const buffered = [];
        for (let index = 0; index < video.buffered.length; index += 1) {
            buffered.push([Number(video.buffered.start(index).toFixed(2)), Number(video.buffered.end(index).toFixed(2))]);
        }
        const resources = performance.getEntriesByType('resource');
        const receivedBytes = resources.reduce((total, entry) => {
            const resource = entry;
            return total + (Number(resource.encodedBodySize) || Number(resource.transferSize) || 0);
        }, 0);
        return {
            currentTime: Number(video.currentTime.toFixed(2)),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            buffered,
            error: video.error?.code ?? null,
            videoWidth: video.videoWidth,
            audioTracks: video.audioTracks?.length ?? null,
            ptime: document.querySelector('.dplayer-ptime')?.textContent?.trim() ?? '',
            duration: Number.isFinite(video.duration) ? video.duration : null,
            receivedBytes,
        };
    });

const seekRelative = async (page, ratio) => {
    if (!(ratio >= 0 && ratio <= 1)) throw new Error(`シーク比率不正: ${ratio}`);
    const box = await page.locator('.dplayer-bar-wrap').boundingBox();
    if (box === null) throw new Error('.dplayer-bar-wrap が見つからない');
    await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
};

const selectOtherQuality = page =>
    page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.dplayer-setting-quality-item, .dplayer-quality-item'));
        const current = document.querySelector('.dplayer-setting-quality-current, .dplayer-quality-current');
        const target = items.find(item => item !== current);
        if (target === undefined) return false;
        target.click();
        return true;
    });

const closePlayback = async session => {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
};

module.exports = {
    HarnessDependencyError,
    normalizeBaseUrl,
    resolveHash,
    openPlayback,
    startPlayback,
    readVideoState,
    seekRelative,
    selectOtherQuality,
    closePlayback,
};
