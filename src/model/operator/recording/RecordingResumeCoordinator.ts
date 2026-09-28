import * as path from 'path';
import { RecordingResumeInfo } from './IRecorderModel';
import IConfigFile from '../../IConfigFile';
import { countRecordingGaps } from './RecordingGapUtil';

export interface RecordingResumePreparation {
    filePath: string;
    fileOffset: number;
    attemptCount: number;
    gapCount: number;
    closeReasons: Array<string | null>;
}

/** 復帰先と session / attempt から復帰用状態を組み立てる */
export default class RecordingResumeCoordinator {
    /** 復帰用の保存先と集計値を解決する */
    public static prepare(info: RecordingResumeInfo, config: IConfigFile): RecordingResumePreparation | null {
        const parent =
            info.videoFile.parentDirectoryName === 'tmp'
                ? config.recordedTmp
                : config.recorded.find(dir => dir.name === info.videoFile.parentDirectoryName)?.path;
        if (parent === undefined) return null;

        return {
            filePath: path.join(parent, info.videoFile.filePath),
            fileOffset: info.videoFile.size,
            attemptCount: info.attempts.length,
            gapCount: countRecordingGaps(info.attempts),
            closeReasons: info.attempts.map(attempt => attempt.closeReason),
        };
    }
}
