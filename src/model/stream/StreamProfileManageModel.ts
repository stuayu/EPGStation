import { inject, injectable, optional } from 'inversify';
import { StreamAudioParam, StreamContainer, StreamingCmd, StreamProfile, StreamVideoParam } from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import { recordedStreamPacingArgs } from '../../util/RecordedStreamPacing';
import { DEINTERLACE_PLACEHOLDER } from '../../util/DeinterlaceUtil';
import IStreamProfileManageModel, { StreamProfileKind } from './IStreamProfileManageModel';
import IHardwareEncoderDetector from '../encoder/IHardwareEncoderDetector';
import { StreamEncoderCapability } from '../../util/StreamArgsUtil';
import ProcessUtil from '../../util/ProcessUtil';

// ffmpeg コマンド生成時の対象スコープ (live / recordedTs は pipe 入力、recordedEncoded はファイル入力)
type ProfileScope = 'live' | 'recordedTs' | 'recordedEncoded';

/**
 * ffmpeg の optional map specifier を実行方式に合わせて表記する。
 * シェル経由では `?` の glob 展開を防ぐため引用し、spawn 直起動では引用符を引数へ渡さない。
 */
const buildOptionalMap = (specifier: string, useShell: boolean): string =>
    `-map ${useShell === true ? `"${specifier}"` : specifier}`;

/**
 * StreamProfileManageModel
 * 配信プリセット設定 (config.yml の stream 項目) を id ベースの StreamProfile[] へ正規化して提供する
 *
 * - 新形式 (stream.profiles) と旧形式 (stream.live / stream.recorded の StreamingCmd[]) の両方に対応する
 * - 新形式と旧形式が両方存在するスコープ (live / recorded.ts / recorded.encoded 単位) では新形式を優先する
 * - 旧形式は配列の index から `{kind}-{container}-{index}` 形式の id を決定的に導出する
 * - 新形式で cmd が省略され、video/audio のいずれかが指定されている場合は container と video/audio から ffmpeg コマンドを組み立てる
 */
