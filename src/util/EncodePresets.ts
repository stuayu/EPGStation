import IConfigFile, {
    EncodeCodec,
    EncodeHwAccel,
    EncodePresetsConfig,
    EncodePresetTarget,
    EncodeQuality,
    StreamProfile,
} from '../model/IConfigFile';

/**
 * ハードウェア (software / qsv / vaapi / nvenc) × コーデック (h264 / hevc) ×
 * 画質 (2160p / 1080p / 720p / 480p / 240p) × 用途 (recorded / liveHLS / recordedStreaming) の
 * 組み合わせから、録画エンコード (encode) / 配信プリセット (stream.profiles) を組み立てる。
 *
 * config.yml で `encode:` / `stream.profiles.*` を 1 つずつ手書き (コメントアウトで運用) する代わりに、
 * `encodePresets` フラグの直積からプリセット一式を自動生成することを目的とする。
 * 生成物は既存の `IEncodeManageModel` / `IStreamProfileManageModel` がそのまま扱える形
 * (config.encode の要素 / StreamProfile) にする。
 */

export type EncodeTargetKind = 'ts' | 'encoded';

export interface EncodePresetExpansion {
    // config.encode に相当する録画エンコードプリセット
    encode: NonNullable<IConfigFile['encode']>;
    // stream.profiles.live に相当するライブ HLS プリセット
    live: StreamProfile[];
    // stream.profiles.recorded.ts に相当する録画 (TS) ストリーミングプリセット
    recordedTs: StreamProfile[];
    // stream.profiles.recorded.encoded に相当する録画 (エンコード済) ストリーミングプリセット
    recordedEncoded: StreamProfile[];
}

interface QualityParam {
    height: number;
    videoBitrate: number; // kbps
    audioBitrate: number; // kbps
}

/**
 * 配信コマンドの遅延・画質方針。
 * 遅延の許容度と GOP 長は独立して決めたいので分けている
 * (録画済み HLS は「遅延は許容できるが LL-HLS のパート境界のため GOP は短くしたい」ケース)
 */
interface StreamTuning {
    // 遅延を最優先する (速度寄りの速度プリセット / zerolatency 系の指定を使う)。
    // false なら 1 段重いプリセットにして画質を優先する
    lowLatency: boolean;
    // GOP を 1 秒相当まで短くする (HLS のセグメント / パート境界を細かくする用途)
    shortGop: boolean;
}

// ライブ視聴: 遅延最優先 + 短い GOP
const TUNING_LIVE: StreamTuning = { lowLatency: true, shortGop: true };
// 録画中ファイルの配信 (実況と同時に見るため遅延を詰める)
const TUNING_RECORDING: StreamTuning = { lowLatency: true, shortGop: true };
// 録画済みファイルの mp4 配信: 画質優先
const TUNING_RECORDED_MP4: StreamTuning = { lowLatency: false, shortGop: false };
// 録画済みファイルの HLS 配信: 画質優先だが LL-HLS のパート境界のため GOP は短くする
const TUNING_RECORDED_HLS: StreamTuning = { lowLatency: false, shortGop: true };

// ffmpeg のエンコーダ名 (hwaccel × codec)。
// qsvencc/nvencc/vceencc は rigaya 系エンコーダが実際のエンコードを担い、ffmpeg 側は
// -c:v copy で remux するだけなので、ここではクライアント表示用に codec 種別 (h264/hevc) のみを表す
const CODEC_NAME: Record<EncodeHwAccel, Record<EncodeCodec, string>> = {
    software: { h264: 'libx264', hevc: 'libx265' },
    qsv: { h264: 'h264_qsv', hevc: 'hevc_qsv' },
    vaapi: { h264: 'h264_vaapi', hevc: 'hevc_vaapi' },
    nvenc: { h264: 'h264_nvenc', hevc: 'hevc_nvenc' },
    qsvencc: { h264: 'h264', hevc: 'hevc' },
    nvencc: { h264: 'h264', hevc: 'hevc' },
    vceencc: { h264: 'h264', hevc: 'hevc' },
};

// config/enc.js (録画エンコード用スクリプト) の PRESETS キー
const ENC_JS_PRESET_KEY: Record<EncodeHwAccel, Record<EncodeCodec, string>> = {
    software: { h264: 'h264', hevc: 'hevc' },
    qsv: { h264: 'h264_qsv', hevc: 'hevc_qsv' },
    vaapi: { h264: 'h264_vaapi', hevc: 'hevc_vaapi' },
    nvenc: { h264: 'h264_nvenc', hevc: 'hevc_nvenc' },
    qsvencc: { h264: 'qsvencc_h264', hevc: 'qsvencc_hevc' },
    nvencc: { h264: 'nvencc_h264', hevc: 'nvencc_hevc' },
    vceencc: { h264: 'vceencc_h264', hevc: 'vceencc_hevc' },
};

const HW_LABEL: Record<EncodeHwAccel, string> = {
    software: '',
    qsv: 'QSV',
    vaapi: 'VAAPI',
    nvenc: 'NVENC',
    qsvencc: 'QSVEncC',
    nvencc: 'NVEncC',
    vceencc: 'VCEEncC',
};

// rigaya 系エンコーダ (QSVEncC/NVEncC/VCEEncC) かどうかを判定する
type RigayaHwAccel = 'qsvencc' | 'nvencc' | 'vceencc';
const isRigayaHwAccel = (hwaccel: EncodeHwAccel): hwaccel is RigayaHwAccel =>
    hwaccel === 'qsvencc' || hwaccel === 'nvencc' || hwaccel === 'vceencc';

// PATH 上に存在することを期待する既定の実行ファイル名 (Windows では .exe 拡張子込みで PATH 解決される)
const RIGAYA_DEFAULT_BIN: Record<RigayaHwAccel, string> = {
    qsvencc: 'QSVEncC',
    nvencc: 'NVEncC',
    vceencc: 'VCEEncC',
};

// config.yml の qsvencc / nvencc / vceencc (実行ファイルパス指定、tsreadex と同じ流儀)
export interface RigayaExecPaths {
    qsvencc?: string;
    nvencc?: string;
    vceencc?: string;
}

