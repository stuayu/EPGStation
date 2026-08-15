import { EventEmitter } from 'events';
import * as net from 'net';
import {
    AmatsukazeChangeItemType,
    AmatsukazeConsoleText,
    AmatsukazeQueueItem,
    AmatsukazeQueueState,
    AmatsukazeServerState,
    AmatsukazeUIData,
    IAmatsukazeRpcClient,
    RPCMethodId,
    ServerRequestName,
} from './IAmatsukazeRpcClient';
import AmatsukazeTextUtil from './AmatsukazeTextUtil';
import {
    buildContractXml,
    buildEnumXml,
    findChild,
    findChildren,
    getChildBoolean,
    getChildNumber,
    getChildText,
    isNil,
    parseXml,
    XmlNode,
} from './AmatsukazeXml';

/**
 * AmatsukazeServer の TCP RPC クライアント。
 *
 * プロトコル (nekopanda/Amatsukaze の ServerInterface.cs):
 * - ヘッダ 6 byte = int16 LE (RPCMethodId) + int32 LE (ペイロード長)
 * - ペイロードは [int32 LE 長さ][本体] のチャンク列。先頭チャンクが DataContract 形式の XML
 *   (2 つ目以降は画像データなので EPGStation では読み飛ばす)
 * - 接続後にクライアントから Request を送ると、サーバが該当する情報を push してくる
 *   (ハンドシェイク・認証は無い)
 */
export default class AmatsukazeRpcClient extends EventEmitter implements IAmatsukazeRpcClient {
    private static readonly HEADER_SIZE = 6;
    // 想定外のフレーム長でメモリを食い潰さないための上限 (ロゴ・DRCS 画像を含めても十分な大きさ)
    private static readonly MAX_PAYLOAD_SIZE = 64 * 1024 * 1024;

    private host: string;
    private port: number;
    private connectTimeoutMs: number;
    private socket: net.Socket | null = null;
    private buffer: Buffer = Buffer.alloc(0);
    private isClosed: boolean = false;

    constructor(host: string, port: number, connectTimeoutMs: number) {
        super();
        this.host = host;
        this.port = port;
        this.connectTimeoutMs = connectTimeoutMs;
    }

    /**
     * AmatsukazeServer へ接続する
     * @return Promise<void>
     */
    public connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const socket = new net.Socket();
            let settled = false;

            const timer = setTimeout(() => {
                if (settled === true) {
                    return;
                }
                settled = true;
                socket.destroy();
                reject(new Error(`connection to AmatsukazeServer timed out: ${this.host}:${this.port}`));
            }, this.connectTimeoutMs);

            socket.once('error', err => {
                clearTimeout(timer);
                if (settled === false) {
                    settled = true;
                    socket.destroy();
                    reject(err);

                    return;
                }
                this.emit('error', err);
            });

