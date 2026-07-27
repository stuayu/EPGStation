import * as fs from 'fs';
import minimist from 'minimist';
import 'reflect-metadata';
import { install } from 'source-map-support';
import RecordedSeriesLink from './db/entities/RecordedSeriesLink';
import IDBOperator from './model/db/IDBOperator';
import IRecordedDB from './model/db/IRecordedDB';
import ISeriesDB from './model/db/ISeriesDB';
import IConnectionCheckModel from './model/IConnectionCheckModel';
import ILogger from './model/ILogger';
import ILoggerModel from './model/ILoggerModel';
import container from './model/ModelContainer';
import * as containerSetter from './model/ModelContainerSetter';
import ILlmTitleExtractor from './model/series/ILlmTitleExtractor';
import IWorkDictionary, { WorkMatch } from './model/series/IWorkDictionary';
import { buildSeriesLookupKeys, parseSeriesInfo } from './model/series/SeriesNormalizer';

install();

containerSetter.set(container);

interface UnmatchedGroup {
    // 正規化済みタイトル (グループキー)
    normalizedTitle: string;
    // このグループに属する録画件数
    count: number;
    // 話数表記を抽出できた件数 (多いほどアニメ等の連続番組である可能性が高い)
    episodeCount: number;
    // 未確定キュー (series_pending_match) に積まれている件数
    pendingCount: number;
    // 生の録画タイトルのサンプル (最大 3 件)
    samples: string[];
    // 作品辞書を引くのに使われた照合キー候補
    lookupKeys: string[];
    // ローカル LLM による解析結果 (--llm 指定時のみ)
    llm?: {
        extractedTitle: string | null;
        matched: boolean;
        matchedTitle: string | null;
        matchType: string | null;
        source: string | null;
    };
}

interface DictionaryHitRow {
    recordedId: number;
    title: string;
    matchedTitle: string;
    matchType: WorkMatch['matchType'];
    source: WorkMatch['source'];
}

/**
 * 録画済み番組のうち、作品辞書 (しょぼいカレンダー + Annict) とマッピングできていない
 * タイトルを抽出・分類する解析ツール。サーバーを止めずに実行できる (読み取り専用)。
 *
 * 使い方:
 *   npm run analyze-series                        # コンソールにサマリーを出力
 *   npm run analyze-series -- -o report.json      # 詳細を JSON へ出力
 *   npm run analyze-series -- --llm               # 未マッチ分をローカル LLM で解析 (要 seriesLlm 設定)
 *   npm run analyze-series -- --top 50            # コンソールに出す未マッチグループ数 (既定 30)
 *   npm run analyze-series -- --llm --llm-max 50  # LLM 解析の上限グループ数 (既定 100)
 */
class SeriesAnalyzeTool {
    private log: ILogger;
    private connectionChecker: IConnectionCheckModel;
    private dbOperator: IDBOperator;
    private recordedDB: IRecordedDB;
    private seriesDB: ISeriesDB;
    private workDictionary: IWorkDictionary;
    private llmExtractor: ILlmTitleExtractor;

    private outputPath: string | null;
    private useLlm: boolean;
    private topCount: number;
    private llmMax: number;

    constructor() {
        const args = minimist(process.argv.slice(2), {
            alias: { o: 'output' },
            string: ['output'],
            boolean: ['llm'],
        });

        this.outputPath = typeof args.output === 'string' && args.output !== '' ? args.output : null;
        this.useLlm = args.llm === true;
        this.topCount = this.toPositiveInt(args.top, 30);
        this.llmMax = this.toPositiveInt(args['llm-max'], 100);

        const logger = container.get<ILoggerModel>('ILoggerModel');
        logger.initialize();
        this.log = logger.getLogger();
        this.connectionChecker = container.get<IConnectionCheckModel>('IConnectionCheckModel');
        this.dbOperator = container.get<IDBOperator>('IDBOperator');
        this.recordedDB = container.get<IRecordedDB>('IRecordedDB');
        this.seriesDB = container.get<ISeriesDB>('ISeriesDB');
        this.workDictionary = container.get<IWorkDictionary>('IWorkDictionary');
        this.llmExtractor = container.get<ILlmTitleExtractor>('ILlmTitleExtractor');
    }

