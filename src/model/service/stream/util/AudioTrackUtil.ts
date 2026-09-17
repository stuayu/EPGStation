import * as apid from '../../../../../api';
import { audioBoostFilter } from '../../../../util/AudioBoostUtil';

/**
 * 配信コマンド (cmd) の音声トラック指定を組み立てるユーティリティ。
 *
 * cmd には 3 つのプレースホルダを置く:
 * - `%DUALMONOMODE%`: 入力オプションの `-dual_mono_mode main|sub` に展開される (`-i` より前に置くこと)
 * - `%AUDIOMAP%`: 出力オプションの `-map 0:v:0 -map 0:a:<n>?` に展開される (音声 ES を選ぶ場合のみ非空)
 * - `%AUDIOSELECTMAP%`: 既に映像 map がある cmd 用の音声 map `-map 0:a:<n>?` に展開される
 * - `%AUDIOFILTER%`: 音声トラック指定と音声ブーストを統合した `-af` に展開される
 *
 * 二か国語放送は「1 つのステレオ ES の左右に主音声・副音声」を入れるデュアルモノラルで送られるため、
 * 副音声の選択は `-map` ではなく `-dual_mono_mode sub` で行う。
 * 音声 ES が複数ある放送では `-map 0:a:<n>?` で ES 自体を選ぶ。選択 ES がその区間に
 * 無い場合は主音声の map も並べ、ffmpeg の map 失敗による配信停止を避ける。出力順は、
 * クライアントが同一ストリーム内で切り替えられる経路では主音声を先にし、それ以外では
 * 選択した ES を先にする。
 *
 * `%DUALMONOMODE%` / `%AUDIOMAP%` を含まない手書き cmd (従来の `-dual_mono_mode main` 直書き) は
 * 置換対象が無いだけで従来どおり動作する (音声トラックの切り替えは効かない)。
 *
 * **tsreadex を通した cmd では選び方が変わる**。tsreadex (`-a 13`) はデュアルモノラルの ES を
 * 主音声・副音声の 2 本の ES へ分離済みなので、副音声は `-dual_mono_mode sub` では選べず
 * `-map 0:a:1` で 2 本目の ES を選ぶ必要がある (実測: `-a 13 -b 5` の出力は音声 ES が常に 2 本)。
 * 呼び出し側が `isNormalizedByTsreadex` と実際の音声 ES 数を渡してこの違いを伝える。
 *
 * **`audioTrack: 'all'`** は tsreadex 正規化済み、または実音声 ES が 2 本以上と判定できるときに
 * 主音声・副音声の両方の ES を主音声先頭の
 * `-map 0:v:0 -map "0:a:0?" -map "0:a:1?"` として同時に配信する (m2tsll でクライアント側
 * (mpegts.js) が再接続無しで `switchPrimaryAudio()` / `switchSecondaryAudio()` を呼んで切り替えるための経路)。
 * tsreadex を通していない cmd で `all` が来た場合はデュアルモノラルの 1 ES しか無く分離できないため
 * `main` と同じ扱いにする。
 *
 * **tsreadex 正規化済みで `audioTrack` が未指定の場合は index 0 (主音声 ES) を明示的に選ぶ**。
 * tsreadex 正規化済みの cmd は音声 map プレースホルダを使う前提 (m2tsll の全 ES 通し `-map 0` を使わない) なので、
 * 未指定のまま音声 map を空文字列にすると映像・音声が 1 本も map されず配信が始まらない。
 */
namespace AudioTrackUtil {
    /**
     * cmd のプレースホルダを置換する。空文字列の場合はプレースホルダ前後の空白も 1 つに整理する。
     */
    const replaceCommandPlaceholder = (cmd: string, placeholder: string, value: string): string => {
        if (value !== '') {
            return cmd.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
        }

        const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return cmd.replace(new RegExp(`\\s*${escapedPlaceholder}\\s*`, 'g'), ' ').trim();
    };

