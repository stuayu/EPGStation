import { inject, injectable } from 'inversify';
import * as path from 'path';
import FileUtil from '../../../util/FileUtil';
import EDCBFileNameParser from '../../recorded/import/EDCBFileNameParser';
import EDCBProgramTxtParser from '../../recorded/import/EDCBProgramTxtParser';
import ImportDirectoryScanner from '../../recorded/import/ImportDirectoryScanner';
import IChannelDB from '../../db/IChannelDB';
import IRecordedDB from '../../db/IRecordedDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IRecordedManageModel from './IRecordedManageModel';
import IImportWatchManageModel from './IImportWatchManageModel';
import IVideoFileDB from '../../db/IVideoFileDB';
import IVideoUtil from '../../api/video/IVideoUtil';
import ITsInfoAnalyzer, { TsInfo } from '../../recorded/ts/ITsInfoAnalyzer';
import {
    buildImportedVideoFilePathIndex,
    ImportedVideoFilePath,
    matchImportDuplicate,
    normalizeImportFilePath,
} from '../../../util/ImportDuplicateMatcher';
import { isImportTsFile } from '../../../util/ImportTsFileExtension';

type ImportCandidateOutcome = 'imported' | 'skipped' | 'failed';

/**
 * config.importWatch が有効な場合に importDirs を定期的に走査し、新規ファイルを自動で取り込む
 */