            socket.on('data', (data: Buffer | string) => {
                this.onData(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
            });

            socket.on('close', () => {
                this.socket = null;
                if (this.isClosed === false) {
                    this.emit('close');
                }
            });

            socket.connect(this.port, this.host, () => {
                clearTimeout(timer);
                if (settled === true) {
                    return;
                }
                settled = true;
                this.socket = socket;
                resolve();
            });
        });
    }

    /**
     * 接続を閉じる
     */
    public close(): void {
        this.isClosed = true;
        if (this.socket !== null) {
            this.socket.destroy();
            this.socket = null;
        }
    }

    /**
     * キュー・状態・コンソールの情報を要求する。
     * ServerRequest は [Flags] enum だが、複数フラグを 1 つの XML にまとめた際の表記に
     * 依存しないよう 1 種類ずつ送る
     * @return Promise<void>
     */
    public async requestAll(): Promise<void> {
        const requests: ServerRequestName[] = ['Queue', 'State', 'Console'];
        for (const request of requests) {
            await this.send(RPCMethodId.Request, buildEnumXml('ServerRequest', request));
        }
    }

    /**
     * キューアイテムを操作する (キャンセル・削除など)
     * @param itemId: number QueueItem の id
     * @param changeType: AmatsukazeChangeItemType
     * @return Promise<void>
     */
    public changeItem(itemId: number, changeType: AmatsukazeChangeItemType): Promise<void> {
        // DataContractSerializer はメンバをアルファベット順に並べる
        const xml = buildContractXml('ChangeItemData', [
            { name: 'ChangeType', value: changeType },
            { name: 'ItemId', value: itemId },
            { name: 'Position', value: 0 },
            { name: 'Priority', value: 0 },
            { name: 'Profile', value: null },
        ]);

        return this.send(RPCMethodId.ChangeItem, xml);
    }

    /**
     * RPC メッセージを送信する
     * @param methodId: RPCMethodId
     * @param xml: string | null 引数が無いメソッドは null
     * @return Promise<void>
     */
    private send(methodId: RPCMethodId, xml: string | null): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const socket = this.socket;
            if (socket === null) {
                reject(new Error('AmatsukazeServer is not connected'));

                return;
            }

            const payload = xml === null ? Buffer.alloc(0) : AmatsukazeRpcClient.createChunk(Buffer.from(xml, 'utf8'));
            const header = Buffer.alloc(AmatsukazeRpcClient.HEADER_SIZE);
            header.writeInt16LE(methodId, 0);
            header.writeInt32LE(payload.length, 2);

            socket.write(Buffer.concat([header, payload]), err => {
                if (typeof err === 'undefined' || err === null) {
                    resolve();
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * ペイロードの 1 チャンクを組み立てる
     * @param body: Buffer
     * @return Buffer
     */
    private static createChunk(body: Buffer): Buffer {
        const length = Buffer.alloc(4);
        length.writeInt32LE(body.length, 0);

        return Buffer.concat([length, body]);
    }

    /**
     * 受信データをフレーム単位に切り出す
     * @param data: Buffer
     */
    private onData(data: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, data]);

        for (;;) {
            if (this.buffer.length < AmatsukazeRpcClient.HEADER_SIZE) {
                return;
            }

            const methodId = this.buffer.readInt16LE(0);
            const payloadSize = this.buffer.readInt32LE(2);
            if (payloadSize < 0 || payloadSize > AmatsukazeRpcClient.MAX_PAYLOAD_SIZE) {
                // フレーム同期が壊れている。復帰できないので接続を切る
                this.emit('error', new Error(`invalid payload size received from AmatsukazeServer: ${payloadSize}`));
                this.close();

                return;
            }

            const frameSize = AmatsukazeRpcClient.HEADER_SIZE + payloadSize;
            if (this.buffer.length < frameSize) {
                return;
            }

            const payload = this.buffer.subarray(AmatsukazeRpcClient.HEADER_SIZE, frameSize);
            this.buffer = this.buffer.subarray(frameSize);

            try {
                this.handleFrame(methodId, payload);
            } catch (err: any) {
                this.emit('error', err instanceof Error ? err : new Error(String(err)));
            }
        }
    }

    /**
     * 1 フレームを解釈してイベントを発火する
     * @param methodId: number
     * @param payload: Buffer
     */
    private handleFrame(methodId: number, payload: Buffer): void {
        if (payload.length === 0) {
            return;
        }

        const chunks = AmatsukazeRpcClient.splitChunks(payload);
        if (chunks.length === 0) {
            return;
        }

        // 先頭チャンクが DataContract の XML (2 つ目以降は画像なので使わない)
        const root = parseXml(chunks[0].toString('utf8'));

        switch (methodId) {
            case RPCMethodId.OnUIData:
                this.emit('uiData', AmatsukazeRpcClient.parseUIData(root));
                break;
            case RPCMethodId.OnConsoleUpdate: {
                const consoleText = AmatsukazeRpcClient.parseConsoleUpdate(root);
                if (consoleText !== null) {
                    this.emit('consoleUpdate', consoleText);
                }
                break;
            }
            default:
                // 他のイベント (ロゴ・DRCS・プロファイル等) は使わない
                break;
        }
    }

    /**
     * ペイロードをチャンクへ分解する
     * @param payload: Buffer
     * @return Buffer[]
     */
    private static splitChunks(payload: Buffer): Buffer[] {
        const chunks: Buffer[] = [];
        let offset = 0;

        while (offset + 4 <= payload.length) {
            const size = payload.readInt32LE(offset);
            offset += 4;
            if (size < 0 || offset + size > payload.length) {
                break;
            }
            chunks.push(payload.subarray(offset, offset + size));
            offset += size;
        }

        return chunks;
    }

    /**
     * UIData の XML を解釈する
     * @param root: XmlNode
     * @return AmatsukazeUIData
     */
    private static parseUIData(root: XmlNode): AmatsukazeUIData {
        const result: AmatsukazeUIData = {};

        const queueData = findChild(root, 'QueueData');
        if (isNil(queueData) === false) {
            const items = findChild(queueData, 'Items');
            result.queueItems = findChildren(items, 'QueueItem').map(item => AmatsukazeRpcClient.parseQueueItem(item));
        }

        const queueUpdate = findChild(root, 'QueueUpdate');
        if (isNil(queueUpdate) === false) {
            const updateType = getChildText(queueUpdate, 'Type');
            if (updateType !== null) {
                result.updateType = updateType as AmatsukazeUIData['updateType'];
            }
            const item = findChild(queueUpdate, 'Item');
            if (isNil(item) === false && item !== null) {
                result.updatedItem = AmatsukazeRpcClient.parseQueueItem(item);
            }
        }

        const state = findChild(root, 'State');
        if (isNil(state) === false) {
            result.state = AmatsukazeRpcClient.parseState(state);
        }

        const consoleData = findChild(root, 'ConsoleData');
        if (isNil(consoleData) === false && consoleData !== null) {
            result.console = {
                index: getChildNumber(consoleData, 'index', -1),
                lines: findChildren(findChild(consoleData, 'text'), 'string').map(line => line.text),
            };
        }

        return result;
    }

    /**
     * QueueItem の XML を解釈する
     * @param node: XmlNode
     * @return AmatsukazeQueueItem
     */
    private static parseQueueItem(node: XmlNode): AmatsukazeQueueItem {
        const addTimeText = getChildText(node, 'AddTime');
        const addTime = addTimeText === null ? NaN : Date.parse(addTimeText);

        return {
            id: getChildNumber(node, 'Id', -1),
            srcPath: getChildText(node, 'SrcPath') ?? '',
            dstPath: getChildText(node, 'DstPath'),
            actualDstPath: getChildText(node, 'ActualDstPath'),
            state: (getChildText(node, 'State') ?? 'Queue') as AmatsukazeQueueState,
            priority: getChildNumber(node, 'Priority', 0),
            addTime: Number.isNaN(addTime) === true ? null : addTime,
            profileName: getChildText(node, 'ProfileName'),
            eventName: getChildText(node, 'EventName'),
            serviceName: getChildText(node, 'ServiceName'),
            failReason: getChildText(node, 'FailReason'),
            consoleId: getChildNumber(node, 'ConsoleId', -1),
            encodeTimeMs: AmatsukazeRpcClient.parseTimeSpan(getChildText(node, 'EncodeTime')),
        };
    }

    /**
     * State の XML を解釈する
     * @param node: XmlNode | null
     * @return AmatsukazeServerState
     */
    private static parseState(node: XmlNode | null): AmatsukazeServerState {
        return {
            pause: getChildBoolean(node, 'Pause'),
            suspend: getChildBoolean(node, 'Suspend'),
            running: getChildBoolean(node, 'Running'),
            progress: getChildNumber(node, 'Progress', 0),
        };
    }

    /**
     * ConsoleUpdate の XML を解釈する。data は byte[] (base64) で送られてくる
     * @param root: XmlNode
     * @return AmatsukazeConsoleText | null
     */
    private static parseConsoleUpdate(root: XmlNode): AmatsukazeConsoleText | null {
        const index = getChildNumber(root, 'index', -1);
        const base64 = getChildText(root, 'data');
        if (base64 === null) {
            return null;
        }

        // エンコーダのログは日本語 Windows の ANSI コードページ (cp932) で入っている
        const text = AmatsukazeTextUtil.decode(Buffer.from(base64, 'base64'));

        return {
            index: index,
            lines: text.split(/\r?\n/).filter(line => line.length > 0),
        };
    }

    /**
     * .NET の TimeSpan (ISO 8601 duration) を ms へ変換する
     * @param text: string | null
     * @return number | null 解釈できない場合は null
     */
    private static parseTimeSpan(text: string | null): number | null {
        if (text === null) {
            return null;
        }

        const matched = /^(-)?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(text);
        if (matched === null) {
            return null;
        }

        const days = matched[2] === undefined ? 0 : parseInt(matched[2], 10);
        const hours = matched[3] === undefined ? 0 : parseInt(matched[3], 10);
        const minutes = matched[4] === undefined ? 0 : parseInt(matched[4], 10);
        const seconds = matched[5] === undefined ? 0 : parseFloat(matched[5]);
        const total = ((days * 24 + hours) * 60 + minutes) * 60 * 1000 + seconds * 1000;

        return matched[1] === '-' ? -total : total;
    }
}
