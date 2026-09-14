import { IRecordedSelectStreamSettingStorageModel } from '@/model/storage/recorded/IRecordedSelectStreamSettingStorageModel';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import IServerConfigModel from '../../../serverConfig/IServerConfigModel';
import StreamSupportUtil from '@/util/StreamSupportUtil';
import IRecordedDetailSelectStreamState, { RecordedStreamType, StreamConfigItem } from './IRecordedDetailSelectStreamState';

@injectable()
export default class RecordedDetailSelectStreamState implements IRecordedDetailSelectStreamState {
    public isOpen: boolean = false;
    public streamTypeItems: RecordedStreamType[] = [];
    public streamModeItems: StreamConfigItem[] = [];
    public selectedStreamType: RecordedStreamType | undefined;
    public title: string | null = null;
    public selectedStreamMode: number | undefined;

    private serverConfig: IServerConfigModel;
    private streamSelectSetting: IRecordedSelectStreamSettingStorageModel;
    private streamConfig: { [type: string]: string[] } = {};
    private videoFileId: apid.VideoFileId | null = null;
    private recordedId: apid.RecordedId | null = null;

    constructor(
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('IRecordedSelectStreamSettingStorageModel')
        streamSelectSetting: IRecordedSelectStreamSettingStorageModel,
    ) {
        this.serverConfig = serverConfig;
        this.streamSelectSetting = streamSelectSetting;
    }

    public open(videoFile: apid.VideoFile, recordedId: apid.RecordedId): void {
        this.isOpen = true;

        this.title = videoFile.name;
        this.videoFileId = videoFile.id;
        this.recordedId = recordedId;
        // 同じ画面で続けて開いても選択肢が積み重ならないよう毎回作り直す
        this.streamTypeItems = [];
        this.streamModeItems = [];
        this.streamConfig = {};
        const config = this.serverConfig.getConfig();

        if (config !== null && typeof config.streamConfig !== 'undefined' && typeof config.streamConfig.recorded !== 'undefined') {
            // set streamTypeItems
            const ts = config.streamConfig.recorded.ts;
            const encoded = config.streamConfig.recorded.encoded;
            if (videoFile.type === 'ts' && config.isEnableTSRecordedStream === true && typeof ts !== 'undefined') {
                // webm
                if (typeof ts.webm !== 'undefined' && ts.webm.length > 0) {
                    this.streamTypeItems.push('WebM');
                    this.streamConfig['WebM'] = ts.webm;
                }

                // mp4
                if (typeof ts.mp4 !== 'undefined' && ts.mp4.length > 0) {
                    this.streamTypeItems.push('MP4');
                    this.streamConfig['MP4'] = ts.mp4;
                }

                // hls
                if (typeof ts.hls !== 'undefined' && ts.hls.length > 0) {
                    this.streamTypeItems.push('HLS');
                    this.streamConfig['HLS'] = ts.hls;
                }
                if (typeof ts.m2tsll !== 'undefined' && ts.m2tsll.length > 0) {
                    this.streamTypeItems.push('M2TS-LL');
                    this.streamConfig['M2TS-LL'] = ts.m2tsll;
                }
            } else if (videoFile.type === 'encoded' && config.isEnableEncodedRecordedStream === true && typeof encoded !== 'undefined') {
                // webm
                if (typeof encoded.webm !== 'undefined' && encoded.webm.length > 0) {
                    this.streamTypeItems.push('WebM');
                    this.streamConfig['WebM'] = encoded.webm;
                }

                // mp4
                if (typeof encoded.mp4 !== 'undefined' && encoded.mp4.length > 0) {
                    this.streamTypeItems.push('MP4');
                    this.streamConfig['MP4'] = encoded.mp4;
                }

                // hls
                if (typeof encoded.hls !== 'undefined' && encoded.hls.length > 0) {
                    this.streamTypeItems.push('HLS');
                    this.streamConfig['HLS'] = encoded.hls;
                }
                if (typeof encoded.m2tsll !== 'undefined' && encoded.m2tsll.length > 0) {
                    this.streamTypeItems.push('M2TS-LL');
                    this.streamConfig['M2TS-LL'] = encoded.m2tsll;
                }
            } else {
                // ビデオの形式に適したストリーミングの設定が存在しない
                throw new Error('VideoTypeError');
            }

            // 端末で再生できない配信方式を落とす。
            // - MP4 / WebM: 録画のプログレッシブ配信は Content-Length / Range を返せない chunked なので
            //   WebKit (iOS / iPadOS / Safari) では MediaError 4 になり、選んでも黒いままになる
            // - M2TS-LL: mpegts.js (MSE / MMS) が使えない端末では再生できない
            // ただし**全部落ちて選択肢が空になる設定もありうる**ため、その場合は元の一覧へ戻す
            // (再生手段が 1 つも出ないより、再生できないかもしれない候補を残す方がまし)
            const supported = this.streamTypeItems.filter(type => {
                if (type === 'MP4' || type === 'WebM') return StreamSupportUtil.isProgressiveFileStreamSupported();
                if (type === 'M2TS-LL') return StreamSupportUtil.isM2TSLLSupported();

                return true;
            });
            if (supported.length > 0) this.streamTypeItems = supported;

            // 前回の選択が今回のビデオ形式に存在しない場合 (ts ⇔ encoded の切り替え) は選び直す
            if (typeof this.selectedStreamType !== 'undefined' && this.streamTypeItems.includes(this.selectedStreamType) === false) {
                this.selectedStreamType = undefined;
            }

            if (typeof this.selectedStreamType === 'undefined') {
                const savedType = this.streamSelectSetting.getSavedValue().type;
                const newSelectedStreamType = this.streamTypeItems.find(type => {
                    return type === savedType;
                });
                this.selectedStreamType = typeof newSelectedStreamType === 'undefined' ? this.streamTypeItems[0] : newSelectedStreamType;
            }
        }

        this.updateModeItems(true);
    }

