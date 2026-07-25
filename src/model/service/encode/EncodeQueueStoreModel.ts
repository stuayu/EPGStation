import { inject, injectable } from 'inversify';
import * as path from 'path';
import FileUtil from '../../../util/FileUtil';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeQueueStoreModel, { StoredEncodeQueue } from './IEncodeQueueStoreModel';

/**
 * エンコードキューをファイルへ永続化する
 * Service プロセスが再起動 (クラッシュ後の自動再起動を含む) しても
 * 未完了のエンコードが消えないようにするために使用する
 */
@injectable()
class EncodeQueueStoreModel implements IEncodeQueueStoreModel {
    private log: ILogger;
    private filePath: string;
    // 書き込みが同時に走って内容が壊れないように直列化するためのチェーン
    private saveChain: Promise<void> = Promise.resolve();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
        this.filePath = path.join(__dirname, '..', '..', '..', '..', 'data', EncodeQueueStoreModel.FILE_NAME);
    }

    /**
     * エンコードキューを保存する
     * @param queue: StoredEncodeQueue
     * @return Promise<void>
     */
    public save(queue: StoredEncodeQueue): Promise<void> {
        // 呼び出し順に直列で書き込む
        this.saveChain = this.saveChain.then(() => {
            return this.writeFile(queue);
        });

        return this.saveChain;
    }

    /**
     * 一時ファイルへ書き出してから rename することで、書き込み途中のファイルが残らないようにする
     * @param queue: StoredEncodeQueue
     * @return Promise<void>
     */
    private async writeFile(queue: StoredEncodeQueue): Promise<void> {
        const tmpFilePath = `${this.filePath}.tmp`;

        try {
            await FileUtil.writeFile(tmpFilePath, JSON.stringify(queue));
            await FileUtil.rename(tmpFilePath, this.filePath);
        } catch (err: any) {
            this.log.encode.error(`save encode queue error: ${this.filePath}`);
            this.log.encode.error(err);
        }
    }

    /**
     * 保存されているエンコードキューを読み込む
     * @return Promise<StoredEncodeQueue | null> 保存されていない場合は null
     */
    public async load(): Promise<StoredEncodeQueue | null> {
        let json: string;
        try {
            await FileUtil.stat(this.filePath);
            json = await FileUtil.readFile(this.filePath);
        } catch (err: any) {
            // 初回起動時などファイルが存在しない場合は復元対象なし
            return null;
        }

        try {
            const queue = JSON.parse(json) as StoredEncodeQueue;
            if (typeof queue.idCnt !== 'number' || Array.isArray(queue.items) === false) {
                throw new Error('EncodeQueueFileIsBroken');
            }

            return queue;
        } catch (err: any) {
            this.log.encode.error(`broken encode queue file: ${this.filePath}`);
            this.log.encode.error(err);

            return null;
        }
    }
}

namespace EncodeQueueStoreModel {
    export const FILE_NAME = 'encodeQueue.json';
}

export default EncodeQueueStoreModel;
