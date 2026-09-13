'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const {
    openPlayback,
    startPlayback,
    readVideoState,
    seekRelative,
    selectOtherQuality,
    closePlayback,
    normalizeBaseUrl,
} = require('./browser');
const { result } = require('./output');
const {
    evaluatePlaybackStability,
    parsePlaybackTime,
    matchJikkyoCommentTimes,
    evaluateJikkyoSync,
    evaluateEmsgCoverage,
} = require('../../../dist/util/PlaybackHarnessUtil');

const execFileAsync = promisify(execFile);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const latestBufferedEnd = state => (state?.buffered?.length > 0 ? state.buffered[state.buffered.length - 1][1] : 0);
const samplePlayback = async (page, seconds, stepSeconds = 2) => {
    const samples = [];
    for (let elapsed = 0; elapsed <= seconds; elapsed += stepSeconds) {
        const state = await readVideoState(page);
        if (state !== null) samples.push({ at: elapsed * 1000, currentTime: state.currentTime, paused: state.paused, state });
        if (elapsed < seconds) await page.waitForTimeout(stepSeconds * 1000);
    }
    return samples;
};

const runWithPlayback = async (options, callback) => {
    const session = await openPlayback(options);
    try {
        await startPlayback(session.page);
        return await callback(session);
    } finally {
        await closePlayback(session);
    }
};

const watch = async options => {
    const samples = await runWithPlayback(options, async ({ page }) => samplePlayback(page, options.duration, options.interval));
    const evaluated = evaluatePlaybackStability(samples, {
        maxStops: options.maxStops,
        maxStallSeconds: options.maxStallSeconds,
        minProgressSeconds: options.minProgressSeconds,
    });
    return result('watch', evaluated.passed, { duration: options.duration, ...evaluated.summary }, evaluated.reason);
};

const qualitySwitch = async options => {
    const value = await runWithPlayback(options, async ({ page }) => {
        await page.waitForTimeout(5000);
        const startedAt = Date.now();
        const switched = await selectOtherQuality(page);
        if (switched === false) return { switched: false, resumedSeconds: null };
        let previous = null;
        let advanced = 0;
        let resumedSeconds = null;
        for (let index = 0; index < 160; index += 1) {
            await page.waitForTimeout(250);
            const state = await readVideoState(page);
            if (state !== null && state.paused === false && previous !== null && state.currentTime > previous + 0.05) {
                advanced += 1;
                if (advanced >= 2) {
                    resumedSeconds = (Date.now() - startedAt) / 1000;
                    break;
                }
            } else {
                advanced = 0;
            }
            previous = state?.currentTime ?? null;
        }
        return { switched: true, resumedSeconds };
    });
    const passed = value.switched === true && value.resumedSeconds !== null && value.resumedSeconds <= options.maxSwitchSeconds;
    return result('quality-switch', passed, value, value.switched === false ? '画質候補なし' : passed ? null : `再開時間が ${options.maxSwitchSeconds}s を超過`);
};

const duplicatePlayer = async options => {
    const value = await runWithPlayback(options, async ({ page }) => {
        const count = () =>
            page.evaluate(() => ({
                dplayer: document.querySelectorAll('.dplayer').length,
                video: document.querySelectorAll('video').length,
                ptime: document.querySelectorAll('.dplayer-ptime').length,
                played: document.querySelectorAll('.dplayer-played').length,
            }));
        const before = await count();
        const switched = await selectOtherQuality(page);
        const observed = [];
        for (let index = 0; index < 20; index += 1) {
            await page.waitForTimeout(700);
            observed.push(await count());
        }
        const maximum = Object.fromEntries(['dplayer', 'video', 'ptime', 'played'].map(key => [key, Math.max(...observed.map(item => item[key]))]));
        return { before, switched, maximum };
    });
    const passed = value.switched && Object.values(value.maximum).every(count => count === 1);
    return result('duplicate-player', passed, value, passed ? null : 'DPlayer/video/時刻表示/再生バーの二重化');
};

const ptime = async options => {
    const value = await runWithPlayback(options, async ({ page }) => {
        const collect = async (seconds, action) => {
            if (action !== undefined) await action();
            const rows = [];
            for (let index = 0; index < seconds * 2; index += 1) {
                const state = await readVideoState(page);
                rows.push({ ptime: state?.ptime ?? '', currentTime: state?.currentTime ?? -1 });
                await page.waitForTimeout(500);
            }
            return rows;
        };
        const seekRows = await collect(10, () => seekRelative(page, 0.5));
        const switched = await selectOtherQuality(page);
        const switchRows = switched ? await collect(10) : [];
        const parseable = [...seekRows, ...switchRows].filter(row => parsePlaybackTime(row.ptime) !== null).length;
        return { switched, parseable, samples: seekRows.length + switchRows.length };
    });
    const passed = value.parseable === value.samples && value.samples > 0;
    return result('ptime', passed, value, passed ? null : 'dplayer-ptime が欠落または不正');
};