@injectable()
class StreamProfileManageModel implements IStreamProfileManageModel {
    private configuration: IConfiguration;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IHardwareEncoderDetector')
        @optional()
        private readonly hardwareEncoderDetector?: IHardwareEncoderDetector,
    ) {
        this.configuration = configuration;
    }

    /**
     * 指定した id の配信プリセットを取得する
     * @param id: string StreamProfile.id
     * @return StreamProfile | null
     */
    public getProfile(id: string): StreamProfile | null {
        const all = [
            ...this.getLiveProfiles(),
            ...this.getRecordedProfiles('ts'),
            ...this.getRecordedProfiles('encoded'),
        ];

        return all.find(profile => profile.id === id) ?? null;
    }

    /**
     * ライブ配信の配信プリセット一覧を返す
     * @return StreamProfile[]
     */
    public getLiveProfiles(): StreamProfile[] {
        const config = this.configuration.getConfig();
        const newProfiles = config.stream?.profiles?.live;
        if (typeof newProfiles !== 'undefined') {
            return newProfiles.map(profile => this.ensureCmd(profile, 'live'));
        }

        const ts = config.stream?.live?.ts;

        return [
            ...this.normalizeLegacyList(ts?.m2ts, 'live', 'm2ts'),
            ...this.normalizeLegacyList(ts?.m2tsll, 'live', 'm2tsll'),
            ...this.normalizeLegacyList(ts?.webm, 'live', 'webm'),
            ...this.normalizeLegacyList(ts?.mp4, 'live', 'mp4'),
            ...this.normalizeLegacyList(ts?.hls, 'live', 'hls'),
        ];
    }

    /**
     * 録画済み配信の配信プリセット一覧を返す
     * @param type: 'ts' | 'encoded'
     * @return StreamProfile[]
     */
    public getRecordedProfiles(type: 'ts' | 'encoded'): StreamProfile[] {
        const config = this.configuration.getConfig();
        const scope: ProfileScope = type === 'ts' ? 'recordedTs' : 'recordedEncoded';
        const idPrefix = type === 'ts' ? 'recorded-ts' : 'recorded-encoded';

        const newProfiles =
            type === 'ts' ? config.stream?.profiles?.recorded?.ts : config.stream?.profiles?.recorded?.encoded;
        if (typeof newProfiles !== 'undefined') {
            return newProfiles.map(profile => this.ensureCmd(profile, scope));
        }

        const legacy = type === 'ts' ? config.stream?.recorded?.ts : config.stream?.recorded?.encoded;

        return [
            ...this.normalizeLegacyList(legacy?.webm, idPrefix, 'webm'),
            ...this.normalizeLegacyList(legacy?.mp4, idPrefix, 'mp4'),
            ...this.normalizeLegacyList(legacy?.hls, idPrefix, 'hls'),
            ...this.normalizeLegacyList(legacy?.m2tsll, idPrefix, 'm2tsll'),
        ];
    }

    /**
     * 旧形式の `?mode=N` クエリを配信プリセットへ解決する
     * container で絞り込んだ配列に対して、旧形式時と同じ index 順で mode を解決する
     * @param kind: StreamProfileKind
     * @param container: StreamContainer
     * @param mode: number
     * @return StreamProfile | null
     */
    public resolveLegacyMode(kind: StreamProfileKind, container: StreamContainer, mode: number): StreamProfile | null {
        const profiles = (
            kind === 'live'
                ? this.getLiveProfiles()
                : this.getRecordedProfiles(kind === 'recordedTs' ? 'ts' : 'encoded')
        ).filter(profile => profile.container === container);

        return profiles[mode] ?? null;
    }

    /**
     * 旧形式の StreamingCmd[] を StreamProfile[] へ正規化する
     * @param list: StreamingCmd[] | undefined
     * @param idPrefix: string ('live' | 'recorded-ts' | 'recorded-encoded')
     * @param container: StreamContainer
     * @return StreamProfile[]
     */
    private normalizeLegacyList(
        list: StreamingCmd[] | undefined,
        idPrefix: string,
        container: StreamContainer,
    ): StreamProfile[] {
        if (typeof list === 'undefined') {
            return [];
        }

        return list.map((item, index) => {
            return {
                id: `${idPrefix}-${container}-${index}`,
                name: item.name,
                container: container,
                // 旧形式の name (例: "1080p") は自己申告のラベルに過ぎず信用できないため video/audio は推測しない
                cmd: item.cmd,
                isUnconverted: typeof item.cmd === 'undefined',
            };
        });
    }

    /**
     * 新形式の配信プリセットについて cmd が省略されている場合に補完する
     * video/audio がいずれも指定されていなければ無変換 (isUnconverted) として扱う
     * @param profile: StreamProfile
     * @param scope: ProfileScope
     * @return StreamProfile
     */
    private ensureCmd(profile: StreamProfile, scope: ProfileScope): StreamProfile {
        if (typeof profile.cmd !== 'undefined' || profile.isUnconverted === true) {
            return profile;
        }

        if (typeof profile.video === 'undefined' && typeof profile.audio === 'undefined') {
            return { ...profile, isUnconverted: true };
        }

        return {
            ...profile,
            cmd:
                this.buildTsreadexPrefix(scope) +
                this.buildCmd(scope, profile.container, profile.video, profile.audio, this.isTsreadexEnabled(scope)),
        };
    }

    /**
     * 生成コマンドの前段に置く tsreadex のパイプを組み立てる
     *
     * tsreadex は対象サービスの抽出・映像/音声 PID の固定・デュアルモノラルの主音声/副音声分離・
     * 欠落音声の補完を行う。放送側で音声構成が変わっても、以降は「映像 + 音声 2 本」の固定構造になる
     * (実測: 二か国語番組から通常番組へ切り替わっても音声 ES は 2 本のまま維持され、
     * 副音声は無音ではなく主音声と同じ内容になる。`-b 5` と `-b 7` で挙動の差は無かった)。
     *
     * **`config.tsreadex` が明示設定されているときだけ挟む**。tsreadex は同梱しておらず、
     * 実行ファイルが無い環境で無条件に挟むと配信が起動しなくなるため。
     * 録画ファイル入力 (recordedEncoded) は放送 TS ではないので対象外
     * @param scope: ProfileScope
     * @return string tsreadex を使わない場合は空文字列
     */
    private buildTsreadexPrefix(scope: ProfileScope): string {
        return this.isTsreadexEnabled(scope) === false ? '' : `${StreamProfileManageModel.TSREADEX_COMMAND} | `;
    }

    /**
     * 生成コマンドで tsreadex を使うか
     * @param scope: ProfileScope
     * @return boolean
     */
    private isTsreadexEnabled(scope: ProfileScope): boolean {
        return scope !== 'recordedEncoded' && typeof this.configuration.getConfig().tsreadex !== 'undefined';
    }

    /**
     * container / video / audio から ffmpeg コマンドを組み立てる
     * config/config.yml.template に記載の実コマンドの書式・プレースホルダ規約 (%FFMPEG% %INPUT% %OUTPUT% %SS% %streamFileDir% %streamNum%) を踏襲する
     *
     * 音声トラックの切り替え (主音声 / 副音声 / 音声 ES の指定) は %DUALMONOMODE% / %AUDIOMAP% / %AUDIOFILTER% を
     * 埋め込んでおき、配信直前に AudioTrackUtil.replacePlaceholders() で展開する。
     * `-dual_mono_mode main` を直接書くと副音声を選べなくなるので書かないこと。
     * `-map 0` を使う container (hls) は全 ES をそのまま通すため %AUDIOMAP% を入れない
     * (両方指定すると ES が二重に出力される)。
     *
     * **m2tsll は `-map 0` と `-map "0:d?"` (data ストリームの一括 map) を使わない**。
     * 相乗りサービスの文字スーパー (PID 0x138, ffmpeg 上は PTS の無い bin_data / private_stream_2) が
     * `-map "0:d?"` で拾われると、mpegts muxer がその PTS 無しストリームとのインターリーブ待ちで
     * 数フレームだけ書き出した後に完全に停止する (実測: ffmpeg 9.0.1、libx264 は 161 フレーム出力済みなのに
     * mux 済みは frame=5 のまま、5 秒間隔の字幕ダミーの周期でしか進まない)。`-map "0:d?"` を外すと
     * 実時間で正常に流れる (実測: 15 秒で 6.9MB / 402 フレーム)。
     * - tsreadex 経由 (音声が主音声・副音声の 2 ES に分離済み): 映像は固定 map、音声は %AUDIOSELECTMAP%、字幕は
     *   `-map "0:s?"` のみ。ID3 timed metadata (ARIB 字幕) は tsreadex が PID を落とすため
     *   出力側 (LiveStreamBaseModel) で付け直す
     * - tsreadex 無し: 映像・音声・字幕を個別に map する。ID3 timed metadata (PID 0x1FFE) は
     *   入力側へ map せず、TS 入力の m2tsll では出力側の `AribSubtitleTimedMetadataTransform` で付け直す
     *   (文字スーパーの bin_data を含む `0:d?` は使わない)
     * @param scope: ProfileScope
     * @param container: StreamContainer
     * @param video?: StreamVideoParam
     * @param audio?: StreamAudioParam
     * @return string
     */
    private buildCmd(
        scope: ProfileScope,
        container: StreamContainer,
        video?: StreamVideoParam,
        audio?: StreamAudioParam,
        useTsreadex: boolean = false,
    ): string {
        const isLive = scope === 'live';
        const isEncodedSource = scope === 'recordedEncoded';

        const requestedVideoCodec = video?.codec ?? (container === 'webm' ? 'libvpx-vp9' : 'libx264');
        const requestedCodec = /(?:hevc|h265|265|x265)/iu.test(requestedVideoCodec) ? 'hevc' : 'h264';
        const selectedEncoder =
            container === 'webm' ? undefined : this.hardwareEncoderDetector?.getStreamEncoder(requestedCodec);
        if (
            selectedEncoder !== undefined &&
            (selectedEncoder.kind === 'qsvencc' ||
                selectedEncoder.kind === 'nvencc' ||
                selectedEncoder.kind === 'vceencc')
        ) {
            return this.buildRigayaCmd(scope, container, video, audio, selectedEncoder);
        }
        const videoCodec = selectedEncoder?.ffmpegCodecs ?? requestedVideoCodec;
        const videoBitrate = `${typeof video?.bitrate === 'number' ? video.bitrate : 3000}k`;
        const audioCodec = audio?.codec ?? (container === 'webm' ? 'libvorbis' : 'aac');
        const audioBitrate = `${typeof audio?.bitrate === 'number' ? audio.bitrate : 192}k`;
        // H.264 の High/Main は 10bit 入力を受けられないため、8bit へ明示変換する。
        // HEVC 出力 (Main10 を含む) は pixel format を上書きしない。
        const h264PixelFormat = /264/u.test(videoCodec) ? ' -pix_fmt yuv420p' : '';

        const scaleFilter = this.buildScaleFilter(video);
        // 素材はプリセット生成時点では未確定。配信開始時に %DEINTERLACE% を解決する。
        // scale が無い場合もプレースホルダを残し、解決側で不要な -vf ごと除去する。
        const vfFilter = scaleFilter === null ? DEINTERLACE_PLACEHOLDER : `${DEINTERLACE_PLACEHOLDER},${scaleFilter}`;
        const vf = ` -vf ${vfFilter}`;

        const input = isEncodedSource ? '-ss %SS% -i %INPUT%' : '-i pipe:0';
        const realtime = isLive ? '-re ' : '';
        // 録画の非 HLS 入力は readrate で有限の先行速度に抑える。ライブと録画 HLS は別の速度制御を使う。
        const pacedInput = isLive || container === 'hls' ? input : `${recordedStreamPacingArgs()} ${input}`;

        // m2tsll は `-map 0` / `-map "0:d?"` を使わない (文字スーパーで muxer が止まる。上のコメント参照)。
        // 音声は %AUDIOSELECTMAP%、字幕は個別 map する。ID3 timed metadata は入力側へ map しない。
        // TS 入力では Recorded/LiveStreamBaseModel が ffmpeg の出力側へ挿入し直す。
        // (文字スーパーを含む `0:d?` の一括 map は使わない)
        const subtitleMap = buildOptionalMap('0:s?', useTsreadex);
        const m2tsllMap = `-map 0:v:0 %AUDIOSELECTMAP% ${subtitleMap}`;
        const m2tsllStreamCopy = '-c:s copy';
        // tsreadex 済みの入力は PAT/PMT とストリーム構造が正規化されているため解析待ちを短くする。
        // 実測 (同一放送波、最初の 300KB 出力まで): 500000/500000 は 3.9 秒、
        // 200000/200000 は 3.3 秒、0/100000 は 2.8 秒だった。0 は放送・チューナー実装によって
        // PMT 検出前に走り出す危険があるため採用せず、200000/200000 を使う。
        // tsreadex を通さない場合は放送波の構造を直接解析する必要があるため従来値を維持する。
        const m2tsllInputAnalysis =
            useTsreadex === true
                ? '-analyzeduration 200000 -probesize 200000'
                : '-analyzeduration 500000 -probesize 500000';
        const m2tsllInputFormat = isEncodedSource === true ? '' : '-f mpegts ';

        switch (container) {
            case 'm2tsll':
                return (
                    `%FFMPEG% %DUALMONOMODE% ${m2tsllInputFormat}${m2tsllInputAnalysis} -fflags nobuffer ${pacedInput} ` +
                    `${m2tsllMap} ${m2tsllStreamCopy} -flags low_delay ` +
                    // TS は PAT/PMT を短周期で送るため probe を 500KB に制限し、初回映像待ちを短くする。
                    `-ignore_unknown -max_delay 250000 -max_interleave_delta 1 -threads 0 ` +
                    `-c:a ${audioCodec} -ar 48000 -b:a ${audioBitrate} -ac 2 %AUDIOFILTER% -c:v ${videoCodec}${h264PixelFormat} -flags +cgop${vf} ` +
                    `-b:v ${videoBitrate} -preset veryfast -y -f mpegts pipe:1`
                );
            case 'webm':
                return (
                    `%FFMPEG% ${realtime}%DUALMONOMODE% ${pacedInput} -sn -threads 3 %AUDIOMAP% -c:a ${audioCodec} -ar 48000 ` +
                    `-b:a ${audioBitrate} -ac 2 %AUDIOFILTER% -c:v ${videoCodec}${vf} -b:v ${videoBitrate} -deadline realtime -speed 4 ` +
                    `-cpu-used -8 -y -f webm pipe:1`
                );
            case 'mp4':
                return (
                    `%FFMPEG% ${realtime}%DUALMONOMODE% ${pacedInput} -sn -threads 0 %AUDIOMAP% -c:a ${audioCodec} -ar 48000 ` +
                    `-b:a ${audioBitrate} -ac 2 %AUDIOFILTER% -c:v ${videoCodec}${h264PixelFormat}${vf} -b:v ${videoBitrate} -profile:v baseline -preset veryfast ` +
                    `-tune fastdecode,zerolatency -movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4 pipe:1`
                );
            case 'hls':
                return (
                    `%FFMPEG% ${realtime}%DUALMONOMODE% -fflags nobuffer ${input} -sn -threads 0 ` +
                    `%AUDIOMAP% -c:a ${audioCodec} -ar 48000 -b:a ${audioBitrate} -ac 2 %AUDIOFILTER% ` +
                    `-c:v ${videoCodec}${h264PixelFormat}${vf} -b:v ${videoBitrate} -preset veryfast -flags +cgop ` +
                    `-g 15 -keyint_min 15 -sc_threshold 0 -movflags empty_moov+default_base_moof+frag_keyframe -y -f mp4 pipe:1`
                );
            case 'm2ts':
            default:
                return (
                    `%FFMPEG% ${realtime}%DUALMONOMODE% ${pacedInput} -sn -threads 0 %AUDIOMAP% -c:a ${audioCodec} -ar 48000 ` +
                    `-b:a ${audioBitrate} -ac 2 %AUDIOFILTER% -c:v ${videoCodec}${h264PixelFormat}${vf} -b:v ${videoBitrate} -preset veryfast -y -f mpegts pipe:1`
                );
        }
    }

    /**
     * 検出済み rigaya エンコーダを使う自動生成コマンドを組み立てる。
     *
     * **tsreadex の前段はここでは付けない**。呼び出し元 (`fillGeneratedCmd()`) が
     * `buildTsreadexPrefix()` で必ず前置するため、ここでも付けると
     * `tsreadex | tsreadex | エンコーダ | ffmpeg` と二重になる (本番の実 cmd で発生していた)。
     */
    private buildRigayaCmd(
        scope: ProfileScope,
        container: StreamContainer,
        video: StreamVideoParam | undefined,
        audio: StreamAudioParam | undefined,
        encoder: StreamEncoderCapability,
    ): string {
        const isFileInput = scope === 'recordedEncoded';
        const codec = /(?:hevc|h265|265|x265)/iu.test(video?.codec ?? '') ? 'hevc' : 'h264';
        const height = video?.height ?? 1080;
        const videoBitrate = video?.bitrate ?? 3000;
        const audioCodec = audio?.codec ?? 'aac';
        const audioBitrate = audio?.bitrate ?? 192;
        const bin = ProcessUtil.quoteShellArg(encoder.command ?? 'QSVEncC');
        const rigayaKind = encoder.kind === 'nvencc' ? 'nvenc' : encoder.kind === 'vceencc' ? 'vce' : 'qsv';
        const quality =
            rigayaKind === 'nvenc' ? '--preset P3' : rigayaKind === 'vce' ? '--preset fast' : '--quality faster';
        const strictGop = rigayaKind === 'vce' ? '' : ' --strict-gop';
        const input = isFileInput ? '--seek %SS% -i %INPUT%' : '--input-format mpegts -i -';
        const sync = isFileInput ? ' --avsync forcecfr --fps 30000/1001' : '';
        const encoderCmd =
            `${bin} --avhw ${input} -c ${codec} --profile main --output-depth 8 ${quality} ` +
            `--vbr ${videoBitrate} --max-bitrate ${videoBitrate * 2} --gop-len 30${strictGop} --bframes 0 ` +
            `--output-res -2x${height}${sync} --audio-copy --output-format mpegts -o -`;
        const ffmpegInput = `%FFMPEG% %DUALMONOMODE% -f mpegts ${isFileInput ? '' : '-fflags nobuffer '}-i pipe:0`;
        const tag = codec === 'hevc' && (container === 'mp4' || container === 'hls') ? ' -tag:v hvc1' : '';
        const audioArgs =
            container === 'm2tsll'
                ? `-c:a ${audioCodec} -ar 48000 -b:a ${audioBitrate}k -ac 2 %AUDIOFILTER%`
                : `%AUDIOMAP% -c:a ${audioCodec} -ar 48000 -b:a ${audioBitrate}k -ac 2 %AUDIOFILTER%`;
        // **`-c:v copy` を落とさないこと**。rigaya 系がエンコードした映像をそのまま通すための指定で、
        // 無いと後段の ffmpeg が出力コンテナの既定コーデック (mpegts なら MPEG-2) で**再エンコードし直す**。
        // 実測 (本番のライブ m2tsll): QSVEncC が HEVC で出したのに配信 TS は mpeg2video になり、
        // mpegts.js が映像を demux できず「音声だけ再生される」状態になっていた
        const map =
            container === 'm2tsll'
                ? '-map 0:v:0 %AUDIOSELECTMAP% -map "0:s?" -c:v copy -c:s copy'
                : '-map 0:v:0 -c:v copy';
        const output =
            container === 'mp4' || container === 'hls'
                ? `${map}${tag} ${audioArgs} -movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1`
                : `${map}${tag} ${audioArgs} -f mpegts pipe:1`;
        return `${encoderCmd} | ${ffmpegInput} ${output}`;
    }

    /**
     * video の width / height から scale フィルタ文字列を組み立てる
     * @param video?: StreamVideoParam
     * @return string | null
     */
    private buildScaleFilter(video?: StreamVideoParam): string | null {
        if (typeof video === 'undefined') {
            return null;
        }

        const { width, height } = video;
        if (typeof width === 'undefined' && typeof height === 'undefined') {
            return null;
        }

        const w = typeof width === 'number' ? width : -2;
        const h = typeof height === 'number' ? height : -2;

        return `scale=${w}:${h}`;
    }
}