@injectable()
export default class ImportWatchManageModel implements IImportWatchManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private channelDB: IChannelDB;
    private recordedDB: IRecordedDB;
    private recordedManage: IRecordedManageModel;
    private tsInfoAnalyzer?: ITsInfoAnalyzer;
    private videoFileDB?: IVideoFileDB;
    private videoUtil?: IVideoUtil;

    private timer: NodeJS.Timeout | null = null;
    private seen: Set<string> = new Set();
    private isTicking: boolean = false;
    private readonly seenFilePath: string;
    private retryAttempts: Map<string, number> = new Map();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IRecordedManageModel') recordedManage: IRecordedManageModel,
        @inject('ITsInfoAnalyzer') tsInfoAnalyzer?: ITsInfoAnalyzer,
        @inject('IVideoFileDB') videoFileDB?: IVideoFileDB,
        @inject('IVideoUtil') videoUtil?: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.channelDB = channelDB;
        this.recordedDB = recordedDB;
        this.recordedManage = recordedManage;
        this.tsInfoAnalyzer = tsInfoAnalyzer;
        this.videoFileDB = videoFileDB;
        this.videoUtil = videoUtil;
        this.seenFilePath = path.join(__dirname, '..', '..', '..', '..', 'data', ImportWatchManageModel.FILE_NAME);
    }

    /**
     * 監視を開始する。config.importWatch が有効かつ importDirs が設定されている場合のみ動作する
     */
    public start(): void {
        if (this.config.importWatch !== true) {
            return;
        }

        const importDirs = this.config.importDirs ?? [];
        if (importDirs.length === 0) {
            this.log.system.warn('importWatch が有効ですが importDirs が設定されていないため監視を開始しません');

            return;
        }

        this.loadSeen().catch(() => {});

        const intervalSec = this.config.importWatchIntervalSec ?? 300;
        this.timer = setInterval(() => {
            this.tick().catch(err => {
                this.log.system.error('import watch tick error');
                this.log.system.error(err);
            });
        }, intervalSec * 1000);

        this.log.system.info(`import watch started: interval ${intervalSec}s`);
    }

    /**
     * 監視を停止する
     */
    public stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * importDirs を走査し、未処理の新規ファイルを取り込む
     */
    private async tick(): Promise<void> {
        if (this.isTicking === true) {
            return;
        }
        this.isTicking = true;

        try {
            const importDirs = this.config.importDirs ?? [];
            const channels = await this.channelDB.findAll();
            let importedPathIndex: Set<string> | null = null;

            for (const dir of importDirs) {
                const candidates = await ImportDirectoryScanner.scan(dir.path, true);

                for (const candidate of candidates) {
                    if (this.seen.has(candidate.filePath) === true) {
                        continue;
                    }

                    // 未処理候補が見つかった場合だけ索引を構築し、同一 tick 内で共有する。
                    importedPathIndex ??= await this.getImportedVideoFilePathIndex();
                    const outcome = await this.importCandidate(candidate, channels, importedPathIndex).catch(err => {
                        const nextRetryCount = (this.retryAttempts.get(candidate.filePath) ?? 0) + 1;
                        this.retryAttempts.set(candidate.filePath, nextRetryCount);
                        this.log.system.warn(`import watch: failed to import ${candidate.filePath}`);
                        this.log.system.warn(err);

                        return 'failed' as const;
                    });

                    if (outcome !== 'failed') {
                        this.seen.add(candidate.filePath);
                    }
                }
            }

            await this.saveSeen();
        } finally {
            this.isTicking = false;
        }
    }

    /**
     * 1 ファイル分の自動取り込み処理
     */
    private async importCandidate(
        candidate: ImportDirectoryScanner.CandidateFile,
        channels: { id: number; name: string; halfWidthName: string; serviceId: number }[],
        importedPathIndex: Set<string> = new Set(),
    ): Promise<ImportCandidateOutcome> {
        const retryCount = this.retryAttempts.get(candidate.filePath) ?? 0;
        if (retryCount >= ImportWatchManageModel.MAX_RETRY_ATTEMPTS) {
            this.log.system.warn(`import watch: retry limit reached, skip: ${candidate.filePath}`);

            return 'skipped';
        }

        if (importedPathIndex.has(normalizeImportFilePath(candidate.filePath))) {
            this.log.system.info(`import watch: already imported, skip: ${candidate.filePath}`);
            this.retryAttempts.delete(candidate.filePath);

            return 'skipped';
        }

        const parsedName = path.parse(candidate.fileName);
        let name = parsedName.name;
        let channelName: string | undefined;
        let startAt: number | undefined;

        const fileNameResult = EDCBFileNameParser.parse(parsedName.name, this.config.importFileNamePatterns ?? []);
        if (fileNameResult !== null) {
            if (typeof fileNameResult.name === 'string') name = fileNameResult.name;
            channelName = fileNameResult.channelName;
            startAt = fileNameResult.startAt;
        }

        if (candidate.programTxtPath !== null) {
            try {
                const content = await FileUtil.readFile(candidate.programTxtPath);
                const parsed = EDCBProgramTxtParser.parse(content);
                if (typeof parsed.name === 'string') name = parsed.name;
                if (typeof parsed.channelName === 'string') channelName = parsed.channelName;
                if (typeof parsed.startAt === 'number') startAt = parsed.startAt;
            } catch (err: any) {
                // 読み取り失敗時は無視してファイル名からの推定値を使う
            }
        }

        // ファイル名 / program.txt から局を先に求め、分かれば TS 解析の対象 service_id を固定する。
        let channel =
            typeof channelName === 'string'
                ? channels.find(
                      c =>
                          c.name === channelName ||
                          c.halfWidthName === channelName ||
                          c.name.includes(channelName as string),
                  )
                : undefined;
        const expectedServiceId = channel?.serviceId ?? null;
        const tsInfo = await this.analyzeTsInfo(candidate.filePath, expectedServiceId);
        if (tsInfo?.eventName !== null && typeof tsInfo?.eventName === 'string') name = tsInfo.eventName;
        if (tsInfo?.serviceName !== null && typeof tsInfo?.serviceName === 'string') channelName = tsInfo.serviceName;
        if (tsInfo?.eventStartAt !== null && typeof tsInfo?.eventStartAt === 'number') startAt = tsInfo.eventStartAt;

        let tsChannel: { id: number; name: string; halfWidthName: string; serviceId: number } | null = null;
        if (tsInfo !== null && tsInfo.networkId !== null && tsInfo.serviceId !== null) {
            tsChannel = await this.channelDB
                .findNetworkIdAndServiceId(tsInfo.networkId, tsInfo.serviceId)
                .catch(() => null);
        }
        if (typeof channel !== 'undefined' && tsInfo?.serviceId !== null && typeof tsInfo?.serviceId === 'number') {
            if (channel.serviceId !== tsInfo.serviceId || (tsChannel !== null && tsChannel.id !== channel.id)) {
                this.log.system.warn(`import watch: channel metadata mismatch, skip: ${candidate.filePath}`);

                return 'skipped';
            }
        } else if (typeof channel === 'undefined' && tsChannel !== null) {
            channel = tsChannel;
        }
        if (typeof channel === 'undefined' && typeof channelName === 'string') {
            channel = channels.find(
                c =>
                    c.name === channelName || c.halfWidthName === channelName || c.name.includes(channelName as string),
            );
        }

        if (typeof channel === 'undefined') {
            this.log.system.info(`import watch: channel could not be estimated, skip: ${candidate.filePath}`);

            return 'skipped';
        }

        if (typeof startAt !== 'number') {
            const stats = await FileUtil.stat(candidate.filePath);
            startAt = Math.floor(stats.mtimeMs);
        }

        // 局・時刻の候補から強一致だけ既存番組へ追加し、弱一致は従来どおり取り込まない。
        const duplicates = await this.recordedDB.findDuplicateCandidates(
            channel.id,
            startAt,
            ImportWatchManageModel.DUPLICATE_TOLERANCE_MS,
        );
        const match = matchImportDuplicate(
            { channelId: channel.id, startAt, name, tsInfo },
            duplicates,
            ImportWatchManageModel.DUPLICATE_TOLERANCE_MS,
        );
        if (match.matchedRecordedId === null && duplicates.length > 0) {
            this.log.system.info(`import watch: duplicate detected, skip: ${candidate.filePath}`);

            return 'skipped';
        }

        const importDirs = this.config.importDirs ?? [];
        const dirName = importDirs[0]?.name;
        if (typeof dirName === 'undefined') {
            return 'skipped';
        }

        const ext = path.extname(candidate.fileName).toLowerCase();
        const fileType = isImportTsFile(candidate.fileName) || ext === '.m2p' ? 'ts' : 'encoded';
        const mode = this.config.importDefaultMode ?? 'register';
        const parentDirectoryName = mode === 'move' ? this.config.recorded?.[0]?.name : dirName;

        const [result] = await this.recordedManage.importExternalRecordedFiles([
            {
                localFilePath: candidate.filePath,
                parentDirectoryName: parentDirectoryName ?? '',
                fileType,
                channelId: channel.id,
                mode,
                name,
                startAt,
                duplicateAction: match.matchedRecordedId === null ? undefined : 'add',
                duplicateRecordedId: match.matchedRecordedId ?? undefined,
            },
        ]);

        if (result?.imported === true) {
            this.retryAttempts.delete(candidate.filePath);
            this.log.system.info(`import watch: imported ${candidate.filePath}`);

            return 'imported';
        }

        if (typeof result?.error === 'string') {
            const nextRetryCount = retryCount + 1;
            this.retryAttempts.set(candidate.filePath, nextRetryCount);
            this.log.system.warn(
                `import watch: import failed (${nextRetryCount}/${ImportWatchManageModel.MAX_RETRY_ATTEMPTS}): ${candidate.filePath}: ${result.error}`,
            );

            return 'failed';
        }

        this.retryAttempts.delete(candidate.filePath);
        this.log.system.info(`import watch: skipped ${candidate.filePath}`);

        return 'skipped';
    }

    /**
     * 監視対象 TS の PSI/SI を解析する。
     * @param filePath: string TS ファイルパス
     * @return Promise<TsInfo | null> 解析できない場合は null
     */
    private async analyzeTsInfo(filePath: string, expectedServiceId: number | null): Promise<TsInfo | null> {
        if (isImportTsFile(filePath) === false || typeof this.tsInfoAnalyzer === 'undefined') return null;

        return await (
            expectedServiceId === null
                ? this.tsInfoAnalyzer.analyze(filePath)
                : this.tsInfoAnalyzer.analyze(filePath, { expectedServiceId })
        ).catch(() => null);
    }

    /**
     * 登録済み video_file の実パスを一括で取得する。
     * @return Promise<Set<string>> 比較用に正規化したパス集合
     */
    private async getImportedVideoFilePathIndex(): Promise<Set<string>> {
        const videoFileDB = this.videoFileDB;
        const videoUtil = this.videoUtil;
        if (typeof videoFileDB === 'undefined' || typeof videoUtil === 'undefined') return new Set();

        const files: ImportedVideoFilePath[] = [];
        for (const videoFile of await videoFileDB.findAll()) {
            const filePath = videoUtil.getFullFilePathFromVideoFile(videoFile);
            if (filePath !== null) {
                files.push({ filePath, videoFileId: videoFile.id, recordedId: videoFile.recordedId });
            }
        }

        return new Set((await buildImportedVideoFilePathIndex(files)).keys());
    }

    private async loadSeen(): Promise<void> {
        try {
            const content = await FileUtil.readFile(this.seenFilePath);
            const list: string[] = JSON.parse(content);
            this.seen = new Set(list);
        } catch (err: any) {
            this.seen = new Set();
        }
    }

    private async saveSeen(): Promise<void> {
        try {
            await FileUtil.writeFile(this.seenFilePath, JSON.stringify(Array.from(this.seen)));
        } catch (err: any) {
            this.log.system.error('failed to save import watch seen state');
            this.log.system.error(err);
        }
    }

    private static readonly FILE_NAME = 'importWatchSeen.json';
    // 重複とみなす時刻の許容誤差 (ms)
    private static readonly DUPLICATE_TOLERANCE_MS = 5 * 60 * 1000;
    // DB / ファイルシステムの一時障害を再試行するが、監視ログを無限に増やさない
    private static readonly MAX_RETRY_ATTEMPTS = 3;
}