    /**
     * cmd の音声トラックプレースホルダを展開する
     * @param cmd: string 置換前のコマンド
     * @param audioTrack?: apid.AudioTrackSpecifier 'main' | 'sub' | 音声 ES のインデックス文字列
     * @param audioBoost?: unknown 音声ブースト設定
     * @param videoFileType: apid.VideoFileType 入力ファイル種別
     * @param isNormalizedByTsreadex: boolean tsreadex で音声 ES を分離済みか
     * @param audioStreamCount?: number 実音声 ES 数
     * @param canSwitchAudioInStream: boolean 同一ストリーム内でクライアントが音声を切り替えられるか
     * @return string
     */
    export const replacePlaceholders = (
        cmd: string,
        audioTrack?: apid.AudioTrackSpecifier,
        audioBoost?: unknown,
        videoFileType: apid.VideoFileType = 'ts',
        isNormalizedByTsreadex: boolean = false,
        audioStreamCount?: number,
        // 引数を追加する前の直接呼び出しとの互換性のため、既定値は従来の主音声先頭を維持する。
        // 実際の配信経路は呼び出し側が container に応じて明示する。
        canSwitchAudioInStream: boolean = true,
    ): string => {
        const hasMultipleAudioStreams = typeof audioStreamCount === 'number' && audioStreamCount >= 2;
        const canEmbedMultipleAudioStreams =
            canSwitchAudioInStream === true && (isNormalizedByTsreadex === true || hasMultipleAudioStreams === true);
        // tsreadex なしでも独立した音声 ES が複数あれば 'all' を map できる。
        // ES 数が不明/1 本の場合は従来どおりデュアルモノラルの main 扱いにする。
        const effectiveAudioTrack =
            audioTrack === 'all' && isNormalizedByTsreadex === false && hasMultipleAudioStreams === false
                ? 'main'
                : audioTrack;

        // tsreadex 正規化済みは音声 ES が主音声・副音声の 2 本に分かれているため ES を選ぶ。
        // 未指定は主音声 (index 0) を明示的に選ぶ (音声 map を空にすると何も map されなくなるため)
        const streamIndex =
            (isNormalizedByTsreadex === true || hasMultipleAudioStreams) &&
            (effectiveAudioTrack === 'main' || effectiveAudioTrack === undefined)
                ? 0
                : (isNormalizedByTsreadex === true || hasMultipleAudioStreams) && effectiveAudioTrack === 'sub'
                  ? 1
                  : parseStreamIndex(effectiveAudioTrack);
        const audioFilter = buildAudioFilter(
            effectiveAudioTrack,
            audioBoost,
            videoFileType,
            isNormalizedByTsreadex,
            audioStreamCount,
        );
        const dualMonoMode =
            isNormalizedByTsreadex === false &&
            hasMultipleAudioStreams === false &&
            videoFileType === 'ts' &&
            effectiveAudioTrack === 'sub'
                ? 'sub'
                : 'main';

        // 'all' (tsreadex 正規化済み、または実 ES 2 本以上) は主音声・副音声の両方を同時に map する。
        // クライアント (mpegts.js) 側で switchPrimaryAudio()/switchSecondaryAudio() を呼んで
        // 再接続無しに切り替えるための経路 (PlaybackProfile.embeddedAudioSwitch を参照)
        const audioMap =
            (effectiveAudioTrack === 'all' ||
                (canEmbedMultipleAudioStreams &&
                    (effectiveAudioTrack === 'main' ||
                        effectiveAudioTrack === 'sub' ||
                        effectiveAudioTrack === undefined))) &&
            (isNormalizedByTsreadex === true || hasMultipleAudioStreams === true)
                ? '-map 0:v:0 -map "0:a:0?" -map "0:a:1?"'
                : streamIndex === null
                  ? ''
                  : buildSelectedAudioMap(streamIndex, true, canSwitchAudioInStream);
        const audioSelectMap =
            (effectiveAudioTrack === 'all' ||
                (canEmbedMultipleAudioStreams &&
                    (effectiveAudioTrack === 'main' ||
                        effectiveAudioTrack === 'sub' ||
                        effectiveAudioTrack === undefined))) &&
            (isNormalizedByTsreadex === true || hasMultipleAudioStreams === true)
                ? '-map "0:a:0?" -map "0:a:1?"'
                : buildSelectedAudioMap(streamIndex ?? 0, false, canSwitchAudioInStream);

        return replaceCommandPlaceholder(
            replaceCommandPlaceholder(
                replaceCommandPlaceholder(
                    replaceCommandPlaceholder(cmd, '%DUALMONOMODE%', `-dual_mono_mode ${dualMonoMode}`),
                    '%AUDIOMAP%',
                    audioMap,
                ),
                '%AUDIOSELECTMAP%',
                audioSelectMap,
            ),
            '%AUDIOFILTER%',
            audioFilter,
        );
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
        isNormalizedByTsreadex: boolean = false,
        audioStreamCount?: number,
    ): string => {
        const filters: string[] = [];
        const hasMultipleAudioStreams = typeof audioStreamCount === 'number' && audioStreamCount >= 2;

        // encoded は既に通常のステレオへ変換済みのため、sub は右chを両耳へ複製する。
        // main へ pan を掛けると、通常のステレオ放送までモノラル化するので掛けない。
        // tsreadex 正規化済みは副音声が独立した ES になっているので pan は不要。
        if (
            isNormalizedByTsreadex === false &&
            hasMultipleAudioStreams === false &&
            videoFileType === 'encoded' &&
            audioTrack === 'sub'
        ) {
            filters.push('pan=stereo|c0=c1|c1=c1');
        }

        const boost = audioBoostFilter(audioBoost);
        if (boost !== '') {
            filters.push(boost);
        }

        if (filters.length === 0) {
            return '';
        }

        const filter = filters.join(',');
        // pan の区切り文字 `|` はシェルのパイプでもあるため、cmd がシェル経由になっても
        // コマンドを分割しないようフィルタ全体を引用する。直接 spawn では ProcessUtil が
        // 外側の引用符を取り除くため、ffmpeg へは従来どおり 1 引数として渡る。
        return filter.includes('|') === true ? `-af "${filter}"` : `-af ${filter}`;
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

    /**
     * VideoAudioTrack[] に含まれる実際の音声 ES 数を数える。
     * デュアルモノラルは main/sub の 2 件へ展開されるが、同じ streamIndex の 1 ES として数える。
     * @param tracks: apid.VideoAudioTrack[] 音声トラック一覧
     * @return number
     */
    export const getAudioStreamCount = (tracks: apid.VideoAudioTrack[]): number => {
        const dualMonoStreamIndexes = new Set<number>();
        let independentStreamCount = 0;

        for (const track of tracks) {
            if (track.isDualMono === true && typeof track.streamIndex === 'number') {
                dualMonoStreamIndexes.add(track.streamIndex);
            } else if (track.isDualMono !== true) {
                independentStreamCount++;
            }
        }

        return independentStreamCount + dualMonoStreamIndexes.size;
    };

    /**
     * 選択した音声 ES と主音声の map を組み立てる。
     * 選択 ES が途中区間の PMT に無い場合、optional map は無視されて主音声だけが残る。
     * @param streamIndex: number 音声 ES の相対インデックス
     * @param includeVideo: boolean 映像 map も含めるか
     * @return string
     */
    const buildSelectedAudioMap = (
        streamIndex: number,
        includeVideo: boolean,
        canSwitchAudioInStream: boolean = false,
    ): string => {
        const selected = `-map "0:a:${streamIndex}?"`;
        // index 0 は重複 map しない。切替可能な経路は HLS の audio0/audio1 の役割を
        // 主音声/副音声へ一致させるため主音声を先にする。それ以外は selected を先にし、
        // 選択 ES が途中区間の PMT に無い場合のフォールバックとして主音声を後ろに置く。
        const maps =
            streamIndex === 0
                ? [selected]
                : canSwitchAudioInStream
                  ? ['-map "0:a:0?"', selected]
                  : [selected, '-map "0:a:0?"'];

        return `${includeVideo ? '-map 0:v:0 ' : ''}${maps.join(' ')}`;
    };
}

export default AudioTrackUtil;
