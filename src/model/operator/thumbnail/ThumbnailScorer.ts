export interface ThumbnailFrameMetrics {
    brightness: number;
    contrast: number;
    sharpness: number;
    sceneChange: number;
    blackPenalty: number;
    blurPenalty: number;
    features?: { brightness: number; contrast: number; sharpness: number; edge: number; blackRatio: number };
}

export interface ThumbnailScoreContext {
    program?: unknown;
    recorded?: unknown;
    videoFile?: unknown;
}

export interface ThumbnailScorer {
    score(frame: ThumbnailFrameMetrics, context: ThumbnailScoreContext): number;
}

/** V1 の画像指標スコア。AI 実装へ差し替え可能。 */
export default class BasicThumbnailScorer implements ThumbnailScorer {
    public score(frame: ThumbnailFrameMetrics, _context: ThumbnailScoreContext): number {
        const f = frame.features;
        if (f !== undefined) {
            const brightness = f.brightness < 20 || f.brightness > 240 ? 0 : Math.min(100, f.brightness / 2);
            const contrast = Math.min(100, f.contrast);
            const sharpness = Math.min(100, f.sharpness / 20);
            const edge = Math.min(100, f.edge / 2);
            return brightness * 0.3 + contrast * 0.3 + sharpness * 0.2 + edge * 0.2 - f.blackRatio * 50;
        }
        return frame.brightness + frame.contrast + frame.sharpness + frame.sceneChange - frame.blackPenalty - frame.blurPenalty;
    }
}
