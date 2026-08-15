import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import { resolveFeatureFlags } from '../../FeatureFlags';
import IConfigFile, { StreamProfile } from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import IStreamProfileManageModel from '../../stream/IStreamProfileManageModel';
import IConfigApiModel from './IConfigApiModel';

@injectable()
export default class ConfigApiModel implements IConfigApiModel {
    private configuration: IConfiguration;
    private ipc: IIPCClient;
    private streamProfileManageModel: IStreamProfileManageModel;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IStreamProfileManageModel') streamProfileManageModel: IStreamProfileManageModel,
    ) {
        this.configuration = configuration;
        this.ipc = ipc;
        this.streamProfileManageModel = streamProfileManageModel;
    }

    /**
     * サーバ内部の StreamProfile (cmd を含む) をクライアント公開用の形式 (cmd を除いたもの) へ変換する
     * @param profile: StreamProfile
     * @return apid.ClientStreamProfile
     */
    private toClientStreamProfile(profile: StreamProfile): apid.ClientStreamProfile {
        const result: apid.ClientStreamProfile = {
            id: profile.id,
            name: profile.name,
            container: profile.container,
        };

        if (typeof profile.video !== 'undefined') {
            result.video = profile.video;
        }
        if (typeof profile.audio !== 'undefined') {
            result.audio = profile.audio;
        }
        if (typeof profile.isUnconverted !== 'undefined') {
            result.isUnconverted = profile.isUnconverted;
        }

        return result;
    }

    /**
     * サーバ内部のエンコードプリセット設定をクライアント公開用の形式 (cmd を除いたもの) へ変換する
     * @param encode: IConfigFile['encode'][number]
     * @return apid.ClientEncodePreset
     */
    private toClientEncodePreset(encode: IConfigFile['encode'][number]): apid.ClientEncodePreset {
        const result: apid.ClientEncodePreset = {
            id: typeof encode.id === 'undefined' ? encode.name : encode.id,
            name: encode.name,
        };

        if (typeof encode.video !== 'undefined') {
            result.video = encode.video;
        }
        if (typeof encode.audio !== 'undefined') {
            result.audio = encode.audio;
        }

        return result;
    }

    /**
     * EPGStation へ直接アクセスされているか (リバースプロキシを挟んでいないか) を判定する。
     *
     * 同じサーバーが LAN 直アクセスとプロキシ経由の両方で使われることがあるため、
     * socket.io の専用ポートを教えてよいかは接続ごとに判断する必要がある。
     * プロキシ経由の場合、専用ポートは外へ公開されていないのが普通なので、
     * ポートを教えず「アクセス中のオリジンへ繋げ」と返す
     * @param isSecure: boolean https アクセスか?
     * @param accessPort: number | null クライアントがアクセスに使ったポート
     * @return boolean 判別できない場合は直接アクセス扱い (従来の挙動) にする
     */
    private isDirectAccess(isSecure: boolean, accessPort: number | null): boolean {
        if (accessPort === null) {
            return true;
        }

        return accessPort === this.resolveListenSetting(isSecure).listenPort;
    }

    /**
     * アクセス経路に対応する待ち受け設定 (Web API のポートと socket.io の専用ポート) を返す。
     *
     * https でアクセスされていても https 設定が無い場合がある。
     * リバースプロキシが TLS を終端し、EPGStation へは http で転送している構成で、
     * この場合は http 側の設定が実際の待ち受けになる
     * @param isSecure: boolean https アクセスか?
     * @return { listenPort: number; dedicatedPort: number | null }
     */
    private resolveListenSetting(isSecure: boolean): { listenPort: number; dedicatedPort: number | null } {
        const config = this.configuration.getConfig();
        const useHttps = isSecure === true ? typeof config.https !== 'undefined' : typeof config.port === 'undefined';

        if (useHttps === true) {
            if (typeof config.https === 'undefined') {
                throw new Error('httpsConfigError');
            }

            return {
                listenPort: config.https.port,
                dedicatedPort: typeof config.https.socketioPort === 'undefined' ? null : config.https.socketioPort,
            };
        }

        if (typeof config.port === 'undefined') {
            throw new Error('httpConfigError');
        }

        return {
            listenPort: config.port,
            dedicatedPort: typeof config.socketioPort === 'undefined' ? null : config.socketioPort,
        };
    }

    /**
     * コンフィグ設定を返す
     * @param isSecure: boolean https アクセスか?
     * @param accessPort?: number | null クライアントがアクセスに使ったポート (判別できない場合は null)
     */
    public async getConfig(isSecure: boolean, accessPort: number | null = null): Promise<apid.Config> {
        const config = this.configuration.getConfig();

        const result: apid.Config = <any>{};

        // socket.io ポート設定
        // 専用ポートの指定が無い場合は Web API と同じ待ち受けを共有しているため、
        // クライアントには「接続先を組み立てず、アクセス中のオリジンへそのまま繋げばよい」と伝える
        // (リバースプロキシ経由でポートが変換されていると、ここで返すポートでは接続できないため)
        const listenSetting = this.resolveListenSetting(isSecure);
        const dedicatedPort =
            typeof config.clientSocketioPort !== 'undefined' ? config.clientSocketioPort : listenSetting.dedicatedPort;
        result.socketIOPort = dedicatedPort === null ? listenSetting.listenPort : dedicatedPort;
        result.useDedicatedSocketIOPort = dedicatedPort !== null && this.isDirectAccess(isSecure, accessPort) === true;

        result.recorded = config.recorded.map(r => {
            return r.name;
        });

        result.encode = config.encode.map(e => {
            return e.name;
        });

        // id ベースのエンコードプリセット情報 (新形式)。encode と併存させる
        if (config.encode.length > 0) {
            result.encodePresets = config.encode.map(e => this.toClientEncodePreset(e));
        }

        result.urlscheme = {
            m2ts: {
                ios: config.urlscheme.m2ts.ios,
                android: config.urlscheme.m2ts.android,
                mac: config.urlscheme.m2ts.mac,
                win: config.urlscheme.m2ts.win,
            },
            video: {
                ios: config.urlscheme.video.ios,
                android: config.urlscheme.video.android,
                mac: config.urlscheme.video.mac,
                win: config.urlscheme.video.win,
            },
            download: {
                ios: config.urlscheme.download.ios,
                android: config.urlscheme.download.android,
                mac: config.urlscheme.download.mac,
                win: config.urlscheme.download.win,
            },
        };

        result.broadcast = await this.ipc.reserveation.getBroadcastStatus();

        // 新旧どちらの形式でも配信プリセットが 1 件以上あれば有効とする
        const liveProfiles = this.streamProfileManageModel.getLiveProfiles();
        const recordedTsProfiles = this.streamProfileManageModel.getRecordedProfiles('ts');
        const recordedEncodedProfiles = this.streamProfileManageModel.getRecordedProfiles('encoded');
        result.isEnableTSLiveStream = liveProfiles.length > 0;
        result.isEnableTSRecordedStream = recordedTsProfiles.length > 0;
        result.isEnableEncodedRecordedStream = recordedEncodedProfiles.length > 0;

        // id ベースの配信プリセット情報 (新形式)。streamConfig と併存させる
        if (liveProfiles.length > 0 || recordedTsProfiles.length > 0 || recordedEncodedProfiles.length > 0) {
            result.streamProfiles = {};
            if (liveProfiles.length > 0) {
                result.streamProfiles.live = liveProfiles.map(p => this.toClientStreamProfile(p));
            }
            if (recordedTsProfiles.length > 0 || recordedEncodedProfiles.length > 0) {
                result.streamProfiles.recorded = {};
                if (recordedTsProfiles.length > 0) {
                    result.streamProfiles.recorded.ts = recordedTsProfiles.map(p => this.toClientStreamProfile(p));
                }
                if (recordedEncodedProfiles.length > 0) {
                    result.streamProfiles.recorded.encoded = recordedEncodedProfiles.map(p =>
                        this.toClientStreamProfile(p),
                    );
                }
            }
        }

        if (typeof config.stream !== 'undefined') {
            result.streamConfig = {};

            // live stream
            if (typeof config.stream.live !== 'undefined') {
                result.streamConfig.live = {};
                if (typeof config.stream.live.ts !== 'undefined') {
                    result.streamConfig.live.ts = {};

                    if (typeof config.stream.live.ts.m2ts !== 'undefined') {
                        result.streamConfig.live.ts.m2ts = config.stream.live.ts.m2ts.map(c => {
                            return {
                                name: c.name,
                                isUnconverted: typeof c.cmd === 'undefined',
                            };
                        });
                    }
                    if (typeof config.stream.live.ts.m2tsll !== 'undefined') {
                        result.streamConfig.live.ts.m2tsll = config.stream.live.ts.m2tsll.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.live.ts.webm !== 'undefined') {
                        result.streamConfig.live.ts.webm = config.stream.live.ts.webm.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.live.ts.mp4 !== 'undefined') {
                        result.streamConfig.live.ts.mp4 = config.stream.live.ts.mp4.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.live.ts.hls !== 'undefined') {
                        result.streamConfig.live.ts.hls = config.stream.live.ts.hls.map(c => {
                            return c.name;
                        });
                    }
                }
            }

            // recorded stream
            if (typeof config.stream.recorded !== 'undefined') {
                result.streamConfig.recorded = {};
                // ts
                if (typeof config.stream.recorded.ts !== 'undefined') {
                    result.streamConfig.recorded.ts = {};
                    if (typeof config.stream.recorded.ts.webm !== 'undefined') {
                        result.streamConfig.recorded.ts.webm = config.stream.recorded.ts.webm.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.ts.mp4 !== 'undefined') {
                        result.streamConfig.recorded.ts.mp4 = config.stream.recorded.ts.mp4.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.ts.hls !== 'undefined') {
                        result.streamConfig.recorded.ts.hls = config.stream.recorded.ts.hls.map(c => {
                            return c.name;
                        });
                    }
                }

                // encoded
                if (typeof config.stream.recorded.encoded !== 'undefined') {
                    result.streamConfig.recorded.encoded = {};
                    if (typeof config.stream.recorded.encoded.webm !== 'undefined') {
                        result.streamConfig.recorded.encoded.webm = config.stream.recorded.encoded.webm.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.encoded.mp4 !== 'undefined') {
                        result.streamConfig.recorded.encoded.mp4 = config.stream.recorded.encoded.mp4.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.encoded.hls !== 'undefined') {
                        result.streamConfig.recorded.encoded.hls = config.stream.recorded.encoded.hls.map(c => {
                            return c.name;
                        });
                    }
                }
            }
        }

        if (typeof config.kodiHosts !== 'undefined') {
            result.kodiHosts = config.kodiHosts.map(k => {
                return k.name;
            });
        }

        // 段階導入用機能フラグ。クライアントはこれを見て機能の表示可否を判断する
        result.featureFlags = resolveFeatureFlags(config.featureFlags);

        // 外部録画ファイル取り込みが許可されたディレクトリ名一覧
        if (typeof config.importDirs !== 'undefined' && config.importDirs.length > 0) {
            result.importDirs = config.importDirs.map(d => d.name);
        }

        return result;
    }
}
