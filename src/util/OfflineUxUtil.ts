import * as apid from '../../api';
import DateUtil from './DateUtil';

export const ORIGINAL_MPEG2_CHUNK_SIZE = Math.floor((16 * 1024 * 1024) / 188) * 188;

export type OfflineOriginalTsKind = 'original-mpeg2' | 'original-hevc';

/** オフライン保存で元 TS をそのまま保持するプロファイルか判定する。 */
export const isOfflineOriginalTsProfile = (profile: unknown): profile is OfflineOriginalTsKind =>
    profile === 'original-mpeg2' || profile === 'original-hevc';

/** オフライン保存の元 TS kind をプロファイルから決める。曖昧な profile は HLS 扱いにする。 */
export const getOfflineOriginalTsKind = (profile: unknown): OfflineOriginalTsKind | null =>
    isOfflineOriginalTsProfile(profile) ? profile : null;

/** 保存済み動画を一意に識別する URL 用キーを作る。 */
export const createOfflineVideoKey = (videoFileId: number, generationId: string): string => {
    if (
        !Number.isSafeInteger(videoFileId) ||
        videoFileId < 0 ||
        generationId.length === 0 ||
        /[/\\?#]/u.test(generationId)
    )
        return '';
    return `${videoFileId.toString(10)}-${generationId}`;
};

export interface OfflineChunkRange {
    start: number;
    end: number;
}

export interface OfflineProgramInfo {
    channelId: apid.ChannelId | null;
    channelName?: string;
    time?: string;
    shortTime?: string;
    name: string;
    description?: string;
    extended?: string;
    genreItems?: string[];
    durationText?: string;
    videoText?: string;
    audioText?: string;
    seriesText?: string;
}

export interface OfflineProgramInfoOptions {
    channelName?: string;
    displayName?: string;
    videoFileId?: apid.VideoFileId;
    resolveGenre?: (genre: number, subGenre?: number) => string | null;
}

/** オフライン保存レコードから扱えるチャプターだけを取り出す。旧レコードは空配列になる。 */
export const normalizeOfflineChapters = (value: unknown): apid.VideoChapter[] => {
    if (Array.isArray(value) === false) return [];

    return value
        .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
        .filter(item =>
            typeof item.id === 'number' &&
            Number.isSafeInteger(item.id) &&
            typeof item.startAt === 'number' &&
            Number.isFinite(item.startAt) &&
            item.startAt >= 0 &&
            typeof item.endAt === 'number' &&
            Number.isFinite(item.endAt) &&
            item.endAt > item.startAt &&
            (item.title === null || typeof item.title === 'string'),
        )
        .map(item => ({
            id: item.id as number,
            startAt: item.startAt as number,
            endAt: item.endAt as number,
            title: item.title as string | null,
        }))
        .sort((a, b) => a.startAt - b.startAt);
};

export interface OfflineDataBroadcastingInfo {
    videoFileId: apid.VideoFileId;
    fileSize: number;
    chunkSize: number;
    url: string;
    startAt: number | null;
}

export interface OfflineDataBroadcastingParam {
    type: 'offlineOriginal';
    videoFileId: apid.VideoFileId;
    url: string;
    fileSize: number;
    chunkSize: number;
    startAt: number | null;
    demultiplexServiceId?: number;
}

/** 元 TS を保存したオフライン動画からデータ放送 decoder の入力情報を作る。 */
export const createOfflineDataBroadcastingInfo = (
    record: {
        videoId: number;
        kind?: 'hls' | OfflineOriginalTsKind;
        originalURL?: string;
        originalFileSize?: number;
        originalChunkSize?: number;
        program: unknown;
    },
): OfflineDataBroadcastingInfo | null => {
    if (
        isOfflineOriginalTsProfile(record.kind) === false ||
        typeof record.originalURL !== 'string' ||
        record.originalURL.length === 0 ||
        !Number.isSafeInteger(record.videoId) ||
        !Number.isSafeInteger(record.originalFileSize) ||
        (record.originalFileSize as number) <= 0
    ) return null;

    const program = (record.program !== null && typeof record.program === 'object' ? record.program : {}) as Record<string, unknown>;
    const videoFiles = Array.isArray(program.videoFiles) ? program.videoFiles : [];
    const videoFile = videoFiles.find(item => item !== null && typeof item === 'object' && (item as { id?: unknown }).id === record.videoId);
    const startAt = videoFile !== undefined && typeof videoFile === 'object' && Number.isFinite((videoFile as { startAt?: unknown }).startAt)
        ? (videoFile as { startAt: number }).startAt
        : null;

    const chunkSize = Number.isSafeInteger(record.originalChunkSize) && (record.originalChunkSize as number) >= 188
        ? Math.floor((record.originalChunkSize as number) / 188) * 188
        : ORIGINAL_MPEG2_CHUNK_SIZE;
    return {
        videoFileId: record.videoId,
        fileSize: record.originalFileSize as number,
        chunkSize,
        url: record.originalURL,
        startAt,
    };
};

/** オフライン元 TS 情報を DataBroadcastingManager の接続パラメータへ組み立てる。 */
export const createOfflineDataBroadcastingParam = (
    videoFileId: number,
    url: string,
    fileSize: number,
    startAt: number | null | undefined,
    chunkSize = ORIGINAL_MPEG2_CHUNK_SIZE,
): OfflineDataBroadcastingParam | null => {
    if (
        !Number.isSafeInteger(videoFileId) ||
        videoFileId < 0 ||
        typeof url !== 'string' ||
        url.length === 0 ||
        !Number.isSafeInteger(fileSize) ||
        fileSize <= 0
    ) return null;
    const alignedChunkSize = Number.isSafeInteger(chunkSize) && chunkSize >= 188 ? Math.floor(chunkSize / 188) * 188 : 0;
    if (alignedChunkSize < 188) return null;
    return {
        type: 'offlineOriginal',
        videoFileId,
        url,
        fileSize,
        chunkSize: alignedChunkSize,
        startAt: typeof startAt === 'number' && Number.isFinite(startAt) ? startAt : null,
    };
};

/** MPEG-2 TS を Range 取得するチャンク境界へ分割する。 */
export const splitOfflineMpeg2Ranges = (
    fileSize: number,
    chunkSize = ORIGINAL_MPEG2_CHUNK_SIZE,
): OfflineChunkRange[] => {
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || !Number.isSafeInteger(chunkSize) || chunkSize < 188)
        return [];
    const alignedChunkSize = Math.floor(chunkSize / 188) * 188;
    if (alignedChunkSize < 188) return [];
    const ranges: OfflineChunkRange[] = [];
    for (let start = 0; start < fileSize; start += alignedChunkSize) {
        ranges.push({ start, end: Math.min(fileSize - 1, start + alignedChunkSize - 1) });
    }
    return ranges;
};