/**
 * rigaya 系エンコーダの実行ファイルパスを解決する (config 未指定時は PATH 上のコマンド名を使う)
 * @param hwaccel: RigayaHwAccel
 * @param execPaths?: RigayaExecPaths
 * @return string
 */
const rigayaBinPath = (hwaccel: RigayaHwAccel, execPaths?: RigayaExecPaths): string =>
    execPaths?.[hwaccel] ?? RIGAYA_DEFAULT_BIN[hwaccel];

/**
 * 画質ごとの解像度・ビットレート。
 *
 * ビットレートは**画質優先**の値にしてある。地上波 (MPEG-2 で 15Mbps 前後) をソースにした
 * リアルタイムエンコードでは、ビットレートを削るほど動きの激しい場面のブロックノイズが目立つ。
 * 帯域を絞りたい場合は `codecs: [hevc]` を選ぶか、1 段下の quality を使うこと。
 *
 * `videoBitrate` は H.264 基準の値で、HEVC は同画質をより低いビットレートで出せるため
 * `HEVC_BITRATE_RATE` を掛けて下げる (下げた分をそのまま画質差にせず帯域削減に回す)。
 * ただし**その配信設定で一番上に出る画質 (最高解像度) だけは係数を掛けず**、H.264 と同じ
 * ビットレートを与える (一覧の先頭は帯域より画質を取る選択肢のため)。
 */
const QUALITY_TABLE: Record<EncodeQuality, QualityParam> = {
    // 新4K8K衛星放送 (BS4K / CS4K) 向け。H.264 の 4K は iOS のハードウェアデコード対象外なので
    // codecs: [hevc] と組み合わせて使う (HEVC では ×0.65 の 15600kbps になる)
    '2160p': { height: 2160, videoBitrate: 24000, audioBitrate: 256 },
    '1080p': { height: 1080, videoBitrate: 8000, audioBitrate: 256 },
    '720p': { height: 720, videoBitrate: 4500, audioBitrate: 192 },
    '480p': { height: 480, videoBitrate: 2000, audioBitrate: 128 },
    '240p': { height: 240, videoBitrate: 1000, audioBitrate: 96 },
};

// HEVC のビットレート係数 (同画質を H.264 の約 65% のビットレートで出せる)
const HEVC_BITRATE_RATE = 0.65;

/**
 * rigaya 系エンコーダが**録画ファイルを直接読む**場合 (--seek %SS% -i %INPUT%) に必須の A/V 同期指定。
 *
 * rigaya 系はファイル先頭付近のタイムスタンプからフレームレートを推定するが、
 * 録画 TS (特に Amatsukaze の tsreplace 出力) は先頭のタイムスタンプが不揃いなため
 * **推定を外す**。実測では 59.94fps のファイルを 31.75fps / 44.96fps と誤検出し、
 * その速度で出力するため映像だけが遅れていく (60 秒で 7.2 秒ずれた)。
 * 音声は --audio-copy で元のタイムスタンプのまま流れるので、ずれは再生時間に比例して開く。
 *
 * - `--avsync forcecfr`: 入力の PTS を見てフレームを挿入・削除し、実時間どおりの CFR にする
 *   (これが同期を保証する本体)
 * - `--fps 30000/1001`: 出力フレームレートを 29.97 に固定する。付けないと誤検出した値
 *   (31.75fps など) がそのまま出力レートになり、--gop-len で決まる LL-HLS のパート長が
 *   ファイルごとに変わってしまう。forcecfr と併用する限り再生速度には影響しない
 *
 * パイプ入力 (ライブ・録画中の TS) は放送 TS がそのまま流れてくるため対象外。
 */
const FILE_INPUT_SYNC_OPTIONS = '--avsync forcecfr --fps 30000/1001';

/**
 * 指定された quality のうち最も解像度が高いものを返す
 * 一覧の先頭に出る「一番良い画質」の選択肢を決めるために使う
 * @param qualities: EncodeQuality[]
 * @return EncodeQuality | null 空配列なら null
 */
const highestQualityOf = (qualities: EncodeQuality[]): EncodeQuality | null => {
    let highest: EncodeQuality | null = null;
    for (const quality of qualities) {
        if (highest === null || QUALITY_TABLE[quality].height > QUALITY_TABLE[highest].height) {
            highest = quality;
        }
    }

    return highest;
};

/**
 * コーデックを考慮した映像ビットレートを返す
 *
 * HEVC は同画質をより低いビットレートで出せるため通常は係数を掛けて帯域を削るが、
 * **その配信設定で一番上に出る画質 (最高解像度) だけは係数を掛けない**。
 * 一覧の先頭は「帯域を使ってでも綺麗に見たい」ときに選ぶものなので、
 * H.264 と同じビットレートを与えて画質差として出す
 * @param quality: EncodeQuality
 * @param codec: EncodeCodec
 * @param highestQuality?: EncodeQuality | null この配信設定での最高解像度
 * @return number kbps
 */
const videoBitrateOf = (quality: EncodeQuality, codec: EncodeCodec, highestQuality?: EncodeQuality | null): number =>
    codec === 'hevc' && quality !== highestQuality
        ? Math.round((QUALITY_TABLE[quality].videoBitrate * HEVC_BITRATE_RATE) / 100) * 100
        : QUALITY_TABLE[quality].videoBitrate;

const DEFAULT_HWACCEL: EncodeHwAccel = 'software';
const DEFAULT_CODECS: EncodeCodec[] = ['h264'];
const DEFAULT_QUALITIES: EncodeQuality[] = ['1080p', '720p', '480p'];
const DEFAULT_TARGETS: EncodePresetTarget[] = ['recorded', 'liveHLS', 'recordedStreaming'];

const isValidHwAccel = (value: unknown): value is EncodeHwAccel =>
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(CODEC_NAME, value);
const isValidCodec = (value: unknown): value is EncodeCodec => value === 'h264' || value === 'hevc';
const isValidQuality = (value: unknown): value is EncodeQuality =>
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(QUALITY_TABLE, value);
const isValidTarget = (value: unknown): value is EncodePresetTarget =>
    value === 'recorded' || value === 'liveHLS' || value === 'recordedStreaming';

