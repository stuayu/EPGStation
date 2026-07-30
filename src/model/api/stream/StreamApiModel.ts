import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import { isDurationUndefined } from '../../../util/ProgramDuration';
import { StreamContainer, StreamProfile } from '../../IConfigFile';
import IChannelDB from '../../db/IChannelDB';
import IProgramDB from '../../db/IProgramDB';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import { LiveHLSStreamModelProvider, LiveStreamModelProvider } from '../../service/stream/base/ILiveStreamBaseModel';
import {
    RecordedHLSStreamModelProvider,
    RecordedStreamModelProvider,
} from '../../service/stream/base/IRecordedStreamBaseModel';
import IStreamManageModel from '../../service/stream/manager/IStreamManageModel';
import IStreamProfileManageModel, { StreamProfileKind } from '../../stream/IStreamProfileManageModel';
import IApiUtil from '../IApiUtil';
import IPlayList from '../IPlayList';
import IStreamApiModel, { StreamResponse } from './IStreamApiModel';

interface RecordedStreamConfig {
    cmd: string;
    displayMode: number;
}

// 旧形式 ?mode=N のみが指定された場合、そのまま stream.setOption() の第二引数 (表示用 mode) として利用する
// profile が指定された場合はプロファイルの並び順を表示用 mode として代用する
interface ResolvedStreamOption {
    profile: StreamProfile;
    displayMode: number;
}

@injectable()
export default class StreamApiModel implements IStreamApiModel {
    private liveStreamProvider: LiveStreamModelProvider;
    private liveHLSStreamProvider: LiveHLSStreamModelProvider;
    private recordedStreamProvider: RecordedStreamModelProvider;
    private recordedHLSStreamProvider: RecordedHLSStreamModelProvider;
    private streamManageModel: IStreamManageModel;
    private streamProfileManageModel: IStreamProfileManageModel;
    private programDB: IProgramDB;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private channelDB: IChannelDB;
    private apiUtil: IApiUtil;

    constructor(
        @inject('LiveStreamModelProvider') liveStreamProvider: LiveStreamModelProvider,
        @inject('LiveHLSStreamModelProvider') liveHLSStreamProvider: LiveHLSStreamModelProvider,
        @inject('RecordedStreamModelProvider') recordedStreamProvider: RecordedStreamModelProvider,
        @inject('RecordedHLSStreamModelProvider') recordedHLSStreamProvider: RecordedHLSStreamModelProvider,
        @inject('IStreamManageModel') streamManageModel: IStreamManageModel,
        @inject('IStreamProfileManageModel') streamProfileManageModel: IStreamProfileManageModel,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IApiUtil') apiUtil: IApiUtil,
    ) {
        this.liveStreamProvider = liveStreamProvider;
        this.liveHLSStreamProvider = liveHLSStreamProvider;
        this.recordedStreamProvider = recordedStreamProvider;
        this.recordedHLSStreamProvider = recordedHLSStreamProvider;
        this.streamManageModel = streamManageModel;
        this.streamProfileManageModel = streamProfileManageModel;
        this.programDB = programDB;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.channelDB = channelDB;
        this.apiUtil = apiUtil;
    }

