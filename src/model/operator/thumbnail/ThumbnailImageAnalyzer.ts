export interface ThumbnailImageFeatures {
    brightness: number;
    contrast: number;
    sharpness: number;
    edge: number;
    blackRatio: number;
}

/** RGB24 フレームを依存なしで解析する V1.5 アナライザ。 */
export default class ThumbnailImageAnalyzer {
    public analyze(data: Buffer, width: number, height: number): ThumbnailImageFeatures {
        const pixels = Math.min(width * height, Math.floor(data.length / 3));
        if (pixels === 0) return { brightness: 0, contrast: 0, sharpness: 0, edge: 0, blackRatio: 1 };
        const gray: number[] = new Array(pixels);
        let sum = 0;
        let black = 0;
        for (let i = 0; i < pixels; i++) {
            const p = i * 3;
            const value = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
            gray[i] = value;
            sum += value;
            if (value < 20) black++;
        }
        const brightness = sum / pixels;
        let variance = 0;
        for (const value of gray) variance += (value - brightness) ** 2;
        const contrast = Math.sqrt(variance / pixels);
        let edge = 0;
        let sharpness = 0;
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = y * width + x;
                const lap = gray[i - width] + gray[i - 1] + gray[i + 1] + gray[i + width] - 4 * gray[i];
                sharpness += lap * lap;
                edge += Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + width] - gray[i - width]);
            }
        }
        const area = Math.max(1, (width - 2) * (height - 2));
        return { brightness, contrast, sharpness: sharpness / area, edge: edge / area, blackRatio: black / pixels };
    }
}
