import * as fs from 'fs';
import * as path from 'path';
import ChapterFileUtil from './ChapterFileUtil';

/** CM検出でEPGStationが作成した副ファイルを扱う。判定JSONが所有権の印。 */
namespace CmDetectionFileUtil {
    export const getEvidencePath = (videoPath: string): string => {
        const extension = path.extname(videoPath);
        return `${videoPath.slice(0, videoPath.length - extension.length)}.cm-detection.json`;
    };

    export const hasSiblingVideoWithSameBaseName = (videoPath: string): boolean => {
        const directory = path.dirname(videoPath);
        const baseName = path.basename(videoPath, path.extname(videoPath));
        try {
            return fs.readdirSync(directory, { withFileTypes: true }).some(entry => {
                if (entry.isFile() === false || entry.name === path.basename(videoPath)) return false;
                if (entry.name.endsWith('.chapter.txt') || entry.name.endsWith('.cm-detection.json')) return false;
                return path.basename(entry.name, path.extname(entry.name)) === baseName;
            });
        } catch {
            return false;
        }
    };

    export const getOwnedSidecarPaths = (videoPath: string): string[] => {
        const evidencePath = getEvidencePath(videoPath);
        if (hasSiblingVideoWithSameBaseName(videoPath) || fs.existsSync(evidencePath) === false) return [];
        try {
            const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
            if (evidence.videoFileName !== path.basename(videoPath) || evidence.chapterWritten !== true) return [];
        } catch {
            return [];
        }
        return [evidencePath, ChapterFileUtil.getChapterFilePath(videoPath)].filter(file => fs.existsSync(file));
    };
}

export default CmDetectionFileUtil;
