import { inject, injectable } from 'inversify';
import { StreamAudioParam, StreamContainer, StreamingCmd, StreamProfile, StreamVideoParam } from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import IStreamProfileManageModel, { StreamProfileKind } from './IStreamProfileManageModel';

// ffmpeg コマンド生成時の対象スコープ (live / recordedTs は pipe 入力、recordedEncoded はファイル入力)
type ProfileScope = 'live' | 'recordedTs' | 'recordedEncoded';

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

    constructor(@inject('IConfiguration') configuration: IConfiguration) {
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
     * - tsreadex 経由 (音声が主音声・副音声の 2 ES に分離済み): 映像・音声は %AUDIOMAP%、字幕は
     *   `-map "0:s?"` のみ。ID3 timed metadata (ARIB 字幕) は tsreadex が PID を落とすため
     *   出力側 (LiveStreamBaseModel) で付け直す
     * - tsreadex 無し: 映像・音声・字幕を個別に map し、ID3 timed metadata (PID 0x1FFE、入力側で
     *   arib-subtitle-timedmetadater が挿入済み) だけを `-map "0:i:0x1ffe?"` で明示的に拾う
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

        const videoCodec = video?.codec ?? (container === 'webm' ? 'libvpx-vp9' : 'libx264');
        const videoBitrate = `${typeof video?.bitrate === 'number' ? video.bitrate : 3000}k`;
        const audioCodec = audio?.codec ?? (container === 'webm' ? 'libvorbis' : 'aac');
        const audioBitrate = `${typeof audio?.bitrate === 'number' ? audio.bitrate : 192}k`;

        const scaleFilter = this.buildScaleFilter(video);
        // recordedEncoded (ソースがファイル) は既に非インターレースとして扱い yadif を付与しない
        const vfParts = [isEncodedSource ? null : 'yadif', scaleFilter].filter((v): v is string => v !== null);
        const vf = vfParts.length > 0 ? ` -vf ${vfParts.join(',')}` : '';

        const input = isEncodedSource ? '-ss %SS% -i %INPUT%' : '-i pipe:0';
        const realtime = isLive ? '-re ' : '';

        // m2tsll は `-map 0` / `-map "0:d?"` を使わない (文字スーパーで muxer が止まる。上のコメント参照)。
        // tsreadex 経由なら音声は %AUDIOMAP% で選び、字幕以外は map しない (ID3 は出力側で付け直す)。
        // tsreadex 無しなら映像・音声・字幕に加え、入力側で挿入済みの ID3 timed metadata (PID 0x1FFE) だけを
        // ピンポイントで拾う (文字スーパーを含む `0:d?` の一括 map は使わない)
        const m2tsllMap =
            useTsreadex === true
                ? '%AUDIOMAP% -map "0:s?"'
                : '-map 0:v:0 -map 0:a -map "0:s?" -map "0:i:0x1ffe?"';
        const m2tsllStreamCopy = useTsreadex === true ? '-c:s copy' : '-c:s copy -c:d copy';
        // tsreadex 済みの入力は PAT/PMT とストリーム構造が正規化されているため解析待ちを短くする。
        // 実測 (同一放送波、最初の 300KB 出力まで): 500000/500000 は 3.9 秒、
        // 200000/200000 は 3.3 秒、0/100000 は 2.8 秒だった。0 は放送・チューナー実装によって
        // PMT 検出前に走り出す危険があるため採用せず、200000/200000 を使う。
        // tsreadex を通さない場合は放送波の構造を直接解析する必要があるため従来値を維持する。
        const m2tsllInputAnalysis =
            useTsreadex === true
                ? '-analyzeduration 200000 -probesize 200000'
                : '-analyzeduration 500000 -probesize 500000';

        switch (container) {
            case 'm2tsll':
                return (
                    `%FFMPEG% %DUALMONOMODE% -f mpegts ${m2tsllInputAnalysis} -fflags nobuffer ${input} ` +
                    `${m2tsllMap} ${m2tsllStreamCopy} -flags low_delay ` +
                    // TS は PAT/PMT を短周期で送るため probe を 500KB に制限し、初回映像待ちを短くする。
                    `-ignore_unknown -max_delay 250000 -max_interleave_delta 1 -threads 0 ` +
                    `-c:a ${audioCodec} -ar 48000 -b:a ${audioBitrate} -ac 2 %AUDIOFILTER% -c:v ${videoCodec} -flags +cgop${vf} ` +
                    `-b:v ${videoBitrate} -preset veryfast -y -f mpegts pipe:1`
                );
            case 'webm':
                return (
                    `%FFMPEG% ${realtime}%DUALMONOMODE% ${input} -sn -threads 3 %AUDIOMAP% -c:a ${audioCodec} -ar 48000 ` +
                    `-b:a ${audioBitrate} -ac 2 %AUDIOFILTER% -c:v ${videoCodec}${vf} -b:v ${videoBitrate} -deadline realtime -speed 4 ` +
                    `-cpu-used -8 -y -f webm pipe:1`
                );
            case 'mp4':
                return (
                    `%FFMPEG% ${realtime}%DUALMONOMODE% ${input} -sn -threads 0 %AUDIOMAP% -c:a ${audioCodec} -ar 48000 ` +
                    `-b:a ${audioBitrate} -ac 2 %AUDIOFILTER% -c:v ${videoCodec}${vf} -b:v ${videoBitrate} -profile:v baseline -preset veryfast ` +
                    `-tune fastdecode,zerolatency -movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4 pipe:1`
                );
            case 'hls':
                return (
                    `%FFMPEG% ${realtime}%DUALMONOMODE% -fflags nobuffer ${input} -sn -threads 0 ` +
                    `%AUDIOMAP% -c:a ${audioCodec} -ar 48000 -b:a ${audioBitrate} -ac 2 %AUDIOFILTER% ` +
                    `-c:v ${videoCodec}${vf} -b:v ${videoBitrate} -preset veryfast -flags +cgop ` +
                    `-g 15 -keyint_min 15 -sc_threshold 0 -movflags empty_moov+default_base_moof+frag_keyframe -y -f mp4 pipe:1`
                );
            case 'm2ts':
            default:
                return (
                    `%FFMPEG% ${realtime}%DUALMONOMODE% ${input} -sn -threads 0 %AUDIOMAP% -c:a ${audioCodec} -ar 48000 ` +
                    `-b:a ${audioBitrate} -ac 2 %AUDIOFILTER% -c:v ${videoCodec}${vf} -b:v ${videoBitrate} -preset veryfast -y -f mpegts pipe:1`
                );
        }
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
