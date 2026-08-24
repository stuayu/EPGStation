import * as apid from '../../../api';
import Thumbnail from '../../db/entities/Thumbnail';

export default interface IThumbnailDB {
    restore(items: Thumbnail[]): Promise<void>;
    insertOnce(thumbnail: Thumbnail): Promise<apid.ThumbnailId>;
    deleteOnce(thumbnailId: apid.ThumbnailId): Promise<void>;
    deleteRecordedId(recordedId: apid.RecordedId): Promise<void>;
    findId(thumbnailId: apid.ThumbnailId): Promise<Thumbnail | null>;
    /**
     * 録画 ID からサムネイルを 1 件引く (シリーズのアイキャッチ代替に使う)
     * @param recordedId: apid.RecordedId
     * @return Promise<Thumbnail | null>
     */
    findByRecordedId(recordedId: apid.RecordedId): Promise<Thumbnail | null>;
    findByRecordedIdAndVariant(recordedId: apid.RecordedId, variant: string): Promise<Thumbnail | null>;
    replaceOnce(thumbnail: Thumbnail): Promise<apid.ThumbnailId>;
    findAll(): Promise<Thumbnail[]>;
}
