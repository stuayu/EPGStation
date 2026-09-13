#!/usr/bin/env node
'use strict';

const scenarios = [
    ['watch', '再生監視。停止回数・最長停止・最低進行量'],
    ['jikkyo-seek', '実況コメントと再生位置の同期を4条件で測定'],
    ['m2ts-seek', '録画 m2tsll の前方・後方シーク復帰'],
    ['m2ts-deep', 'シーク後の buffered・readyState・受信バイト'],
    ['duplicate-player', '画質切替中の DPlayer/video/表示要素二重化'],
    ['ptime', '.dplayer-ptime と再生状態の継続性'],
    ['hls-subtitle', 'HLS セグメントの emsg 比率'],
    ['emsg', 'curl + ffprobe による HLS emsg 検査'],
    ['subtitle', '字幕 canvas の不透明ピクセル描画'],
    ['quality-switch', '画質切替後の再生再開時間'],
    ['recording-stress', '録画再生の連続・シーク・一時停止・終端ストレス'],
    ['ipad-audio', 'iPad/WebKit の音声・画質候補'],
    ['mms', 'ManagedMediaSource 経路強制'],
];

const usage = () => {
    console.log(`Usage: node tools/playback-harness/run.js <scenario> [options]\n`);
    console.log('共通オプション:');
    console.log('  --base-url URL              EPGStation URL (または EPGSTATION_BASE_URL)');
    console.log('  --hash HASH                 既存の hash route');
    console.log('  --video-file-id ID          録画 videoFileId');
    console.log('  --recorded-id ID            録画 recordedId');
    console.log('  --streaming-type TYPE       hls / m2tsll / mp4 / webm (指定時 --mode 必須)');
    console.log('  --mode N                    配信 mode');
    console.log('  --browser chromium|webkit   既定 chromium');
    console.log('  --device NAME               Playwright device 名');
    console.log('  --duration SEC              測定時間');
    console.log('  --help                      シナリオ一覧と共通オプション');
    console.log('\nシナリオ:');
    for (const [name, description] of scenarios) console.log(`  ${name.padEnd(18)} ${description}`);
    console.log('\n判定上書き: --max-stops N --max-stall-seconds N --max-drift-seconds N --min-emsg-ratio N --max-black-ratio N --min-frame-changes N --black-luma-max N --frame-change-threshold N');
};

const parseArgs = argv => {
    const options = { baseUrl: process.env.EPGSTATION_BASE_URL, browser: 'chromium', duration: 60, interval: 2 };
    const positionals = [];
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--help' || token === '-h') return { help: true };
        if (!token.startsWith('--')) {
            positionals.push(token);
            continue;
        }
        const equal = token.indexOf('=');
        const key = token.slice(2, equal === -1 ? undefined : equal).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
        const value = equal === -1 ? argv[++index] : token.slice(equal + 1);
        if (value === undefined) throw new Error(`値がない: ${token}`);
        const numericKeys = new Set([
            'duration', 'interval', 'maxStops', 'maxStallSeconds', 'minProgressSeconds', 'maxSwitchSeconds', 'minReceivedBytes',
            'minSubtitlePixels', 'minEmsgRatio', 'minSegments', 'videoStartAt', 'maxDriftSeconds', 'minCommentSamples',
            'commentWindow', 'mode', 'seekSeconds', 'minQualityItems', 'minAudioItems', 'cleanupWait', 'parallel',
            'maxBlackRatio', 'minFrameChanges', 'blackLumaMax', 'frameChangeThreshold',
        ]);
        options[key] = numericKeys.has(key) ? Number(value) : value;
    }
    return { scenario: positionals[0], options };
};

const defaults = options => ({
    ...options,
    maxStops: options.maxStops ?? 0,
    maxStallSeconds: options.maxStallSeconds ?? 0,
    minProgressSeconds: options.minProgressSeconds ?? 1,
    maxSwitchSeconds: options.maxSwitchSeconds ?? 40,
    minReceivedBytes: options.minReceivedBytes ?? 1024,
    minSubtitlePixels: options.minSubtitlePixels ?? 1,
    // ARIB 字幕は番組中ずっと出ているわけではないため、全セグメントに emsg は載らない。
    // 実測 (本番の録画 HLS) では 0.80 前後。字幕経路が死んでいれば 0 になるので、
    // 「壊れていないこと」を見る目的では 0.5 で十分。厳しくしたい場合は --min-emsg-ratio で上書きする。
    minEmsgRatio: options.minEmsgRatio ?? 0.5,
    minSegments: options.minSegments ?? 3,
    mode: options.mode ?? 0,
    seekSeconds: options.seekSeconds ?? 300,
    maxDriftSeconds: options.maxDriftSeconds ?? 2,
    maxBlackRatio: options.maxBlackRatio ?? 0,
    minFrameChanges: options.minFrameChanges ?? 1,
    blackLumaMax: options.blackLumaMax ?? 16,
    frameChangeThreshold: options.frameChangeThreshold ?? 2,
    minCommentSamples: options.minCommentSamples ?? 1,
    commentWindow: options.commentWindow ?? 8,
    minQualityItems: options.minQualityItems ?? 1,
    minAudioItems: options.minAudioItems ?? 1,
    stress: options.stress ?? 'long',
    parallel: options.parallel ?? 1,
});

(async () => {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help || parsed.scenario === undefined) {
        usage();
        return;
    }
    const scenario = scenarios.find(item => item[0] === parsed.scenario);
    if (scenario === undefined) throw new Error(`シナリオ不明: ${parsed.scenario}`);
    const options = defaults(parsed.options);
    if (options.baseUrl === undefined && options.scenario !== 'emsg') throw new Error('--base-url または EPGSTATION_BASE_URL が必要');
    const implementation = require('./lib/scenarios')[parsed.scenario];
    const outcome = await implementation(options);
    if (outcome?.passed !== true) process.exitCode = 1;
})().catch(error => {
    if (error.name === 'HarnessDependencyError') console.error(`実行不可: ${error.message}`);
    else console.error(`FATAL: ${error.message}`);
    process.exitCode = 2;
});
