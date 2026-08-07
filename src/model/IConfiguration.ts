import IConfigFile from './IConfigFile';

export default interface IConfiguration {
    /**
     * config.yml に GUI の差分を重ねた実効値
     */
    getConfig(): IConfigFile;
    /**
     * config.yml をそのまま読んだ値 (GUI で「ファイルの値」を示すために使う)
     */
    getFileConfig(): IConfigFile;
    /**
     * config.yml をそのまま読んだ生の値 (デフォルト値で補完される前のスナップショット)。
     * 実効値が「既定値 / config.yml / DB オーバーレイ」のどの層で決まったかを判定する
     * 基準として使う (getFileConfig() は既定値補完後の値なので出自判定には使えない)。
     */
    getRawFileConfig(): Record<string, unknown>;
    /**
     * 既定値 (Configuration.DEFAULT_VALUE) のコピー
     */
    getDefaultValue(): Record<string, unknown>;
    /**
     * 現在適用している差分
     */
    getOverlay(): Record<string, unknown>;
    /**
     * GUI から編集された差分を適用する
     * @param overlay: unknown
     */
    setOverlay(overlay: unknown): void;
}
