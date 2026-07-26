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

    private timer: NodeJS.Timeout | null = null;
    private seen: Set<string> = new Set();
    private isTicking: boolean = false;
    private readonly seenFilePath: string;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IRecordedManageModel') recordedManage: IRecordedManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.channelDB = channelDB;
        this.recordedDB = recordedDB;
        this.recordedManage = recordedManage;
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

            for (const dir of importDirs) {
                const candidates = await ImportDirectoryScanner.scan(dir.path, true);

                for (const candidate of candidates) {
                    if (this.seen.has(candidate.filePath) === true) {
                        continue;
                    }

                    await this.importCandidate(candidate, channels).catch(err => {
                        this.log.system.warn(`import watch: failed to import ${candidate.filePath}`);
                        this.log.system.warn(err);
                    });

                    this.seen.add(candidate.filePath);
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
        channels: { id: number; name: string; halfWidthName: string }[],
    ): Promise<void> {
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

        if (typeof channelName === 'undefined') {
            this.log.system.info(`import watch: channel could not be estimated, skip: ${candidate.filePath}`);

            return;
        }

        const channel = channels.find(
            c => c.name === channelName || c.halfWidthName === channelName || c.name.includes(channelName as string),
        );
        if (typeof channel === 'undefined') {
            this.log.system.info(`import watch: channel "${channelName}" not found, skip: ${candidate.filePath}`);

            return;
        }

        if (typeof startAt !== 'number') {
            const stats = await FileUtil.stat(candidate.filePath);
            startAt = Math.floor(stats.mtimeMs);
        }

        // 重複チェック (5 分以内の同一チャンネル番組が既にあれば取り込まない)
        const duplicates = await this.recordedDB.findDuplicateCandidates(
            channel.id,
            startAt,
            ImportWatchManageModel.DUPLICATE_TOLERANCE_MS,
        );
        if (duplicates.length > 0) {
            this.log.system.info(`import watch: duplicate detected, skip: ${candidate.filePath}`);

            return;
        }

        const importDirs = this.config.importDirs ?? [];
        const dirName = importDirs[0]?.name;
        if (typeof dirName === 'undefined') {
            return;
        }

        const ext = path.extname(candidate.fileName).toLowerCase();
        const fileType = ext === '.ts' || ext === '.m2ts' || ext === '.m2p' ? 'ts' : 'encoded';

        await this.recordedManage.importExternalRecordedFiles([
            {
                localFilePath: candidate.filePath,
                parentDirectoryName: dirName,
                fileType,
                channelId: channel.id,
                mode: this.config.importDefaultMode ?? 'register',
                name,
                startAt,
            },
        ]);

        this.log.system.info(`import watch: imported ${candidate.filePath}`);
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
}
