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
     * 現在適用している差分
     */
    getOverlay(): Record<string, unknown>;
    /**
     * GUI から編集された差分を適用する
     * @param overlay: unknown
     */
    setOverlay(overlay: unknown): void;
}
