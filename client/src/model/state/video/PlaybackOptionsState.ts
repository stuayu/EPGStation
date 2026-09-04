import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IStreamApiModel, { PlaybackQueryPreference } from '../../api/streams/IStreamApiModel';
import { getClientCapabilities } from '@/util/ClientCapabilityUtil';
import IPlaybackOptionsState, { PlaybackPreference } from './IPlaybackOptionsState';

const KEY = 'epgstation.playback.preferences';
const DEFAULT: PlaybackPreference = {
    preferredQuality: 'auto',
    videoCorrection: 'auto',
    hdrMode: 'auto',
    autoPlayWithRecommendedQuality: true,
    mobileDataPreference: true,
    showQualityDetail: false,
};

@injectable()
export default class PlaybackOptionsState implements IPlaybackOptionsState {
    public options: apid.PlaybackOptions | null = null;
    public preference: PlaybackPreference = PlaybackOptionsState.readPreference();
    public selectedPresetId = 'auto';

    constructor(@inject('IStreamApiModel') private readonly api: IStreamApiModel) {}

    // 取得の世代。この State は singleton なので、配信方式の切り替えなどで
    // 続けて呼ばれると古い応答が後から解決して新しい選択肢を上書きしうる
    private loadGeneration = 0;

    public async loadLive(channelId: apid.ChannelId, container?: apid.PlaybackContainer): Promise<void> {
        const generation = ++this.loadGeneration;
        const options = await this.api.getLivePlaybackOptions(
            channelId,
            await getClientCapabilities(),
            this.preference.preferredQuality,
            container,
            this.getPreferenceQuery(),
        );
        this.applyOptions(generation, options);
    }

    public async loadRecorded(videoFileId: apid.VideoFileId, container?: apid.PlaybackContainer): Promise<void> {
        const generation = ++this.loadGeneration;
        const options = await this.api.getRecordedPlaybackOptions(
            videoFileId,
            await getClientCapabilities(),
            this.preference.preferredQuality,
            container,
            this.getPreferenceQuery(),
        );
        this.applyOptions(generation, options);
    }

    /**
     * 取得結果を反映する。後から解決した古い応答は捨てる
     * @param generation: number 取得開始時の世代
     * @param options: apid.PlaybackOptions 取得結果
     */
    private applyOptions(generation: number, options: apid.PlaybackOptions): void {
        if (generation !== this.loadGeneration) return;

        this.options = options;
        this.selectedPresetId = this.getInitialPresetId();
    }

    /**
     * 端末の設定画面が持つ既定値を API のクエリ形式へ変換する
     * @return PlaybackQueryPreference
     */
    private getPreferenceQuery(): PlaybackQueryPreference {
        return {
            preferHdr: this.preference.hdrMode,
            preferCorrection: this.preference.videoCorrection,
            saveData: this.preference.mobileDataPreference,
        };
    }

    /**
     * 再生開始時に選択済みとして扱うプリセットを決める。
     * 設定画面の「既定の画質」がこの入力で使えるならそれを、使えなければサーバの推奨 (auto) を選ぶ
     * @return string プリセット識別子
     */
    private getInitialPresetId(): string {
        const preferred = this.preference.preferredQuality;
        if (preferred !== 'auto' && this.options?.profiles.some(profile => profile.id === preferred) === true) {
            return preferred;
        }

        // 「おまかせ」を選択肢として持たない場面 (録画の配信) では解決済みプリセットを選択済みにする。
        // 'auto' のままにすると、一覧のどれも選択されていないのにボタンだけ「おまかせ」と出る
        if (this.options?.profiles.some(profile => (profile.role ?? profile.id) === 'auto') === true) {
            return this.options.recommended.id;
        }

        return this.options?.recommended.resolvedId ?? 'auto';
    }

    public selectPreset(id: string): void {
        if (this.options?.profiles.some(profile => profile.id === id) === true || id === 'auto') this.selectedPresetId = id;
    }

    /**
     * API が返した順序を優先して fallback 候補を返す。
     * @return fallback 対象のプリセット識別子
     */
    public getFallbackChain(): string[] {
        // 順序を保証できない旧 API の profile 一覧は使わない。
        // 高品質側へ切り替わる可能性があるため、fallbackChain が無ければ自動切替を行わない。
        return this.options?.recommended.fallbackChain ?? [];
    }

    public savePreference(value: Partial<PlaybackPreference>): void {
        this.preference = { ...this.preference, ...value };
        try {
            localStorage.setItem(KEY, JSON.stringify(this.preference));
        } catch (_err) {
            // localStorage が使えない環境でもセッション中は使用可能
        }
    }

    public clear(): void {
        // 進行中の取得結果を反映させない
        this.loadGeneration++;
        this.options = null;
        this.selectedPresetId = 'auto';
    }

    private static readPreference(): PlaybackPreference {
        try {
            const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PlaybackPreference> | null;
            return { ...DEFAULT, ...(value ?? {}) };
        } catch (_err) {
            return { ...DEFAULT };
        }
    }
}