const recoverAfterSeek = async (page, ratio, seconds) => {
    await seekRelative(page, ratio);
    const samples = [];
    for (let index = 0; index < seconds / 2; index += 1) {
        await page.waitForTimeout(2000);
        const state = await readVideoState(page);
        samples.push(state);
    }
    return samples;
};

const m2tsSeek = async options => {
    const value = await runWithPlayback(options, async ({ page }) => {
        await page.waitForTimeout(10_000);
        const forward = await recoverAfterSeek(page, 0.8, 14);
        const backward = await recoverAfterSeek(page, 0.2, 20);
        const recovered = rows => rows.some(state => state !== null && state.readyState >= 2 && latestBufferedEnd(state) > state.currentTime);
        return { forwardRecovered: recovered(forward), backwardRecovered: recovered(backward), forward, backward };
    });
    const passed = value.forwardRecovered && value.backwardRecovered;
    return result('m2ts-seek', passed, { forwardRecovered: value.forwardRecovered, backwardRecovered: value.backwardRecovered }, passed ? null : '前方または後方シーク後に再生バッファ復帰なし');
};

const m2tsDeep = async options => {
    const value = await runWithPlayback(options, async ({ page }) => {
        await page.waitForTimeout(12_000);
        const samples = await recoverAfterSeek(page, 0.35, 28);
        const last = samples[samples.length - 1];
        return {
            samples: samples.length,
            bufferedAfterSeek: samples.some(state => state !== null && latestBufferedEnd(state) > state.currentTime),
            readyAfterSeek: samples.some(state => state !== null && state.readyState >= 2),
            receivedBytes: last?.receivedBytes ?? 0,
        };
    });
    const passed = value.bufferedAfterSeek && value.readyAfterSeek && value.receivedBytes >= options.minReceivedBytes;
    return result('m2ts-deep', passed, value, passed ? null : `buffered/readyState/受信バイト不足 (${options.minReceivedBytes}B)`);
};

const subtitle = async options => {
    const value = await runWithPlayback(options, async ({ page }) => {
        let maximumPixels = 0;
        let canvasCount = 0;
        for (let elapsed = 0; elapsed < options.duration; elapsed += 3) {
            await page.waitForTimeout(3000);
            const state = await page.evaluate(() => {
                let drawn = 0;
                const canvases = Array.from(document.querySelectorAll('canvas'));
                for (const canvas of canvases) {
                    if (canvas.width === 0 || canvas.height === 0) continue;
                    const context = canvas.getContext('2d');
                    if (context === null) continue;
                    try {
                        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
                        for (let index = 3; index < data.length; index += 4) if (data[index] > 0) drawn += 1;
                    } catch (_error) {
                        // CORS canvas は判定対象外
                    }
                }
                return { drawn, canvases: canvases.length };
            });
            maximumPixels = Math.max(maximumPixels, state.drawn);
            canvasCount = Math.max(canvasCount, state.canvases);
        }
        return { canvasCount, maximumPixels };
    });
    const passed = value.maximumPixels >= options.minSubtitlePixels;
    return result('subtitle', passed, value, passed ? null : `不透明字幕ピクセル ${value.maximumPixels} < ${options.minSubtitlePixels}`);
};

const hlsSubtitle = async options => {
    const session = await openPlayback(options);
    const segments = [];
    session.page.on('response', async response => {
        if (!/\.(?:m4s|mp4)(?:\?|$)/u.test(response.url())) return;
        try {
            const body = await response.body();
            if (body.length >= 200) segments.push(body.includes(Buffer.from('emsg')));
        } catch (_error) {
            // response body が既に破棄された場合は標本から除外
        }
    });
    try {
        await startPlayback(session.page);
        await session.page.waitForTimeout(options.duration * 1000);
    } finally {
        await closePlayback(session);
    }
    const coverage = evaluateEmsgCoverage(segments, options.minEmsgRatio, options.minSegments);
    return result('hls-subtitle', coverage.passed, coverage, coverage.reason);
};

