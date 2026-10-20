export type CaptureCompositionMode = 'video' | 'caption' | 'caption-comment';

export interface CaptureCommentInstruction {
    text: string;
    x: number;
    y: number;
    color: string;
    fontSize: number;
    strokeColor: string;
    strokeWidth: number;
}

/** 表示座標を映像ピクセルへ換算する倍率を返す。KonomiTV: client/src/services/player/managers/CaptureManager.ts */
export function getCaptureScale(
    videoWidth: number,
    videoHeight: number,
    displayWidth: number,
    displayHeight: number,
): { x: number; y: number } {
    return {
        x: displayWidth > 0 ? videoWidth / displayWidth : 1,
        y: displayHeight > 0 ? videoHeight / displayHeight : 1,
    };
}

/** 番組名と時刻から安全な JPEG 名を作る。KonomiTV: client/src/services/player/managers/CaptureManager.ts */
export function createCaptureFilename(title: string, date: Date): string {
    // eslint-disable-next-line no-control-regex
    const safeTitle = (title || 'capture').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'capture';
    const pad = (value: number): string => String(value).padStart(2, '0');
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    return `${safeTitle}_${stamp}.jpg`;
}

/** DOM の弾幕情報を実解像度で描画する命令へ変換する。 */
export function createCaptureCommentInstructions(
    comments: Array<{
        text: string;
        top: number;
        left: number;
        color: string;
        fontSize: number;
        strokeColor: string;
        strokeWidth: number;
    }>,
    scale: { x: number; y: number },
): CaptureCommentInstruction[] {
    return comments
        .filter(comment => comment.text.trim() !== '')
        .map(comment => ({
            text: comment.text.trim(),
            x: comment.left * scale.x,
            y: comment.top * scale.y + comment.fontSize * scale.y,
            color: comment.color,
            fontSize: comment.fontSize * scale.y,
            strokeColor: comment.strokeColor,
            strokeWidth: comment.strokeWidth * scale.y,
        }));
}

/** 字幕・コメント合成順を返す。映像を常に最下層に置く。 */
export function getCaptureLayerOrder(
    mode: CaptureCompositionMode,
    hasCaption: boolean,
    hasComments: boolean,
): Array<'video' | 'caption' | 'comments'> {
    const layers: Array<'video' | 'caption' | 'comments'> = ['video'];
    if (mode !== 'video' && hasCaption) layers.push('caption');
    if (mode === 'caption-comment' && hasComments) layers.push('comments');
    return layers;
}
