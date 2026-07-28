import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import StreamSupportUtil from '../../util/StreamSupportUtil';
import UaUtil from '../..//util/UaUtil';
import IConfigApiModel from '../api/config/IConfigApiModel';
import IServerConfigModel from './IServerConfigModel';

@injectable()
export default class ServerConfigModel implements IServerConfigModel {
    private configApiModel: IConfigApiModel;
    private config: apid.Config | null = null;

    constructor(@inject('IConfigApiModel') configApiModel: IConfigApiModel) {
        this.configApiModel = configApiModel;
    }

    /**
     * config 情報取得
     * @return Promise<void>
     */
    public async fetchConfig(): Promise<void> {
        this.config = await this.configApiModel.getConfig();

        this.buildStreamConfigFromProfiles();
        this.setStreamingSettingForSafari();
    }

    /**
     * 新形式 (streamProfiles / id ベース) から旧形式の streamConfig を生成する
     * UI は streamConfig を参照して選択リストを構築するため、新形式のみ設定された
     * サーバでも動作するようにここで変換する。
     * サーバ側は streamProfiles が存在するスコープでは旧形式より優先し、旧形式の
     * `?mode=N` は「同じ container 内の index」で profiles へ解決されるため、
     * 表示リストも profiles 由来のもので上書きすることで選択と実際の配信内容の
     * ズレを防ぐ。
     */
    private buildStreamConfigFromProfiles(): void {
        if (this.config === null || typeof this.config.streamProfiles === 'undefined') {
            return;
        }

        const profiles = this.config.streamProfiles;
        const streamConfig: NonNullable<apid.Config['streamConfig']> =
            typeof this.config.streamConfig === 'undefined' ? {} : this.config.streamConfig;

        const pickNames = (items: apid.ClientStreamProfile[], container: apid.StreamContainer): string[] => {
            return items.filter(p => p.container === container).map(p => p.name);
        };

        // live
        if (typeof profiles.live !== 'undefined' && profiles.live.length > 0) {
            const ts: NonNullable<NonNullable<NonNullable<apid.Config['streamConfig']>['live']>['ts']> = {};

            const m2ts = profiles.live
                .filter(p => p.container === 'm2ts')
                .map(p => {
                    return {
                        name: p.name,
                        isUnconverted: p.isUnconverted === true,
                    };
                });
            if (m2ts.length > 0) {
                ts.m2ts = m2ts;
            }

            const m2tsll = pickNames(profiles.live, 'm2tsll');
            if (m2tsll.length > 0) {
                ts.m2tsll = m2tsll;
            }
            const webm = pickNames(profiles.live, 'webm');
            if (webm.length > 0) {
                ts.webm = webm;
            }
            const mp4 = pickNames(profiles.live, 'mp4');
            if (mp4.length > 0) {
                ts.mp4 = mp4;
            }
            const hls = pickNames(profiles.live, 'hls');
            if (hls.length > 0) {
                ts.hls = hls;
            }

            streamConfig.live = { ts: ts };
        }

        // recorded
        if (typeof profiles.recorded !== 'undefined') {
            const recorded: NonNullable<NonNullable<apid.Config['streamConfig']>['recorded']> = {};

            for (const type of ['ts', 'encoded'] as const) {
                const items = profiles.recorded[type];
                if (typeof items === 'undefined' || items.length === 0) {
                    continue;
                }

                const scope: { webm?: string[]; mp4?: string[]; hls?: string[] } = {};
                const webm = pickNames(items, 'webm');
                if (webm.length > 0) {
                    scope.webm = webm;
                }
                const mp4 = pickNames(items, 'mp4');
                if (mp4.length > 0) {
                    scope.mp4 = mp4;
                }
                const hls = pickNames(items, 'hls');
                if (hls.length > 0) {
                    scope.hls = hls;
                }

                recorded[type] = scope;
            }

            if (typeof recorded.ts !== 'undefined' || typeof recorded.encoded !== 'undefined') {
                streamConfig.recorded = recorded;
            }
        }

        if (typeof streamConfig.live !== 'undefined' || typeof streamConfig.recorded !== 'undefined') {
            this.config.streamConfig = streamConfig;
        }
    }