/**
 * config.yml から読み込んだ配列のうち妥当な値のみを取り出す (1 つも残らなければ既定値を使う)
 * @param values: unknown 設定ファイル上の値
 * @param isValid: 妥当性判定関数
 * @param defaultValues: T[] 既定値
 * @return T[]
 */
const pickValid = <T>(values: unknown, isValid: (value: unknown) => value is T, defaultValues: T[]): T[] => {
    if (Array.isArray(values) === false) {
        return defaultValues;
    }

    const filtered = (values as unknown[]).filter(isValid);

    return filtered.length > 0 ? filtered : defaultValues;
};

namespace EncodePresets {
    /**
     * 画質ラベルを組み立てる (例: "1080p(H.264)", "720p(HEVC/QSV)")
     * @param quality: EncodeQuality
     * @param codec: EncodeCodec
     * @param hwaccel: EncodeHwAccel
     * @return string
     */
    const buildName = (quality: EncodeQuality, codec: EncodeCodec, hwaccel: EncodeHwAccel): string => {
        const codecLabel = codec === 'hevc' ? 'HEVC' : 'H.264';
        const hwLabel = HW_LABEL[hwaccel];
        return hwLabel === '' ? `${quality}(${codecLabel})` : `${quality}(${codecLabel}/${hwLabel})`;
    };

    /**
     * 録画エンコード (config.encode) の 1 プリセット分のタイムアウト倍率 (番組長 × この値で打ち切る)。
     * config/enc.js の録画エンコードは画質・圧縮効率優先の速度プリセット
     * (libx264 slow / libx265 medium / NVENC p7 / QSV slower / rigaya best・P7・slower) を使うため、
     * ソフトウェアエンコードでは実時間の数倍かかる前提で余裕を持たせる。
     * ハードウェアエンコードは実時間より速く終わるので短めでよい
     * @param hwaccel: EncodeHwAccel
     * @param codec: EncodeCodec
     * @return number
     */
    const timeoutRate = (hwaccel: EncodeHwAccel, codec: EncodeCodec): number => {
        if (hwaccel !== 'software') {
            return 3.0;
        }
        return codec === 'hevc' ? 14.0 : 10.0;
    };

    /**
     * 映像フィルタ (デインタレース + リサイズ + ハードウェア用フォーマット変換) を組み立てる
     * @param hwaccel: EncodeHwAccel
     * @param height: number
     * @param deinterlace: boolean 入力がインタレースか (録画済みエンコード済ファイル由来なら false)
     * @return string
     */
    const buildVideoFilter = (hwaccel: EncodeHwAccel, height: number, deinterlace: boolean): string => {
        switch (hwaccel) {
            case 'qsv':
                return `${deinterlace ? 'yadif,' : ''}scale=-2:${height},format=nv12`;
            case 'vaapi':
                // vaapi はハードウェアフレームでのフィルタ処理が必要 (format=nv12 → hwupload → vaapi 系フィルタ)
                return `format=nv12,hwupload${deinterlace ? ',deinterlace_vaapi' : ''},scale_vaapi=-2:${height}`;
            case 'software':
            case 'nvenc':
            default:
                return `${deinterlace ? 'yadif,' : ''}scale=-2:${height}`;
        }
    };

    /**
     * -c:v 以降のレート制御・GOP 設定を組み立てる (hwaccel ごとに指定できるオプション体系が異なるため個別に定義する)
     *
     * `lowLatency` で速度と画質のどちらを優先するかが変わる:
     * - ライブ視聴 (true): 遅延がそのまま体感を損なうため速度優先のプリセットを使う
     * - 録画再生 (false): 数百 ms の遅れは体感に響かないので、1 段重いプリセットにして画質を優先する。
     *   ソフトウェアエンコードの `-tune fastdecode,zerolatency` (先読み・B フレームを止める指定) も
     *   外して圧縮効率を戻す。ただし fMP4 のフラグメント境界をキーフレームで閉じる必要があるため
     *   closed GOP (`-flags +cgop`、呼び出し側で付与) は録画再生でも維持する
     * @param hwaccel: EncodeHwAccel
     * @param codec: EncodeCodec
     * @param height: number
     * @param videoBitrate: number kbps
     * @param lowLatency: boolean true でライブ視聴向けの速度優先設定にする
     * @return string
     */
    const buildVideoCodecOptions = (
        hwaccel: EncodeHwAccel,
        codec: EncodeCodec,
        height: number,
        videoBitrate: number,
        lowLatency: boolean,
    ): string => {
        const bufsize = videoBitrate * 2;
        const isHevc = codec === 'hevc';
        const hvc1 = isHevc ? ' -tag:v hvc1' : '';
        const rate = `-b:v ${videoBitrate}k -maxrate ${videoBitrate}k -bufsize ${bufsize}k`;

        switch (hwaccel) {
            case 'nvenc': {
                const profileLevel = isHevc
                    ? ` -profile:v ${hevcProfile()} -level ${hevcLevel(height)}`
                    : ` -profile:v ${h264Profile(height)} -level ${h264Level(height)}`;
                // p3 = 速度寄り / p5 = 画質寄り (p7 は録画再生のリアルタイム性に対して遅すぎる)。
                // ライブは -tune ll (低遅延) + CBR、録画再生は -tune hq + VBR で画質を優先する
                const tuning = lowLatency
                    ? '-preset p3 -tune ll -rc cbr -bf 0 -zerolatency 1 -no-scenecut 1'
                    : '-preset p5 -tune hq -rc vbr -bf 0 -no-scenecut 1';
                return `${rate}${profileLevel} ${tuning} -g 30 -keyint_min 30${hvc1}`;
            }
            case 'qsv': {
                const profilePart = isHevc ? ` -profile:v ${hevcProfile()}` : ` -profile:v ${h264Profile(height)}`;
                return (
                    `${rate}${profilePart} -preset ${lowLatency ? 'veryfast' : 'faster'} ` +
                    `-g 30 -keyint_min 30${hvc1}`
                );
            }
            case 'vaapi':
                // vaapi は -preset / -level を解釈しないドライバが多いため、profile とビットレートのみで制御する
                return (
                    `${rate} -profile:v ${isHevc ? hevcProfile() : h264Profile(height)} ` +
                    `-g 30 -keyint_min 30${hvc1}`
                );
            case 'software':
            default: {
                if (isHevc) {
                    // libx265 は libx264 より大幅に重いため、録画再生でも 1 段までしか上げない
                    const tune = lowLatency ? ' -tune zerolatency' : '';
                    return (
                        `${rate} -profile:v ${hevcProfile()} -pix_fmt yuv420p ` +
                        `-preset ${lowLatency ? 'veryfast' : 'faster'}${tune} ` +
                        `-g 30 -keyint_min 30 -x265-params scenecut=0:repeat-headers=1:level-idc=${hevcLevel(height)}${hvc1}`
                    );
                }
                // -tune fastdecode,zerolatency は先読みと B フレームを止めるため圧縮効率が落ちる。
                // 録画再生では外し、その分を画質に回す
                const tune = lowLatency ? ' -tune fastdecode,zerolatency' : '';
                return (
                    `${rate} -profile:v ${h264Profile(height)} -level ${h264Level(height)} -pix_fmt yuv420p ` +
                    `-preset ${lowLatency ? 'veryfast' : 'faster'}${tune} -g 30 -keyint_min 30 -sc_threshold 0`
                );
            }
        }
    };