const collectJikkyo = async (page, seconds) => {
    const rows = [];
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
        rows.push(
            await page.evaluate(() => ({
                positionText: document.querySelector('.dplayer-ptime')?.textContent ?? '',
                texts: Array.from(document.querySelectorAll('.dplayer-danmaku-item')).map(element => element.textContent ?? ''),
            })),
        );
        await page.waitForTimeout(300);
    }
    return rows;
};

const jikkyoSeek = async options => {
    if (options.videoStartAt === undefined) throw new Error('--video-start-at が必要');
    const session = await openPlayback(options);
    const timesByText = Object.create(null);
    let kakologCount = 0;
    session.page.on('response', async response => {
        if (!/kakolog/iu.test(response.url())) return;
        kakologCount += 1;
        try {
            const json = await response.json();
            for (const packet of json.packet ?? []) {
                const chat = packet.chat;
                if (typeof chat?.content !== 'string') continue;
                const timestamp = Number(chat.date) * 1000 + Math.floor(Number(chat.date_usec ?? 0) / 1000);
                if (!Number.isFinite(timestamp)) continue;
                (timesByText[chat.content] ??= []).push(timestamp);
            }
        } catch (_error) {
            // 過去ログ以外の応答は無視
        }
    });
    const cases = [];
    try {
        await startPlayback(session.page);
        await session.page.waitForTimeout(15_000);
        const measure = async (name, ratio, paused, resumeAfter = false) => {
            await seekRelative(session.page, ratio);
            if (paused) await session.page.evaluate(() => document.querySelector('video')?.pause());
            await session.page.waitForTimeout(paused ? 3000 : 8000);
            const samples = await collectJikkyo(session.page, options.commentWindow);
            const matches = matchJikkyoCommentTimes(samples, timesByText, options.videoStartAt);
            const evaluated = evaluateJikkyoSync(matches, { maxDriftSeconds: options.maxDriftSeconds, minSamples: options.minCommentSamples });
            cases.push({ name, ...evaluated });
            if (resumeAfter) {
                await session.page.evaluate(() => document.querySelector('video')?.play?.().catch(() => undefined));
                await session.page.waitForTimeout(6000);
                const resumedSamples = await collectJikkyo(session.page, options.commentWindow);
                const resumedMatches = matchJikkyoCommentTimes(resumedSamples, timesByText, options.videoStartAt);
                cases.push({ name: `${name}-再開後`, ...evaluateJikkyoSync(resumedMatches, { maxDriftSeconds: options.maxDriftSeconds, minSamples: options.minCommentSamples }) });
            }
        };
        await measure('再生中シーク', 0.35, false);
        await measure('一時停止中シーク', 0.65, true, true);
        const switched = await selectOtherQuality(session.page);
        if (switched) {
            await session.page.waitForTimeout(10_000);
            const samples = await collectJikkyo(session.page, options.commentWindow);
            const matches = matchJikkyoCommentTimes(samples, timesByText, options.videoStartAt);
            cases.push({ name: '画質切替後', ...evaluateJikkyoSync(matches, { maxDriftSeconds: options.maxDriftSeconds, minSamples: options.minCommentSamples }) });
        } else {
            cases.push({ name: '画質切替後', passed: false, reason: '画質候補なし' });
        }
        await measure('巻き戻し', 0.2, false);
    } finally {
        await closePlayback(session);
    }
    const passed = cases.length === 4 && cases.every(item => item.passed === true);
    return result('jikkyo-seek', passed, { cases, kakologCount, commentCount: Object.keys(timesByText).length }, passed ? null : '実況同期の合否条件を満たさないケースあり');
};