    /**
     * ダイアログを閉じる
     */
    public close(): void {
        // ストリームの選択情報を保存
        if (typeof this.selectedStreamType !== 'undefined' && typeof this.selectedStreamMode !== 'undefined') {
            this.streamSelectSetting.tmp.type = this.selectedStreamType as string;
            this.streamSelectSetting.tmp.mode = typeof this.selectedStreamMode === 'undefined' ? 0 : this.selectedStreamMode;
            this.streamSelectSetting.save();
        }

        this.isOpen = false;
    }

    /**
     * 視聴設定の更新
     */
    public updateModeItems(isInit: boolean = false): void {
        this.streamModeItems = this.getModeItems().map((text, i) => {
            return {
                title: text,
                value: i,
            };
        });

        if (isInit === true) {
            this.selectedStreamMode = this.streamSelectSetting.getSavedValue().mode;
        }

        if (typeof this.selectedStreamMode === 'undefined' || typeof this.streamModeItems[this.selectedStreamMode] === 'undefined') {
            this.selectedStreamMode = 0;
        }
    }

    /** playback-options が返した MPEG-2 original を方式一覧へ追加する。 */
    public addOriginalStreamType(): void {
        if (this.streamTypeItems.includes('オリジナル')) return;
        this.streamTypeItems.push('オリジナル');
        this.streamConfig['オリジナル'] = ['オリジナル'];
        if (typeof this.selectedStreamType === 'undefined') {
            this.selectedStreamType = 'オリジナル';
            this.updateModeItems();
        }
    }

    /**
     * 視聴設定を返す
     * @return string[]
     */
    private getModeItems(): string[] {
        return typeof this.selectedStreamType === 'undefined' ? [] : this.streamConfig[this.selectedStreamType];
    }

    /**
     * VideoFile id を返す
     * @return apid.VideoFileId | null
     */
    public getVideoFileId(): apid.VideoFileId | null {
        return this.videoFileId;
    }

    /**
     * Recorded id を返す
     * @return apid.RecordedId | null
     */
    public getRecordedId(): apid.RecordedId | null {
        return this.recordedId;
    }
}
