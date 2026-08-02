import { randomUUID } from 'crypto';
import * as fs from 'fs';
import type internal from 'stream';
import type WebSocket from 'ws';
import { inject, injectable } from 'inversify';
import IChannelDB from '../../db/IChannelDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import IVideoUtil from '../../api/video/IVideoUtil';
import IDataBroadcastingManageModel, { DataBroadcastingParam } from './IDataBroadcastingManageModel';
import { loadDecodeTS, ResponseMessage } from './webBml';

interface DataBroadcastingStream {
    id: string;
    registeredAt: Date;
    ws: WebSocket;
    // 元データ (mirakurun のライブストリーム or 録画ファイルの ReadStream)
    readStream: internal.Readable;
    // decodeTS の出力先 (下流を持たない Transform)
    tsStream: internal.Transform;
    closed: boolean;
}

@injectable()
export default class DataBroadcastingManageModel implements IDataBroadcastingManageModel {
    // 既定の同時ストリーム数上限 (config.yml の dataBroadcasting.maxStreams で上書き可能)
    private static readonly DEFAULT_MAX_STREAMS = 4;
    // ws.bufferedAmount がこの値を超えている間は高頻度メッセージ (pcr / currentTime 等) を間引く
    private static readonly BACKPRESSURE_DROP_THRESHOLD = 8 * 1024 * 1024;
    // 間引いても解消しない場合にストリームを強制的に切断する閾値
    private static readonly BACKPRESSURE_CLOSE_THRESHOLD = 32 * 1024 * 1024;
    // moduleDownloaded は BML コンテンツそのものであり間引くと表示が壊れるため常に送る
    private static readonly ALWAYS_SEND_TYPES: ReadonlySet<ResponseMessage['type']> = new Set(['moduleDownloaded']);

