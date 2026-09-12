import { SourceCapabilities } from '../model/stream/capability/ISourceCapabilities';

/**
 * ffprobe の映像情報からデインターレース要否を判定する入力。
 * field_order が不明でも、フレームレートが 59.94fps 以上で MPEG-2 でない
 * 素材は、tsreplace 等で生成された progressive の可能性が高い。
 */
export interface DeinterlaceInput {
    codec?: string;
    field_order?: string;
    fps?: number | string;
    container?: string;
}

export const DEINTERLACE_PLACEHOLDER = '%DEINTERLACE%';

const INTERLACED_FIELD_ORDERS = new Set(['tt', 'tb', 'bb', 'bt', 'tff', 'bff', 'interlaced']);
const PROGRESSIVE_CODECS = new Set(['h264', 'avc', 'hevc', 'h265', 'av1']);

const parseFps = (value: number | string | undefined): number | undefined => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
    if (typeof value !== 'string') return undefined;

    if (value.includes('/') === false) {
        const fps = Number(value);
        return Number.isFinite(fps) && fps > 0 ? fps : undefined;
    }

    const [numerator, denominator] = value.split('/').map(Number);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
        return undefined;
    }
    return numerator / denominator;
};

/**
 * デインターレース判定に必要な映像特性が揃っているか返す。
 * field_order が無い progressive 素材は codec と 50fps 以上の組み合わせでのみ確定する。
 * @param input: DeinterlaceInput
 * @return boolean 判定結果をキャッシュしてよい場合は true
 */
export const hasReliableDeinterlaceInput = (input: DeinterlaceInput): boolean => {
    const fieldOrder = input.field_order?.toLowerCase();
    if (fieldOrder === 'progressive' || (fieldOrder !== undefined && INTERLACED_FIELD_ORDERS.has(fieldOrder))) {
        return true;
    }

    const codec = input.codec?.toLowerCase();
    const fps = parseFps(input.fps);
    return codec !== undefined && PROGRESSIVE_CODECS.has(codec) && fps !== undefined && fps >= 50;
};

/**
 * 自動生成する配信 cmd にデインターレースを入れるか判定する。
 *
 * field_order の明示値を最優先する。progressive は false、インターレース値は true。
 * field_order が unknown の場合は、59.94fps 以上の既知の progressive 系 codec だけを
 * progressive とみなす。それ以外は放送波そのままの MPEG-TS / MPEG-2 1080i を守るため
 * true (yadif 有り) に倒す。
 *
 * @param input: DeinterlaceInput
 * @return boolean デインターレースが必要なら true
 */
export const shouldDeinterlace = (input: DeinterlaceInput): boolean => {
    const fieldOrder = input.field_order?.toLowerCase();
    if (fieldOrder === 'progressive') return false;
    if (fieldOrder !== undefined && INTERLACED_FIELD_ORDERS.has(fieldOrder)) return true;

    const codec = input.codec?.toLowerCase();
    const fps = parseFps(input.fps);
    if (codec !== undefined && PROGRESSIVE_CODECS.has(codec) && fps !== undefined && fps >= 50) {
        return false;
    }

    // MPEG-TS / MPEG-2 は放送波の interlaced を取りこぼさないことを優先する。
    // それ以外の unknown も安全側へ倒し、明示的に progressive と確認できた場合だけ外す。
    if (input.container?.toLowerCase() === 'mpegts' || codec === 'mpeg2video' || codec === 'mpeg2') return true;
    return true;
};

/**
 * SourceAnalyzer の結果をデインターレース判定の入力へ変換する。
 * scan=progressive は field_order の実測値として明示し、unknown は fps / codec の判定へ渡す。
 * @param source: SourceCapabilities
 * @return DeinterlaceInput
 */
export const toDeinterlaceInput = (source: SourceCapabilities): DeinterlaceInput => ({
    codec: source.codec,
    field_order: source.scan === 'progressive' ? 'progressive' : source.fieldOrder,
    fps: source.frameRate,
    container: source.transport,
});

/**
 * 自動生成 cmd のデインターレース用プレースホルダを素材情報で置換する。
 * 素材情報が無い場合は放送波を壊さないため yadif 有りにする。
 * プレースホルダを持たない手書き cmd は変更しない。
 * @param cmd: string
 * @param input?: DeinterlaceInput
 * @return string
 */
export const replaceDeinterlacePlaceholder = (cmd: string, input?: DeinterlaceInput): string => {
    if (cmd.includes(DEINTERLACE_PLACEHOLDER) === false) return cmd;
    if (input === undefined || shouldDeinterlace(input) === true) {
        return cmd.replaceAll(DEINTERLACE_PLACEHOLDER, 'yadif');
    }

    // scale と連結した `-vf %DEINTERLACE%,scale` は `-vf scale` にする。
    const withoutFilter = cmd.replaceAll(`${DEINTERLACE_PLACEHOLDER},`, '');
    // scale も無い `-vf %DEINTERLACE%` は -vf ごと除去する。
    return withoutFilter.replace(new RegExp(`-vf\\s+${DEINTERLACE_PLACEHOLDER}`, 'g'), '');
};

export default shouldDeinterlace;
