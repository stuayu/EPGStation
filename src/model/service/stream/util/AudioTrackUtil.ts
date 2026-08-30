import * as apid from '../../../../../api';
import { audioBoostFilter } from '../../../../util/AudioBoostUtil';

/**
 * 配信コマンド (cmd) の音声トラック指定を組み立てるユーティリティ。
 *
 * cmd には 3 つのプレースホルダを置く:
 * - `%DUALMONOMODE%`: 入力オプションの `-dual_mono_mode main|sub` に展開される (`-i` より前に置くこと)
 * - `%AUDIOMAP%`: 出力オプションの `-map 0:v:0 -map 0:a:<n>` に展開される (音声 ES を選ぶ場合のみ非空)
 * - `%AUDIOFILTER%`: 音声トラック指定と音声ブーストを統合した `-af` に展開される
 *
 * 二か国語放送は「1 つのステレオ ES の左右に主音声・副音声」を入れるデュアルモノラルで送られるため、
 * 副音声の選択は `-map` ではなく `-dual_mono_mode sub` で行う。
 * 音声 ES が複数ある放送では `-map 0:a:<n>` で ES 自体を選ぶ。
 *
 * `%DUALMONOMODE%` / `%AUDIOMAP%` を含まない手書き cmd (従来の `-dual_mono_mode main` 直書き) は
 * 置換対象が無いだけで従来どおり動作する (音声トラックの切り替えは効かない)。
 */
namespace AudioTrackUtil {
    /**
     * cmd の音声トラックプレースホルダを展開する
     * @param cmd: string 置換前のコマンド
     * @param audioTrack?: apid.AudioTrackSpecifier 'main' | 'sub' | 音声 ES のインデックス文字列
     * @return string
     */
    export const replacePlaceholders = (
        cmd: string,
        audioTrack?: apid.AudioTrackSpecifier,
        audioBoost?: unknown,
        videoFileType: apid.VideoFileType = 'ts',
    ): string => {
        const streamIndex = parseStreamIndex(audioTrack);
        const audioFilter = buildAudioFilter(audioTrack, audioBoost, videoFileType);
        const dualMonoMode = videoFileType === 'ts' && audioTrack === 'sub' ? 'sub' : 'main';

        return cmd
            .replace(/%DUALMONOMODE%/g, `-dual_mono_mode ${dualMonoMode}`)
            .replace(/%AUDIOMAP%/g, streamIndex === null ? '' : `-map 0:v:0 -map 0:a:${streamIndex}`)
            .replace(/%AUDIOFILTER%/g, audioFilter);
    };

    /**
     * 音声トラック指定と音声ブーストを 1 本の -af へまとめる
     * @param audioTrack?: apid.AudioTrackSpecifier
     * @param audioBoost?: unknown
     * @param videoFileType: apid.VideoFileType 入力ファイル種別
     * @return string -af オプション。フィルタ無しなら空文字列
     */
    export const buildAudioFilter = (
        audioTrack?: apid.AudioTrackSpecifier,
        audioBoost?: unknown,
        videoFileType: apid.VideoFileType = 'ts',
    ): string => {
        const filters: string[] = [];

        // encoded は既に通常のステレオへ変換済みのため、sub は右chを両耳へ複製する。
        // main へ pan を掛けると、通常のステレオ放送までモノラル化するので掛けない。
        if (videoFileType === 'encoded' && audioTrack === 'sub') {
            filters.push('pan=stereo|c0=c1|c1=c1');
        }

        const boost = audioBoostFilter(audioBoost);
        if (boost !== '') {
            filters.push(boost);
        }

        return filters.length === 0 ? '' : `-af ${filters.join(',')}`;
    };

    /**
     * 音声トラック指定子から音声 ES のインデックスを取り出す
     * 'main' / 'sub' / 未指定 / 不正値は null (ffmpeg の既定の音声選択に任せる)
     * @param audioTrack?: apid.AudioTrackSpecifier
     * @return number | null
     */
    export const parseStreamIndex = (audioTrack?: apid.AudioTrackSpecifier): number | null => {
        if (typeof audioTrack !== 'string' || audioTrack === 'main' || audioTrack === 'sub') {
            return null;
        }

        const index = parseInt(audioTrack, 10);

        return isNaN(index) === true || index < 0 ? null : index;
    };
}

export default AudioTrackUtil;
