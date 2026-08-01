import { ChildProcess } from 'child_process';
import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import IAppSettingChangeEvent from '../event/IAppSettingChangeEvent';
import IOperatorEncodeEvent, { OperatorFinishEncodeInfo } from '../event/IOperatorEncodeEvent';
import IImportJobManageModel, { ImportJobId } from '../operator/recorded/IImportJobManageModel';
import IRecordedManageModel, {
    AddVideoFileOption,
    ImportedExternalRecordedFileOption,
    UploadedVideoFileOption,
} from '../operator/recorded/IRecordedManageModel';
import IRecordedTagManadeModel from '../operator/recordedTag/IRecordedTagManadeModel';
import IRecordingManageModel from '../operator/recording/IRecordingManageModel';
import IReservationManageModel from '../operator/reservation/IReservationManageModel';
import IRuleManageModel from '../operator/rule/IRuleManageModel';
import ISeriesBackfillManageModel, { SeriesBackfillOption } from '../operator/series/ISeriesBackfillManageModel';
import IThumbnailManageModel from '../operator/thumbnail/IThumbnailManageModel';
import IUpdateManageModel from '../update/IUpdateManageModel';
import IIPCServer from './IIPCServer';
import {
    AppSettingFunctions,
    OperatorEncodeEventFunctions,
    ModelName,
    NotifyClientMessage,
    NotifyOnAirProgramMessage,
    PushEncodeMessage,
    RecordedFunctions,
    RecordedTagFunctions,
    RecordingFunctions,
    ReplayMessage,
    ReserveationFunctions,
    RuleFuntions,
    SendMessage,
    SeriesFunctions,
    ThumbnailFunctions,
    UpdateFunctions,
} from './IPCMessageDefine';

interface IFunctionIndex {
    [functionName: string]: (msg: SendMessage) => Promise<any>;
}

@injectable()
export default class IPCServer implements IIPCServer {
    private reservationManage: IReservationManageModel;
    private recordedManage: IRecordedManageModel;
    private importJobManage: IImportJobManageModel;
    private recordedTagManage: IRecordedTagManadeModel;
    private recordingManage: IRecordingManageModel;
    private ruleManage: IRuleManageModel;
    private thumbnailManage: IThumbnailManageModel;
    private encodeEvent: IOperatorEncodeEvent;
    private seriesBackfillManage: ISeriesBackfillManageModel;
    private appSettingChangeEvent: IAppSettingChangeEvent;
    private updateManage: IUpdateManageModel;
    private child: ChildProcess | null = null;
    private functions: {
        [modelName: string]: IFunctionIndex;
    } = {};

    constructor(
        @inject('IReservationManageModel')
        reservationManage: IReservationManageModel,
        @inject('IRecordedManageModel') recordedManage: IRecordedManageModel,
        @inject('IImportJobManageModel') importJobManage: IImportJobManageModel,
        @inject('IRecordedTagManadeModel') recordedTagManage: IRecordedTagManadeModel,
        @inject('IRecordingManageModel') recordingManage: IRecordingManageModel,
        @inject('IRuleManageModel') ruleManage: IRuleManageModel,
        @inject('IThumbnailManageModel') thumbnailManage: IThumbnailManageModel,
        @inject('IOperatorEncodeEvent') encodeEvent: IOperatorEncodeEvent,
        @inject('ISeriesBackfillManageModel') seriesBackfillManage: ISeriesBackfillManageModel,
        @inject('IAppSettingChangeEvent') appSettingChangeEvent: IAppSettingChangeEvent,
        @inject('IUpdateManageModel') updateManage: IUpdateManageModel,
    ) {
        this.reservationManage = reservationManage;
        this.recordedManage = recordedManage;
        this.importJobManage = importJobManage;
        this.recordedTagManage = recordedTagManage;
        this.recordingManage = recordingManage;
        this.ruleManage = ruleManage;
        this.thumbnailManage = thumbnailManage;
        this.encodeEvent = encodeEvent;
        this.seriesBackfillManage = seriesBackfillManage;
        this.appSettingChangeEvent = appSettingChangeEvent;
        this.updateManage = updateManage;

        this.init();
    }