const formatTime = (time: number): Date => DateUtil.getJaDate(new Date(time));

const createProgramTime = (program: { startAt?: number; endAt?: number }): { time?: string; shortTime?: string } => {
    if (typeof program.startAt !== 'number' || typeof program.endAt !== 'number') return {};
    const start = formatTime(program.startAt);
    const end = formatTime(program.endAt);
    return {
        time: `${DateUtil.format(start, 'MM/dd(w) hh:mm')} ~ ${DateUtil.format(end, 'hh:mm')}`,
        shortTime: `${DateUtil.format(start, 'hh:mm')} ~ ${DateUtil.format(end, 'hh:mm')}`,
    };
};

const createGenreItems = (
    program: Record<string, unknown>,
    resolveGenre: ((genre: number, subGenre?: number) => string | null) | undefined,
): string[] | undefined => {
    if (resolveGenre === undefined) return undefined;
    const result: string[] = [];
    for (const index of [1, 2, 3]) {
        const genre = program[`genre${index}`];
        const subGenre = program[`subGenre${index}`];
        if (typeof genre !== 'number') continue;
        const text = resolveGenre(genre, typeof subGenre === 'number' ? subGenre : undefined);
        if (text !== null && text !== undefined && result.includes(text) === false) result.push(text);
    }
    return result.length > 0 ? result : undefined;
};

