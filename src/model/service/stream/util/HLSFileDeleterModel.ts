import { inject, injectable } from 'inversify';
import * as path from 'path';
import FileUtil from '../../../../util/FileUtil';
import ILogger from '../../../ILogger';
import ILoggerModel from '../../../ILoggerModel';
import IHLSFileDeleterModel, { HLSFileDeleterOption } from './IHLSFileDeleterModel';

@injectable()
export default class HLSFileDeleterModel implements IHLSFileDeleterModel {
    // Windows で ffmpeg がまだファイルを掴んでいる場合 (EPERM) の再試行回数と間隔
    private static readonly UNLINK_RETRY_COUNT = 2;
    private static readonly UNLINK_RETRY_INTERVAL = 200;

    private log: ILogger;
    private option: HLSFileDeleterOption | null = null;

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * 削除オプション設定
     * @param option: HLSFileDeleterOption
     */
    public setOption(option: HLSFileDeleterOption): void {
        this.option = option;
    }

    /**
     * 全てのファイルを削除する
     */
    public async deleteAllFiles(): Promise<void> {
        if (this.option === null) {
            throw new Error('HLSFileDeleterOptionIsNull');
        }

        this.log.stream.info(`delete all hls files: ${this.option.streamId}`);
        await this.deleteFile(0);
    }

    /**
     * ファイルの削除
     * @param fileNum: 残すファイル数 0 なら全て削除
     * @return Promise<void>;
     */
    private async deleteFile(fileNum: number): Promise<void> {
        if (this.option === null) {
            throw new Error('HLSFileDeleterOptionIsNull');
        }

        const option: HLSFileDeleterOption = this.option;

        let targetFiles = (await FileUtil.readDir(this.option.streamFilePath)).filter(file => {
            return (
                (fileNum === 0 && file.match('.m3u8') && file.match(`stream${option.streamId}`)) ||
                file.match(`stream${option.streamId}`)
            );
        });

        targetFiles = targetFiles.sort();

        for (let i = 0; i < targetFiles.length - fileNum; i++) {
            if (typeof targetFiles[i] !== 'undefined' && targetFiles[i] !== '.gitkeep') {
                await this.unlink(path.join(this.option.streamFilePath, targetFiles[i]), targetFiles[i]);
            }
        }
    }

    /**
     * ファイル 1 つを削除する。
     * 削除失敗で配信の停止処理を中断させてはならないため、例外は投げずに warn ログへ落とす
     * (既に消えている場合の ENOENT、Windows で ffmpeg がまだ掴んでいる場合の EPERM が起きうる)
     * @param filePath: 削除するファイルのパス
     * @param fileName: ログ表示用のファイル名
     * @return Promise<void>
     */
    private async unlink(filePath: string, fileName: string): Promise<void> {
        for (let retry = 0; retry <= HLSFileDeleterModel.UNLINK_RETRY_COUNT; retry++) {
            try {
                await FileUtil.unlink(filePath);
                this.log.stream.info(`deleted ${fileName}`);
                return;
            } catch (err: any) {
                // 既に消えているなら削除成功として扱う
                if (err?.code === 'ENOENT') {
                    return;
                }
                // 掴んでいるハンドルが離れるまで待って再試行する
                if (err?.code === 'EPERM' && retry < HLSFileDeleterModel.UNLINK_RETRY_COUNT) {
                    await new Promise<void>(resolve => setTimeout(resolve, HLSFileDeleterModel.UNLINK_RETRY_INTERVAL));
                    continue;
                }
                this.log.stream.warn(`failed to delete ${fileName}`);
                this.log.stream.warn(err);
                return;
            }
        }
    }
}