    const h264Profile = (height: number): string => (height >= 720 ? 'high' : 'main');
    const h264Level = (height: number): string => {
        if (height >= 2160) return '5.2'; // 4K (3840x2160) は Level 5.1 以上が要る
        if (height >= 1080) return '4.1';
        if (height >= 720) return '4.0';
        if (height >= 480) return '3.1';
        return '3.0';
    };

    /**
     * HEVC のプロファイル。
     * iOS / Safari のハードウェアデコーダは HEVC Main (8bit 4:2:0) が確実に再生できる範囲で、
     * Main10 は端末世代によっては再生できない。地上波・BS/CS は元が 8bit なので Main で足りる
     * @return string
     */
    const hevcProfile = (): string => 'main';

    /**
     * HEVC のレベル。iOS の HEVC ハードウェアデコードは Main Level 5.1 までを想定する
     * @param height: number
     * @return string
     */
    const hevcLevel = (height: number): string => {
        if (height >= 2160) return '5.1';
        if (height >= 1080) return '4.1';
        return '4';
    };

    // vaapi はデバイスの初期化 (-vaapi_device) を -i より前段のグローバルオプションとして必要とする
    const vaapiDeviceOption = (hwaccel: EncodeHwAccel): string =>
        hwaccel === 'vaapi' ? '-vaapi_device /dev/dri/renderD128 ' : '';

    /**
     * rigaya 系エンコーダ (QSVEncC/NVEncC/VCEEncC) の共通 CLI オプションを組み立てる。
     * 3 ツールは同じ CLI フレームワークを共有しており、--avhw (ハードウェアデコード) /
     * --output-res / --vbr / --max-bitrate / --gop-len / --bframes / --audio-copy などの
     * オプション名・書式は共通 (通称 rigaya 系オプション)。
     * ただしオプションの一部は 3 ツールで揃っていないため個別に分岐する:
     * - --vpp-deinterlace は QSVEncC/NVEncC のみ (VCEEncC には無い)。かつ --interlace tff/bff の
     *   指定が前提なので、地上波・BS/CS (すべて tff) 向けに --interlace tff を明示する
     * - --vpp-yadif は 3 ツール共通なので VCEEncC のデインタレースはこちらを使う
     * - --strict-gop (GOP 長を固定する) は QSVEncC/NVEncC のみ
     * - --closed-gop というオプションは 3 ツールいずれにも存在しない (指定するとエラーで即終了する)
     *
     * -c:v 側は QUALITY_TABLE のビットレートに合わせた --vbr (平均ビットレート VBR) + --max-bitrate
     * (ffmpeg の -maxrate 相当、ピーク抑制用に 2 倍) で統一し、既存の software/qsv/vaapi/nvenc と
     * 同じ「ビットレート指定」の運用感に揃える。
     * --bframes 0 + --strict-gop は HLS/fMP4 のセグメント境界をキーフレームで確実に閉じるための指定
     * (buildLiveHlsCmd 等の -flags +cgop と同じ狙い)。
     *
     * iOS / Safari 互換のため --profile / --level / --output-depth 8 を明示する。
     * HEVC は Main (8bit 4:2:0) 以外だと端末世代によってハードウェアデコードできず再生できない。
     * なお rigaya 側の mp4/mpegts 出力にコーデックタグ (hvc1) を指定する手段は無いため、
     * hvc1 タグ付けは後段 ffmpeg の -tag:v hvc1 (buildHvc1TagOption) で行う。
     * @param hwaccel: RigayaHwAccel
     * @param codec: EncodeCodec
     * @param height: number
     * @param videoBitrate: number kbps
     * @param deinterlace: boolean 入力がインタレースか
     * @param tuning: StreamTuning 遅延と GOP の方針
     * @return string
     */
    const buildRigayaArgs = (
        hwaccel: RigayaHwAccel,
        codec: EncodeCodec,
        height: number,
        videoBitrate: number,
        deinterlace: boolean,
        tuning: StreamTuning,
        isFileInput: boolean = false,
    ): string => {
        const maxBitrate = videoBitrate * 2;
        // 幅は -2 (アスペクト比を保ったまま 2 の倍数へ丸める) にして、高さのみ画質プリセットに合わせる
        const resize = `--output-res -2x${height}`;
        // 録画ファイルを直接読む場合の A/V 同期対策 (下記 FILE_INPUT_SYNC_OPTIONS 参照)
        const sync = isFileInput ? ` ${FILE_INPUT_SYNC_OPTIONS}` : '';
        const deint = deinterlace
            ? hwaccel === 'vceencc'
                ? ' --interlace tff --vpp-yadif'
                : ' --interlace tff --vpp-deinterlace normal'
            : '';
        // HLS はセグメント / パート境界を GOP で刻むため短く (1 秒 @30fps)、
        // それ以外はやや長め (2 秒) にして圧縮効率を優先する
        const gop = tuning.shortGop ? 30 : 60;
        const strictGop = hwaccel === 'vceencc' ? '' : ' --strict-gop';
        const latency = tuning.lowLatency ? ' --lowlatency' : '';
        // iOS / Safari 互換: HEVC は Main (8bit)、H.264 は High/Main + レベル指定
        const profile = codec === 'hevc' ? hevcProfile() : h264Profile(height);
        const level = codec === 'hevc' ? hevcLevel(height) : h264Level(height);

        return (
            `-c ${codec} --profile ${profile} --level ${level} --output-depth 8 ` +
            `${rigayaQualityOption(hwaccel, tuning.lowLatency)} ` +
            `--vbr ${videoBitrate} --max-bitrate ${maxBitrate} --gop-len ${gop}${strictGop} ` +
            `--bframes 0${deint} ${resize}${latency}${sync}`
        );
    };