/** 保存済み RecordedItem のスナップショットだけから視聴画面向け番組情報を作る。 */
export const createOfflineProgramInfo = (
    value: unknown,
    options: OfflineProgramInfoOptions = {},
): OfflineProgramInfo => {
    const program = (value !== null && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const videoFiles = Array.isArray(program.videoFiles) ? program.videoFiles : [];
    const videoFile =
        videoFiles.find(item => typeof item === 'object' && item !== null && item.id === options.videoFileId) ??
        videoFiles[0];
    const typedVideo = (videoFile !== null && typeof videoFile === 'object' ? videoFile : {}) as Record<
        string,
        unknown
    >;
    const name = typeof program.name === 'string' && program.name.length > 0 ? program.name : '録画番組';
    const result: OfflineProgramInfo = {
        channelId: typeof program.channelId === 'number' ? program.channelId : null,
        channelName:
            options.channelName ??
            (typeof program.channelName === 'string' ? program.channelName : undefined) ??
            (typeof program.tsChannelName === 'string' ? program.tsChannelName : undefined),
        name: options.displayName ?? name,
        description: typeof program.description === 'string' ? program.description : undefined,
        extended: typeof program.extended === 'string' ? program.extended : undefined,
        ...createProgramTime({
            startAt: program.startAt as number | undefined,
            endAt: program.endAt as number | undefined,
        }),
        genreItems: createGenreItems(program, options.resolveGenre),
    };
    if (typeof program.startAt === 'number' && typeof program.endAt === 'number') {
        result.durationText = `${Math.max(0, Math.floor((program.endAt - program.startAt) / 60000))} 分`;
    }
    const videoParts = [
        program.videoType,
        program.videoResolution,
        typedVideo.width && typedVideo.height ? `${typedVideo.width}x${typedVideo.height}` : undefined,
        typedVideo.videoCodec ?? program.videoType,
    ];
    const videoText = videoParts
        .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
        .join(' / ');
    if (videoText !== '') result.videoText = videoText;
    const audioParts = [
        program.audioSamplingRate === undefined ? undefined : `${program.audioSamplingRate}Hz`,
        typedVideo.audioCodec,
    ];
    const audioText = audioParts.filter((item): item is string => typeof item === 'string').join(' / ');
    if (audioText !== '') result.audioText = audioText;
    const series = program.series as Record<string, unknown> | undefined;
    if (series !== undefined && typeof series.seriesTitle === 'string') {
        const episode = [series.episodeLabel, series.episodeTitle]
            .filter((item): item is string => typeof item === 'string' && item.length > 0)
            .join(' ');
        result.seriesText = episode === '' ? series.seriesTitle : `${series.seriesTitle} ${episode}`;
    }
    return result;
};

/** 録画一覧の videoFileId から保存済みレコードを O(n) で引く。 */
export const findOfflineVideoByIds = <T extends { videoId: number }>(records: T[], videoIds: number[]): T | null => {
    const ids = new Set(videoIds);
    return records.find(record => ids.has(record.videoId)) ?? null;
};

/** 保存済み動画の一意キーを取得する。旧保存データは videoFileId と世代から復元する。 */
export const getOfflineVideoKey = (record: { key?: string; videoId: number; generationId: string }): string =>
    record.key ?? createOfflineVideoKey(record.videoId, record.generationId);

/** URL の一意キーから保存済み動画を引く。 */
export const findOfflineVideoByKey = <T extends { key?: string; videoId: number; generationId: string }>(
    records: T[],
    key: string,
): T | null => records.find(record => getOfflineVideoKey(record) === key) ?? null;

/** オフライン視聴画面を直接開いた場合の戻り先を決める。通常はブラウザ履歴を優先する。 */
export const resolveOfflineWatchReturnPath = (origin: unknown, key: string, recordedId?: number): string => {
    switch (origin) {
        case 'detail':
            return `/offline-videos/${encodeURIComponent(key)}`;
        case 'recorded-detail':
            return Number.isSafeInteger(recordedId) && (recordedId as number) >= 0
                ? `/recorded/detail/${(recordedId as number).toString(10)}`
                : '/recorded';
        case 'recorded':
            return '/recorded';
        default:
            return '/offline-videos';
    }
};

/** 起動時状態と現在の回線状態から小さなオフライン表示を出すか決める。 */
export const shouldShowOfflineIndicator = (isOnline: boolean | undefined, offlineStartup: boolean): boolean =>
    isOnline === false || offlineStartup;