    public register(child: ChildProcess): void {
        this.child = child;

        this.child.on('message', async (msg: SendMessage) => {
            if (
                typeof this.functions[msg.model] !== 'undefined' &&
                typeof this.functions[msg.model][msg.func] !== 'undefined'
            ) {
                // 指定された関数が存在するなら実行
                try {
                    const result = await this.functions[msg.model][msg.func](msg);
                    this.replay({
                        id: msg.id,
                        result: result,
                    });
                } catch (err: any) {
                    this.replay({
                        id: msg.id,
                        error: err.message,
                    });
                }
            } else {
                this.replay({
                    id: msg.id,
                    error: 'IPCFunctionError',
                });
            }
        });
    }

    /**
     * 子プロセスに socket.io による状態更新通知を依頼する
     */
    public notifyClient(): void {
        if (this.child === null) {
            return;
        }

        this.child.send(<any>(<NotifyClientMessage>{
            type: 'notifyClient',
        }));
    }

    /**
     * EIT[p/f] 相当の更新をクライアントへ通知する
     * @param channelIds: number[] 対象の放送局
     */
    public notifyOnAirProgramClient(channelIds: number[]): void {
        if (this.child === null) {
            return;
        }

        this.child.send(<any>(<NotifyOnAirProgramMessage>{
            type: 'notifyOnAirProgram',
            value: { channelIds },
        }));
    }

    /**
     * クライアントへエンコードを依頼する
     * @param addOption: apid.AddEncodeProgramOption
     */
    public setEncode(addOption: apid.AddEncodeProgramOption): void {
        if (this.child === null) {
            throw new Error('ChildIsNull');
        }

        this.child.send(<any>(<PushEncodeMessage>{
            type: 'pushEncode',
            value: addOption,
        }));
    }

    /**
     * 応答メッセージ送信
     * @param msg: ReplayMessage
     */
    private replay(msg: ReplayMessage): void {
        if (this.child === null) {
            throw new Error('IPCSendReplayError');
        }

        this.child.send(msg);
    }

    /**
     * 関数登録処理
     */
    private init(): void {
        this.functions[ModelName.reserveation] = this.getReserveationFunctions();
        this.functions[ModelName.recorded] = this.getRecordedFunctions();
        this.functions[ModelName.recordedTag] = this.getRecordedTagFunctions();
        this.functions[ModelName.recording] = this.getRecordingFunctions();
        this.functions[ModelName.rule] = this.getRuleFunctions();
        this.functions[ModelName.thumbnail] = this.getThumbnailFunctions();
        this.functions[ModelName.encodeEvent] = this.getOperatorEncodeEventFunctions();
        this.functions[ModelName.series] = this.getSeriesFunctions();
        this.functions[ModelName.appSetting] = this.getAppSettingFunctions();
        this.functions[ModelName.update] = this.getUpdateFunctions();
    }

    /**
     * set update functions
     * 更新は git 操作・ビルド・プロセス再起動を伴うため Operator (親) 側で実行する
     */
    private getUpdateFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        index[UpdateFunctions.getStatus] = async () => {
            return await this.updateManage.getStatus();
        };
        index[UpdateFunctions.check] = async () => {
            return await this.updateManage.check();
        };
        index[UpdateFunctions.run] = async msg => {
            const option = this.getArgsValue<any>(msg, 'option');
            return await this.updateManage.run(option ?? {});
        };
        index[UpdateFunctions.getJob] = async () => {
            return this.updateManage.getJob();
        };
        index[UpdateFunctions.restart] = async () => {
            return this.updateManage.restartApplication();
        };