    /**
     * rigaya 系エンコーダの速度プリセットを返す。
     * **オプション名も選べる値も 3 ツールで異なる**:
     * - QSVEncC: `--quality best|higher|high|balanced|fast|faster|fastest`
     * - NVEncC: `--preset P1`〜`P7` (数字が大きいほど画質優先)
     * - VCEEncC: `--preset balanced|fast|slow|slower` (quality という値は存在しない)
     *
     * ライブは実時間に追いつくことが最優先なので速度側、録画再生は 1 段画質側へ倒す
     * (未指定だと各ツールの既定 = おおむね balanced 相当になるため、意図を明示する)
     * @param hwaccel: RigayaHwAccel
     * @param lowLatency: boolean
     * @return string
     */
    const rigayaQualityOption = (hwaccel: RigayaHwAccel, lowLatency: boolean): string => {
        switch (hwaccel) {
            case 'qsvencc':
                return lowLatency ? '--quality faster' : '--quality balanced';
            case 'nvencc':
                return lowLatency ? '--preset P3' : '--preset P5';
            case 'vceencc':
            default:
                return lowLatency ? '--preset fast' : '--preset balanced';
        }
    };

    /**
     * HEVC を fMP4 / MP4 で配信する際に必須のコーデックタグ指定を返す。
     * 既定の hev1 タグでは iOS / Safari が再生できない (映像が出ない・エラーになる) ため、
     * HEVC のときは必ず hvc1 を指定する
     * @param codec: EncodeCodec
     * @return string 先頭にスペースを含む (H.264 の場合は空文字列)
     */
    const buildHvc1TagOption = (codec: EncodeCodec): string => (codec === 'hevc' ? ' -tag:v hvc1' : '');

    /**
     * rigaya 系エンコーダ → ffmpeg のパイプラインの前段 (rigaya エンコーダ部分) を組み立てる。
     * rigaya 側でハードウェアデコード・デインターレース・リサイズ・エンコードまでを行い、
     * 音声はコピー (--audio-copy) のまま mpegts コンテナで標準出力へ渡す。
     * ffmpeg 側はこれを受けて -c:v copy で remux するだけにする
     * (最終コンテナの fMP4/HLS 特有のフラグ調整は rigaya 側にはできないため ffmpeg に任せる)。
     * cmd に `|` を含めると EncodeProcessManageModel がシェル経由 (Windows: cmd.exe) で実行する。
     * @param hwaccel: RigayaHwAccel
     * @param codec: EncodeCodec
     * @param height: number
     * @param videoBitrate: number kbps
     * @param deinterlace: boolean
     * @param lowLatency: boolean
     * @param inputSpec: string 入力指定 (pipe: '-i - --input-format mpegts' / ファイル: '--seek %SS% -i %INPUT%')
     * @param execPaths?: RigayaExecPaths
     * @return string 末尾に `|` を含む (ffmpeg 側コマンドをこの後ろに連結する)
     */
    const buildRigayaPipelinePrefix = (
        hwaccel: RigayaHwAccel,
        codec: EncodeCodec,
        height: number,
        videoBitrate: number,
        deinterlace: boolean,
        tuning: StreamTuning,
        inputSpec: string,
        execPaths?: RigayaExecPaths,
    ): string => {
        const bin = rigayaBinPath(hwaccel, execPaths);
        // 録画ファイルを直接読む指定 (--seek %SS% -i %INPUT%) かどうかで A/V 同期指定の要否が変わる
        const isFileInput = inputSpec.includes('%INPUT%');
        const codecArgs = buildRigayaArgs(hwaccel, codec, height, videoBitrate, deinterlace, tuning, isFileInput);

        // コンテナ指定は --output-format (別名 -f)。--format というオプションは存在しない
        // 音声はここでは触らず (--audio-copy) 後段の ffmpeg が aac 化するため、
        // 音量ブーストも後段へ寄せる (--audio-filter は --audio-copy と併用できない)
        return `${bin} --avhw ${inputSpec} ${codecArgs} --audio-copy --output-format mpegts -o - |`;
    };

    /**
     * ライブ HLS (in-memory 低遅延配信) 用のコマンドを組み立てる。
     * cmd に %streamFileDir% を含めないことで LiveStreamBaseModel.isMemoryHLS() が
     * in-memory モードと判定する (ディスク書き込みなし、doc/streaming-refresh.md 参照)
     *
     * 低遅延優先のチューニング:
     * - GOP を短く保つ (buildVideoCodecOptions/buildRigayaArgs 側で 30 = 1 秒 @30fps 相当)
     * - -flags +cgop で closed GOP を強制し、fMP4 フラグメント境界を確実にキーフレームで閉じる
     *   (フラグメントが前後の GOP を参照すると in-memory HLS のフラグメント単体再生が破綻するため)
     * - -movflags empty_moov+default_base_moof+frag_keyframe は Fmp4Packager が前提とする
     *   フラグメント化 fMP4 の必須フラグ (doc/streaming-refresh.md 参照、変更しないこと)
     */
    /**
     * ライブ HLS (in-memory) の GOP 長 (フレーム)
     * fMP4 のフラグメント境界 = キーフレームであり、それがそのまま HLS セグメント長になるため、
     * 遅延を詰めるにはここを短くする (29.97fps で 15 フレーム = 約 0.5 秒)
     */
    const LIVE_HLS_GOP_FRAMES = 15;

