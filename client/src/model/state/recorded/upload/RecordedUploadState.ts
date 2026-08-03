import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import IRuleApiModel from '../../../..//model/api/rule/IRuleApiModel';
import GenreUtil from '../../../../util/GenreUtil';
import { isFeatureEnabled } from '../../../../util/FeatureFlags';
import IVideoApiModel from '../../..//api/video/IVideoApiModel';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import IChannelModel from '../../../channels/IChannelModel';
import IServerConfigModel from '../../../serverConfig/IServerConfigModel';
import { ISettingStorageModel } from '../../../storage/setting/ISettingStorageModel';
import IRecordedUploadState, { ImportScanRowItem, SelectorItem, ServerFileItem, UploadProgramOption, VideoFileItem } from './IRecordedUploadState';

@injectable()
class RecordedUploadState implements IRecordedUploadState {
    public programOption: UploadProgramOption = {
        ruleId: null,
        channelId: undefined,
        startAt: null,
        duration: null,
        name: null,
        description: null,
        extended: null,
        genre1: undefined,
        subGenre1: undefined,
    };
    public videoFileItems: VideoFileItem[] = [];
    // TS の PSI/SI から番組情報をサーバー側で自動取得するか (放送 TS を上げる場合の既定)
    public isAutoDetect: boolean = true;

    public ruleKeyword: string | null = null;
    public ruleItems: apid.RuleKeywordItem[] = [];
    public isShowPeriod: boolean = true;

    // 外部録画ファイル取り込みウィザード用の状態
    public importDirName: string | undefined;
    public importSubPath: string | null = null;
    public importRecursive: boolean = true;
    public importParentDirectoryName: string | undefined;
    public importScanResults: ImportScanRowItem[] = [];
    public importJobStatus: apid.ImportJobStatus | null = null;
    public importIsScanning: boolean = false;
    private importPollingTimer: number | undefined;

    private settingModel: ISettingStorageModel;
    private channelModel: IChannelModel;
    private serverConfig: IServerConfigModel;
    private ruleApiModel: IRuleApiModel;
    private recordedApiModel: IRecordedApiModel;
    private videoApiModel: IVideoApiModel;

    private channelItems: SelectorItem[] = [];
    private genreItems: SelectorItem[] = [];
    private subGemreItems: SelectorItem[][] = [];
    private videoItemCnt: number = 0;

    constructor(
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
        @inject('IChannelModel') channelModel: IChannelModel,
        @inject('IRuleApiModel') ruleApiModel: IRuleApiModel,
        @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel,
        @inject('IVideoApiModel') videoApiModel: IVideoApiModel,
    ) {
        this.serverConfig = serverConfig;
        this.settingModel = settingModel;
        this.channelModel = channelModel;
        this.ruleApiModel = ruleApiModel;
        this.recordedApiModel = recordedApiModel;
        this.videoApiModel = videoApiModel;

        this.genreItems = GenreUtil.getGenreListItems();
        for (let i = 0; i < GenreUtil.GENRE_MAX_NUM; i++) {
            this.subGemreItems.push(GenreUtil.getSubGenreListItems(i));
        }
    }

    /**
     * 各種変数初期化
     */
    public init(): void {
        this.programOption = {
            ruleId: null,
            channelId: undefined,
            startAt: null,
            duration: null,
            name: null,
            description: null,
            extended: null,
            genre1: undefined,
            subGenre1: undefined,
        };

        this.isAutoDetect = true;
        this.videoItemCnt = 0;
        this.videoFileItems = [];
        this.addEmptyVideoFileItem();

        this.importDirName = this.getImportDirItems()[0];
        this.importSubPath = null;
        this.importRecursive = true;
        this.importParentDirectoryName = this.getPrentDirectoryItems()[0];
        this.importScanResults = [];
        this.importJobStatus = null;
        this.stopImportPolling();

        if (this.channelItems.length === 0) {
            const channels = this.channelModel.getChannels(this.settingModel.getSavedValue().isHalfWidthDisplayed);
            for (const c of channels) {
                this.channelItems.push({
                    title: c.name,
                    value: c.id,
                });
            }
        }
    }

    /**
     * 各種データ取得
     * @return Promise<void>
     */
    public async fetchData(): Promise<void> {
        await this.updateRuleItems();
    }

