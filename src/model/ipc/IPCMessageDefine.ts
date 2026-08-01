import * as apid from '../../../api';

export type MessageId = number;

/**
 * 親プロセスから子プロセスへのメッセージ
 */
export interface ParentMessage {
    type: 'pushEncode' | 'notifyClient' | 'notifyOnAirProgram';
    value?: any;
}

/**
 * EIT[p/f] 相当の更新通知。視聴画面・番組表を即時更新させるため、
 * 対象の放送局 id を添えて socket.io で配る
 */
export interface NotifyOnAirProgramMessage extends ParentMessage {
    type: 'notifyOnAirProgram';
    value: { channelIds: number[] };
}

/**
 * クライアントへのステータス更新通知メッセージ
 */
export interface NotifyClientMessage extends ParentMessage {
    type: 'notifyClient';
}

export interface PushEncodeMessage extends ParentMessage {
    type: 'pushEncode';
    value: apid.AddEncodeProgramOption;
}

/**
 * 子プロセスからメッセージ送信時に使用するオプション
 */
export interface ClientMessageOption {
    model: ModelName;
    func: string;
    args?: any;
}

/**
 * 子プロセスから送信されるメッセージ
 */
export interface SendMessage extends ClientMessageOption {
    id: MessageId;
}

/**
 * 子プロセスから送信されたメッセージに対する応答メッセージ
 */
export interface ReplayMessage {
    id: MessageId;
    result?: any;
    error?: string;
}

/**
 * モデル名
 */
export enum ModelName {
    recorded = 'recorded',
    recording = 'recording',
    recordedTag = 'recordedTag',
    reserveation = 'reserveation',
    rule = 'rule',
    thumbnail = 'thumbnail',
    encodeEvent = 'encodeEvent',
    series = 'series',
    appSetting = 'appSetting',
    update = 'update',
}

/**
 * reserveation の関数定義
 */
export enum ReserveationFunctions {
    getBroadcastStatus = 'getBroadcastStatus',
    add = 'add',
    update = 'update',
    updateRule = 'updateRule',
    updateAll = 'updateAll',
    cancel = 'cancel',
    removeSkip = 'removeSkip',
    removeOverlap = 'removeOverlap',
    edit = 'edit',
    clean = 'clean',
}

/**
 * recorded の関数定義
 */
export enum RecordedFunctions {
    delete = 'delete',
    updateVideoFileSize = 'updateVideoFileSize',
    addVideoFile = 'addVideoFile',
    addUploadedVideoFile = 'addUploadedVideoFile',
    createNewRecorded = 'createNewRecorded',
    deleteVideoFile = 'deleteVideoFile',
    changeProtect = 'changeProtect',
    getCleanupInfo = 'getCleanupInfo',
    videoFileCleanup = 'videoFileCleanup',
    dropLogFileCleanup = 'dropLogFileCleanup',
    startImportJob = 'startImportJob',
    getImportJobStatus = 'getImportJobStatus',
    retryImportJob = 'retryImportJob',
}

/**
 * recordedTag の関数定義
 */
export enum RecordedTagFunctions {
    create = 'create',
    update = 'update',
    setRelation = 'setRelation',
    delete = 'delete',
    deleteRelation = 'deleteRelation',
}

/**
 * Recording の関数定義
 */
export enum RecordingFunctions {
    resetTimer = 'resetTimer',
}

/**
 * Rule の関数定義
 */
export enum RuleFuntions {
    add = 'add',
    update = 'update',
    enable = 'enable',
    disable = 'disable',
    delete = 'delete',
    deletes = 'deletes',
}

/**
 * Thumbnail の関数定義
 */
export enum ThumbnailFunctions {
    regenerate = 'regenerate',
    fileCleanup = 'fileCleanup',
    add = 'add',
    delete = 'delete',
}

/**
 * encode event の関数定義
 */
export enum OperatorEncodeEventFunctions {
    emitFinishEncode = 'emitFinishEncode',
}

/**
 * series (バックフィル) の関数定義
 */
export enum SeriesFunctions {
    startBackfill = 'startBackfill',
    getBackfillStatus = 'getBackfillStatus',
    cancelBackfill = 'cancelBackfill',
    analyze = 'analyze',
}

/**
 * システム設定 (app_setting) のホットリロード通知関数定義 (§6.3)。
 * Service プロセス (Web API) で設定が更新された際、Operator プロセス側の
 * 対象モジュール (メタデータプロバイダー・通知) だけを再初期化するために使う。
 * 録画中の処理には一切影響しないよう、単なる「変更があった」という通知に留める
 */
export enum AppSettingFunctions {
    notifyChanged = 'notifyChanged',
}

/**
 * バージョン更新の関数定義。
 * 更新は git 操作・ビルド・プロセス再起動を伴うため、Service (子) ではなく
 * Operator (親) 側で実行する必要がある
 */
export enum UpdateFunctions {
    getStatus = 'getStatus',
    check = 'check',
    run = 'run',
    getJob = 'getJob',
    restart = 'restart',
}
