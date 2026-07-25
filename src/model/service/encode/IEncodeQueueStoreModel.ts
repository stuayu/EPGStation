import { EncodeOption } from './IEncoderModel';

/**
 * 保存されるエンコードキューの内容
 */
export interface StoredEncodeQueue {
    idCnt: number; // 次に払い出す encodeId の元になるカウンタ
    items: EncodeOption[]; // 未完了のエンコード情報 (実行中 + 待機中)
}

export default interface IEncodeQueueStoreModel {
    save(queue: StoredEncodeQueue): Promise<void>;
    load(): Promise<StoredEncodeQueue | null>;
}