    const buildLiveHlsCmd = (
        hwaccel: EncodeHwAccel,
        codec: EncodeCodec,
        height: number,
        videoBitrate: number,
        audioBitrate: number,
        execPaths?: RigayaExecPaths,
    ): string => {
        if (isRigayaHwAccel(hwaccel)) {
            const prefix = buildRigayaPipelinePrefix(
                hwaccel,
                codec,
                height,
                videoBitrate,
                true,
                TUNING_LIVE,
                '-i - --input-format mpegts',
                execPaths,
            );

            return (
                `${prefix} %FFMPEG% %DUALMONOMODE% -f mpegts -analyzeduration 500000 -probesize 500000 ` +
                `-fflags nobuffer -i pipe:0 -sn -threads 0 ` +
                `-max_muxing_queue_size 1024 -c:v copy${buildHvc1TagOption(codec)} ` +
                `%AUDIOMAP% -c:a aac -ar 48000 -b:a ${audioBitrate}k -ac 2 %AUDIOFILTER% ` +
                `-movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1`
            );
        }

        const ffCodec = CODEC_NAME[hwaccel][codec];
        const vf = buildVideoFilter(hwaccel, height, true);
        const codecOpts = buildVideoCodecOptions(hwaccel, codec, height, videoBitrate, TUNING_LIVE.lowLatency);

        return (
            `%FFMPEG% %DUALMONOMODE% -fflags nobuffer ${vaapiDeviceOption(hwaccel)}-i pipe:0 ` +
            `-sn -threads 0 -max_muxing_queue_size 1024 %AUDIOMAP% -c:a aac -ar 48000 -b:a ${audioBitrate}k -ac 2 %AUDIOFILTER% ` +
            `-vf ${vf} -c:v ${ffCodec} ${codecOpts} -flags +cgop ` +
            // セグメント長 = GOP 長になるため、ライブ HLS では 0.5 秒 GOP まで詰める
            // (codecOpts の -g 30 を後ろから上書きする)
            `-g ${LIVE_HLS_GOP_FRAMES} -keyint_min ${LIVE_HLS_GOP_FRAMES} ` +
            `-movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1`
        );
    };

    /**
     * 録画ストリーミング (mp4) 用のコマンドを組み立てる。
     * scope が 'ts' の場合はパイプ入力 (未エンコード TS、録画中ファイルの実況ストリーミング相当)、
     * 'encoded' の場合はシーク付きファイル入力。
     *
     * シーク応答・再生開始の速さ優先のチューニング:
     * - -analyzeduration/-probesize を控えめに (500000/5000000) して入力解析待ちを短縮
     * - -fflags nobuffer -flags low_delay で ffmpeg 内部バッファリングを最小化
     * - -frag_duration 500000 (0.5 秒) で mp4 の moof フラグメントを細かく刻み、
     *   プレイヤーが最初のフラグメント受信後すぐに再生を開始できるようにする
     */
    const buildRecordedMp4Cmd = (
        scope: EncodeTargetKind,
        hwaccel: EncodeHwAccel,
        codec: EncodeCodec,
        height: number,
        videoBitrate: number,
        audioBitrate: number,
        execPaths?: RigayaExecPaths,
    ): string => {
        const isTs = scope === 'ts';

        if (isRigayaHwAccel(hwaccel)) {
            const inputSpec = isTs ? '-i - --input-format mpegts' : '--seek %SS% -i %INPUT%';
            const prefix = buildRigayaPipelinePrefix(
                hwaccel,
                codec,
                height,
                videoBitrate,
                isTs,
                isTs ? TUNING_RECORDING : TUNING_RECORDED_MP4,
                inputSpec,
                execPaths,
            );

            return (
                `${prefix} %FFMPEG% %DUALMONOMODE% -f mpegts -analyzeduration 500000 -probesize 5000000 -fflags nobuffer ` +
                `-flags low_delay -i pipe:0 -sn -threads 0 -max_muxing_queue_size 1024 -max_interleave_delta 1 ` +
                `-c:v copy${buildHvc1TagOption(codec)} %AUDIOMAP% -c:a aac -ar 48000 -b:a ${audioBitrate}k -ac 2 %AUDIOFILTER% ` +
                `-movflags empty_moov+default_base_moof+frag_keyframe -frag_duration 500000 -y -f mp4 pipe:1`
            );
        }

        const ffCodec = CODEC_NAME[hwaccel][codec];
        const vf = buildVideoFilter(hwaccel, height, isTs);
        const codecOpts = buildVideoCodecOptions(
            hwaccel,
            codec,
            height,
            videoBitrate,
            (isTs ? TUNING_RECORDING : TUNING_RECORDED_MP4).lowLatency,
        );
        const input = isTs ? '-i pipe:0' : '-ss %SS% -i %INPUT%';

        return (
            `%FFMPEG% %DUALMONOMODE% -fflags nobuffer -flags low_delay -analyzeduration 500000 ` +
            `-probesize 5000000 ${vaapiDeviceOption(hwaccel)}${input} -sn -threads 0 -max_muxing_queue_size 1024 ` +
            `-max_interleave_delta 1 %AUDIOMAP% -c:a aac -ar 48000 -b:a ${audioBitrate}k -ac 2 %AUDIOFILTER% ` +
            `-vf ${vf} -c:v ${ffCodec} ${codecOpts} -flags +cgop ` +
            `-movflags empty_moov+default_base_moof+frag_keyframe -frag_duration 500000 -y -f mp4 pipe:1`
        );
    };

    /**
     * 録画済み HLS (in-memory LL-HLS 配信) の GOP 長 (フレーム)
     * fMP4 のフラグメント境界 = キーフレームであり、それが LL-HLS のパート境界になる
     * (29.97fps で 15 フレーム = 約 0.5 秒。2 パートで 1 秒セグメント)
     */
    const RECORDED_HLS_GOP_FRAMES = 15;

