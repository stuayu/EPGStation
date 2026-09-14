#!/usr/bin/env node
'use strict';

const scenarios = [
    ['watch', '再生監視。停止回数・最長停止・最低進行量'],
    ['jikkyo-seek', '実況コメントと再生位置の同期を4条件で測定'],
    ['m2ts-seek', '録画ストリーミングの80%・30%・90%シーク復帰'],
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
    ['offline-records', 'TS 素材からオフライン EPGODL2 レコード生成を測定'],
    ['original-hevc', 'HEVC TS の無変換 fMP4 と ARIB 字幕 emsg を測定'],
    ['offline-app', '保存済みプロファイルのオフライン起動・再生・新規タブ確認'],
    ['ui-original-flow', '録画詳細の配信選択から視聴・80%/30%シークまでを測定'],
    ['watch-history-flow', '視聴履歴の配信選択・レジューム・profile一致を測定'],
    ['container-switch', '再生中の M2TS-LL ⇔ オリジナル切替と位置継承を測定'],
    ['live-original', 'ライブ Original を60秒再生し15秒切れを検出'],
    ['offline-hevc', 'HEVC Original を保存後、WebKitオフライン再生を測定'],
    ['offline-original-mpeg2', 'MPEG-2 Original の保存・回線断再生・シークを測定'],
    ['offline-program-info', '回線断で保存済み番組情報を表示できることを測定'],
    ['offline-indicator', 'オフライン表示と overlay 無し、回線復帰を測定'],
    ['recorded-offline-play', '録画一覧から保存データを再生し配信 API 無しを測定'],
    ['offline-navigation', 'オフライン一覧の複数動画を視聴画面へ遷移し再生進行を測定'],
    ['offline-detail', 'オフライン一覧 → 番組情報 → 視聴画面を回線断で測定'],
    ['recorded-detail-offline-play', '録画詳細から保存データ視聴へ遷移し配信 API 無しを測定'],
];

const usage = () => {
    console.log(`Usage: node tools/playback-harness/run.js <scenario> [options]\n`);
    console.log('共通オプション:');
    console.log('  --base-url URL              EPGStation URL (または EPGSTATION_BASE_URL)');
    console.log('  --hash HASH                 既存の hash route');
    console.log('  --video-file-id ID          録画 videoFileId');
    console.log('  --recorded-id ID            録画 recordedId');
    console.log('  --streaming-type TYPE       hls / m2tsll / original / mp4 / webm (指定時 --mode 必須)');
    console.log('  --mode N                    配信 mode');
    console.log('  --browser chromium|webkit   既定 chromium');
    console.log('  --device NAME               Playwright device 名');
    console.log('  --duration SEC              測定時間');
    console.log('  --input-ts PATH             オフライン測定へ使う TS (省略時は60秒素材を生成)');
    console.log('  --hevc                      tsreplace 相当の HEVC TS を生成して測定');
    console.log('  --non-idr-start             HEVC TS の先頭を任意位置から始める近似素材を使う');
    console.log('  --offline                   original-hevc の OfflineFmp4RecordStream も測定');
    console.log('  --profile-dir PATH          オフラインシナリオで使う保存済み永続プロファイル');
    console.log('  --profile ID                URLで期待する playback profile id');
    console.log('  --quality TEXT              UIで選ぶ画質ラベル');
    console.log('  --file-label TEXT           UIで選ぶ録画ファイル名 (例: TS)');
    console.log('  --ss SEC                    subtitle の録画開始位置 (秒)');
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
        if (token === '--hevc' || token === '--non-idr-start' || token === '--without-subtitles' || token === '--offline') {
            options[token.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())] = true;
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
            'maxBlackRatio', 'minFrameChanges', 'blackLumaMax', 'frameChangeThreshold', 'ss', 'timeoutMs', 'saveTimeoutMs',
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
    if (options.baseUrl === undefined && parsed.scenario !== 'emsg' && parsed.scenario !== 'offline-records' && parsed.scenario !== 'original-hevc') throw new Error('--base-url または EPGSTATION_BASE_URL が必要');
    const implementation = require('./lib/scenarios')[parsed.scenario];
    const outcome = await implementation(options);
    if (outcome?.passed !== true) process.exitCode = 1;
})().catch(error => {
    if (error.name === 'HarnessDependencyError') console.error(`実行不可: ${error.message}`);
    else console.error(`FATAL: ${error.message}`);
    process.exitCode = 2;
});