    /**
     * ルール item 更新
     */
    public async updateRuleItems(): Promise<void> {
        const keywordItems = await this.ruleApiModel.searchKeyword(this.createSearchKeywordOption());
        this.ruleItems.splice(-this.ruleItems.length);
        for (const k of keywordItems) {
            this.ruleItems.push(k);
        }
    }

    /**
     * ルールのキーワード検索オプション生成
     * @return apid.GetRuleOption
     */
    private createSearchKeywordOption(): apid.GetRuleOption {
        const option: apid.GetRuleOption = {
            limit: RecordedUploadState.KEYWORD_SEARCH_LIMIT,
        };

        if (this.ruleKeyword !== null) {
            option.keyword = this.ruleKeyword;
        }

        return option;
    }

    /**
     * 放送局 item を返す
     * @return SelectorItem[]
     */
    public getChannelItems(): SelectorItem[] {
        return this.channelItems;
    }

    /**
     * 親ディレクトリ item を返す
     * @return string[]
     */
    public getPrentDirectoryItems(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null ? [] : config.recorded;
    }

    /**
     * ファイルタイプ item を返す
     * @return apid.VideoFileType[]
     */
    public getFileTypeItems(): apid.VideoFileType[] {
        return ['ts', 'encoded'];
    }

    /**
     * ジャンル item を返す
     * @return SelectorItem[]
     */
    public getGenreItems(): SelectorItem[] {
        return this.genreItems;
    }

    /**
     * サブジャンル items を返す
     * @return SelectorItem[]
     */
    public getSubGenreItems(): SelectorItem[] {
        return typeof this.programOption.genre1 === 'undefined' || this.programOption.genre1 < 0 || this.programOption.genre1 > GenreUtil.GENRE_MAX_NUM
            ? []
            : this.subGemreItems[this.programOption.genre1];
    }

    /**
     * videoFileItems に空要素追加
     */
    public addEmptyVideoFileItem(): void {
        this.videoFileItems.push({
            key: this.videoItemCnt,
            parentDirectoryName: this.getPrentDirectoryItems()[0],
            subDirectory: null,
            viewName: null,
            // 自動取得モードは放送 TS 前提なので ts を既定にする
            fileType: this.isAutoDetect === true ? 'ts' : undefined,
            file: null,
            fileSource: 'browser',
            localFilePath: null,
        });

        this.videoItemCnt++;
    }

    /**
     * 入力値のチェック
     * @return true 入力値に問題なければ true を返す
     */
    /**
     * 番組情報の自動取得モードを切り替える
     * @param isAutoDetect: boolean
     */
    public setAutoDetect(isAutoDetect: boolean): void {
        this.isAutoDetect = isAutoDetect;
        if (isAutoDetect === false) return;

        // 自動取得は拡張子 .ts のファイルが対象なので ts を既定にする。
        // tsreplace 出力のように encoded で登録したい場合もあるため、選択済みの値は変えない
        for (const video of this.videoFileItems) {
            if (typeof video.fileType === 'undefined') video.fileType = 'ts';
        }
    }

    public checkInput(): boolean {
        // 番組情報をサーバー側で補完する場合はビデオファイルの指定だけ確認する
        if (this.isAutoDetect === true) {
            return this.videoFileItems.length > 0 && this.checkVideoFileItemInput(this.videoFileItems[0]);
        }

        if (typeof this.programOption.channelId !== 'number') {
            return false;
        }

        if (this.programOption.startAt === null) {
            return false;
        }

        if (typeof this.programOption.duration !== 'number' || this.programOption.duration <= 0) {
            return false;
        }

        if (typeof this.programOption.name !== 'string') {
            return false;
        }

        if (this.videoFileItems.length === 0 || this.checkVideoFileItemInput(this.videoFileItems[0]) === false) {
            return false;
        }

        return true;
    }

    /**
     * ビデオファイル入力チェック
     * @param item: VideoFileItem
     * @return boolean
     */
    private checkVideoFileItemInput(item: VideoFileItem): boolean {
        if (typeof item.viewName !== 'string') {
            return false;
        }

        if (typeof item.fileType !== 'string') {
            return false;
        }

        if (typeof item.parentDirectoryName !== 'string') {
            return false;
        }

        // サーバー上のファイルを指定する場合はパスが、ブラウザからのアップロードならファイルが必要
        if (item.fileSource === 'server') {
            return typeof item.localFilePath === 'string' && item.localFilePath.length > 0;
        }

        if (typeof item.file === 'undefined' || item.file === null) {
            return false;
        }

        return true;
    }