const recordingStress = async options => {
    const session = await openPlayback(options);
    let value;
    try {
        await startPlayback(session.page);
        const pages = [session.page];
        for (let index = 1; index < options.parallel; index += 1) {
            const page = await session.context.newPage();
            await page.goto(session.url);
            await page.waitForSelector('video', { timeout: options.timeoutMs ?? 30_000 });
            await startPlayback(page);
            pages.push(page);
        }
        const samples = [];
        for (let elapsed = 0; elapsed <= options.duration; elapsed += options.interval) {
            if (options.stress === 'seeks' && elapsed > 20 && elapsed % 20 === 0) {
                await Promise.all(pages.map((page, pageIndex) => seekRelative(page, 0.2 + ((elapsed / 20 + pageIndex) % 4) * 0.15)));
            }
            if (options.stress === 'pause' && elapsed === 30) await Promise.all(pages.map(page => page.evaluate(() => document.querySelector('video')?.pause())));
            if (options.stress === 'pause' && elapsed === 120) await Promise.all(pages.map(page => page.evaluate(() => document.querySelector('video')?.play?.().catch(() => undefined))));
            if (options.stress === 'tail' && elapsed === 20) await Promise.all(pages.map(page => seekRelative(page, 0.97)));
            const states = await Promise.all(pages.map(page => readVideoState(page)));
            states.forEach((state, pageIndex) => {
                if (state !== null) samples.push({ at: elapsed * 1000 + pageIndex, currentTime: state.currentTime, paused: state.paused });
            });
            if (elapsed < options.duration) await session.page.waitForTimeout(options.interval * 1000);
        }
        const evaluated = evaluatePlaybackStability(samples, { maxStops: options.maxStops, maxStallSeconds: options.maxStallSeconds, minProgressSeconds: options.minProgressSeconds });
        value = { stress: options.stress, parallel: pages.length, ...evaluated, samples: samples.length };
    } finally {
        await closePlayback(session);
    }
    return result('recording-stress', value.passed, value, value.reason);
};

const ipadAudio = async options => {
    const session = await openPlayback({ ...options, browser: 'webkit', device: options.device ?? 'iPad Mini' });
    try {
        await startPlayback(session.page);
        await session.page.waitForTimeout(6000);
        await session.page.locator('.dplayer-setting-icon').click().catch(() => undefined);
        const value = await session.page.evaluate(() => {
            const audioItems = Array.from(document.querySelectorAll('.dplayer-setting-audio-item, [data-audio]')).map(element => element.textContent?.trim() ?? '');
            const qualityItems = Array.from(document.querySelectorAll('.dplayer-setting-quality-item, .dplayer-quality-item')).map(element => element.textContent?.trim() ?? '');
            return { audioItems, qualityItems };
        });
        const passed = value.qualityItems.length >= options.minQualityItems && value.audioItems.length >= options.minAudioItems;
        return result('ipad-audio', passed, value, passed ? null : 'iPad/WebKit の音声または画質候補不足');
    } finally {
        await closePlayback(session);
    }
};

const mms = async options => {
    const session = await openPlayback({ ...options, browser: 'webkit', device: options.device ?? 'iPad Mini' });
    try {
        await session.context.addInitScript(() => {
            try {
                delete window.MediaSource;
                delete self.MediaSource;
            } catch (_error) {
                // 非 configurable な環境はそのまま確認
            }
        });
        // addInitScript は goto 前に必要なため、現在ページを再読込する
        await session.page.reload();
        await session.page.waitForSelector('video', { timeout: options.timeoutMs ?? 30_000 });
        await startPlayback(session.page);
        await session.page.waitForTimeout(options.duration * 1000);
        const value = await session.page.evaluate(() => {
            const video = document.querySelector('video');
            return {
                mediaSource: typeof window.MediaSource,
                managedMediaSource: typeof window.ManagedMediaSource,
                currentTime: video?.currentTime ?? 0,
                readyState: video?.readyState ?? 0,
            };
        });
        const passed = value.mediaSource === 'undefined' && value.managedMediaSource === 'function' && value.currentTime >= options.minProgressSeconds && value.readyState >= 2;
        return result('mms', passed, value, passed ? null : 'ManagedMediaSource 経路で再生進行なし');
    } finally {
        await closePlayback(session);
    }
};

const emsg = async options => {
    const script = path.join(__dirname, '..', 'emsg-check.sh');
    try {
        const { stdout, stderr } = await execFileAsync(script, [normalizeBaseUrl(options.baseUrl), String(options.videoFileId), String(options.mode), String(options.seekSeconds), String(options.minEmsgRatio), String(options.minSegments)], { maxBuffer: 1024 * 1024 });
        process.stdout.write(stdout);
        if (stderr.length > 0) process.stderr.write(stderr);
        return result('emsg', true, { delegated: true }, null);
    } catch (error) {
        if (error.stdout) process.stdout.write(error.stdout);
        if (error.stderr) process.stderr.write(error.stderr);
        return result('emsg', false, { delegated: true }, error.message);
    }
};

module.exports = {
    watch,
    'jikkyo-seek': jikkyoSeek,
    'm2ts-seek': m2tsSeek,
    'm2ts-deep': m2tsDeep,
    'duplicate-player': duplicatePlayer,
    ptime,
    'hls-subtitle': hlsSubtitle,
    emsg,
    subtitle,
    'quality-switch': qualitySwitch,
    'recording-stress': recordingStress,
    'ipad-audio': ipadAudio,
    mms,
};