    /**
     * 録画ストリーミング (HLS) 用のコマンドを組み立てる。
     * cmd に %streamFileDir% を含めないことで RecordedStreamBaseModel.isMemoryHLS() が
     * in-memory モードと判定し、fragmented MP4 を Fmp4Packager が LL-HLS
     * (#EXT-X-PART 付き) としてメモリ上で配信する (ディスク書き込みなし)。
     *
     * MPEG-TS セグメントではなく fMP4 セグメントにしているのは、
     * - HEVC は MPEG-TS の HLS では iOS / Safari が再生できない (fMP4 でのみ対応)
     * - LL-HLS のパート分割は fMP4 フラグメント単位でしか実現できない
     * ため。ARIB 字幕は Fmp4Packager が emsg box (version 1) として多重化する。
     *
     * シーク応答・再生開始の速さ優先のチューニング:
     * - GOP を 0.5 秒まで詰めてパート境界を細かくし、再生開始・シーク時の待ちを最小化
     * - -flags +cgop で closed GOP を強制し、フラグメントが前後の GOP を参照しないようにする
     * - -movflags empty_moov+default_base_moof+frag_keyframe は Fmp4Packager が前提とする
     *   フラグメント化 fMP4 の必須フラグ (doc/streaming-refresh.md 参照、変更しないこと)
     */
    const buildRecordedHlsCmd = (
        scope: EncodeTargetKind,
        hwaccel: EncodeHwAccel,
        codec: EncodeCodec,
        height: number,
        videoBitrate: number,
        audioBitrate: number,
        execPaths?: RigayaExecPaths,
    ): string => {
        const isTs = scope === 'ts';

        if (isRigayaHwAccel(hwaccel)) {
            const inputSpec = isTs ? '-i - --input-format mpegts' : '--seek %SS% -i %INPUT%';
            const prefix = buildRigayaPipelinePrefix(
                hwaccel,
                codec,
                height,
                videoBitrate,
                isTs,
                isTs ? TUNING_RECORDING : TUNING_RECORDED_HLS,
                inputSpec,
                execPaths,
            );

            return (
                `${prefix} %FFMPEG% %DUALMONOMODE% -f mpegts -analyzeduration 500000 -probesize 5000000 ` +
                `-fflags nobuffer -i pipe:0 -sn -threads 0 -max_muxing_queue_size 1024 -max_interleave_delta 1 ` +
                `-c:v copy${buildHvc1TagOption(codec)} %AUDIOMAP% -c:a aac -ar 48000 -b:a ${audioBitrate}k -ac 2 %AUDIOFILTER% ` +
                `-movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1`
            );
        }

        const ffCodec = CODEC_NAME[hwaccel][codec];
        const vf = buildVideoFilter(hwaccel, height, isTs);
        const codecOpts = buildVideoCodecOptions(
            hwaccel,
            codec,
            height,
            videoBitrate,
            (isTs ? TUNING_RECORDING : TUNING_RECORDED_HLS).lowLatency,
        );
        const input = isTs ? '-i pipe:0' : '-ss %SS% -i %INPUT%';

        return (
            `%FFMPEG% %DUALMONOMODE% -fflags nobuffer -analyzeduration 500000 -probesize 5000000 ` +
            `${vaapiDeviceOption(hwaccel)}${input} -sn -threads 0 -max_muxing_queue_size 1024 ` +
            `-max_interleave_delta 1 %AUDIOMAP% -c:a aac -ar 48000 -b:a ${audioBitrate}k -ac 2 %AUDIOFILTER% ` +
            `-vf ${vf} -c:v ${ffCodec} ${codecOpts} -flags +cgop ` +
            // パート長 = GOP 長になるため、録画済み HLS でも 0.5 秒 GOP まで詰める
            // (codecOpts の -g 30 を後ろから上書きする)
            `-g ${RECORDED_HLS_GOP_FRAMES} -keyint_min ${RECORDED_HLS_GOP_FRAMES} ` +
            `-movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1`
        );
    };

