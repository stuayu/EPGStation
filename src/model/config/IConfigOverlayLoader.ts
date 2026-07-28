export default interface IConfigOverlayLoader {
    /**
     * DB (app_setting の config キー) から GUI の設定差分を読み込み、Configuration へ適用する。
     * DB が読めない場合は何もしない (config.yml だけで動作を継続する)
     * @return Promise<void>
     */
    load(): Promise<void>;
}
