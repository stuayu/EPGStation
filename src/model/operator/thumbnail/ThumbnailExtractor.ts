import { spawn } from 'child_process';
import { createThumbnailCandidates } from './ThumbnailCandidateGenerator';

export interface ThumbnailExtractedFrame {
    timestamp: number;
    data: Buffer;
    width: number;
    height: number;
}

// 候補は1フレームだけなので、壊れたTSでキューを長時間塞がない上限とする。
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
// TS を複数seekするとディスクI/Oが競合する。3並列なら待ち時間を縮めつつ過負荷を抑えられる。
const MAX_PARALLEL_EXTRACTIONS = 3;
type SpawnProcess = typeof spawn;

/** 候補時刻ごとに FFmpeg の input-side seek を使い、RGB24 フレームを取得する。 */
export default class ThumbnailExtractor {
    private spawnProcess: SpawnProcess;

    /** @param spawnProcess テストで差し替えるプロセス生成関数 */
    constructor(spawnProcess: SpawnProcess = spawn) {
        this.spawnProcess = spawnProcess;
    }

    /**
     * 候補時刻からフレームを抽出する。個別候補の失敗は除外し、全候補失敗時だけ reject する。
     * @param ffmpeg FFmpeg 実行ファイル
     * @param input 入力動画パス
     * @param duration 録画時間（秒）
     * @param count 候補数
     * @param legacyPosition duration不明・候補1点時の従来切り出し位置
     * @param timeoutMs 候補ごとのタイムアウト
     * @return 時刻順の抽出成功フレーム
     */
    public async extract(
        ffmpeg: string,
        input: string,
        duration: number,
        count: number,
        legacyPosition = 5,
        timeoutMs = DEFAULT_TIMEOUT_MS,
    ): Promise<ThumbnailExtractedFrame[]> {
        const candidates = createThumbnailCandidates(duration, count, legacyPosition);
        const frames: ThumbnailExtractedFrame[] = [];
        const errors: unknown[] = [];
        let nextIndex = 0;
        const worker = async (): Promise<void> => {
            while (nextIndex < candidates.length) {
                const candidate = candidates[nextIndex++];
                try {
                    frames.push(await this.extractAt(ffmpeg, input, candidate.timestamp, timeoutMs));
                } catch (err) {
                    errors.push(err);
                }
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(MAX_PARALLEL_EXTRACTIONS, candidates.length) }, () => worker()),
        );
        if (frames.length === 0) {
            throw new AggregateError(errors, 'ThumbnailExtractorAllCandidatesFailed');
        }
        return frames.sort((a, b) => a.timestamp - b.timestamp);
    }

    private extractAt(
        ffmpeg: string,
        input: string,
        timestamp: number,
        timeoutMs: number,
    ): Promise<ThumbnailExtractedFrame> {
        const width = 320;
        const height = 180;
        const args = [
            '-hide_banner',
            '-loglevel',
            'error',
            // -ss を -i より前に置き、TS を先頭から候補位置まで全デコードしない。
            '-ss',
            `${timestamp}`,
            '-i',
            input,
            '-frames:v',
            '1',
            '-vf',
            `scale=${width}:${height}:flags=fast_bilinear`,
            '-f',
            'rawvideo',
            '-pix_fmt',
            'rgb24',
            'pipe:1',
        ];
        return new Promise((resolve, reject) => {
            const child = this.spawnProcess(ffmpeg, args);
            const chunks: Buffer[] = [];
            let stderr = '';
            let settled = false;
            const finish = (err?: Error): void => {
                if (settled === true) return;
                settled = true;
                clearTimeout(timer);
                if (err !== undefined) {
                    reject(err);
                    return;
                }
                const data = Buffer.concat(chunks);
                const bytes = width * height * 3;
                if (data.length < bytes) {
                    reject(new Error(`ThumbnailExtractorIncompleteFrame:${data.length}/${bytes}`));
                    return;
                }
                resolve({ timestamp, data: data.subarray(0, bytes), width, height });
            };
            const timer = setTimeout(() => {
                child.kill();
                finish(new Error('ThumbnailExtractorTimeout'));
            }, timeoutMs);
            child.stdout?.on('data', chunk => chunks.push(Buffer.from(chunk)));
            child.stderr?.on('data', chunk => {
                stderr += String(chunk);
            });
            child.once('error', err => finish(err));
            child.once('exit', code => {
                if (code !== 0) {
                    finish(new Error(`ThumbnailExtractorExit:${code}:${stderr.slice(-500)}`));
                    return;
                }
                finish();
            });
        });
    }
}