    /**
     * m2ts 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startLiveM2TsStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        const resolved = this.resolveLiveProfile('m2ts', option);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: resolved.profile.cmd,
            },
            resolved.displayMode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * m2ts Low Latency (mpegts.js 用) 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startLiveM2TsLLStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        const resolved = this.resolveLiveProfile('m2tsll', option);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: resolved.profile.cmd,
            },
            resolved.displayMode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * webm 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startLiveWebmStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        const resolved = this.resolveLiveProfile('webm', option);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: resolved.profile.cmd,
            },
            resolved.displayMode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * mp4 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startMp4Stream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        const resolved = this.resolveLiveProfile('mp4', option);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: resolved.profile.cmd,
            },
            resolved.displayMode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * HLS 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<apid.StreamId>
     */
    public async startLiveHLSStream(option: apid.LiveStreamOption): Promise<apid.StreamId> {
        const resolved = this.resolveLiveProfile('hls', option);

        // stream 生成
        const stream = await this.liveHLSStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: resolved.profile.cmd,
            },
            resolved.displayMode,
        );

        // manager に登録
        return await this.streamManageModel.start(stream);
    }

    /**
     * ライブ配信の配信プリセットを解決する
     * option.profile (新形式 id) が指定されていればそれを使い、無ければ option.mode (旧形式 index) を解決する
     * @param container: StreamContainer
     * @param option: apid.LiveStreamOption
     * @return ResolvedStreamOption
     */
    private resolveLiveProfile(container: StreamContainer, option: apid.LiveStreamOption): ResolvedStreamOption {
        return this.resolveProfile('live', container, option);
    }

    /**
     * option (mode / profile) から配信プリセットを解決する
     * profile が指定されていればそれを優先し、無ければ mode を旧形式 index として解決する
     * どちらも解決できない場合は例外を投げる
     * @param kind: StreamProfileKind
     * @param container: StreamContainer
     * @param option: { mode?: number; profile?: string }
     * @return ResolvedStreamOption
     */
    private resolveProfile(
        kind: StreamProfileKind,
        container: StreamContainer,
        option: { mode?: number; profile?: string },
    ): ResolvedStreamOption {
        let profile: StreamProfile | null = null;

        if (typeof option.profile !== 'undefined') {
            profile = this.streamProfileManageModel.getProfile(option.profile);
        } else if (typeof option.mode === 'number') {
            profile = this.streamProfileManageModel.resolveLegacyMode(kind, container, option.mode);
        }

        if (profile === null) {
            throw new Error('ConfigIsUndefined');
        }

        // 表示用 mode: クライアントが数値 mode を指定した場合はそのまま使用し、
        // profile 指定の場合はコンテナ内でのプロファイルの並び順を代用する
        const displayMode =
            typeof option.mode === 'number' ? option.mode : this.getProfileIndexInContainer(kind, container, profile);

        return {
            profile: profile,
            displayMode: displayMode,
        };
    }

    /**
     * 指定したプロファイルが同一 container 内で何番目か (旧形式 mode 相当) を返す
     * @param kind: StreamProfileKind
     * @param container: StreamContainer
     * @param profile: StreamProfile
     * @return number
     */
    private getProfileIndexInContainer(
        kind: StreamProfileKind,
        container: StreamContainer,
        profile: StreamProfile,
    ): number {
        const profiles = (
            kind === 'live'
                ? this.streamProfileManageModel.getLiveProfiles()
                : this.streamProfileManageModel.getRecordedProfiles(kind === 'recordedTs' ? 'ts' : 'encoded')
        ).filter(p => p.container === container);

        const index = profiles.findIndex(p => p.id === profile.id);

        return index === -1 ? 0 : index;
    }

    /**
     * WebM 形式の Recorded streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startRecordedWebMStream(option: apid.RecordedStreanOption): Promise<StreamResponse> {
        const resolved = await this.getRecordedVideoConfig('webm', option);

        // stream 生成
        const stream = await this.recordedStreamProvider();
        stream.setOption(
            {
                videoFileId: option.videoFileId,
                playPosition: option.playPosition,
                cmd: resolved.cmd,
            },
            resolved.displayMode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * WebM 形式の Recorded streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startRecordedMp4Stream(option: apid.RecordedStreanOption): Promise<StreamResponse> {
        const resolved = await this.getRecordedVideoConfig('mp4', option);

        // stream 生成
        const stream = await this.recordedStreamProvider();
        stream.setOption(
            {
                videoFileId: option.videoFileId,
                playPosition: option.playPosition,
                cmd: resolved.cmd,
            },
            resolved.displayMode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * HLS 形式の Recorded streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<apid.StreamId>
     */
    public async startRecordedHLSStream(option: apid.RecordedStreanOption): Promise<apid.StreamId> {
        const resolved = await this.getRecordedVideoConfig('hls', option);

        // stream 生成
        const stream = await this.recordedHLSStreamProvider();
        stream.setOption(
            {
                videoFileId: option.videoFileId,
                playPosition: option.playPosition,
                cmd: resolved.cmd,
            },
            resolved.displayMode,
        );

        // manager に登録
        return await this.streamManageModel.start(stream);
    }

    /**
     * 録画済みビデオの配信プリセットを解決し stream コマンドを取り出す
     * ソースがエンコード済みか (recorded.encoded) 元 TS か (recorded.ts) で参照先を切り替える
     * @param type: 'webm' | 'mp4' | 'hls'
     * @param option apid.RecordedStreanOption
     * @return Promise<RecordedStreamConfig>
     */
    private async getRecordedVideoConfig(
        type: 'webm' | 'mp4' | 'hls',
        option: apid.RecordedStreanOption,
    ): Promise<RecordedStreamConfig> {
        const isEncodedVideo = await this.isEncodedVideo(option.videoFileId);
        const kind: StreamProfileKind = isEncodedVideo === true ? 'recordedEncoded' : 'recordedTs';

        const resolved = this.resolveProfile(kind, type, option);

        if (typeof resolved.profile.cmd === 'undefined') {
            throw new Error('CmdIsUndefined');
        }

        return {
            cmd: resolved.profile.cmd,
            displayMode: resolved.displayMode,
        };
    }

    /**
     * 指定された video file が エンコードされたものなのか返す
     * @param videoFileId: apid.VideoFileId
     * @return Promise<boolean>
     */
    private async isEncodedVideo(videoFileId: apid.VideoFileId): Promise<boolean> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsNotFound');
        }

        return video.type === 'encoded';
    }

    /**
     * 指定した m2ts 形式のライブストリーミングの m3u8 形式のプレイリスト文字列を取得する
     * @param host: string host
     * @param isSecure boolean https 通信か
     * @param option: apid.LiveStreamOption
     * @return Promise<IPlayList | null>
     */
    public async getLiveM2TsStreamM3u8(
        host: string,
        isSecure: boolean,
        option: apid.LiveStreamOption,
    ): Promise<IPlayList | null> {
        const channel = await this.channelDB.findId(option.channelId);
        if (channel === null) {
            return null;
        }

        const query =
            typeof option.profile !== 'undefined'
                ? `profile=${encodeURIComponent(option.profile)}`
                : `mode=${option.mode}`;

        return {
            name: encodeURIComponent(channel.name + '.m3u8'),
            playList: this.apiUtil.createM3U8PlayListStr({
                host: host,
                isSecure: isSecure,
                name: channel.name,
                duration: 0,
                baseUrl: `/api/streams/live/${option.channelId.toString(10)}/m2ts?${query}`,
            }),
        };
    }

    /**
     * 指定した stream id のストリームを停止
     * @param streamId: apid.StreamId
     * @param isForce?: boolean 強制的に停止させるか
     * @return Promise<void>
     */
    public async stop(streamId: apid.StreamId, isForce: boolean = false): Promise<void> {
        await this.streamManageModel.stop(streamId, isForce);
    }

    /**
     * すべてのストリームを停止
     * @return Promise<void>
     */
    public async stopAll(): Promise<void> {
        await this.streamManageModel.stopAll();
    }

    /**
     * 指定したストリームを停止しないように停止タイマー情報を更新させる
     * @param streamId: apid.StreamId
     */
    public keep(streamId: apid.StreamId): void {
        this.streamManageModel.keep(streamId);
    }

    /**
     * ストリーム情報を返す
     * @param isHalfWidth: boolean 半角文字で取得するか true なら半角文字
     * @return apid.StreamInfo
     */
    public async getStreamInfos(isHalfWidth: boolean): Promise<apid.StreamInfo> {
        const infos = this.streamManageModel.getStreamInfos();

        const items: (apid.LiveStreamInfoItem | apid.VideoFileStreamInfoItem)[] = [];
        const now = new Date().getTime();
        for (const info of infos) {
            if (info.info.type === 'LiveStream' || info.info.type === 'LiveHLS') {
                // ライブストリーミング
                const item: apid.LiveStreamInfoItem = {
                    streamId: info.streamId,
                    type: info.info.type,
                    mode: info.info.mode,
                    isEnable: info.info.isEnable,
                    channelId: info.info.channelId,
                    name: '',
                    startAt: 0,
                    endAt: 0,
                };
                const program = await this.programDB.findChannelIdAndTime(info.info.channelId, now);
                if (program !== null) {
                    item.name = isHalfWidth === true ? program.halfWidthName : program.name;
                    item.startAt = program.startAt;
                    item.endAt = program.endAt;
                    // 放送時間未定の番組は endAt が暫定値なので、その旨をクライアントへ伝える
                    item.isDurationUndefined = isDurationUndefined(program.duration);
                    if (program.description !== null && program.halfWidthDescription !== null) {
                        item.description = isHalfWidth === true ? program.halfWidthDescription : program.description;
                    }
                    if (program.extended !== null && program.halfWidthExtended !== null) {
                        item.extended = isHalfWidth === true ? program.halfWidthExtended : program.extended;
                    }
                    if (program.rawExtended !== null && program.rawHalfWidthExtended !== null) {
                        item.rawExtended =
                            isHalfWidth === true
                                ? JSON.parse(program.rawHalfWidthExtended)
                                : JSON.parse(program.rawExtended);
                    }
                }

                // 実況コメントの遅延補正用。TDT / TOT をまだ受信していない場合は付けない
                if (typeof info.info.broadcastTime !== 'undefined') {
                    item.broadcastTime = info.info.broadcastTime;
                }

                items.push(item);
            } else if (info.info.type === 'RecordedStream' || info.info.type === 'RecordedHLS') {
                // ビデオストリーミング
                const item: apid.VideoFileStreamInfoItem = {
                    streamId: info.streamId,
                    type: info.info.type,
                    mode: info.info.mode,
                    isEnable: info.info.isEnable,
                    channelId: 0,
                    name: '',
                    startAt: 0,
                    endAt: 0,
                    viodeFileId: info.info.videoFileId,
                    recordedId: 0,
                };

                const videoFile = await this.videoFileDB.findId(info.info.videoFileId);
                if (videoFile !== null) {
                    item.recordedId = videoFile.recordedId;
                    const recorded = await this.recordedDB.findId(videoFile.recordedId);
                    if (recorded !== null) {
                        item.channelId = recorded.channelId;
                        item.name = recorded.name;
                        item.startAt = recorded.startAt;
                        item.endAt = recorded.endAt;
                        if (recorded.description !== null && recorded.halfWidthDescription !== null) {
                            item.description =
                                isHalfWidth === true ? recorded.halfWidthDescription : recorded.description;
                        }
                        if (recorded.extended !== null && recorded.halfWidthExtended !== null) {
                            item.extended = isHalfWidth === true ? recorded.halfWidthExtended : recorded.extended;
                        }
                        if (recorded.rawExtended !== null && recorded.rawHalfWidthExtended !== null) {
                            item.rawExtended =
                                isHalfWidth === true
                                    ? JSON.parse(recorded.rawHalfWidthExtended)
                                    : JSON.parse(recorded.rawExtended);
                        }
                    }
                }

                items.push(item);
            } else {
                throw new Error('StreamInfoTypeError');
            }
        }

        return {
            items: items,
        };
    }
}