    /**
     * iOS / Safari (macOS 含む) で再生できないストリーミングの設定を削除する
     * m2tsll (mpegts.js) の可否は StreamSupportUtil.checkM2TSLLSupport() で判定する
     * (MMS 対応の可否・iOS 26 以降のホーム画面 Web App・macOS Safari 26 の既知不具合)
     */
    private setStreamingSettingForSafari(): void {
        if ((UaUtil.isiOS() === false && UaUtil.isSafari() === false) || this.config === null || typeof this.config.streamConfig === 'undefined') {
            return;
        }

        if (typeof this.config.streamConfig.live !== 'undefined') {
            if (typeof this.config.streamConfig.live.ts !== 'undefined') {
                // ライブ視聴の webm, mp4 を削除
                delete this.config.streamConfig.live.ts.webm;
                delete this.config.streamConfig.live.ts.mp4;

                if (StreamSupportUtil.isM2TSLLSupported() === false) {
                    // mpegts.js による低遅延ライブ再生が利用できない環境ではネイティブ HLS へ誘導する
                    delete this.config.streamConfig.live.ts.m2tsll;
                }

                // ライブ視聴で再生可能な設定が残っているか
                if (typeof this.config.streamConfig.live.ts.m2ts === 'undefined' && typeof this.config.streamConfig.live.ts.hls === 'undefined') {
                    delete this.config.streamConfig.live.ts;
                    this.config.isEnableTSLiveStream = false;
                }
            }

            // live ストリーミングの設定が残っているか
            if (typeof this.config.streamConfig.live.ts === 'undefined') {
                delete this.config.streamConfig.live;
            }
        }

        if (typeof this.config.streamConfig.recorded !== 'undefined') {
            if (typeof this.config.streamConfig.recorded.ts !== 'undefined') {
                // 録画済み番組の ts ストリーミングの webm. mp4 を削除
                delete this.config.streamConfig.recorded.ts.webm;
                delete this.config.streamConfig.recorded.ts.mp4;

                // 録画済み番組の ts ストリーミングの再生可能な設定が残っているか
                if (typeof this.config.streamConfig.recorded.ts.hls === 'undefined') {
                    delete this.config.streamConfig.recorded.ts;
                    this.config.isEnableTSRecordedStream = false;
                }
            }
            if (typeof this.config.streamConfig.recorded.encoded !== 'undefined') {
                // 録画済み番組のエンコード済みストリーミングの webm. mp4 を削除
                delete this.config.streamConfig.recorded.encoded.webm;
                delete this.config.streamConfig.recorded.encoded.mp4;

                // 録画済み番組のエンコード済みストリーミングの再生可能な設定が残っているか
                if (typeof this.config.streamConfig.recorded.encoded.hls === 'undefined') {
                    delete this.config.streamConfig.recorded.encoded;
                    this.config.isEnableEncodedRecordedStream = false;
                }
            }

            // 録画済み番組のストリーミングの再生可能な設定が残っているか
            if (typeof this.config.streamConfig.recorded.ts === 'undefined' && typeof this.config.streamConfig.recorded.encoded === 'undefined') {
                delete this.config.streamConfig.recorded;
            }
        }

        // ストリーミング設定が残っているか
        if (typeof this.config.streamConfig.live === 'undefined' && typeof this.config.streamConfig.recorded === 'undefined') {
            delete this.config.streamConfig;
        }
    }

    /**
     * 取得した config 情報を返す
     * @return apid.Config | null
     */
    public getConfig(): apid.Config | null {
        return this.config;
    }

    /**
     * エンコード設定が有効か
     * @return boolean true で有効
     */
    public isEnableEncode(): boolean {
        return this.config !== null && this.config.encode.length > 0;
    }

    /**
     * kodi への viode file link 送信が有効か
     * @return boolean true で有効
     */
    public isEnableSendVideoFileLinkToKodi(): boolean {
        return this.config !== null && typeof this.config.kodiHosts !== 'undefined' && this.config.kodiHosts.length > 0;
    }
}
