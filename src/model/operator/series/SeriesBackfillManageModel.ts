import { inject, injectable } from 'inversify';
import Series from '../../../db/entities/Series';
import IRecordedDB, { SeriesBackfillCandidateRow, SeriesBackfillFilter } from '../../db/IRecordedDB';
import IAppSettingDB from '../../db/IAppSettingDB';
import ISeriesDB from '../../db/ISeriesDB';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { isPlausibleProgramTitle, programConfidence, scoreCandidate } from '../../series/SeriesResolver';
import ISeriesResolver from '../../series/ISeriesResolver';
import ISyobocalProgramLookup from '../../metadata/syobocal/ISyobocalProgramLookup';
import IWorkDictionary, { WorkMatch } from '../../series/IWorkDictionary';
import { displaySeriesTitle, parseSeriesInfo } from '../../series/SeriesNormalizer';
import { SeriesResolveTrace } from '../../series/ISeriesResolver';
import ISeriesBackfillManageModel, {
    SeriesAnalyzeResult,
    SeriesBackfillOption,
    SeriesBackfillPreviewCandidate,
    SeriesBackfillPreviewItem,
    SeriesBackfillResult,
    SeriesBackfillStatus,
} from './ISeriesBackfillManageModel';

interface DecideResult {
    matched: boolean;
    seriesId: number | null;
    seriesTitle: string | null;
    confidence: number | null;
    candidates: SeriesBackfillPreviewCandidate[];
}

type BackfillMode = 'real' | 'transient';

/**
 * 既存録画のシリーズ化バックフィルを夜間の低優先バッチとしてチャンク分割しつつ実行する (提案書 §11.1)
 * - 中断・再開が自由: 実行状態 (カーソル・件数) を IAppSettingDB へチャンク毎に永続化するため、
 *   キャンセルや Operator プロセスの異常終了を挟んでも次回 start() で続きから再開できる
 * - チャンク単位で await this.sleep() を挟むことで、SQLite への録画書き込みと継続的に競合しないよう低優先度で動作する
 * - ドライラン (dryRun: true) は実バックフィルの進捗 (再開カーソル) に一切影響を与えないよう、
 *   実行状態を完全に分離したメモリ上の状態で完結させ、DB への書き込み (シリーズ作成・リンク保存・未確定キューへの追加) は行わない
 * - GET /api/series/backfill/status はグローバルに 1 つの実行スロットを見るだけなので、
 *   このクラスも直近に start() された方 (実行 or ドライラン) の状態を返す単一スロットのモデルとして実装する
 */
@injectable()
export default class SeriesBackfillManageModel implements ISeriesBackfillManageModel {
    private log: ILogger;
    private recordedDB: IRecordedDB;
    private seriesDB: ISeriesDB;
    private settingsDB: IAppSettingDB;
    private seriesResolver: ISeriesResolver;
    private workDictionary: IWorkDictionary;
    private programLookup: ISyobocalProgramLookup;

