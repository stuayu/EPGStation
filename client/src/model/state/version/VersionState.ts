import { inject, injectable } from 'inversify';
import IVersionApiModel from '../../api/version/IVersionApiModel';
import IVersionState, { VersionInfo } from './IVersionState';

@injectable()
export default class VersionState implements IVersionState {
    // 表示用に切り出す semver のベース部分 (例: '2.15.0-stuayu-260809-68-g06f1494' → '2.15.0')
    private static readonly BASE_VERSION_REGEXP = /^\d+(\.\d+){0,2}/;

    private versionApiModel: IVersionApiModel;

    private info: VersionInfo | null = null;

    constructor(@inject('IVersionApiModel') versionApiModel: IVersionApiModel) {
        this.versionApiModel = versionApiModel;
    }

    /**
     * 取得したバージョン情報をクリア
     */
    public clearData(): void {
        this.info = null;
    }

    /**
     * バージョン情報の取得
     */
    public async fetchData(): Promise<void> {
        const version = await this.versionApiModel.getInfo();

        this.info = version;
    }

    /**
     * 取得したバージョン情報を返す
     * @return VersionInfo
     */
    public getInfo(): VersionInfo | null {
        return this.info;
    }

    /**
     * 画面表示用のバージョン文字列を返す。
     * リリースタグは '2.15.0-stuayu-260809-68-g06f1494' のように長く、
     * タイトルバーやナビゲーションドロワーでは見切れてしまうためベース部分だけにする
     * (完全なバージョンは設定 > 更新 で確認できる)
     * @return string
     */
    public getVersionString(): string {
        if (this.info == null) {
            return 'EPGStation';
        }

        const matched = this.info.version.match(VersionState.BASE_VERSION_REGEXP);

        return `EPGStation v${matched === null ? this.info.version : matched[0]}`;
    }

    /**
     * 省略していないバージョン文字列を返す
     * @return string
     */
    public getFullVersionString(): string {
        return this.info == null ? 'EPGStation' : `EPGStation v${this.info.version}`;
    }
}
