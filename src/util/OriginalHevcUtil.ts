import { execFile } from 'child_process';
import { SourceCapabilities } from '../model/stream/capability/ISourceCapabilities';
import { audioBoostFilter } from './AudioBoostUtil';

export const ORIGINAL_HEVC_PROFILE_ID = 'original-hevc';

export type OriginalHevcAudioLayout = 'dual-mono' | 'multi' | 'single';

export type OriginalHevcInputMode = 'pipe' | 'file' | 'file-tsreadex';

export interface OriginalHevcAudioTrackInfo {
    streamIndex: number;
    isDualMono: boolean;
}

export interface DecodedAudioComparison {
    sampleCount: number;
    meanAbsoluteDifference: number;
    maxAbsoluteDifference: number;
}

export const AAC_DUAL_MONO_PROBE_SECONDS = 3;
export const AAC_DUAL_MONO_PROBE_TIMEOUT_MS = 5000;
const AAC_DUAL_MONO_PCM_SAMPLE_RATE = 16000;
const AAC_DUAL_MONO_PCM_BYTES_PER_SAMPLE = 2;
const AAC_DUAL_MONO_DIFFERENCE_THRESHOLD = 1;

/** main/sub のデコード結果を比較する。PCM が揃わない場合は判定不能。 */
export const compareDecodedAudio = (main: Uint8Array, sub: Uint8Array): DecodedAudioComparison | undefined => {
    if (
        main.byteLength === 0 ||
        main.byteLength !== sub.byteLength ||
        main.byteLength % AAC_DUAL_MONO_PCM_BYTES_PER_SAMPLE !== 0
    ) {
        return undefined;
    }

    const mainPcm = Buffer.from(main);
    const subPcm = Buffer.from(sub);
    let sum = 0;
    let max = 0;
    const sampleCount = mainPcm.byteLength / AAC_DUAL_MONO_PCM_BYTES_PER_SAMPLE;
    for (let i = 0; i < mainPcm.byteLength; i += AAC_DUAL_MONO_PCM_BYTES_PER_SAMPLE) {
        const difference = Math.abs(mainPcm.readInt16LE(i) - subPcm.readInt16LE(i));
        sum += difference;
        max = Math.max(max, difference);
    }

    return {
        sampleCount,
        meanAbsoluteDifference: sum / sampleCount,
        maxAbsoluteDifference: max,
    };
};

/** デコード結果が異なる場合だけ、実 AAC をデュアルモノラルと判定する。 */
export const isDecodedDualMono = (comparison: DecodedAudioComparison | undefined): boolean | undefined => {
    if (comparison === undefined || comparison.sampleCount === 0) return undefined;

    return comparison.meanAbsoluteDifference > AAC_DUAL_MONO_DIFFERENCE_THRESHOLD;
};