    /**
     * 外部録画ファイル取り込み機能が有効か (featureFlags.externalFileImport)
     * @return boolean
     */
    public isExternalImportEnabled(): boolean {
        return isFeatureEnabled(this.serverConfig.getConfig(), 'externalFileImport');
    }

    /**
     * 取り込み許可ディレクトリ名一覧を返す
     * @return string[]
     */
    public getImportDirItems(): string[] {
        const config = this.serverConfig.getConfig();

        return config?.importDirs ?? [];
    }

    /**
     * 重複時の挙動の選択肢
     * @return apid.ImportDuplicateAction[]
     */
    public getImportDuplicateActionItems(): apid.ImportDuplicateAction[] {
        return ['skip', 'add', 'newRecorded'];
    }

    /**
     * 取り込みモードの選択肢
     * @return apid.ImportMode[]
     */
    public getImportModeItems(): apid.ImportMode[] {
        return ['register', 'move'];
    }

    /**
     * 指定した importDirName・subPath 配下をスキャンし、取り込み候補を取得する
     * @return Promise<void>
     */
    public async scanImportDirectory(): Promise<void> {
        if (typeof this.importDirName !== 'string') {
            throw new Error('ImportDirNameIsRequired');
        }

        this.importIsScanning = true;
        try {
            const result = await this.recordedApiModel.scanImportDirectory({
                importDirName: this.importDirName,
                subPath: typeof this.importSubPath === 'string' && this.importSubPath.length > 0 ? this.importSubPath : undefined,
                recursive: this.importRecursive,
            });

            this.importScanResults = result.items.map(item => {
                return <ImportScanRowItem>{
                    result: item,
                    selected: typeof item.duplicateRecordedIds === 'undefined' || item.duplicateRecordedIds.length === 0,
                    editedName: item.estimatedName ?? item.fileName,
                    editedChannelId: item.estimatedChannelId,
                    duplicateAction: typeof item.duplicateRecordedIds !== 'undefined' && item.duplicateRecordedIds.length > 0 ? 'skip' : 'newRecorded',
                    mode: 'register',
                };
            });
        } finally {
            this.importIsScanning = false;
        }
    }

    /**
     * サーバー上 (importDirs 配下) のファイルを列挙する
     * アップロード時のファイル選択用なので、TS 解析・重複判定は行わせない (analyze: false)
     * @param importDirName: string
     * @param subPath: string | null
     * @param recursive: boolean
     * @return Promise<ServerFileItem[]>
     */
    public async listServerFiles(importDirName: string, subPath: string | null, recursive: boolean): Promise<ServerFileItem[]> {
        const result = await this.recordedApiModel.scanImportDirectory({
            importDirName: importDirName,
            subPath: typeof subPath === 'string' && subPath.length > 0 ? subPath : undefined,
            recursive: recursive,
            analyze: false,
        });

        return result.items.map(item => {
            return <ServerFileItem>{
                filePath: item.filePath,
                fileName: item.fileName,
                size: item.size,
            };
        });
    }

    /**
     * 選択済みのスキャン結果を登録ジョブとして送信し、進捗のポーリングを開始する
     * @return Promise<void>
     */
    public async startImportRegistration(): Promise<void> {
        const selected = this.importScanResults.filter(row => row.selected === true);
        if (selected.length === 0) {
            throw new Error('NoImportItemSelected');
        }

        const items: apid.ImportRegisterItem[] = [];
        for (const row of selected) {
            if (typeof row.editedChannelId !== 'number' || typeof row.result.estimatedStartAt !== 'number') {
                throw new Error('ImportItemChannelOrStartAtMissing');
            }

            items.push({
                filePath: row.result.filePath,
                channelId: row.editedChannelId,
                name: row.editedName,
                startAt: row.result.estimatedStartAt,
                endAt: row.result.estimatedEndAt,
                parentDirectoryName: (this.importParentDirectoryName ?? this.getPrentDirectoryItems()[0]) as string,
                fileType: 'ts',
                mode: row.mode,
                duplicateAction: row.duplicateAction,
                duplicateRecordedId: row.result.duplicateRecordedIds?.[0],
            });
        }

        const { jobId } = await this.recordedApiModel.startImportJob({ items });
        this.startImportPolling(jobId);
    }

    /**
     * 直近のジョブの失敗ファイルのみを再実行する
     * @return Promise<void>
     */
    public async retryFailedImports(): Promise<void> {
        if (this.importJobStatus === null) {
            return;
        }

        const result = await this.recordedApiModel.retryImportJob(this.importJobStatus.jobId);
        if (result !== null) {
            this.startImportPolling(result.jobId);
        }
    }