    private log: ILogger;
    private config: IConfigFile;
    private channelDB: IChannelDB;
    private mirakurunClientModel: IMirakurunClientModel;
    private videoUtil: IVideoUtil;
    private streams: Map<string, DataBroadcastingStream> = new Map();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.channelDB = channelDB;
        this.mirakurunClientModel = mirakurunClientModel;
        this.videoUtil = videoUtil;
    }

    /**
     * WebSocket 1 本に対してデータ放送ストリームを開始する。
     * ライブ / 録画済みのどちらの元データも decodeTS (web-bml) へ流し込み、
     * デコード結果 (カルーセルのモジュール等) を WebSocket 経由で JSON として送る
     * @param ws: WebSocket
     * @param param: DataBroadcastingParam
     * @return Promise<void>
     */
    public async start(ws: WebSocket, param: DataBroadcastingParam): Promise<void> {
        const decodeTS = loadDecodeTS();

        let readStream: internal.Readable;
        try {
            readStream = await this.createSourceStream(param);
        } catch (err: any) {
            this.log.system.error('DataBroadcastingManageModel: failed to create source stream');
            this.log.system.error(err);
            this.sendError(ws, 'DataBroadcastingSourceError');
            ws.close(1011);

            return;
        }

        const id = randomUUID();
        // decodeTS は Transform を返すだけでこの時点では sendCallback を呼ばないが、
        // 万一同期的に呼ばれても壊れないよう entry は後から差し込む
        let entry: DataBroadcastingStream | null = null;
        const tsStream = decodeTS({
            sendCallback: msg => {
                if (entry === null) {
                    return;
                }
                this.send(entry, msg);
            },
            serviceId: param.demultiplexServiceId,
            parsePES: false,
        });

        entry = {
            id,
            registeredAt: new Date(),
            ws,
            readStream,
            tsStream,
            closed: false,
        };

        this.register(entry);

        readStream.pause();
        readStream.pipe(tsStream);
        // tsStream は下流を持たない Transform なので、resume しないと内部バッファが詰まって読み出しが止まる
        tsStream.resume();

        readStream.on('error', err => {
            this.log.system.error(`DataBroadcastingManageModel: read stream error: ${id}`);
            this.log.system.error(err);
            this.close(entry);
        });
        readStream.on('close', () => {
            this.close(entry);
        });

        ws.on('error', err => {
            this.log.system.error(`DataBroadcastingManageModel: ws error: ${id}`);
            this.log.system.error(err);
            this.close(entry);
        });
        ws.on('close', () => {
            this.close(entry);
        });
    }

    /**
     * param に応じて元データの ReadStream を作る
     * @param param: DataBroadcastingParam
     * @return Promise<internal.Readable>
     */
    private async createSourceStream(param: DataBroadcastingParam): Promise<internal.Readable> {
        if (param.type === 'epgStationLive') {
            const channel = await this.channelDB.findId(param.channelId);
            if (channel === null) {
                throw new Error(`ChannelIsNotFound: ${param.channelId}`);
            }

            const mirakurun = this.mirakurunClientModel.getClient();
            mirakurun.priority = this.config.streamingPriority;

            return await mirakurun.getServiceStream(channel.id, true, this.config.streamingPriority);
        }

        const filePath = await this.videoUtil.getFullFilePathFromId(param.videoFileId);
        if (filePath === null) {
            throw new Error(`VideoFileIsNotFound: ${param.videoFileId}`);
        }

        return fs.createReadStream(filePath, { start: param.seek ?? 0 });
    }

    /**
     * ストリームを登録する。上限を超えている場合は最も古いものを閉じる
     * (web-bml の registerDataBroadcastingStream と同じ挙動)
     * @param entry: DataBroadcastingStream
     */
    private register(entry: DataBroadcastingStream): void {
        const maxStreams = this.config.dataBroadcasting?.maxStreams ?? DataBroadcastingManageModel.DEFAULT_MAX_STREAMS;

        if (this.streams.size >= maxStreams) {
            const oldest = [...this.streams.values()].sort(
                (a, b) => a.registeredAt.getTime() - b.registeredAt.getTime(),
            )[0];
            if (typeof oldest !== 'undefined') {
                this.log.system.warn(
                    `DataBroadcastingManageModel: max streams (${maxStreams}) exceeded. closing oldest: ${oldest.id}`,
                );
                this.sendError(oldest.ws, 'The maximum number of streams has been exceeded.');
                this.close(oldest);
            }
        }

        this.streams.set(entry.id, entry);
    }

    /**
     * WebSocket へメッセージを送る。backpressure が大きい場合は間引き、
     * さらに大きい場合はストリームごと切断する
     * @param entry: DataBroadcastingStream
     * @param msg: ResponseMessage
     */
    private send(entry: DataBroadcastingStream, msg: ResponseMessage): void {
        if (entry.closed === true || entry.ws.readyState !== entry.ws.OPEN) {
            return;
        }

        const bufferedAmount = entry.ws.bufferedAmount;
        if (bufferedAmount > DataBroadcastingManageModel.BACKPRESSURE_CLOSE_THRESHOLD) {
            this.log.system.error(
                `DataBroadcastingManageModel: backpressure exceeded close threshold. closing: ${entry.id}`,
            );
            this.close(entry);

            return;
        }

        if (
            bufferedAmount > DataBroadcastingManageModel.BACKPRESSURE_DROP_THRESHOLD &&
            DataBroadcastingManageModel.ALWAYS_SEND_TYPES.has(msg.type) === false
        ) {
            return;
        }

        try {
            entry.ws.send(JSON.stringify(msg));
        } catch (err: any) {
            this.log.system.error(`DataBroadcastingManageModel: ws send error: ${entry.id}`);
            this.log.system.error(err);
            this.close(entry);
        }
    }

    /**
     * WebSocket へエラーメッセージを送る
     * @param ws: WebSocket
     * @param message: string
     */
    private sendError(ws: WebSocket, message: string): void {
        if (ws.readyState !== ws.OPEN) {
            return;
        }

        try {
            ws.send(JSON.stringify({ type: 'error', message } as ResponseMessage));
        } catch (err: any) {
            this.log.system.error('DataBroadcastingManageModel: failed to send error message');
            this.log.system.error(err);
        }
    }

    /**
     * ストリームを閉じて後始末する
     * @param entry: DataBroadcastingStream
     */
    private close(entry: DataBroadcastingStream): void {
        if (this.streams.has(entry.id) === false || entry.closed === true) {
            return;
        }
        entry.closed = true;
        this.streams.delete(entry.id);

        entry.readStream.unpipe();
        entry.readStream.destroy();
        entry.tsStream.unpipe();
        entry.tsStream.removeAllListeners();
        entry.tsStream.destroy();

        if (entry.ws.readyState === entry.ws.OPEN || entry.ws.readyState === entry.ws.CONNECTING) {
            entry.ws.close(4000);
        }
    }
}
