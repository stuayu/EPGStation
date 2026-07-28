export default interface ILogLevelApplier {
    /**
     * DB (app_setting.logging) のログレベルを現在のプロセスの log4js へ適用する。
     * ログ設定ファイルの内容がベースで、ここで指定されたカテゴリだけを上書きする。
     * DB が読めない場合は何もしない (ログ出力自体は止めない)
     * @return Promise<void>
     */
    apply(): Promise<void>;
}
