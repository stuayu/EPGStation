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
export default class StreamProfileManageModel implements IStreamProfileManageModel {
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
            cmd: this.buildCmd(scope, profile.container, profile.video, profile.audio),
        };
    }

    /**
     * container / video / audio から ffmpeg コマンドを組み立てる
     * config/config.yml.template に記載の実コマンドの書式・プレースホルダ規約 (%FFMPEG% %INPUT% %OUTPUT% %SS% %streamFileDir% %streamNum%) を踏襲する
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

        switch (container) {
            case 'm2tsll':
                return (
                    `%FFMPEG% -dual_mono_mode main -f mpegts -analyzeduration 500000 ${input} -map 0 -c:s copy -c:d copy ` +
                    `-ignore_unknown -fflags nobuffer -flags low_delay -max_delay 250000 -max_interleave_delta 1 -threads 0 ` +
                    `-c:a ${audioCodec} -ar 48000 -b:a ${audioBitrate} -ac 2 -c:v ${videoCodec} -flags +cgop${vf} ` +
                    `-b:v ${videoBitrate} -preset veryfast -y -f mpegts pipe:1`
                );
            case 'webm':
                return (
                    `%FFMPEG% ${realtime}-dual_mono_mode main ${input} -sn -threads 3 -c:a ${audioCodec} -ar 48000 ` +
                    `-b:a ${audioBitrate} -ac 2 -c:v ${videoCodec}${vf} -b:v ${videoBitrate} -deadline realtime -speed 4 ` +
                    `-cpu-used -8 -y -f webm pipe:1`
                );
            case 'mp4':
                return (
                    `%FFMPEG% ${realtime}-dual_mono_mode main ${input} -sn -threads 0 -c:a ${audioCodec} -ar 48000 ` +
                    `-b:a ${audioBitrate} -ac 2 -c:v ${videoCodec}${vf} -b:v ${videoBitrate} -profile:v baseline -preset veryfast ` +
                    `-tune fastdecode,zerolatency -movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4 pipe:1`
                );
            case 'hls':
                return (
                    `%FFMPEG% ${realtime}-dual_mono_mode main ${input} -sn -map 0 -threads 0 -ignore_unknown ` +
                    `-max_muxing_queue_size 1024 -f hls -hls_time 3 -hls_list_size ${isLive ? 17 : 0} -hls_allow_cache 1 ` +
                    `-hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts -hls_flags delete_segments ` +
                    `-c:a ${audioCodec} -ar 48000 -b:a ${audioBitrate} -ac 2 -c:v ${videoCodec}${vf} -b:v ${videoBitrate} ` +
                    `-preset veryfast -flags +loop-global_header %OUTPUT%`
                );
            case 'm2ts':
            default:
                return (
                    `%FFMPEG% ${realtime}-dual_mono_mode main ${input} -sn -threads 0 -c:a ${audioCodec} -ar 48000 ` +
                    `-b:a ${audioBitrate} -ac 2 -c:v ${videoCodec}${vf} -b:v ${videoBitrate} -preset veryfast -y -f mpegts pipe:1`
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