const decodeAudioStreamWindow = (
    ffmpegPath: string,
    filePath: string,
    audioIndex: number,
    startAt: number,
    timeoutMs: number,
): Promise<Buffer> =>
    new Promise<Buffer>((resolve, reject) => {
        execFile(
            ffmpegPath,
            [
                '-hide_banner',
                '-loglevel',
                'error',
                '-nostdin',
                '-ss',
                Math.max(0, startAt).toFixed(3),
                '-i',
                filePath,
                '-map',
                `0:a:${audioIndex}`,
                '-t',
                AAC_DUAL_MONO_PROBE_SECONDS.toString(10),
                '-vn',
                '-sn',
                '-dn',
                '-ac',
                '1',
                '-ar',
                AAC_DUAL_MONO_PCM_SAMPLE_RATE.toString(10),
                '-f',
                's16le',
                'pipe:1',
            ],
            { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' },
            (error, stdout) => {
                if (error !== null) {
                    reject(error);
                    return;
                }
                resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
            },
        );
    });

const decodeAudioWindow = (
    ffmpegPath: string,
    filePath: string,
    mode: 'main' | 'sub',
    startAt: number,
    timeoutMs: number,
): Promise<Buffer> =>
    new Promise<Buffer>((resolve, reject) => {
        execFile(
            ffmpegPath,
            [
                '-hide_banner',
                '-loglevel',
                'error',
                '-nostdin',
                '-ss',
                Math.max(0, startAt).toFixed(3),
                '-dual_mono_mode',
                mode,
                '-i',
                filePath,
                '-map',
                '0:a:0',
                '-t',
                AAC_DUAL_MONO_PROBE_SECONDS.toString(10),
                '-vn',
                '-sn',
                '-dn',
                '-ac',
                '1',
                '-ar',
                AAC_DUAL_MONO_PCM_SAMPLE_RATE.toString(10),
                '-f',
                's16le',
                'pipe:1',
            ],
            {
                encoding: 'buffer',
                maxBuffer: 2 * 1024 * 1024,
                timeout: timeoutMs,
                killSignal: 'SIGKILL',
            },
            (error, stdout) => {
                if (error !== null) {
                    reject(error);
                    return;
                }

                resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
            },
        );
    });

/**
 * AAC を実際に main/sub へデコードし、ファイル内の複数位置が全て dual-mono か判定する。
 * 失敗・timeout・通常ステレオのいずれも false/undefined の安全側へ倒す。
 * @param ffmpegPath: string ffmpeg 実行ファイル
 * @param filePath: string 音声を含むファイル
 * @param probePositions: readonly number[] 秒単位の probe 開始位置
 * @param timeoutMs: number 1回の ffmpeg 上限
 * @return Promise<boolean | undefined> true=dual-mono、false=dual-monoでない、undefined=判定不能
 */
export const probeAacDualMono = async (
    ffmpegPath: string,
    filePath: string,
    probePositions: readonly number[],
    timeoutMs: number = AAC_DUAL_MONO_PROBE_TIMEOUT_MS,
): Promise<boolean | undefined> => {
    if (probePositions.length === 0) return undefined;

    for (const position of probePositions) {
        try {
            const [main, sub] = await Promise.all([
                decodeAudioWindow(ffmpegPath, filePath, 'main', position, timeoutMs),
                decodeAudioWindow(ffmpegPath, filePath, 'sub', position, timeoutMs),
            ]);
            const dualMono = isDecodedDualMono(compareDecodedAudio(main, sub));
            if (dualMono !== true) return dualMono === false ? false : undefined;
        } catch (_error) {
            return undefined;
        }
    }

    return true;
};

/**
 * 2 本目の音声 ES が、ファイル内の指定位置のどこかで実際にデコードできるか判定する。
 * 音声トラック一覧 (ffprobe) はファイル冒頭の PMT しか見ないため、実体の無い 2 本目を拾うことがある。
 * そこで実デコードで裏を取るが、**全位置に存在することは求めない** —
 * オーディオコメンタリーや二か国語は本編だけに 2 本目があり、冒頭や末尾 (CM・予告) では 1 本に戻る録画が普通にある
 * (実測: videoFile 23023 は先頭 0 バイト / 中央 580096 バイト / 末尾 0 バイト)。
 * 全位置必須にすると、そうした録画がすべて「音声 1 本」に落ちて副音声へ切り替えられなくなる。
 * 2 本目の map は optional (`-map 0:a:1?`) なので、ES が無い区間から始めても出力は開ける。
 * @param ffmpegPath: string ffmpeg 実行ファイル
 * @param filePath: string 対象ファイル
 * @param probePositions: readonly number[] 秒単位の probe 開始位置
 * @param timeoutMs: number 1 回の ffmpeg 上限
 * @param decode: 指定位置の 2 本目を PCM へデコードする処理 (テストで差し替える)
 * @return Promise<boolean> いずれかの位置で 2 本目をデコードできたら true
 */
export const probeSecondAudioStreamPresent = async (
    ffmpegPath: string,
    filePath: string,
    probePositions: readonly number[],
    timeoutMs: number = AAC_DUAL_MONO_PROBE_TIMEOUT_MS,
    decode: (
        ffmpegPath: string,
        filePath: string,
        streamIndex: number,
        position: number,
        timeoutMs: number,
    ) => Promise<Buffer> = decodeAudioStreamWindow,
): Promise<boolean> => {
    if (probePositions.length === 0) return false;
    for (const position of probePositions) {
        try {
            const pcm = await decode(ffmpegPath, filePath, 1, position, timeoutMs);
            if (pcm.length > 0) return true;
        } catch (_error) {
            // この位置に 2 本目が無い / 読めないだけなので、次の位置を試す
        }
    }

    return false;
};

/** tsreplace などが作った HEVC の MPEG-TS を端末デコードへ渡せる素材か判定する。 */
export const isOriginalHevcSource = (source: SourceCapabilities): boolean =>
    source.transport === 'mpegts' && source.codec === 'hevc';

/**
 * HEVC を再エンコードせず、fMP4 の標準出力へ詰め替える録画 HLS コマンドを作る。
 * **音声は copy しない (AAC へ再エンコードする)**。放送の AAC を copy した fMP4 は、Safari / WebKit で
 * 最初のフラグメント境界 (4〜6 秒) で再生が止まる。実測 (Playwright WebKit、tsreplace 出力 3 本):
 * 音声 copy の fMP4 は 4.40 / 4.80 / 6.29 秒で停止、映像のみ・音声 AAC 再エンコードはいずれも 24 秒まで進行。
 * 映像の CRA/RASL・in-band PPS・AUD を除いても直らず、原因は音声トラック側 (copy 後の ffprobe で profile=-1、
 * `Number of bands (49) exceeds limit (32)`)。副音声の `-dual_mono_mode` も音声をデコードしないと効かない。
 */
/**
 * 音声トラック一覧から original-hevc の音声構成を分類する。
 * 一覧が空・想定外の場合は undefined とし、従来の単一音声経路へ戻す。
 * @param tracks: OriginalHevcAudioTrackInfo[] VideoUtil.getAudioTracks() の結果
 * @return OriginalHevcAudioLayout | undefined
 */
export const classifyOriginalHevcAudioLayout = (
    tracks: OriginalHevcAudioTrackInfo[],
): OriginalHevcAudioLayout | undefined => {
    if (tracks.length === 1 && tracks[0].isDualMono === false) return 'single';

    if (
        tracks.length >= 2 &&
        tracks[0].isDualMono === true &&
        tracks[1].isDualMono === true &&
        tracks[0].streamIndex === tracks[1].streamIndex
    ) {
        return 'dual-mono';
    }

    if (tracks.length >= 2 && new Set(tracks.map(track => track.streamIndex)).size >= 2) return 'multi';

    return undefined;
};

/**
 * encoded HEVC の Original HLS 入力方式を決める。
 * オフライン保存では先頭から全編を読むため、実在する複数音声だけ tsreadex で正規化する。
 * 単一音声を tsreadex (`-b 7`) へ通すと複製された音声 ES が生じるため、必ず file のままにする。
 * @param isEncodedVideo: boolean encoded TS か
 * @param isOffline: boolean オフライン保存か
 * @param audioLayout?: OriginalHevcAudioLayout 実 probe で得た音声構成
 * @param hasTsreadex: boolean tsreadex が設定されているか
 * @return OriginalHevcInputMode
 */
export const resolveOriginalHevcInputMode = (
    isEncodedVideo: boolean,
    isOffline: boolean,
    audioLayout: OriginalHevcAudioLayout | undefined,
    hasTsreadex: boolean,
): OriginalHevcInputMode => {
    if (isEncodedVideo === false) return 'pipe';

    if (isOffline === true && hasTsreadex === true && (audioLayout === 'dual-mono' || audioLayout === 'multi')) {
        return 'file-tsreadex';
    }

    return 'file';
};

/**
 * HEVC を再エンコードせず、fMP4 の標準出力へ詰め替える録画 HLS コマンドを作る。
 * 既知の encoded TS 音声構成は、ここで具体的な音声 map / filter_complex へ展開する。
 * 判定不能または tsreadex 経由では既存 placeholder 経路を使う。
 * @param useTsreadex: boolean TS 入力を tsreadex へ通すか
 * @param input: 'pipe' | 'file' | 'file-tsreadex' 入力方式
 * @param audioLayout?: OriginalHevcAudioLayout encoded TS の音声構成
 * @param audioTrack?: string 音声選択。all のとき全音声を出す
 * @param audioBoost?: unknown 音声ブースト倍率
 * @return string
 */
export const createOriginalHevcHlsCommand = (
    useTsreadex: boolean,
    input: OriginalHevcInputMode = 'pipe',
    audioLayout?: OriginalHevcAudioLayout,
    audioTrack?: string,
    audioBoost?: unknown,
): string => {
    const tsreadex =
        input === 'file-tsreadex'
            ? '%TSREADEX% -x 18 -n -1 -a 13 -b 7 -c 5 -u 5 %INPUT% | '
            : useTsreadex === true
              ? '%TSREADEX% | '
              : '';
    const inputArgs =
        input === 'pipe' || input === 'file-tsreadex'
            ? '-f mpegts -analyzeduration 5000000 -probesize 5000000 -i pipe:0'
            : '-ss %SS% -i %INPUT%';

    const knownAudio = input !== 'file-tsreadex' && useTsreadex === false && audioLayout !== undefined;
    const audioArgs = knownAudio === true ? createKnownAudioArgs(audioLayout, audioTrack, audioBoost) : null;
    const audioInputOption = audioArgs === null ? '%DUALMONOMODE% ' : '';
    const audioOutputOption =
        audioArgs === null
            ? '%AUDIOMAP% -c:a aac -ar 48000 -b:a 192k -ac 2 %AUDIOFILTER%'
            : `${audioArgs.filterComplex}${audioArgs.maps} -c:a aac -ar 48000 -b:a 192k -ac 2${audioArgs.filter}`;

    return (
        `${tsreadex}%FFMPEG% -fflags +genpts ${audioInputOption}${inputArgs} -sn -threads 0 ` +
        `${audioOutputOption} -c:v copy -tag:v hvc1 ` +
        `-avoid_negative_ts make_zero -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1`
    );
};

interface KnownAudioArgs {
    filterComplex: string;
    maps: string;
    filter: string;
}

const createKnownAudioArgs = (
    layout: OriginalHevcAudioLayout,
    audioTrack?: string,
    audioBoost?: unknown,
): KnownAudioArgs => {
    const boost = audioBoostFilter(audioBoost);
    const audioFilter = boost === '' ? '' : ` -af ${boost}`;

    if (layout === 'dual-mono') {
        const all = audioTrack === 'all';
        const main = audioTrack === 'sub' ? 'c1' : 'c0';
        const label = audioTrack === 'sub' ? 'sub_audio' : 'main_audio';
        const filterComplex = all
            ? `-filter_complex "[0:a:0]asplit=2[m][s];[m]pan=stereo|c0=c0|c1=c0${boost === '' ? '' : `,${boost}`}[main_audio];[s]pan=stereo|c0=c1|c1=c1${boost === '' ? '' : `,${boost}`}[sub_audio]" `
            : `-filter_complex "[0:a:0]pan=stereo|c0=${main}|c1=${main}${boost === '' ? '' : `,${boost}`}[${label}]" `;
        const maps = all ? '-map 0:v:0 -map "[main_audio]" -map "[sub_audio]"' : `-map 0:v:0 -map "[${label}]"`;

        return { filterComplex, maps, filter: '' };
    }

    if (layout === 'multi') {
        if (audioTrack === 'all') {
            return {
                filterComplex: '',
                // 2 本目の音声 ES は番組の途中で消えることがある (本番 34334: 冒頭は 2 本、200MB 位置は 1 本)。
                // 必須の -map だと ES が無い位置から再生を始めたとき ffmpeg が出力を開けず配信が始まらないので optional にする
                maps: '-map 0:v:0 -map 0:a:0 -map 0:a:1?',
                filter: audioFilter,
            };
        }

        const index = audioTrack === 'sub' ? 1 : (parseAudioIndex(audioTrack) ?? 0);
        return {
            filterComplex: '',
            maps: `-map 0:v:0 -map 0:a:${index}?`,
            filter: audioFilter,
        };
    }

    // single は placeholder を使うためここへは到達しない。
    return { filterComplex: '', maps: '-map 0:v:0 -map 0:a:0?', filter: audioFilter };
};

const parseAudioIndex = (audioTrack?: string): number | null => {
    if (typeof audioTrack !== 'string' || /^(?:main|sub|all)$/u.test(audioTrack)) return null;
    const index = Number.parseInt(audioTrack, 10);
    return Number.isInteger(index) && index >= 0 ? index : null;
};
