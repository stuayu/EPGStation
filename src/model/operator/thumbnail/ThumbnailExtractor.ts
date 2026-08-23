import { spawn } from 'child_process';

export interface ThumbnailExtractedFrame { timestamp: number; data: Buffer; width: number; height: number; }

/** FFmpeg を一度だけ起動し、候補区間の RGB24 フレームを取得する。 */
export default class ThumbnailExtractor {
    public extract(ffmpeg: string, input: string, duration: number, count: number, timeoutMs = 120000): Promise<ThumbnailExtractedFrame[]> {
        const safeDuration = Math.max(1, duration);
        const safeCount = Math.max(1, Math.floor(count));
        const start = safeDuration * 0.05;
        const end = Math.max(start, safeDuration * 0.95);
        const interval = safeCount === 1 ? 1 : Math.max(0.1, (end - start) / (safeCount - 1));
        return this.extractOnce(ffmpeg, input, start, end, interval, safeCount, timeoutMs).then(frames => {
            if (frames.length > 0 || start <= 0) return frames;
            // duration が DB の推定値で実ファイルより長い場合、先頭区間へ再試行する。
            return this.extractOnce(ffmpeg, input, 0, Math.min(safeDuration, 10), Math.max(0.1, Math.min(interval, 1)), safeCount, timeoutMs);
        });
    }

    private extractOnce(ffmpeg: string, input: string, start: number, end: number, interval: number, safeCount: number, timeoutMs: number): Promise<ThumbnailExtractedFrame[]> {
        const width = 320;
        const height = 180;
        const args = ['-hide_banner', '-loglevel', 'error', '-ss', `${start}`, '-i', input, '-t', `${Math.max(0.1, end - start)}`, '-vf', `fps=1/${interval},scale=${width}:${height}:flags=fast_bilinear`, '-frames:v', `${safeCount}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
        return new Promise((resolve, reject) => {
            const child = spawn(ffmpeg, args);
            const chunks: Buffer[] = [];
            let stderr = '';
            const timer = setTimeout(() => { child.kill(); reject(new Error('ThumbnailExtractorTimeout')); }, timeoutMs);
            child.stdout?.on('data', chunk => chunks.push(Buffer.from(chunk)));
            child.stderr?.on('data', chunk => { stderr += String(chunk); });
            child.once('error', err => { clearTimeout(timer); reject(err); });
            child.once('exit', code => {
                clearTimeout(timer);
                if (code !== 0) return reject(new Error(`ThumbnailExtractorExit:${code}:${stderr.slice(-500)}`));
                const bytes = width * height * 3;
                const data = Buffer.concat(chunks);
                const frames: ThumbnailExtractedFrame[] = [];
                for (let i = 0; i < Math.min(safeCount, Math.floor(data.length / bytes)); i++) {
                    frames.push({ timestamp: Math.min(end, start + i * interval), data: data.subarray(i * bytes, (i + 1) * bytes), width, height });
                }
                resolve(frames);
            });
        });
    }
}