    private running: boolean = false;
    private cancelRequested: boolean = false;
    private persistedLoaded: boolean = false;
    // IAppSettingDB に永続化される実バックフィルの状態
    private realStatus: SeriesBackfillStatus = SeriesBackfillManageModel.initialStatus(false);
    // ドライラン・部分実行 (直近 N 件) 専用の状態 (永続化しない)。start() の度に初期化される
    private transientStatus: SeriesBackfillStatus | null = null;
    private previewItems: SeriesBackfillPreviewItem[] = [];
    private previewTruncated: boolean = false;
    // ドライラン中に「新規作成予定」と判定した仮シリーズ。
    // 実行時は作成直後のシリーズが後続録画の照合候補になるため、ドライランでも同一実行内の作成予定シリーズを候補に含めて挙動を再現する
    private dryRunVirtualSeries: Series[] = [];
    // getStatus() がどちらを返すか (直近に start() されたモード)
    private lastMode: BackfillMode = 'real';

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('ISeriesDB') seriesDB: ISeriesDB,
        @inject('IAppSettingDB') settingsDB: IAppSettingDB,
        @inject('ISeriesResolver') seriesResolver: ISeriesResolver,
        @inject('IWorkDictionary') workDictionary: IWorkDictionary,
        @inject('ISyobocalProgramLookup') programLookup: ISyobocalProgramLookup,
    ) {
        this.log = logger.getLogger();
        this.recordedDB = recordedDB;
        this.seriesDB = seriesDB;
        this.settingsDB = settingsDB;
        this.seriesResolver = seriesResolver;
        this.workDictionary = workDictionary;
        this.programLookup = programLookup;
    }

    /**
     * バックフィルを開始する (既に実行中の場合は現在の状態を返すのみ)
     * @param option: SeriesBackfillOption
     * @return Promise<SeriesBackfillResult>
     */
    public async start(option: SeriesBackfillOption = {}): Promise<SeriesBackfillResult> {
        await this.ensureRealStatusLoaded();

        if (this.running) {
            return this.publicStatus();
        }

        const dryRun = option.dryRun === true;
        const onlyUnlinked = option.onlyUnlinked === true;
        const latest = this.normalizeLatest(option.latest);
        const chunkSize = this.normalizeChunkSize(option.chunkSize);
        const intervalMs = this.normalizeIntervalMs(option.intervalMs);
        // 直近 N 件だけの部分実行は一時的な用途なので、ドライランと同じく永続カーソルを汚さない
        const persist = dryRun === false && latest === null;
        this.lastMode = persist ? 'real' : 'transient';

        // 直近 N 件だけを対象にする場合の下限 id (0 = 制限なし)
        const minId = latest === null ? 0 : await this.recordedDB.findSeriesBackfillFloorId(latest);
        const filter: SeriesBackfillFilter = { onlyUnlinked: onlyUnlinked, minId: minId };

        if (persist === true && option.restart === true) {
            // 前回の再開位置 (lastRecordedId) と件数を破棄して先頭から実行し直す
            this.realStatus = SeriesBackfillManageModel.initialStatus(false);
        }

        if (persist === false) {
            // ドライラン・部分実行は実バックフィルの進捗 (カーソル) に影響を与えないよう独立した状態で実行する
            this.transientStatus = SeriesBackfillManageModel.initialStatus(dryRun);
            // 直近 N 件だけを対象にする場合は、その下限の 1 つ手前からスキャンする
            this.transientStatus.lastRecordedId = minId > 0 ? minId - 1 : 0;
            this.previewItems = [];
            this.previewTruncated = false;
            this.dryRunVirtualSeries = [];
        }

        const status = persist === false ? (this.transientStatus as SeriesBackfillStatus) : this.realStatus;
        status.onlyUnlinked = onlyUnlinked;
        status.latest = latest;
        this.log.system.info(
            `series backfill: start (dryRun=${dryRun}, onlyUnlinked=${onlyUnlinked}, latest=${latest ?? 'なし'}, minId=${minId}, chunkSize=${chunkSize})`,
        );
        status.state = 'running';
        status.startedAt = status.startedAt ?? Date.now();
        status.finishedAt = null;
        status.error = null;
        this.cancelRequested = false;
        this.running = true;

        if (persist === true) {
            await this.persistReal();
        }

        this.runLoop(status, dryRun, persist, chunkSize, intervalMs, filter).catch(err => {
            this.log.system.error('series backfill: unexpected error');
            this.log.system.error(err);
            status.state = 'failed';
            status.error = err instanceof Error ? err.message : String(err);
            status.finishedAt = Date.now();
            this.running = false;
        });

        return this.publicStatus();
    }

    /**
     * 現在の進捗状況を取得する (直近に start() されたモードの状態を返す)
     * @return Promise<SeriesBackfillResult>
     */
    public async getStatus(): Promise<SeriesBackfillResult> {
        await this.ensureRealStatusLoaded();

        return this.publicStatus();
    }

    /**
     * 実行中のバックフィルをキャンセルする
     */
    public async cancel(): Promise<void> {
        if (this.running) {
            this.cancelRequested = true;
        }
    }

    /**
     * 録画 1 件だけシリーズ判定を実行し、判定過程のトレース付きで結果を返す。
     * バックフィルの進捗 (カーソル) には影響しない
     * @param recordedId: number
     * @return Promise<SeriesAnalyzeResult>
     */
    public async analyze(recordedId: number): Promise<SeriesAnalyzeResult> {
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNotFound');
        }

        const trace: SeriesResolveTrace = [];
        this.log.system.info(`series analyze: start recordedId=${recordedId} title=${recorded.name}`);

        let link = null;
        try {
            link = await this.seriesResolver.resolve(
                {
                    recordedId: recorded.id,
                    title: recorded.name,
                    channelId: recorded.channelId,
                    startAt: recorded.startAt,
                },
                trace,
            );
        } catch (err) {
            this.log.system.error(`series analyze: failed recordedId=${recordedId}`);
            this.log.system.error(err);
            trace.push({
                step: 'error',
                label: '判定中のエラー',
                input: recorded.name,
                output: err instanceof Error ? err.message : String(err),
                matched: false,
            });
        }

        // 判定過程はログにも残す (外部照会の入出力を運用ログから追えるようにする)
        for (const step of trace) {
            this.log.system.info(
                `series analyze: recordedId=${recordedId} [${step.step}] ${step.label} <- ${step.input} => ${step.output}`,
            );
        }

        const series = link === null ? null : await this.seriesDB.getSeries(link.seriesId);
        const episode =
            link === null || link.episodeId === null ? null : await this.seriesDB.findEpisodeById(link.episodeId);
        const pending = link === null ? (await this.seriesDB.findPendingMatchByRecordedId(recordedId)) !== null : false;

        return {
            recordedId: recorded.id,
            title: recorded.name,
            channelId: recorded.channelId,
            startAt: recorded.startAt,
            linked: link !== null,
            pending: pending,
            seriesId: link?.seriesId ?? null,
            seriesTitle: series?.title ?? null,
            episodeNumber: episode?.episodeNumber ?? null,
            episodeTitle: episode?.title ?? null,
            airType: link?.airType ?? null,
            matchMethod: link?.matchMethod ?? null,
            confidence: link?.confidence ?? null,
            manualLock: link?.manualLock === true,
            steps: trace,
        };
    }

    /**
     * バックフィル本体。チャンク単位で処理 → 進捗永続化 (実行時のみ) → 短い待機 を繰り返す
     */
    private async runLoop(
        status: SeriesBackfillStatus,
        dryRun: boolean,
        persist: boolean,
        chunkSize: number,
        intervalMs: number,
        filter: SeriesBackfillFilter,
    ): Promise<void> {
        try {
            for (;;) {
                if (this.cancelRequested) {
                    status.state = 'canceled';
                    status.finishedAt = Date.now();
                    if (persist) await this.persistReal();
                    this.log.system.info(`series backfill: canceled (processed=${status.processed})`);
                    break;
                }

                const rows = await this.recordedDB.findForSeriesBackfill(status.lastRecordedId, chunkSize, filter);
                if (rows.length === 0) {
                    status.state = 'completed';
                    status.finishedAt = Date.now();
                    status.total = status.processed;
                    if (persist) await this.persistReal();
                    this.log.system.info(
                        `series backfill: completed (processed=${status.processed}, linked=${status.linked}, ` +
                            `pending=${status.pending}, skipped=${status.skipped}, failed=${status.failed})`,
                    );
                    break;
                }

                const remaining = await this.recordedDB.countForSeriesBackfill(status.lastRecordedId, filter);
                status.total = status.processed + remaining;

                if (dryRun) {
                    await this.previewChunk(rows, status);
                } else {
                    await this.processChunk(rows, status, filter.onlyUnlinked === true);
                }

                status.lastRecordedId = rows[rows.length - 1].id;
                if (persist) await this.persistReal();

                await this.sleep(intervalMs);
            }
        } catch (err) {
            status.state = 'failed';
            status.error = err instanceof Error ? err.message : String(err);
            status.finishedAt = Date.now();
            if (persist) await this.persistReal();
            this.log.system.error('series backfill: failed');
            this.log.system.error(err);
        } finally {
            this.running = false;
        }
    }

    /**
     * 実行チャンク: manualLock (と onlyUnlinked 時のリンク済み録画) はスキップし、それ以外は SeriesResolver.resolve() を通す (冪等)
     */
    private async processChunk(
        rows: SeriesBackfillCandidateRow[],
        status: SeriesBackfillStatus,
        onlyUnlinked: boolean,
    ): Promise<void> {
        for (const row of rows) {
            try {
                const existingLink = await this.seriesDB.findLink(row.id);
                if (existingLink?.manualLock === true || (onlyUnlinked === true && existingLink !== null)) {
                    status.skipped++;
                } else {
                    const link = await this.seriesResolver.resolve({
                        recordedId: row.id,
                        title: row.name,
                        channelId: row.channelId,
                        startAt: row.startAt,
                    });

                    if (link !== null) {
                        status.linked++;
                    } else {
                        const pending = await this.seriesDB.findPendingMatchByRecordedId(row.id);
                        if (pending !== null) {
                            status.pending++;
                        } else {
                            status.skipped++;
                        }
                    }
                }
            } catch (err) {
                status.failed++;
                this.log.system.error(`series backfill: failed to resolve recordedId=${row.id}`);
                this.log.system.error(err);
            }

            status.processed++;
        }
    }

    /**
     * ドライランチャンク: DB を変更せずマッチ結果のみを判定してプレビューに積む
     */
    private async previewChunk(rows: SeriesBackfillCandidateRow[], status: SeriesBackfillStatus): Promise<void> {
        for (const row of rows) {
            try {
                const existingLink = await this.seriesDB.findLink(row.id);
                if (existingLink?.manualLock === true) {
                    status.skipped++;
                } else {
                    const decision = await this.decide(row);
                    if (decision.matched) {
                        status.linked++;
                    } else {
                        status.pending++;
                    }

                    if (this.previewItems.length < SeriesBackfillManageModel.MAX_PREVIEW_ITEMS) {
                        this.previewItems.push({
                            recordedId: row.id,
                            title: row.name,
                            matched: decision.matched,
                            seriesId: decision.seriesId,
                            seriesTitle: decision.seriesTitle,
                            confidence: decision.confidence,
                            candidates: decision.candidates,
                        });
                    } else {
                        this.previewTruncated = true;
                    }
                }
            } catch (err) {
                status.failed++;
                this.log.system.error(`series backfill preview: failed to evaluate recordedId=${row.id}`);
                this.log.system.error(err);
            }

            status.processed++;
        }
    }

    /**
     * DB を変更せずに SeriesResolver.resolve() 相当の判定のみ行う (エイリアス → 類似度スコアリング)
     * 候補ゼロの場合は実行時には新規シリーズが自動作成される想定として matched: true (seriesId: null) を返す
     */
    private async decide(row: SeriesBackfillCandidateRow): Promise<DecideResult> {
        const parsed = parseSeriesInfo(row.name);
        if (!parsed.normalizedTitle) {
            return { matched: false, seriesId: null, seriesTitle: null, confidence: null, candidates: [] };
        }

        // 実行時 (SeriesResolver) と同じく、しょぼいカレンダーの放送予定を最優先で引く。
        // これを省くとプレビューの「未確定」が実行では確定してしまい、結果が食い違う
        const programMatch = await this.lookupByProgram(row);
        if (programMatch !== null) {
            const existing =
                programMatch.syobocalTid === null
                    ? null
                    : await this.seriesDB.findBySyobocalTid(programMatch.syobocalTid);
            return {
                matched: true,
                // 実行時に新規作成されるシリーズは seriesId: null で表す
                seriesId: existing?.id ?? null,
                seriesTitle: existing?.title ?? programMatch.title,
                confidence: programMatch.confidence,
                candidates: [],
            };
        }

        const alias = await this.seriesDB.findAlias(parsed.normalizedTitle);
        if (alias) {
            const aliasSeries = await this.seriesDB.getSeries(alias.seriesId);
            if (aliasSeries) {
                return {
                    matched: true,
                    seriesId: aliasSeries.id,
                    seriesTitle: aliasSeries.title,
                    confidence: 1,
                    candidates: [],
                };
            }
        }

        // 実行時 (SeriesResolver) と同じく作品辞書を類似度スコアリングより先に引く
        const dictionaryMatch = await Promise.resolve()
            // resolve() と同じく、再放送でなければ放送日時を渡して続編の期を選び分ける
            .then(
                async () =>
                    await this.workDictionary.lookup(row.name, parsed.airType === 'rerun' ? undefined : row.startAt),
            )
            .catch(() => null);
        if (dictionaryMatch !== null) {
            const existing =
                dictionaryMatch.syobocalTid !== null
                    ? await this.seriesDB.findBySyobocalTid(dictionaryMatch.syobocalTid)
                    : dictionaryMatch.annictId !== null
                      ? await this.seriesDB.findByAnnictId(String(dictionaryMatch.annictId))
                      : null;
            return {
                matched: true,
                // 実行時に新規作成されるシリーズは seriesId: null で表す
                seriesId: existing?.id ?? null,
                seriesTitle: existing?.title ?? dictionaryMatch.title,
                confidence: dictionaryMatch.confidence,
                candidates: [],
            };
        }

        // 実行時 (SeriesResolver) は直前に作成されたシリーズも DB から候補として引けるため、
        // ドライランでも同一実行内で「新規作成予定」とした仮シリーズを候補に加えて挙動を再現する
        const dbCandidates = await this.seriesDB.findCandidates(parsed.normalizedTitle);
        const virtualCandidates = this.findVirtualCandidates(parsed.normalizedTitle);
        // SeriesDB.findCandidates() と同様に、完全一致があれば完全一致のみを候補とする
        const merged = [...dbCandidates, ...virtualCandidates];
        const exactMatches = merged.filter(candidate => candidate.normalizedTitle === parsed.normalizedTitle);
        const candidates = exactMatches.length > 0 ? exactMatches : merged;
        const settings = await this.settingsDB.getAll();
        const threshold = this.threshold((settings.series as any)?.matchThreshold);

        let winner: Series | null = null;
        let confidence = 0;
        for (const candidate of candidates) {
            const score = scoreCandidate(parsed.normalizedTitle, candidate, row.channelId);
            if (score > confidence) {
                winner = candidate;
                confidence = score;
            }
        }

        if (candidates.length === 0) {
            // 実行時にはこの録画を起点に新規シリーズが自動作成されるため、
            // 仮シリーズとして登録して同一ドライラン内の後続録画の判定に反映する
            const title = displaySeriesTitle(row.name);
            this.dryRunVirtualSeries.push({
                id: SeriesBackfillManageModel.VIRTUAL_SERIES_ID,
                title,
                normalizedTitle: parsed.normalizedTitle,
                preferredChannelId: row.channelId,
            } as Series);

            return { matched: true, seriesId: null, seriesTitle: title, confidence: 1, candidates: [] };
        }

        if (!winner || confidence < threshold) {
            const ranked = candidates
                .map(candidate => ({
                    // 仮シリーズ (このドライラン中に新規作成予定) は seriesId: null で表す
                    seriesId: candidate.id === SeriesBackfillManageModel.VIRTUAL_SERIES_ID ? null : candidate.id,
                    seriesTitle: candidate.title,
                    score: scoreCandidate(parsed.normalizedTitle, candidate, row.channelId),
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 3);

            return { matched: false, seriesId: null, seriesTitle: null, confidence: null, candidates: ranked };
        }

        return {
            matched: true,
            // 仮シリーズ (このドライラン中に新規作成予定) への割当は seriesId: null で表す
            seriesId: winner.id === SeriesBackfillManageModel.VIRTUAL_SERIES_ID ? null : winner.id,
            seriesTitle: winner.title,
            confidence,
            candidates: [],
        };
    }

    /**
     * しょぼいカレンダーの放送予定 (放送局 + 放送開始時刻) から作品を引く (ドライラン用)。
     * SeriesResolver.resolveByProgram() と同じ条件・同じ確度で判定する
     * @param row: SeriesBackfillCandidateRow
     * @return Promise<WorkMatch | null>
     */
    private async lookupByProgram(row: SeriesBackfillCandidateRow): Promise<WorkMatch | null> {
        try {
            const program = (await this.programLookup.lookup(row.channelId, row.startAt)).match;
            if (program === null) return null;
            const match = await this.workDictionary.findByIds({ syobocalTid: program.tid });
            if (match === null) return null;
            // 時刻ずれ・キー局の代用で別番組を拾った場合を弾く (SeriesResolver と同じ判定)
            if (isPlausibleProgramTitle(row.name, match.title) === false) return null;

            return { ...match, confidence: programConfidence(program) };
        } catch {
            return null;
        }
    }

    // ドライラン専用の仮シリーズ ID (実シリーズの id は 1 以上のため衝突しない)
    private static readonly VIRTUAL_SERIES_ID = 0;

    /**
     * SeriesDB.findCandidates() と同じ規則 (完全一致 → 先頭 4 文字の部分一致) で仮シリーズから候補を探す
     * @param normalizedTitle: string 正規化済みタイトル
     * @return Series[]
     */
    private findVirtualCandidates(normalizedTitle: string): Series[] {
        const exact = this.dryRunVirtualSeries.filter(series => series.normalizedTitle === normalizedTitle);
        if (exact.length > 0) return exact;

        const key = normalizedTitle.slice(0, Math.min(4, normalizedTitle.length));
        if (key === '') return [];

        return this.dryRunVirtualSeries.filter(series => series.normalizedTitle.includes(key));
    }

    private threshold(value: unknown): number {
        return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.8;
    }

    /**
     * IAppSettingDB から永続化された実バックフィルの状態を読み込む (プロセス生存期間中 1 度だけ)
     * 異常終了により 'running' のまま保存されていた場合は 'canceled' 扱いとし、次回 start() で再開できるようにする
     */
    private async ensureRealStatusLoaded(): Promise<void> {
        if (this.persistedLoaded) {
            return;
        }
        this.persistedLoaded = true;

        const all = await this.settingsDB.getAll();
        const saved = (all as Record<string, unknown>)[SeriesBackfillManageModel.SETTING_KEY];
        if (saved && typeof saved === 'object') {
            this.realStatus = {
                ...SeriesBackfillManageModel.initialStatus(false),
                ...(saved as SeriesBackfillStatus),
                dryRun: false,
            };
            if (this.realStatus.state === 'running') {
                this.realStatus.state = 'canceled';
            }
        }
    }

    /**
     * 実バックフィルの状態を永続化する (ドライランは永続化しない)
     */
    private async persistReal(): Promise<void> {
        await this.settingsDB.upsert({ [SeriesBackfillManageModel.SETTING_KEY]: this.realStatus });
    }

    private publicStatus(): SeriesBackfillResult {
        if (this.lastMode === 'transient' && this.transientStatus !== null) {
            return {
                ...this.transientStatus,
                previewItems: [...this.previewItems],
                previewTruncated: this.previewTruncated,
            };
        }

        return { ...this.realStatus };
    }

    private normalizeChunkSize(value: number | undefined): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return SeriesBackfillManageModel.DEFAULT_CHUNK_SIZE;
        }

        return Math.min(500, Math.max(1, Math.floor(value)));
    }

    /**
     * 「直近 N 件」の指定を正規化する (未指定・不正値は null = 制限なし)
     * @param value: number | undefined
     * @return number | null
     */
    private normalizeLatest(value: number | undefined): number | null {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
            return null;
        }

        return Math.min(SeriesBackfillManageModel.MAX_LATEST, Math.floor(value));
    }

    private normalizeIntervalMs(value: number | undefined): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return SeriesBackfillManageModel.CHUNK_INTERVAL_MS;
        }

        return Math.min(60000, Math.max(0, Math.floor(value)));
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private static initialStatus(dryRun: boolean): SeriesBackfillStatus {
        return {
            state: 'idle',
            dryRun,
            total: 0,
            processed: 0,
            linked: 0,
            pending: 0,
            skipped: 0,
            failed: 0,
            startedAt: null,
            finishedAt: null,
            lastRecordedId: 0,
            error: null,
        };
    }

    // IAppSettingDB に永続化する際のキー
    private static readonly SETTING_KEY = 'seriesBackfill';
    // 1 チャンクあたりのデフォルト処理件数
    private static readonly DEFAULT_CHUNK_SIZE = 50;
    // チャンク間の待機時間 (ms)。SQLite への録画書き込みと競合しないよう低優先度で動作させる
    private static readonly CHUNK_INTERVAL_MS = 500;
    // ドライランのプレビュー結果として保持する最大件数 (メモリ肥大化防止)
    private static readonly MAX_PREVIEW_ITEMS = 2000;
    // 「直近 N 件」で指定できる上限
    private static readonly MAX_LATEST = 10000;
}