namespace StreamProfileManageModel {
    /**
     * 生成コマンドの前段に置く tsreadex の起動コマンド
     * -x 18: 不要な PID を除去 / -n -1: 先頭のサービスだけを抽出して PID を固定
     * -a 13: 第 1 音声の補完 + モノラルのステレオ化 + デュアルモノラル (ARIB STD-B32) の主音声/副音声分離
     * -b 7: 第 2 音声が無ければ**第 1 音声をコピー** + モノラルのステレオ化
     * -c 5 -u 5: ARIB 字幕・文字スーパーの PMT 項目を補完 + データが現れない場合に 5 秒ごとにダミーを挿入
     *
     * **`-c 1 -u 1` にしないこと**。字幕データが一度も現れないと ffmpeg が待ち続け、
     * エンコードが数フレームで止まる (実測: `-c 1` で frame=7 のまま進まず、配信が始まらない)。
     * `+4` のダミー挿入はこれを回避するためのもの (tsreadex の Readme に明記されている)。
     *
     * **`-b 5` (無音 AAC を挿入) にしないこと**。第 2 音声を選んだまま二か国語番組が終わる、
     * または EPG が二か国語と言っていても実際の AAC がデュアルモノラルでない場合に、
     * 副音声が完全な無音になる (実測: `-b 5` で副音声 -91.0dB、`-b 7` で主音声と同じ -28.4dB)。
     * 第 2 音声が実在する放送では `-b 5` と `-b 7` で挙動の差は無い (実測で確認済み)
     */
    export const TSREADEX_COMMAND = '%TSREADEX% -x 18 -n -1 -a 13 -b 7 -c 5 -u 5 -';
}

export default StreamProfileManageModel;