        return index;
    }

    /**
     * set app setting (hot reload) functions
     */
    private getAppSettingFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // notifyChanged: システム設定が更新されたことを Operator 側へ伝える。
        // 対象モジュールは DB を都度読み直す実装のため、ここでは録画中の処理に影響しない
        // イベント発行のみを行う (fire-and-forget)
        index[AppSettingFunctions.notifyChanged] = async msg => {
            const keys = this.getArgsValue<string[]>(msg, 'keys');
            this.appSettingChangeEvent.emitChanged(keys);
        };

        return index;
    }

    /**
     * set reserveation functions
     */
    private getReserveationFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // getBroadcastStatus
        index[ReserveationFunctions.getBroadcastStatus] = async () => {
            return this.reservationManage.getBroadcastStatus();
        };

        // add
        index[ReserveationFunctions.add] = async msg => {
            const option = this.getArgsValue<apid.ManualReserveOption>(msg, 'option');

            return await this.reservationManage.add(option);
        };

        // update
        index[ReserveationFunctions.update] = async msg => {
            const reserveId = this.getArgsValue<apid.ReserveId>(msg, 'reserveId');
            await this.reservationManage.update(reserveId);
        };

        // updateRule
        index[ReserveationFunctions.updateRule] = async msg => {
            const ruleId = this.getArgsValue<apid.RuleId>(msg, 'ruleId');
            await this.reservationManage.updateRule(ruleId);
        };

        // updateAll
        index[ReserveationFunctions.updateAll] = async msg => {
            const isUntilComplete = this.getArgsValue<boolean>(msg, 'isUntilComplete');

            if (isUntilComplete === true) {
                await this.reservationManage.updateAll();
            } else {
                this.reservationManage.updateAll();
            }
        };

        // cancel
        index[ReserveationFunctions.cancel] = async msg => {
            const reserveId = this.getArgsValue<apid.ReserveId>(msg, 'reserveId');
            await this.reservationManage.cancel(reserveId);
        };

        // removeSkip
        index[ReserveationFunctions.removeSkip] = async msg => {
            const reserveId = this.getArgsValue<apid.ReserveId>(msg, 'reserveId');
            await this.reservationManage.removeSkip(reserveId);
        };

        // removeOverlap
        index[ReserveationFunctions.removeOverlap] = async msg => {
            const reserveId = this.getArgsValue<apid.ReserveId>(msg, 'reserveId');
            await this.reservationManage.removeOverlap(reserveId);
        };

        // edit
        index[ReserveationFunctions.edit] = async msg => {
            const reserveId = this.getArgsValue<apid.ReserveId>(msg, 'reserveId');
            const option = this.getArgsValue<apid.EditManualReserveOption>(msg, 'option');
            await this.reservationManage.edit(reserveId, option);
        };

        return index;
    }

    /**
     * set recorded functions
     */
    private getRecordedFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // delete
        index[RecordedFunctions.delete] = async msg => {
            const recordedId = this.getArgsValue<apid.RecordedId>(msg, 'recordedId');

            await this.recordedManage.delete(recordedId);
        };

        // updateVideoFileSize
        index[RecordedFunctions.updateVideoFileSize] = async msg => {
            const videoFileId = this.getArgsValue<apid.VideoFileId>(msg, 'videoFileId');

            await this.recordedManage.updateVideoFileSize(videoFileId);
        };

        // addVideoFile
        index[RecordedFunctions.addVideoFile] = async msg => {
            const option = this.getArgsValue<AddVideoFileOption>(msg, 'option');

            return await this.recordedManage.addVideoFile(option);
        };

        // addUploadedVideoFile
        index[RecordedFunctions.addUploadedVideoFile] = async msg => {
            const option = this.getArgsValue<UploadedVideoFileOption>(msg, 'option');

            return await this.recordedManage.addUploadedVideoFile(option);
        };

        // createNewRecorded
        index[RecordedFunctions.createNewRecorded] = async msg => {
            const option = this.getArgsValue<apid.CreateNewRecordedOption>(msg, 'option');

            return await this.recordedManage.createNewRecorded(option);
        };

        // deleteVideoFile
        index[RecordedFunctions.deleteVideoFile] = async msg => {
            const videoFileId = this.getArgsValue<apid.VideoFileId>(msg, 'videoFileId');

            await this.recordedManage.deleteVideoFile(videoFileId);
        };

        // changeProtect
        index[RecordedFunctions.changeProtect] = async msg => {
            const recordedId = this.getArgsValue<apid.RecordedId>(msg, 'recordedId');
            const isProtect = this.getArgsValue<boolean>(msg, 'isProtect');

            await this.recordedManage.changeProtect(recordedId, isProtect);
        };

        // getCleanupInfo
        index[RecordedFunctions.getCleanupInfo] = async () => {
            return await this.recordedManage.getCleanupInfo();
        };

        // videoFileCleanup
        index[RecordedFunctions.videoFileCleanup] = async () => {
            await this.recordedManage.videoFileCleanup();
        };

        // dropLogFileCleanup
        index[RecordedFunctions.dropLogFileCleanup] = async () => {
            await this.recordedManage.dropLogFileCleanup();
        };

        // startImportJob
        index[RecordedFunctions.startImportJob] = async msg => {
            const items = this.getArgsValue<ImportedExternalRecordedFileOption[]>(msg, 'items');

            return this.importJobManage.start(items);
        };

        // getImportJobStatus
        index[RecordedFunctions.getImportJobStatus] = async msg => {
            const jobId = this.getArgsValue<ImportJobId>(msg, 'jobId');

            return this.importJobManage.getStatus(jobId);
        };

        // retryImportJob
        index[RecordedFunctions.retryImportJob] = async msg => {
            const jobId = this.getArgsValue<ImportJobId>(msg, 'jobId');

            return this.importJobManage.retryFailed(jobId);
        };

        return index;
    }

    /**
     * set recordedTag functions
     */
    private getRecordedTagFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        index[RecordedTagFunctions.create] = async msg => {
            const name = this.getArgsValue<string>(msg, 'name');
            const color = this.getArgsValue<string>(msg, 'color');
            const parentId = msg.args?.parentId as number | null | undefined;

            return await this.recordedTagManage.create(name, color, parentId);
        };

        index[RecordedTagFunctions.update] = async msg => {
            const tagId = this.getArgsValue<apid.RecordedTagId>(msg, 'tagId');
            const name = this.getArgsValue<string>(msg, 'name');
            const color = this.getArgsValue<string>(msg, 'color');
            const parentId = msg.args?.parentId as number | null | undefined;

            await this.recordedTagManage.update(tagId, name, color, parentId);
        };

        index[RecordedTagFunctions.setRelation] = async msg => {
            const tagId = this.getArgsValue<apid.RecordedTagId>(msg, 'tagId');
            const recordedId = this.getArgsValue<apid.RecordedId>(msg, 'recordedId');

            await this.recordedTagManage.setRelation(tagId, recordedId);
        };

        index[RecordedTagFunctions.delete] = async msg => {
            const tagId = this.getArgsValue<apid.RecordedTagId>(msg, 'tagId');

            await this.recordedTagManage.delete(tagId);
        };

        index[RecordedTagFunctions.deleteRelation] = async msg => {
            const tagId = this.getArgsValue<apid.RecordedTagId>(msg, 'tagId');
            const recordedId = this.getArgsValue<apid.RecordedId>(msg, 'recordedId');

            await this.recordedTagManage.deleteRelation(tagId, recordedId);
        };

        return index;
    }

    /**
     * set recording functions
     */
    private getRecordingFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // resetTimer
        index[RecordingFunctions.resetTimer] = async () => {
            this.recordingManage.resetTimer();
        };

        return index;
    }

    /**
     * set rule functions
     */
    private getRuleFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // add
        index[RuleFuntions.add] = async msg => {
            const rule = this.getArgsValue<apid.AddRuleOption>(msg, 'rule');

            return await this.ruleManage.add(rule);
        };

        // update
        index[RuleFuntions.update] = async msg => {
            const rule = this.getArgsValue<apid.Rule>(msg, 'rule');

            await this.ruleManage.update(rule);
        };

        // enable
        index[RuleFuntions.enable] = async msg => {
            const ruleId = this.getArgsValue<apid.RuleId>(msg, 'ruleId');

            await this.ruleManage.enable(ruleId);
        };

        // disable
        index[RuleFuntions.disable] = async msg => {
            const ruleId = this.getArgsValue<apid.RuleId>(msg, 'ruleId');

            await this.ruleManage.disable(ruleId);
        };

        // delete
        index[RuleFuntions.delete] = async msg => {
            const ruleId = this.getArgsValue<apid.RuleId>(msg, 'ruleId');

            await this.ruleManage.delete(ruleId);
        };

        // deletes
        index[RuleFuntions.deletes] = async msg => {
            const ruleIds = this.getArgsValue<apid.RuleId[]>(msg, 'ruleIds');

            await this.ruleManage.deletes(ruleIds);
        };

        return index;
    }

    /**
     * set thumbnail functions
     */
    private getThumbnailFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // regenerate
        index[ThumbnailFunctions.regenerate] = async () => {
            await this.thumbnailManage.regenerate();
        };

        // fileCleanup
        index[ThumbnailFunctions.fileCleanup] = async () => {
            await this.thumbnailManage.fileCleanup();
        };

        // add
        index[ThumbnailFunctions.add] = async msg => {
            const videoFileId = this.getArgsValue<apid.VideoFileId>(msg, 'videoFileId');

            this.thumbnailManage.add(videoFileId);
        };

        // delete
        index[ThumbnailFunctions.delete] = async msg => {
            const thumbnailId = this.getArgsValue<apid.ThumbnailId>(msg, 'thumbnailId');

            await this.thumbnailManage.delete(thumbnailId);
        };

        return index;
    }

    /**
     * set operator encode event functions
     */
    private getOperatorEncodeEventFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // emitFinishEncode
        index[OperatorEncodeEventFunctions.emitFinishEncode] = async msg => {
            const info = this.getArgsValue<OperatorFinishEncodeInfo>(msg, 'info');

            this.encodeEvent.emitFinishEncode(info);
        };

        return index;
    }

    /**
     * set series (backfill) functions
     */
    private getSeriesFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // startBackfill
        index[SeriesFunctions.startBackfill] = async msg => {
            const option = this.getArgsValue<SeriesBackfillOption>(msg, 'option');

            return await this.seriesBackfillManage.start(option);
        };

        // getBackfillStatus
        index[SeriesFunctions.getBackfillStatus] = async () => {
            return await this.seriesBackfillManage.getStatus();
        };

        // cancelBackfill
        index[SeriesFunctions.cancelBackfill] = async () => {
            await this.seriesBackfillManage.cancel();
        };

        // analyze (録画 1 件のシリーズ判定 + トレース)
        index[SeriesFunctions.analyze] = async msg => {
            const recordedId = this.getArgsValue<apid.RecordedId>(msg, 'recordedId');

            return await this.seriesBackfillManage.analyze(recordedId);
        };

        return index;
    }

    /**
     * SendMessage.args から指定した引数を取り出す
     * @param msg: SendMessage
     * @param argsName: 引数名
     * @return T
     */
    private getArgsValue<T>(msg: SendMessage, argsName: string): T {
        if (typeof msg.args === 'undefined' || typeof msg.args[argsName] === 'undefined') {
            throw new Error('IPCArgsError');
        }

        return <T>msg.args[argsName];
    }
}