    /**
     * ジョブの進捗を定期的に取得する
     * @param jobId: string
     */
    private startImportPolling(jobId: string): void {
        this.stopImportPolling();

        const poll = async () => {
            this.importJobStatus = await this.recordedApiModel.getImportJobStatus(jobId);
            if (this.importJobStatus !== null && this.importJobStatus.isRunning === true) {
                this.importPollingTimer = window.setTimeout(poll, RecordedUploadState.IMPORT_POLLING_INTERVAL_MS);
            }
        };

        poll();
    }

    private stopImportPolling(): void {
        if (typeof this.importPollingTimer !== 'undefined') {
            window.clearTimeout(this.importPollingTimer);
            this.importPollingTimer = undefined;
        }
    }

    /**
     * ファイルアップロード処理
     * @return Promise<void>
     */
    public async upload(): Promise<void> {
        if (this.checkInput() === false) {
            throw new Error('InputError');
        }

        // 自動取得モードでは番組情報を作らず、サーバーに TS を解析させて紐付けてもらう
        const recordedId = this.isAutoDetect === true ? null : await this.recordedApiModel.createNewRecorded(this.createProgramOption());

        for (const video of this.videoFileItems) {
            const isServerFile = video.fileSource === 'server';
            if (
                typeof video.parentDirectoryName !== 'string' ||
                typeof video.viewName !== 'string' ||
                video.viewName.length === 0 ||
                typeof video.fileType !== 'string' ||
                (isServerFile === true
                    ? typeof video.localFilePath !== 'string' || video.localFilePath.length === 0
                    : typeof video.file === 'undefined' || video.file === null)
            ) {
                continue;
            }

            const uploadVideoOption: apid.UploadVideoFileOption = {
                parentDirectoryName: video.parentDirectoryName,
                viewName: video.viewName,
                fileType: video.fileType as apid.VideoFileType,
            };
            if (isServerFile === true) {
                uploadVideoOption.localFilePath = video.localFilePath as string;
            } else {
                uploadVideoOption.file = video.file as File;
            }
            if (recordedId !== null) {
                uploadVideoOption.recordedId = recordedId;
            }
            if (typeof video.subDirectory === 'string' && video.subDirectory.length > 0) {
                uploadVideoOption.subDirectory = video.subDirectory;
            }

            try {
                await this.videoApiModel.uploadedVideoFile(uploadVideoOption);
            } catch (err) {
                // 自分で作った番組情報がある場合のみ後始末する
                // (自動取得モードはサーバー側でロールバックされる)
                if (recordedId !== null) {
                    await this.recordedApiModel.delete(recordedId).catch(e => {
                        console.error(e);
                    });
                }

                throw err;
            }
        }
    }

    /**
     * アップロードするビデオファイルの番組情報を生成する
     * @return apid.CreateNewRecordedOption
     */
    private createProgramOption(): apid.CreateNewRecordedOption {
        if (
            typeof this.programOption.channelId === 'undefined' ||
            this.programOption.startAt === null ||
            typeof this.programOption.duration !== 'number' ||
            typeof this.programOption.name !== 'string'
        ) {
            throw new Error('ProgramError');
        }

        const startAt = this.programOption.startAt.getTime();

        const option: apid.CreateNewRecordedOption = {
            channelId: this.programOption.channelId,
            startAt: startAt,
            endAt: startAt + this.programOption.duration * 60 * 1000,
            name: this.programOption.name,
        };

        if (typeof this.programOption.ruleId === 'number') {
            option.ruleId = this.programOption.ruleId;
        }

        if (typeof this.programOption.description === 'string') {
            option.description = this.programOption.description;
        }

        if (typeof this.programOption.extended === 'string') {
            option.extended = this.programOption.extended;
        }

        if (typeof this.programOption.genre1 === 'number') {
            option.genre1 = this.programOption.genre1;
        }

        if (typeof this.programOption.subGenre1 === 'number') {
            option.subGenre1 = this.programOption.subGenre1;
        }

        return option;
    }
}

namespace RecordedUploadState {
    export const KEYWORD_SEARCH_LIMIT = 1000;
    // 取り込みジョブの進捗ポーリング間隔 (ms)
    export const IMPORT_POLLING_INTERVAL_MS = 1500;
}

export default RecordedUploadState;