    public async run(): Promise<void> {
        this.log.system.info('--- series analyze start ---');
        await this.connectionChecker.checkDB();

        // 1. リンク済み録画 ID と未確定キューを先にまとめて引く (N+1 を避ける)
        const connection = await this.dbOperator.getConnection();
        const links = await connection.getRepository(RecordedSeriesLink).find();
        const linkedMethods = new Map<number, string>();
        for (const link of links) linkedMethods.set(link.recordedId, link.matchMethod);

        const [pendingRows] = await this.seriesDB.listPendingMatches(0, 1000000);
        const pendingIds = new Set<number>(pendingRows.map(row => row.recordedId));

        // 2. 全録画をページングしながら分類する
        const methodCounts: Record<string, number> = {};
        const dictionaryHits: DictionaryHitRow[] = [];
        const groups = new Map<string, UnmatchedGroup>();
        let total = 0;
        let linkedCount = 0;
        let dictionaryHitCount = 0;
        let unmatchedCount = 0;
        let afterId = 0;

        for (;;) {
            const rows = await this.recordedDB.findForSeriesBackfill(afterId, 1000);
            if (rows.length === 0) break;
            for (const row of rows) {
                afterId = row.id;
                total++;

                const method = linkedMethods.get(row.id);
                if (typeof method !== 'undefined') {
                    linkedCount++;
                    methodCounts[method] = (methodCounts[method] ?? 0) + 1;
                    continue;
                }

                const match = await this.workDictionary.lookup(row.name).catch(() => null);
                if (match !== null) {
                    // 辞書では当たるがリンク未作成 = バックフィル未実行か、実行後に辞書が更新された分
                    dictionaryHitCount++;
                    if (dictionaryHits.length < 500) {
                        dictionaryHits.push({
                            recordedId: row.id,
                            title: row.name,
                            matchedTitle: match.title,
                            matchType: match.matchType,
                            source: match.source,
                        });
                    }
                    continue;
                }

                // 辞書で当たらない未マッチ分。正規化タイトルでグループ化する
                unmatchedCount++;
                const parsed = parseSeriesInfo(row.name);
                const key = parsed.normalizedTitle;
                let group = groups.get(key);
                if (typeof group === 'undefined') {
                    group = {
                        normalizedTitle: key,
                        count: 0,
                        episodeCount: 0,
                        pendingCount: 0,
                        samples: [],
                        lookupKeys: buildSeriesLookupKeys(row.name),
                    };
                    groups.set(key, group);
                }
                group.count++;
                if (parsed.episodeNumber !== null) group.episodeCount++;
                if (pendingIds.has(row.id)) group.pendingCount++;
                if (group.samples.length < 3 && group.samples.includes(row.name) === false) {
                    group.samples.push(row.name);
                }
            }
        }

        const sortedGroups = [...groups.values()].sort((a, b) => b.count - a.count);

        // 3. オプション: 未マッチグループをローカル LLM で解析し、辞書を引き直して解決可能か検証する
        let llmResolvable = 0;
        let llmAnalyzed = 0;
        if (this.useLlm) {
            if (this.llmExtractor.isEnabled() === false) {
                this.log.system.warn('config.yml の seriesLlm (url / model) が未設定のため LLM 解析をスキップします');
            } else {
                const targets = sortedGroups.slice(0, this.llmMax);
                this.log.system.info(`llm analysis: ${targets.length} groups`);
                for (const group of targets) {
                    llmAnalyzed++;
                    const extracted = await this.llmExtractor.extractWorkTitle(group.samples[0]);
                    let match: WorkMatch | null = null;
                    if (extracted !== null) {
                        match = await this.workDictionary.lookup(extracted).catch(() => null);
                    }
                    group.llm = {
                        extractedTitle: extracted,
                        matched: match !== null,
                        matchedTitle: match?.title ?? null,
                        matchType: match?.matchType ?? null,
                        source: match?.source ?? null,
                    };
                    if (match !== null) llmResolvable++;
                }
            }
        }

        // 4. レポート出力
        this.printReport(
            { total, linkedCount, methodCounts, dictionaryHitCount, unmatchedCount, llmAnalyzed, llmResolvable },
            sortedGroups,
        );

        if (this.outputPath !== null) {
            const report = {
                generatedAt: new Date().toISOString(),
                summary: {
                    totalRecorded: total,
                    linked: linkedCount,
                    linkedByMethod: methodCounts,
                    dictionaryHitButNotLinked: dictionaryHitCount,
                    unmatched: unmatchedCount,
                    unmatchedGroups: sortedGroups.length,
                    llmAnalyzedGroups: llmAnalyzed,
                    llmResolvableGroups: llmResolvable,
                },
                dictionaryHitButNotLinked: dictionaryHits,
                unmatchedGroups: sortedGroups,
            };
            fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 4), 'utf-8');
            this.log.system.info(`report written: ${this.outputPath}`);
        }

        await this.dbOperator.closeConnection();
        this.log.system.info('--- series analyze finish ---');
        process.exit(0);
    }

    private printReport(
        summary: {
            total: number;
            linkedCount: number;
            methodCounts: Record<string, number>;
            dictionaryHitCount: number;
            unmatchedCount: number;
            llmAnalyzed: number;
            llmResolvable: number;
        },
        sortedGroups: UnmatchedGroup[],
    ): void {
        const lines: string[] = [];
        const percent = (n: number): string =>
            summary.total === 0 ? '0.0%' : `${((n / summary.total) * 100).toFixed(1)}%`;

        lines.push('');
        lines.push('===== シリーズマッピング解析レポート =====');
        lines.push(`録画総数:                 ${summary.total}`);
        lines.push(`リンク済み:               ${summary.linkedCount} (${percent(summary.linkedCount)})`);
        for (const [method, count] of Object.entries(summary.methodCounts).sort((a, b) => b[1] - a[1])) {
            lines.push(`    - ${method}: ${count}`);
        }
        lines.push(`辞書ヒット/リンク未作成:   ${summary.dictionaryHitCount} (バックフィル再実行で解消できる見込み)`);
        lines.push(`未マッチ:                 ${summary.unmatchedCount} (${percent(summary.unmatchedCount)})`);
        if (summary.llmAnalyzed > 0) {
            lines.push(
                `LLM 解析:                 ${summary.llmAnalyzed} グループ中 ${summary.llmResolvable} グループが解決可能`,
            );
        }
        lines.push('');
        lines.push(`===== 未マッチグループ (件数順上位 ${Math.min(this.topCount, sortedGroups.length)} 件) =====`);
        for (const group of sortedGroups.slice(0, this.topCount)) {
            lines.push(`[${group.count}件] ${group.samples[0]}`);
            lines.push(`    正規化: ${group.normalizedTitle}`);
            lines.push(`    照合キー: ${group.lookupKeys.join(' / ')}`);
            if (group.episodeCount > 0 || group.pendingCount > 0) {
                lines.push(`    話数表記あり: ${group.episodeCount}件, 未確定キュー: ${group.pendingCount}件`);
            }
            if (typeof group.llm !== 'undefined') {
                const llm = group.llm;
                if (llm.matched) {
                    lines.push(
                        `    LLM: 「${llm.extractedTitle}」→ ${llm.matchedTitle} (${llm.source}/${llm.matchType}) ← 解決可能`,
                    );
                } else if (llm.extractedTitle !== null) {
                    lines.push(`    LLM: 「${llm.extractedTitle}」→ 辞書に該当なし (辞書未収録 or 非アニメ)`);
                } else {
                    lines.push('    LLM: 作品名を抽出できず (非アニメ番組の可能性)');
                }
            }
        }
        lines.push('');
        console.log(lines.join('\n'));
    }

    private toPositiveInt(value: unknown, defaultValue: number): number {
        const num = Number(value);
        return Number.isFinite(num) && num > 0 ? Math.floor(num) : defaultValue;
    }
}

new SeriesAnalyzeTool().run().catch(err => {
    console.error(err);
    process.exit(1);
});
