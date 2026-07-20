import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
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

        this.setStreamingSettingForSafari();
    }

    /**
     * iOS / Safari (macOS 含む) で再生できないストリーミングの設定を削除する
     * macOS 26 (Safari 26) 以降は mpegts.js によるライブ再生 (m2tsll) が
     * 映像停止するため、iOS だけでなくデスクトップの Safari もネイティブ HLS へ誘導する
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

                if (UaUtil.isSafari() === true) {
                    // Safari では mpegts.js のライブ再生が不安定なため、ネイティブ HLS を使用する
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