    /**
     * フラグ (hwaccel × codecs × qualities) の直積から、録画エンコード / 配信プリセットを組み立てる
     * @param presets: EncodePresetsConfig
     * @param execPaths?: RigayaExecPaths hwaccel が qsvencc/nvencc/vceencc の場合の実行ファイルパス
     *        (config.yml の qsvencc/nvencc/vceencc。省略時は PATH 上のコマンド名を使う)
     * @return EncodePresetExpansion
     */
    export const expand = (
        presets: EncodePresetsConfig | undefined,
        execPaths?: RigayaExecPaths,
    ): EncodePresetExpansion => {
        // 音声フィルタ (音量ブースト・副音声の pan) は cmd へ %AUDIOFILTER% を置くだけにして、
        // 実際の値は配信開始時に AudioTrackUtil が config と再生要求から展開する
        const result: EncodePresetExpansion = { encode: [], live: [], recordedTs: [], recordedEncoded: [] };
        if (typeof presets === 'undefined') {
            return result;
        }

        // config.yml は自由記述なので、未知の値が来ても既定値へ落として起動を止めないようにする
        // (テーブル引きの結果が undefined になって TypeError で落ちるのを防ぐ)
        const hwaccel = isValidHwAccel(presets.hwaccel) ? presets.hwaccel : DEFAULT_HWACCEL;
        const codecs = pickValid(presets.codecs, isValidCodec, DEFAULT_CODECS);
        const qualities = pickValid(presets.qualities, isValidQuality, DEFAULT_QUALITIES);
        const targets = pickValid(presets.targets, isValidTarget, DEFAULT_TARGETS);

        const targetSet = new Set(targets);
        // 一番上に出る画質だけ HEVC の係数を外すため、最高解像度を先に決める
        const highestQuality = highestQualityOf(qualities);

        for (const codec of codecs) {
            for (const quality of qualities) {
                const { height, audioBitrate } = QUALITY_TABLE[quality];
                // HEVC は同画質をより低いビットレートで出せるため係数を掛ける (最高解像度を除く)
                const videoBitrate = videoBitrateOf(quality, codec, highestQuality);
                const name = buildName(quality, codec, hwaccel);

                if (targetSet.has('recorded')) {
                    result.encode.push({
                        id: `preset-encode-${hwaccel}-${codec}-${quality}`,
                        name,
                        cmd: `%NODE% %ROOT%/config/enc.js ${ENC_JS_PRESET_KEY[hwaccel][codec]} ${height}`,
                        suffix: '.mp4',
                        rate: timeoutRate(hwaccel, codec),
                        video: { codec: CODEC_NAME[hwaccel][codec], height },
                        audio: { codec: 'aac' },
                    });
                }

                if (targetSet.has('liveHLS')) {
                    result.live.push({
                        id: `preset-live-hls-${hwaccel}-${codec}-${quality}`,
                        name,
                        container: 'hls',
                        video: { codec: CODEC_NAME[hwaccel][codec], height, bitrate: videoBitrate },
                        audio: { codec: 'aac', bitrate: audioBitrate },
                        cmd: buildLiveHlsCmd(hwaccel, codec, height, videoBitrate, audioBitrate, execPaths),
                    });
                }

                if (targetSet.has('recordedStreaming')) {
                    result.recordedTs.push({
                        id: `preset-recorded-ts-mp4-${hwaccel}-${codec}-${quality}`,
                        name,
                        container: 'mp4',
                        video: { codec: CODEC_NAME[hwaccel][codec], height, bitrate: videoBitrate },
                        audio: { codec: 'aac', bitrate: audioBitrate },
                        cmd: buildRecordedMp4Cmd('ts', hwaccel, codec, height, videoBitrate, audioBitrate, execPaths),
                    });
                    result.recordedTs.push({
                        id: `preset-recorded-ts-hls-${hwaccel}-${codec}-${quality}`,
                        name,
                        container: 'hls',
                        video: { codec: CODEC_NAME[hwaccel][codec], height, bitrate: videoBitrate },
                        audio: { codec: 'aac', bitrate: audioBitrate },
                        cmd: buildRecordedHlsCmd('ts', hwaccel, codec, height, videoBitrate, audioBitrate, execPaths),
                    });
                    result.recordedEncoded.push({
                        id: `preset-recorded-encoded-mp4-${hwaccel}-${codec}-${quality}`,
                        name,
                        container: 'mp4',
                        video: { codec: CODEC_NAME[hwaccel][codec], height, bitrate: videoBitrate },
                        audio: { codec: 'aac', bitrate: audioBitrate },
                        cmd: buildRecordedMp4Cmd(
                            'encoded',
                            hwaccel,
                            codec,
                            height,
                            videoBitrate,
                            audioBitrate,
                            execPaths,
                        ),
                    });
                    result.recordedEncoded.push({
                        id: `preset-recorded-encoded-hls-${hwaccel}-${codec}-${quality}`,
                        name,
                        container: 'hls',
                        video: { codec: CODEC_NAME[hwaccel][codec], height, bitrate: videoBitrate },
                        audio: { codec: 'aac', bitrate: audioBitrate },
                        cmd: buildRecordedHlsCmd(
                            'encoded',
                            hwaccel,
                            codec,
                            height,
                            videoBitrate,
                            audioBitrate,
                            execPaths,
                        ),
                    });
                }
            }
        }

        return result;
    };

    /**
     * encodePresets (§ ハードウェア × コーデック × 画質 × 用途の一括有効化フラグ) から
     * config.encode / config.stream.profiles.* を自動生成し、未設定のセクションにのみ補完する (config を直接変更する)。
     *
     * 優先順位 (手書き優先):
     * - config.encode に 1 件でも要素があれば録画エンコードプリセットは生成しない
     * - stream.profiles.live / recorded.ts / recorded.encoded は各セクション単位で、
     *   新形式 (profiles) にも旧形式 (stream.live / stream.recorded) にも手書きの設定が
     *   無い場合にのみ生成する (旧形式が優先されないよう profiles だけを埋める設計を壊さないため)
     * @param config: IConfigFile
     */
    export const applyToConfig = (config: IConfigFile): void => {
        if (typeof config.encodePresets === 'undefined') {
            return;
        }

        const expansion = expand(config.encodePresets, {
            qsvencc: config.qsvencc,
            nvencc: config.nvencc,
            vceencc: config.vceencc,
        });

        if ((config.encode?.length ?? 0) === 0 && expansion.encode.length > 0) {
            config.encode = expansion.encode;
        }

        const hasLegacyLiveProfiles =
            typeof config.stream?.live?.ts !== 'undefined' &&
            Object.values(config.stream.live.ts).some(list => Array.isArray(list) && list.length > 0);
        const hasLegacyRecordedTsProfiles =
            typeof config.stream?.recorded?.ts !== 'undefined' &&
            Object.values(config.stream.recorded.ts).some(list => Array.isArray(list) && list.length > 0);
        const hasLegacyRecordedEncodedProfiles =
            typeof config.stream?.recorded?.encoded !== 'undefined' &&
            Object.values(config.stream.recorded.encoded).some(list => Array.isArray(list) && list.length > 0);

        if (
            expansion.live.length === 0 &&
            expansion.recordedTs.length === 0 &&
            expansion.recordedEncoded.length === 0
        ) {
            return;
        }

        if (typeof config.stream === 'undefined') {
            config.stream = {};
        }
        if (typeof config.stream.profiles === 'undefined') {
            config.stream.profiles = {};
        }

        if (
            (config.stream.profiles.live?.length ?? 0) === 0 &&
            hasLegacyLiveProfiles === false &&
            expansion.live.length > 0
        ) {
            config.stream.profiles.live = expansion.live;
        }

        if (expansion.recordedTs.length > 0 || expansion.recordedEncoded.length > 0) {
            if (typeof config.stream.profiles.recorded === 'undefined') {
                config.stream.profiles.recorded = {};
            }

            if (
                (config.stream.profiles.recorded.ts?.length ?? 0) === 0 &&
                hasLegacyRecordedTsProfiles === false &&
                expansion.recordedTs.length > 0
            ) {
                config.stream.profiles.recorded.ts = expansion.recordedTs;
            }

            if (
                (config.stream.profiles.recorded.encoded?.length ?? 0) === 0 &&
                hasLegacyRecordedEncodedProfiles === false &&
                expansion.recordedEncoded.length > 0
            ) {
                config.stream.profiles.recorded.encoded = expansion.recordedEncoded;
            }
        }
    };
}

export default EncodePresets;
