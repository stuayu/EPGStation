import * as fs from 'fs';
import * as path from 'path';
import ChapterFileUtil from './ChapterFileUtil';

/** CM検出でEPGStationが作成した副ファイルを扱う。判定JSONが所有権の印。 */
namespace CmDetectionFileUtil {
    export const getEvidencePath = (videoPath: string): string => {
        const extension = path.extname(videoPath);
        return `${videoPath.slice(0, videoPath.length - extension.length)}.cm-detection.json`;
    };

    export const getOwnedSidecarPaths = (videoPath: string): string[] => {
        const evidencePath = getEvidencePath(videoPath);
        if (fs.existsSync(evidencePath) === false) return [];
        return [evidencePath, ChapterFileUtil.getChapterFilePath(videoPath)].filter(file => fs.existsSync(file));
    };
}

export default CmDetectionFileUtil;
